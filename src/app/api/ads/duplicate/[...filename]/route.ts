import { handleApiError } from '@/lib/api/error-handler';
import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth/middleware';
import { findAdByFile, readAd, writeAd } from '@/lib/yaml/ads';
import path from 'path';
import { mkdir, copyFile } from 'fs/promises';
import { existsSync } from 'fs';
import { globSync } from 'glob';

const BOT_MANAGED_FIELDS = new Set([
  'id',
  'created_on',
  'updated_on',
  'content_hash',
  'repost_count',
  'price_reduction_count',
]);
const ALLOWED_IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp']);

interface RouteContext {
  params: Promise<{ filename: string[] }>;
}

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const user = await getCurrentUser(request);
    if (!user) {
      return NextResponse.json({ detail: 'Authentication required' }, { status: 401 });
    }

    const { filename } = await context.params;
    const filePath = filename.join('/');
    const ws = user.workspace;

    const result = await findAdByFile(filePath, ws);
    if (!result) {
      return NextResponse.json({ detail: `Ad file ${filePath} not found` }, { status: 404 });
    }

    const { path: srcPath, ad } = result;

    // Remove bot-managed fields
    const newAd: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(ad)) {
      if (!BOT_MANAGED_FIELDS.has(k)) {
        newAd[k] = v;
      }
    }
    newAd.title = `Kopie von ${(ad.title as string) ?? 'Anzeige'}`;

    // Generate unique directory + filename
    let slug = (newAd.title as string)
      .toLowerCase()
      .replace(/ /g, '_')
      .replace(/[–—]/g, '')
      .slice(0, 60);
    slug = slug.replace(/[^a-z0-9_]/g, '');

    const baseName = `ad_${slug}`;
    const adsDir = path.join(ws, 'ads');
    let destDir = path.join(adsDir, baseName);
    let counter = 1;
    while (existsSync(destDir)) {
      destDir = path.join(adsDir, `${baseName}_${counter}`);
      counter++;
    }
    await mkdir(destDir, { recursive: true });
    const dest = path.join(destDir, `${path.basename(destDir)}.yaml`);

    // Copy images from source to new directory
    const srcDir = path.dirname(srcPath);
    const copiedImages: string[] = [];
    for (const pattern of (ad.images as string[]) ?? []) {
      const matches = globSync(path.join(srcDir, pattern));
      for (const match of matches) {
        const ext = path.extname(match).toLowerCase();
        if (ALLOWED_IMAGE_EXTENSIONS.has(ext) && existsSync(match)) {
          const name = path.basename(match);
          await copyFile(match, path.join(destDir, name));
          copiedImages.push(name);
        }
      }
    }
    if (copiedImages.length > 0) {
      newAd.images = copiedImages;
    }

    await writeAd(dest, newAd);
    return NextResponse.json({
      message: 'Ad duplicated',
      file: path.relative(ws, dest),
      data: newAd,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
