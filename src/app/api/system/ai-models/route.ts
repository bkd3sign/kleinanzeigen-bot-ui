import { handleApiError } from '@/lib/api/error-handler';
import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth/middleware';

const MODELS_URL = 'https://openrouter.ai/api/v1/models';
const CACHE_TTL_MS = 60 * 60 * 1000; // models change rarely — cache for 1h
const TOP_N = 5;
const MAX_PER_PROVIDER = 2; // keep the top-5 diverse, not 5 variants of one family

// Capability proxy: how strong/reliable a provider's chat models are for German
// ad text and image analysis. Higher = preferred when scoring.
const PROVIDER_RANK: Record<string, number> = {
  openai: 5, anthropic: 5, google: 5, deepseek: 4, 'meta-llama': 3, qwen: 3, mistralai: 3, 'x-ai': 3,
};

// Substrings that mark a model as unsuitable for chat-style text/vision tasks.
const EXCLUDE_KEYWORDS = ['embed', 'moderation', 'guard', 'safety', 'tts', 'whisper', 'rerank', 'audio'];

export interface AiModelOption {
  id: string;
  name: string;
  pricePromptPerM: number | null;
  vision: boolean;
  recommendedText: boolean;
  recommendedVision: boolean;
}

interface OpenRouterModel {
  id: string;
  name: string;
  pricing?: { prompt?: string };
  architecture?: { input_modalities?: string[] };
}

interface ScoredModel extends AiModelOption {
  provider: string;
  score: number;
}

let cache: { ts: number; models: AiModelOption[] } | null = null;

/**
 * Score a model as a balance of capability (provider strength), value (cheaper
 * scores higher) and fitness for this use case (fast "mini/flash/haiku"-style
 * variants are the sweet spot for ad text + image analysis).
 */
function scoreModel(provider: string, id: string, pricePerM: number | null): number {
  const capability = PROVIDER_RANK[provider] ?? 1;
  const sweetSpot = /(\bmini\b|nano|flash|haiku|lite|small|turbo)/i.test(id) ? 3 : 0;
  let value = 0;
  if (pricePerM != null) {
    if (pricePerM <= 0.3) value = 3;
    else if (pricePerM <= 1) value = 2;
    else if (pricePerM <= 5) value = 1;
  }
  return capability + sweetSpot + value;
}

/** Assign a model to a price tier so the top-5 spans cheap → balanced → premium. */
function priceTier(pricePerM: number | null): 'cheap' | 'mid' | 'premium' {
  if (pricePerM == null || pricePerM > 4) return 'premium';
  if (pricePerM <= 0.5) return 'cheap';
  return 'mid';
}

/**
 * Pick the top-5 as a deliberate mix across price tiers (2 cheap + 2 balanced +
 * 1 premium), each the highest-scored in its tier, then backfill by score. At
 * most MAX_PER_PROVIDER per provider so the list stays diverse.
 */
function pickTop(pool: ScoredModel[]): Set<string> {
  const sorted = [...pool].sort((a, b) => b.score - a.score || (a.pricePromptPerM ?? Infinity) - (b.pricePromptPerM ?? Infinity));
  const perProvider: Record<string, number> = {};
  const picked = new Set<string>();

  const add = (m: ScoredModel): boolean => {
    if (picked.size >= TOP_N || picked.has(m.id)) return false;
    if ((perProvider[m.provider] ?? 0) >= MAX_PER_PROVIDER) return false;
    perProvider[m.provider] = (perProvider[m.provider] ?? 0) + 1;
    picked.add(m.id);
    return true;
  };

  // First pass: honour the tier quota (cheap 2, balanced 2, premium 1).
  const quota: Array<['cheap' | 'mid' | 'premium', number]> = [['cheap', 2], ['mid', 2], ['premium', 1]];
  for (const [tier, n] of quota) {
    let added = 0;
    for (const m of sorted) {
      if (added >= n) break;
      if (priceTier(m.pricePromptPerM) === tier && add(m)) added++;
    }
  }
  // Backfill to TOP_N by overall score if a tier was underfilled.
  for (const m of sorted) add(m);

  return picked;
}

function mapModels(raw: OpenRouterModel[]): AiModelOption[] {
  const scored: ScoredModel[] = raw
    .filter((m) => !EXCLUDE_KEYWORDS.some((k) => m.id.toLowerCase().includes(k)))
    .map((m) => {
      const provider = m.id.split('/')[0] ?? '';
      const pricePromptPerM = m.pricing?.prompt ? parseFloat(m.pricing.prompt) * 1_000_000 : null;
      const vision = (m.architecture?.input_modalities ?? []).includes('image');
      return {
        id: m.id,
        name: m.name,
        pricePromptPerM,
        vision,
        recommendedText: false,
        recommendedVision: false,
        provider,
        score: scoreModel(provider, m.id, pricePromptPerM),
      };
    });

  const topText = pickTop(scored);
  const topVision = pickTop(scored.filter((m) => m.vision));

  return scored
    .map(({ provider: _provider, score: _score, ...m }) => ({
      ...m,
      recommendedText: topText.has(m.id),
      recommendedVision: topVision.has(m.id),
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

export async function GET(request: NextRequest) {
  try {
    const user = await getCurrentUser(request);
    if (!user || user.role !== 'admin') {
      return NextResponse.json({ detail: 'Admin access required' }, { status: 403 });
    }

    if (cache && Date.now() - cache.ts < CACHE_TTL_MS) {
      return NextResponse.json({ models: cache.models });
    }

    // Bound the upstream call so a stalled OpenRouter never hangs the request.
    const res = await fetch(MODELS_URL, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      // Serve stale cache if available, else signal unavailability without crashing the page.
      if (cache) return NextResponse.json({ models: cache.models });
      return NextResponse.json({ models: [], error: `OpenRouter HTTP ${res.status}` });
    }

    const json = (await res.json()) as { data?: OpenRouterModel[] };
    const models = mapModels(json.data ?? []);
    cache = { ts: Date.now(), models };
    return NextResponse.json({ models });
  } catch (error) {
    if (cache) return NextResponse.json({ models: cache.models });
    return handleApiError(error);
  }
}
