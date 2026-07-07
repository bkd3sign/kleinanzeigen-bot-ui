import { NextRequest, NextResponse } from 'next/server';
import { aiGenerateSchema } from '@/validation/schemas';
import { getCurrentUser } from '@/lib/auth/middleware';
import { aiLimiter } from '@/lib/auth/rate-limiter';
import { readMergedConfig, AI_DEFAULTS } from '@/lib/yaml/config';
import { allCarriersOf, type ShippingSizeId } from '@/lib/shipping';
import { trackAdGeneration } from '@/lib/messaging/responder';
import { loadCatAttrsData } from '@/lib/ads/normalize-attributes';
import {
  resolveCategoryAndAttributes,
  parseAiJson,
  type AiCallConfig,
} from '@/lib/ads/resolve-category-attributes';
import { MAX_AI_IMAGES } from '@/lib/images/formats';
import { normalizeAdType, normalizePriceType, normalizeShippingType } from './normalize';

export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser(request);
    if (!user) {
      return NextResponse.json({ detail: 'Authentication required' }, { status: 401 });
    }

    // Rate-limit per user to prevent API key exhaustion
    aiLimiter.check(user.id);

    const body = await request.json();
    const parsed = aiGenerateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { detail: parsed.error.issues[0]?.message ?? 'Invalid input' },
        { status: 400 },
      );
    }

    const { prompt, images } = parsed.data;

    if (!prompt && images.length === 0) {
      return NextResponse.json(
        { detail: 'Either text or images (or both) required' },
        { status: 400 },
      );
    }

    // Load merged config — ai section may live in root config.yaml (server-level)
    const config = readMergedConfig(user.workspace);
    const aiConfig = (config?.ai as Record<string, string>) ?? {};

    const apiKey = aiConfig.api_key ?? process.env.OPENROUTER_API_KEY ?? '';
    const baseUrl = aiConfig.base_url ?? AI_DEFAULTS.base_url;

    if (!apiKey) {
      return NextResponse.json(
        {
          detail:
            "No OpenRouter API key configured. Set 'ai.api_key' in config.yaml or the OPENROUTER_API_KEY environment variable.",
        },
        { status: 400 },
      );
    }

    // Model and prompts are determined server-side only — config overrides, then hardcoded defaults
    const hasImages = images.length > 0;
    const model = hasImages
      ? (aiConfig.model_vision ?? AI_DEFAULTS.model_vision)
      : (aiConfig.model ?? AI_DEFAULTS.model);
    const systemPrompt = hasImages
      ? (aiConfig.prompt_vision ?? AI_DEFAULTS.prompt_vision)
      : (aiConfig.prompt ?? AI_DEFAULTS.prompt);

    // Build messages — use vision prompt when images are present
    const messages: Array<Record<string, unknown>> = [
      { role: 'system', content: systemPrompt },
    ];

    if (hasImages) {
      const userContent: Array<Record<string, unknown>> = [];
      userContent.push({
        type: 'text',
        text: prompt || 'Analysiere die Bilder und erstelle daraus eine Kleinanzeige.',
      });
      for (const imgB64 of images.slice(0, MAX_AI_IMAGES)) {
        const imageUrl = imgB64.startsWith('data:')
          ? imgB64
          : `data:image/jpeg;base64,${imgB64}`;
        userContent.push({ type: 'image_url', image_url: { url: imageUrl } });
      }
      messages.push({ role: 'user', content: userContent });
    } else {
      messages.push({ role: 'user', content: prompt });
    }

    const resp = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        ...(aiConfig.referer ? { 'HTTP-Referer': String(aiConfig.referer) } : {}),
        ...(aiConfig.app_name ? { 'X-Title': String(aiConfig.app_name) } : {}),
      },
      body: JSON.stringify({
        model,
        messages,
        temperature: 0.7,
        response_format: { type: 'json_object' },
      }),
      signal: AbortSignal.timeout(hasImages ? 90000 : 60000),
    });

    if (!resp.ok) {
      const errText = await resp.text();
      return NextResponse.json(
        { detail: `OpenRouter API error: ${resp.status} - ${errText.slice(0, 200)}` },
        { status: 502 },
      );
    }

    const data = await resp.json();
    const content = data.choices?.[0]?.message?.content ?? '';

    // Parse AI response JSON robustly
    let adData: Record<string, unknown>;
    try {
      adData = parseAiJson(content);
    } catch {
      return NextResponse.json(
        { detail: 'Failed to parse AI response as JSON' },
        { status: 502 },
      );
    }

    // Resolve category + special_attributes via the shared SoT pipeline.
    // Identical to the quick-edit autosuggest — both derive category/attributes purely
    // from { title, description }, so the same article yields the same result.
    const catAttrsData = loadCatAttrsData();
    if (catAttrsData && adData.title) {
      const cfg: AiCallConfig = {
        baseUrl,
        apiKey,
        model: aiConfig.model ?? AI_DEFAULTS.model,
        referer: aiConfig.referer ? String(aiConfig.referer) : undefined,
        appName: aiConfig.app_name ? String(aiConfig.app_name) : undefined,
      };
      const resolved = await resolveCategoryAndAttributes(
        {
          title: String(adData.title),
          description: String(adData.description ?? ''),
          userHint: prompt,
        },
        catAttrsData,
        cfg,
      );
      adData.category = resolved.category;
      adData.special_attributes = resolved.special_attributes;
    } else {
      adData.category = null;
      adData.special_attributes = {};
    }

    // Fallback: if AI returned null price but has a suggestion, use it
    const hint = adData.price_hint as Record<string, unknown> | undefined;
    if ((adData.price == null || adData.price === 0) && hint?.suggestion != null) {
      adData.price = hint.suggestion;
    }

    // Normalize AI enum fields — handles German values, typos, NOT_APPLICABLE
    adData.type = normalizeAdType(adData.type);
    adData.price_type = normalizePriceType(adData.price_type);
    adData.shipping_type = normalizeShippingType(adData.shipping_type);

    // Auto-fill predefined shipping_options based on AI-suggested size
    if (adData.shipping_size && adData.shipping_type === 'SHIPPING') {
      const sizeId = adData.shipping_size as ShippingSizeId;
      const carriers = allCarriersOf(sizeId);
      if (carriers.length > 0) {
        adData.shipping_options = carriers;
      }
    }

    // Individual/custom shipping is no longer supported — never let a
    // hallucinated shipping_costs from the AI response reach the form.
    delete adData.shipping_costs;

    trackAdGeneration(user.workspace, images.length);

    return NextResponse.json({ ad: adData });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    const cause = error instanceof Error ? (error.cause as Error | undefined) : undefined;
    console.error('[AI Generate]', msg, cause ? `(cause: ${cause.message ?? cause})` : '');
    return NextResponse.json({ detail: `AI generation error: ${msg}${cause ? ` (${cause.message ?? cause})` : ''}` }, { status: 500 });
  }
}
