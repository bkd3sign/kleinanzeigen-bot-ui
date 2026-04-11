import { handleApiError } from '@/lib/api/error-handler';
import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { adCreateSchema } from '@/validation/schemas';
import { getCurrentUser } from '@/lib/auth/middleware';
import { findAdFiles, readAd, writeAd } from '@/lib/yaml/ads';
import { readMergedConfig } from '@/lib/yaml/config';
import { readLastDownloadAll } from '@/lib/bot/hooks';
import { getFirstImage } from '@/lib/images/resolve';
import path from 'path';

// Compute content hash matching the bot's algorithm
// Excludes metadata fields, prunes empty containers, JSON-serializes with sorted keys
const METADATA_FIELDS = new Set(['id', 'created_on', 'updated_on', 'content_hash', 'repost_count', 'price_reduction_count', 'file']);

function prune(obj: unknown): unknown {
  if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      if (v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === 0) continue;
      if (Array.isArray(v) && v.length === 0) continue;
      result[k] = prune(v);
    }
    return result;
  }
  if (Array.isArray(obj)) {
    return obj.filter((v) => !(v && typeof v === 'object' && Object.keys(v).length === 0)).map(prune);
  }
  return obj;
}

/** JSON.stringify with recursively sorted keys matching Python json.dumps(sort_keys=True).
 *  Python default separators are (', ', ': ') — space after comma and colon. */
function stableStringify(obj: unknown): string {
  if (obj === null || obj === undefined) return 'null';
  if (typeof obj !== 'object') return JSON.stringify(obj);
  if (Array.isArray(obj)) {
    return '[' + obj.map(stableStringify).join(', ') + ']';
  }
  const sorted = Object.keys(obj as Record<string, unknown>).sort();
  return '{' + sorted.map((k) => JSON.stringify(k) + ': ' + stableStringify((obj as Record<string, unknown>)[k])).join(', ') + '}';
}

function computeContentHash(ad: Record<string, unknown>): string {
  const raw: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(ad)) {
    if (METADATA_FIELDS.has(k)) continue;
    if (v === null || v === undefined) continue;
    raw[k] = v;
  }
  const pruned = prune(raw) as Record<string, unknown>;
  const json = stableStringify(pruned);
  return crypto.createHash('sha256').update(json).digest('hex');
}

export async function GET(request: NextRequest) {
  try {
    const user = await getCurrentUser(request);
    if (!user) {
      return NextResponse.json({ detail: 'Authentication required' }, { status: 401 });
    }

    const ws = user.workspace;
    const files = await findAdFiles(ws);
    const lastDownload = readLastDownloadAll(ws);
    const onlineIds = lastDownload ? new Set(lastDownload.ids) : null;
    const ads = [];

    for (const filePath of files) {
      const ad = await readAd(filePath);
      const adDir = path.dirname(filePath);
      const images = (ad.images as string[]) ?? [];
      // Detect changed status: has content_hash but current content differs
      // Compare stored content_hash with freshly computed one
      // Only flag as changed if stored hash exists (bot has published/hashed this ad before)
      const storedHash = (ad.content_hash as string) ?? null;
      const currentHash = storedHash ? computeContentHash(ad) : null;
      const isChanged = storedHash ? currentHash !== storedHash : false;

      ads.push({
        id: ad.id ?? null,
        title: ad.title ?? '',
        price: ad.price ?? null,
        price_type: ad.price_type ?? null,
        active: ad.active ?? true,
        type: ad.type ?? 'OFFER',
        category: ad.category ?? null,
        images: images.length,
        first_image: getFirstImage(adDir, images),
        created_on: ad.created_on ?? null,
        updated_on: ad.updated_on ?? null,
        repost_count: ad.repost_count ?? 0,
        republication_interval: ad.republication_interval ?? null,
        shipping_type: ad.shipping_type ?? null,
        auto_price_reduction: ad.auto_price_reduction ?? null,
        price_reduction_count: ad.price_reduction_count ?? 0,
        has_description: Boolean(ad.description),
        is_changed: isChanged,
        is_orphaned: onlineIds !== null && ad.id != null && !onlineIds.has(ad.id as number),
        file: path.relative(ws, filePath),
      });
    }

    return NextResponse.json({ ads, total: ads.length });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser(request);
    if (!user) {
      return NextResponse.json({ detail: 'Authentication required' }, { status: 401 });
    }

    const body = await request.json();
    const parsed = adCreateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { detail: parsed.error.issues[0]?.message ?? 'Invalid input' },
        { status: 400 },
      );
    }

    const ad = parsed.data;
    const ws = user.workspace;

    // Fill missing contact fields from config ad_defaults
    if (!ad.contact_name || !ad.contact_zipcode || !ad.contact_location) {
      const config = readMergedConfig(ws);
      const defaults = (config?.ad_defaults as Record<string, unknown>)?.contact as Record<string, string> | undefined;
      if (defaults) {
        if (!ad.contact_name) ad.contact_name = defaults.name ?? '';
        if (!ad.contact_zipcode) ad.contact_zipcode = defaults.zipcode ?? '';
        if (!ad.contact_location) ad.contact_location = defaults.location ?? '';
      }
    }

    // Generate slug from title
    let slug = ad.title
      .toLowerCase()
      .replace(/ /g, '_')
      .replace(/[–—]/g, '')
      .slice(0, 60);
    slug = slug.replace(/[^a-z0-9_]/g, '');

    const dirName = `ad_${slug}`;
    const filename = `ad_${slug}.yaml`;
    const adsDir = path.join(ws, 'ads');
    const adDir = path.join(adsDir, dirName);
    const filePath = path.join(adDir, filename);

    // Create directory
    const { mkdir } = await import('fs/promises');
    await mkdir(adDir, { recursive: true });

    // Check if file already exists
    const { existsSync } = await import('fs');
    if (existsSync(filePath)) {
      return NextResponse.json(
        { detail: `File ${filename} already exists` },
        { status: 409 },
      );
    }

    // Build ad data
    const data: Record<string, unknown> = {
      active: ad.active,
      type: ad.type,
      title: ad.title,
      description: ad.description,
      category: ad.category,
      price: ad.price,
      price_type: ad.price_type,
      shipping_type: ad.shipping_type,
      sell_directly: ad.sell_directly,
      images: ad.images,
      contact: {
        name: ad.contact_name,
        zipcode: ad.contact_zipcode,
        location: ad.contact_location,
        street: ad.contact_street,
        phone: ad.contact_phone,
      },
    };

    if (ad.description_prefix) data.description_prefix = ad.description_prefix;
    if (ad.description_suffix) data.description_suffix = ad.description_suffix;
    if (ad.special_attributes && Object.keys(ad.special_attributes).length > 0) {
      // Strip category prefix from keys (e.g. "kleidung_herren.art_s" → "art_s")
      data.special_attributes = Object.fromEntries(
        Object.entries(ad.special_attributes).map(([k, v]) => [k.includes('.') ? k.split('.').pop()! : k, v]),
      );
    }
    if (ad.auto_price_reduction) {
      data.auto_price_reduction = ad.auto_price_reduction;
    }
    if (ad.shipping_costs !== undefined) data.shipping_costs = ad.shipping_costs;
    if (ad.shipping_options && ad.shipping_options.length > 0) data.shipping_options = ad.shipping_options;
    if (ad.republication_interval !== undefined) {
      data.republication_interval = ad.republication_interval;
    }

    await writeAd(filePath, data);
    return NextResponse.json({
      message: 'Ad created',
      file: path.relative(ws, filePath),
      data,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
