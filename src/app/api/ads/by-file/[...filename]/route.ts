import { handleApiError } from '@/lib/api/error-handler';
import { NextRequest, NextResponse } from 'next/server';
import { adUpdateSchema } from '@/validation/schemas';
import { getCurrentUser } from '@/lib/auth/middleware';
import { findAdByFile, readAd, writeAd, applyAdUpdates } from '@/lib/yaml/ads';
import path from 'path';
import { unlink, rm } from 'fs/promises';
import { existsSync, readdirSync } from 'fs';
import { globSync } from 'glob';

const ALLOWED_IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp']);

interface RouteContext {
  params: Promise<{ filename: string[] }>;
}

export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const user = await getCurrentUser(request);
    if (!user) {
      return NextResponse.json({ detail: 'Authentication required' }, { status: 401 });
    }

    const { filename } = await context.params;
    const filePath = filename.join('/');

    const result = await findAdByFile(filePath, user.workspace);
    if (!result) {
      return NextResponse.json({ detail: `File ${filePath} not found` }, { status: 404 });
    }

    const { path: resolvedPath, ad } = result;
    ad.file = path.relative(user.workspace, resolvedPath);
    return NextResponse.json(ad);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PUT(request: NextRequest, context: RouteContext) {
  try {
    const user = await getCurrentUser(request);
    if (!user) {
      return NextResponse.json({ detail: 'Authentication required' }, { status: 401 });
    }

    const { filename } = await context.params;
    const filePath = filename.join('/');

    const body = await request.json();
    const parsed = adUpdateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { detail: parsed.error.issues[0]?.message ?? 'Invalid input' },
        { status: 400 },
      );
    }

    const result = await findAdByFile(filePath, user.workspace);
    if (!result) {
      return NextResponse.json({ detail: `File ${filePath} not found` }, { status: 404 });
    }

    const { path: resolvedPath, ad } = result;
    const updateData = Object.fromEntries(
      Object.entries(parsed.data).filter(([, v]) => v !== undefined),
    );
    applyAdUpdates(ad, updateData);
    await writeAd(resolvedPath, ad);

    return NextResponse.json({
      message: 'Ad updated',
      file: path.relative(user.workspace, resolvedPath),
      data: ad,
    });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  try {
    const user = await getCurrentUser(request);
    if (!user) {
      return NextResponse.json({ detail: 'Authentication required' }, { status: 401 });
    }

    const { filename } = await context.params;
    const filePath = filename.join('/');

    const result = await findAdByFile(filePath, user.workspace);
    if (!result) {
      return NextResponse.json({ detail: `File ${filePath} not found` }, { status: 404 });
    }

    const { path: resolvedPath } = result;
    const adDir = path.dirname(resolvedPath);
    const ad = await readAd(resolvedPath);
    const adsRoot = path.join(user.workspace, 'ads');

    const otherYamls = readdirSync(adDir).filter(
      (f) =>
        f.startsWith('ad_') &&
        f.endsWith('.yaml') &&
        path.join(adDir, f) !== resolvedPath,
    );

    if (otherYamls.length === 0 && path.basename(adDir).startsWith('ad_') && adDir !== adsRoot) {
      await rm(adDir, { recursive: true, force: true });
    } else {
      for (const pattern of (ad.images as string[]) ?? []) {
        const matches = globSync(path.join(adDir, pattern));
        for (const match of matches) {
          if (ALLOWED_IMAGE_EXTENSIONS.has(path.extname(match).toLowerCase()) && existsSync(match)) {
            await unlink(match);
          }
        }
      }
      await unlink(resolvedPath);
    }

    return NextResponse.json({
      message: 'Ad deleted',
      file: path.relative(user.workspace, resolvedPath),
    });
  } catch (error) {
    return handleApiError(error);
  }
}
