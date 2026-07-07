import { handleApiError } from '@/lib/api/error-handler';
import { NextRequest, NextResponse } from 'next/server';
import { adUpdateSchema } from '@/validation/schemas';
import { getCurrentUser } from '@/lib/auth/middleware';
import { findAdByFile, readAd, writeAd, applyAdUpdates } from '@/lib/yaml/ads';
import { loadCatAttrsData, translateAttrValues } from '@/lib/ads/normalize-attributes';
import { computeContentHash } from '@/lib/ads/content-hash';
import { toNFC } from '@/lib/images/normalize';
import path from 'path';
import { unlink, rm } from 'fs/promises';
import { existsSync, readdirSync } from 'fs';
import { globSync } from 'glob';
import {
  archiveAdFolder,
  unarchiveAdFolder,
  resolveArchiveDir,
  resolveArchiveSubDir,
  ARCHIVE_SUBDIR_ADS,
  ARCHIVE_SUBDIR_DOWNLOADS,
  type ArchiveOrigin,
} from '@/lib/bot/archive';
import { resolveDownloadDir, resolveAdsDir } from '@/lib/bot/hooks';
import { ALLOWED_IMAGE_EXTENSIONS } from '@/lib/images/upload';

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

    // Normalize text-based attributes on read and write back if changed
    const catData = loadCatAttrsData();
    const category = String(ad.category ?? '');
    if (catData && category && ad.special_attributes) {
      const original = ad.special_attributes as Record<string, string>;
      const translated = translateAttrValues(original, category, catData);
      const changed = Object.keys(translated).some(k => translated[k] !== original[k]);
      if (changed) {
        ad.special_attributes = translated;
        if (ad.content_hash) ad.content_hash = computeContentHash(ad);
        writeAd(resolvedPath, ad);
      }
    }

    ad.file = toNFC(path.relative(user.workspace, resolvedPath));
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
    const wasActive = ad.active !== false;

    const updateData = Object.fromEntries(
      Object.entries(parsed.data).filter(([, v]) => v !== undefined),
    );
    applyAdUpdates(ad, updateData);

    // Translate API values → display text for text-based attributes
    const catData = loadCatAttrsData();
    const category = String(ad.category ?? '');
    if (catData && category && ad.special_attributes) {
      ad.special_attributes = translateAttrValues(
        ad.special_attributes as Record<string, string>,
        category,
        catData,
      );
    }

    await writeAd(resolvedPath, ad);

    const isNowActive = ad.active !== false;
    let newResolvedPath = resolvedPath;

    if (wasActive !== isNowActive) {
      const downloadDir = resolveDownloadDir(user.workspace);
      const adsDir = resolveAdsDir(user.workspace);
      const archiveDir = resolveArchiveDir(user.workspace);
      const adFolder = path.dirname(resolvedPath);
      const folderBaseName = path.basename(adFolder);
      const yamlBaseName = path.basename(resolvedPath);

      if (isNowActive) {
        if (adFolder.startsWith(archiveDir + path.sep)) {
          const adsArchiveDir = resolveArchiveSubDir(user.workspace, ARCHIVE_SUBDIR_ADS);
          const destDir = adFolder.startsWith(adsArchiveDir + path.sep) ? adsDir : downloadDir;
          unarchiveAdFolder(adFolder, user.workspace, adsDir, downloadDir);
          newResolvedPath = path.join(destDir, folderBaseName, yamlBaseName);
        }
      } else {
        if (!adFolder.startsWith(archiveDir + path.sep)) {
          const origin: ArchiveOrigin = adFolder.startsWith(adsDir + path.sep)
            ? ARCHIVE_SUBDIR_ADS
            : ARCHIVE_SUBDIR_DOWNLOADS;
          archiveAdFolder(adFolder, user.workspace, origin);
          newResolvedPath = path.join(resolveArchiveSubDir(user.workspace, origin), folderBaseName, yamlBaseName);
        }
      }
    }

    return NextResponse.json({
      message: 'Ad updated',
      file: toNFC(path.relative(user.workspace, newResolvedPath)),
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

    // Delete the ad's own referenced images, then its YAML.
    for (const pattern of (ad.images as string[]) ?? []) {
      const matches = globSync(path.join(adDir, pattern));
      for (const match of matches) {
        if (ALLOWED_IMAGE_EXTENSIONS.has(path.extname(match).toLowerCase()) && existsSync(match)) {
          await unlink(match);
        }
      }
    }
    await unlink(resolvedPath);

    // Remove the per-ad folder only once it is empty — template-agnostic (honors
    // any folder_name_template), never deletes unrecognized files or the ads root.
    if (adDir !== adsRoot && existsSync(adDir) && readdirSync(adDir).length === 0) {
      await rm(adDir, { recursive: true, force: true });
    }

    return NextResponse.json({
      message: 'Ad deleted',
      file: toNFC(path.relative(user.workspace, resolvedPath)),
    });
  } catch (error) {
    return handleApiError(error);
  }
}
