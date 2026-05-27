import { handleApiError } from '@/lib/api/error-handler';
import { NextRequest, NextResponse } from 'next/server';
import { adUpdateSchema } from '@/validation/schemas';
import { getCurrentUser } from '@/lib/auth/middleware';
import { findAdById, readAd, writeAd, applyAdUpdates } from '@/lib/yaml/ads';
import { loadCatAttrsData, translateAttrValues } from '@/lib/ads/normalize-attributes';
import { computeContentHash } from '@/lib/ads/content-hash';
import { toNFC } from '@/lib/images/normalize';
import { startJob } from '@/lib/bot/jobs';
import path from 'path';
import { unlink, rm } from 'fs/promises';
import { existsSync, readdirSync } from 'fs';
import { globSync } from 'glob';
import { ALLOWED_IMAGE_EXTENSIONS } from '@/lib/images/upload';

interface RouteContext {
  params: Promise<{ adId: string }>;
}

export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const user = await getCurrentUser(request);
    if (!user) {
      return NextResponse.json({ detail: 'Authentication required' }, { status: 401 });
    }

    const { adId } = await context.params;
    const numId = parseInt(adId, 10);
    if (isNaN(numId)) {
      return NextResponse.json({ detail: 'Invalid ad ID' }, { status: 400 });
    }

    const result = await findAdById(numId, user.workspace);
    if (!result) {
      return NextResponse.json({ detail: `Ad ${adId} not found` }, { status: 404 });
    }

    const { path: filePath, ad } = result;

    // Normalize text-based attributes on read and write back if changed.
    // Ensures files downloaded by the bot (which stores API values) are corrected
    // on disk before the bot attempts to re-publish them.
    const catData = loadCatAttrsData();
    const category = String(ad.category ?? '');
    if (catData && category && ad.special_attributes) {
      const original = ad.special_attributes as Record<string, string>;
      const translated = translateAttrValues(original, category, catData);
      const changed = Object.keys(translated).some(k => translated[k] !== original[k]);
      if (changed) {
        ad.special_attributes = translated;
        // Keep hash in sync so the ad doesn't appear "changed" after normalization
        if (ad.content_hash) ad.content_hash = computeContentHash(ad);
        writeAd(filePath, ad);
      }
    }

    ad.file = toNFC(path.relative(user.workspace, filePath));
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

    const { adId } = await context.params;
    const numId = parseInt(adId, 10);
    if (isNaN(numId)) {
      return NextResponse.json({ detail: 'Invalid ad ID' }, { status: 400 });
    }

    const body = await request.json();
    const parsed = adUpdateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { detail: parsed.error.issues[0]?.message ?? 'Invalid input' },
        { status: 400 },
      );
    }

    const result = await findAdById(numId, user.workspace);
    if (!result) {
      return NextResponse.json({ detail: `Ad ${adId} not found` }, { status: 404 });
    }

    const { path: filePath, ad } = result;
    const updateData = Object.fromEntries(
      Object.entries(parsed.data).filter(([, v]) => v !== undefined),
    );
    applyAdUpdates(ad, updateData);

    // Translate API values → display text for text-based attributes (e.g. brand_s: jack_jones → "Jack & Jones")
    const catData = loadCatAttrsData();
    const category = String(ad.category ?? '');
    if (catData && category && ad.special_attributes) {
      ad.special_attributes = translateAttrValues(
        ad.special_attributes as Record<string, string>,
        category,
        catData,
      );
    }

    await writeAd(filePath, ad);

    return NextResponse.json({
      message: 'Ad updated',
      file: toNFC(path.relative(user.workspace, filePath)),
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

    const { adId } = await context.params;
    const numId = parseInt(adId, 10);
    if (isNaN(numId)) {
      return NextResponse.json({ detail: 'Invalid ad ID' }, { status: 400 });
    }

    const { searchParams } = new URL(request.url);
    const remote = searchParams.get('remote') === 'true';

    const result = await findAdById(numId, user.workspace);
    if (!result) {
      return NextResponse.json({ detail: `Ad ${adId} not found` }, { status: 404 });
    }

    const { path: filePath } = result;
    const relFile = toNFC(path.relative(user.workspace, filePath));
    const response: Record<string, unknown> = { message: 'Ad deleted locally', file: relFile };

    if (remote) {
      const job = startJob(`delete --ads=${numId}`, user.workspace, user.id);
      response.message = 'Ad deleted locally, remote deletion started';
      response.job = job;
    }

    // Delete ad with images
    const adDir = path.dirname(filePath);
    const ad = await readAd(filePath);
    const adsRoot = path.join(user.workspace, 'ads');
    const otherYamls = readdirSync(adDir).filter(
      (f) => f.startsWith('ad_') && f.endsWith('.yaml') && path.join(adDir, f) !== filePath,
    );

    if (otherYamls.length === 0 && path.basename(adDir).startsWith('ad_') && adDir !== adsRoot) {
      await rm(adDir, { recursive: true, force: true });
    } else {
      // Delete referenced images
      for (const pattern of (ad.images as string[]) ?? []) {
        const matches = globSync(path.join(adDir, pattern));
        for (const match of matches) {
          if (ALLOWED_IMAGE_EXTENSIONS.has(path.extname(match).toLowerCase()) && existsSync(match)) {
            await unlink(match);
          }
        }
      }
      await unlink(filePath);
    }

    return NextResponse.json(response);
  } catch (error) {
    return handleApiError(error);
  }
}
