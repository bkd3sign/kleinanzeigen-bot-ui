import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth/middleware';
import { aiLimiter } from '@/lib/auth/rate-limiter';
import { readMergedConfig, AI_DEFAULTS } from '@/lib/yaml/config';
import { loadCatAttrsData } from '@/lib/ads/normalize-attributes';
import { resolveCategoryAndAttributes, type AiCallConfig } from '@/lib/ads/resolve-category-attributes';

// Quick-edit autosuggest: resolves { category, special_attributes } from an article
// using the same SoT pipeline as the AI generator, so both paths return identical results.
export async function POST(req: NextRequest) {
  const user = await getCurrentUser(req);
  if (!user) {
    return NextResponse.json({ detail: 'Authentication required' }, { status: 401 });
  }

  const emptyResult = { category: null, special_attributes: {} };

  try {
    const body = (await req.json()) as { title?: string; description?: string };
    const title = body.title?.trim();
    if (!title) return NextResponse.json(emptyResult);

    const catAttrsData = loadCatAttrsData();
    if (!catAttrsData) return NextResponse.json(emptyResult);

    const config = readMergedConfig(user.workspace);
    const aiConfig = (config?.ai as Record<string, string>) ?? {};
    const apiKey = aiConfig.api_key ?? process.env.OPENROUTER_API_KEY ?? '';
    if (!apiKey) return NextResponse.json(emptyResult);

    // Rate-limit per user — shared budget with the generator
    aiLimiter.check(user.id);

    const cfg: AiCallConfig = {
      baseUrl: aiConfig.base_url ?? AI_DEFAULTS.base_url,
      apiKey,
      model: aiConfig.model ?? AI_DEFAULTS.model,
      referer: aiConfig.referer ? String(aiConfig.referer) : undefined,
      appName: aiConfig.app_name ? String(aiConfig.app_name) : undefined,
    };

    const result = await resolveCategoryAndAttributes(
      { title, description: body.description ?? '' },
      catAttrsData,
      cfg,
    );
    return NextResponse.json(result);
  } catch {
    return NextResponse.json(emptyResult);
  }
}
