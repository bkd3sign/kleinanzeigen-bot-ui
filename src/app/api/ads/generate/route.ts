import { NextRequest, NextResponse } from 'next/server';
import { aiGenerateSchema } from '@/validation/schemas';
import { getCurrentUser } from '@/lib/auth/middleware';
import { aiLimiter } from '@/lib/auth/rate-limiter';
import { readMergedConfig, AI_DEFAULTS } from '@/lib/yaml/config';
import { allCarriersOf, cheapestPriceOf, type ShippingSizeId } from '@/lib/shipping';
import { trackAdGeneration } from '@/lib/messaging/responder';
import path from 'path';
import { readFileSync, existsSync } from 'fs';
import { shortKey as attrShortKey } from '@/lib/ads/category-attributes';

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

    // Load category_attributes.json — used for KA ID validation and attribute context in prompt
    interface AttrOption { value: string; text: string; }
    interface SharedAttrDef { options?: AttrOption[]; type?: string; text?: string; }
    interface CatAttrEntry { attributes: Array<{ attribute_key: string; options?: AttrOption[] }>; shared: string[]; }
    interface CatAttrsData { categories: Record<string, CatAttrEntry>; shared_attributes: Record<string, SharedAttrDef>; }

    let catAttrsData: CatAttrsData | null = null;
    const catAttrsPath = path.join(process.cwd(), 'public', 'data', 'category_attributes.json');
    if (existsSync(catAttrsPath)) {
      try { catAttrsData = JSON.parse(readFileSync(catAttrsPath, 'utf-8')); } catch { /* ignore */ }
    }
    const validCategoryIds = catAttrsData ? new Set(Object.keys(catAttrsData.categories)) : new Set<string>();

    // Pre-fetch KA category-suggest using prompt text — runs in parallel with no extra latency
    // For vision mode the hint text is used; falls back to post-AI suggest if empty
    const kaSuggestInput = (prompt || '').slice(0, 200).trim();
    let kaSuggestion: Record<string, unknown> | null = null;
    let kaId: string | null = null;

    if (kaSuggestInput) {
      try {
        const kaRes = await fetch(
          `https://www.kleinanzeigen.de/p-category-suggestion.json?title=${encodeURIComponent(kaSuggestInput)}`,
          { headers: { Accept: 'application/json', 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(4000) },
        );
        if (kaRes.ok) {
          kaSuggestion = await kaRes.json() as Record<string, unknown>;
          const base = `${kaSuggestion.parent_id}/${kaSuggestion.category_id}`;
          const l3 = kaSuggestion.l3_value as string | undefined;
          const tentativeId = l3 ? `${base}/${l3}` : base;
          if (validCategoryIds.size === 0 || validCategoryIds.has(tentativeId)) kaId = tentativeId;
        }
      } catch { /* ignore — will fall back to post-AI suggest */ }
    }

    // Build attribute context for the prompt if we have a KA category
    let attrContextMsg: string | null = null;
    if (kaId && catAttrsData) {
      const entry = catAttrsData.categories[kaId];
      if (entry) {
        const lines: string[] = [];
        for (const ref of entry.shared ?? []) {
          const def = catAttrsData.shared_attributes[ref];
          if (!def?.options?.length) continue;
          lines.push(`${attrShortKey(ref)}: ${def.options.map((o) => o.value).join(' | ')}`);
        }
        for (const attr of entry.attributes ?? []) {
          if (!attr.options?.length) continue;
          lines.push(`${attrShortKey(attr.attribute_key)}: ${attr.options.map((o) => o.value).join(' | ')}`);
        }
        if (lines.length > 0) {
          attrContextMsg = `ERKANNTE KATEGORIE: ${kaId}\nPFLICHT: Du MUSST "special_attributes" mit Werten für ALLE folgenden Felder füllen. Nutze EXAKT diese Schlüsselnamen und wähle einen der erlaubten Werte (kein Freitext, nur die vorgegebenen Werte). Felder die du nicht kennst: leer lassen, aber NIEMALS Platzhalter wie "[Wert]" verwenden:\n${lines.join('\n')}`;
        }
      }
    }

    // Build messages — use vision prompt when images are present
    const messages: Array<Record<string, unknown>> = [
      { role: 'system', content: systemPrompt },
    ];
    if (attrContextMsg) {
      messages.push({ role: 'system', content: attrContextMsg });
    }

    if (hasImages) {
      const userContent: Array<Record<string, unknown>> = [];
      userContent.push({
        type: 'text',
        text: prompt || 'Analysiere die Bilder und erstelle daraus eine Kleinanzeige.',
      });
      for (const imgB64 of images.slice(0, 10)) {
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

    // Apply KA category (pre-fetched or re-fetched with AI-generated title for accuracy)
    {
      let activeSuggestion = kaSuggestion;
      let activeId = kaId;

      // If pre-fetch used a short prompt, re-fetch with the more precise AI-generated title
      if (adData.title && String(adData.title).trim() !== kaSuggestInput) {
        try {
          const kaRes2 = await fetch(
            `https://www.kleinanzeigen.de/p-category-suggestion.json?title=${encodeURIComponent(String(adData.title))}`,
            { headers: { Accept: 'application/json', 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(4000) },
          );
          if (kaRes2.ok) {
            const s2 = await kaRes2.json() as Record<string, unknown>;
            const base2 = `${s2.parent_id}/${s2.category_id}`;
            const l3b = s2.l3_value as string | undefined;
            const id2 = l3b ? `${base2}/${l3b}` : base2;
            if (validCategoryIds.size === 0 || validCategoryIds.has(id2)) {
              activeSuggestion = s2;
              activeId = id2;
            }
          }
        } catch { /* keep pre-fetched result */ }
      }

      if (activeSuggestion && activeId) {
        adData.category = activeId;

        // Extract lN_id / lN_value attribute pairs
        const kaAttrs: Record<string, string> = {};
        for (let n = 1; n <= 9; n++) {
          const key = activeSuggestion[`l${n}_id`] as string | undefined;
          const val = activeSuggestion[`l${n}_value`] as string | undefined;
          if (key && val) kaAttrs[key] = val;
        }

        // Enrich with KA attribute-suggest using the precise AI-generated title
        if (activeSuggestion.category_id && adData.title) {
          try {
            const attrRes = await fetch('https://www.kleinanzeigen.de/p-attribute-suggestion.json', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'User-Agent': 'Mozilla/5.0' },
              body: JSON.stringify({
                title: String(adData.title),
                categoryId: String(activeSuggestion.category_id),
                previousCategoryId: String(activeSuggestion.category_id),
                attributes: JSON.stringify(kaAttrs),
              }),
              signal: AbortSignal.timeout(4000),
            });
            if (attrRes.ok) {
              const attrData = await attrRes.json() as Record<string, unknown>;
              for (const [k, v] of Object.entries(attrData)) {
                if (typeof v === 'string' && k !== 'categoryId' && k !== 'previousCategoryId') kaAttrs[k] = v;
              }
            }
          } catch { /* ignore */ }
        }

        // Merge: AI-filled attrs first, KA attrs override (KA is authoritative for known keys)
        if (Object.keys(kaAttrs).length > 0) {
          adData.special_attributes = {
            ...(adData.special_attributes as Record<string, unknown> ?? {}),
            ...kaAttrs,
          };
        }

        // Mini AI call: fill any remaining empty select-type attributes that neither AI nor KA filled
        if (catAttrsData && activeId && catAttrsData.categories[activeId]) {
          const catEntry = catAttrsData.categories[activeId];
          const currentAttrs = (adData.special_attributes as Record<string, string>) ?? {};
          const missingLines: string[] = [];

          for (const ref of catEntry.shared ?? []) {
            const def = catAttrsData.shared_attributes[ref];
            if (!def?.options?.length) continue;
            const sk = attrShortKey(ref);
            if (!currentAttrs[sk]) {
              missingLines.push(`${sk}: ${def.options.map((o) => o.value).join(' | ')}`);
            }
          }
          for (const attr of catEntry.attributes ?? []) {
            if (!attr.options?.length) continue;
            const sk = attrShortKey(attr.attribute_key);
            if (!currentAttrs[sk]) {
              missingLines.push(`${sk}: ${attr.options.map((o) => o.value).join(' | ')}`);
            }
          }

          if (missingLines.length > 0) {
            try {
              const miniModel = aiConfig.model ?? AI_DEFAULTS.model;
              const miniPrompt = `Artikel: ${String(adData.title ?? '')}
Beschreibung: ${String(adData.description ?? '').slice(0, 400)}

Wähle für die folgenden Felder den passendsten Wert aus den erlaubten Optionen. Antworte NUR mit einem JSON-Objekt (keine Erklärung). Wenn du einen Wert nicht sicher bestimmen kannst, lass das Feld weg. NIEMALS Platzhalter verwenden.

${missingLines.join('\n')}`;

              const miniResp = await fetch(`${baseUrl}/chat/completions`, {
                method: 'POST',
                headers: {
                  Authorization: `Bearer ${apiKey}`,
                  'Content-Type': 'application/json',
                  ...(aiConfig.referer ? { 'HTTP-Referer': String(aiConfig.referer) } : {}),
                  ...(aiConfig.app_name ? { 'X-Title': String(aiConfig.app_name) } : {}),
                },
                body: JSON.stringify({
                  model: miniModel,
                  messages: [
                    { role: 'system', content: 'Du bist ein Assistent der Produktattribute für Kleinanzeigen bestimmt. Antworte ausschließlich mit einem JSON-Objekt.' },
                    { role: 'user', content: miniPrompt },
                  ],
                  temperature: 0.3,
                  response_format: { type: 'json_object' },
                }),
                signal: AbortSignal.timeout(15000),
              });

              if (miniResp.ok) {
                const miniData = await miniResp.json();
                const miniContent = miniData.choices?.[0]?.message?.content ?? '';
                try {
                  const miniAttrs = parseAiJson(miniContent) as Record<string, string>;
                  // Only apply values that are from the allowed options list
                  const allowedMap: Record<string, Set<string>> = {};
                  for (const line of missingLines) {
                    const [key, rest] = line.split(': ');
                    if (key && rest) allowedMap[key] = new Set(rest.split(' | '));
                  }
                  const merged = { ...currentAttrs };
                  for (const [k, v] of Object.entries(miniAttrs)) {
                    if (typeof v === 'string' && allowedMap[k]?.has(v)) {
                      merged[k] = v;
                    }
                  }
                  adData.special_attributes = merged;
                } catch { /* ignore mini parse failure */ }
              }
            } catch { /* ignore mini call failure */ }
          }
        }
      }
    }

    // Strip any AI-invented attribute keys that aren't valid for the category
    if (catAttrsData && adData.special_attributes) {
      const catEntry = adData.category ? catAttrsData.categories[String(adData.category)] : null;
      if (catEntry) {
        const validKeys = new Set<string>();
        for (const ref of catEntry.shared ?? []) {
          validKeys.add(ref.includes('.') ? ref.split('.').pop()! : ref);
        }
        for (const attr of catEntry.attributes ?? []) {
          validKeys.add(attr.attribute_key.includes('.') ? attr.attribute_key.split('.').pop()! : attr.attribute_key);
        }
        const attrs = adData.special_attributes as Record<string, unknown>;
        for (const key of Object.keys(attrs)) {
          if (!validKeys.has(key)) {
            delete attrs[key];
          }
        }
        // Coerce all values to strings — the bot requires string-type special_attributes
        adData.special_attributes = Object.fromEntries(
          Object.entries(attrs).map(([k, v]) => [k, String(v)]),
        );
      }
    }

    // Fallback: if AI returned null price but has a suggestion, use it
    const hint = adData.price_hint as Record<string, unknown> | undefined;
    if ((adData.price == null || adData.price === 0) && hint?.suggestion != null) {
      adData.price = hint.suggestion;
    }

    // Fallback: ensure sane defaults if AI ignored the rules
    if (!adData.price_type || adData.price_type === 'NOT_APPLICABLE') {
      adData.price_type = 'NEGOTIABLE';
    }
    if (!adData.shipping_type || adData.shipping_type === 'NOT_APPLICABLE') {
      adData.shipping_type = 'SHIPPING';
    }

    // Auto-fill shipping_options + shipping_costs based on AI-suggested size
    if (adData.shipping_size) {
      const sizeId = adData.shipping_size as ShippingSizeId;
      const carriers = allCarriersOf(sizeId);
      if (carriers.length > 0) {
        adData.shipping_options = carriers;
        adData.shipping_costs = cheapestPriceOf(sizeId);
      }
    }

    trackAdGeneration(user.workspace, images.length);

    return NextResponse.json({ ad: adData });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    console.error('[AI Generate]', msg);
    return NextResponse.json({ detail: `AI generation error: ${msg}` }, { status: 500 });
  }
}

// Robustly parse JSON from AI response
function parseAiJson(content: string): Record<string, unknown> {
  let cleaned = content.trim();

  // Strip markdown fences
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.split('\n').slice(1).join('\n');
    cleaned = cleaned.replace(/```\s*$/, '').trim();
  }

  // Extract first { ... } block
  if (!cleaned.startsWith('{')) {
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start !== -1 && end !== -1) {
      cleaned = cleaned.slice(start, end + 1);
    }
  }

  try {
    return JSON.parse(cleaned);
  } catch (error) {
    // Repair unescaped control characters inside JSON strings
    cleaned = cleaned.replace(/\r\n/g, '\n');
    let repaired = '';
    let inString = false;
    let escape = false;

    for (const ch of cleaned) {
      if (escape) {
        repaired += ch;
        escape = false;
        continue;
      }
      if (ch === '\\' && inString) {
        repaired += ch;
        escape = true;
        continue;
      }
      if (ch === '"') {
        inString = !inString;
        repaired += ch;
        continue;
      }
      if (inString) {
        if (ch === '\n') { repaired += '\\n'; continue; }
        if (ch === '\t') { repaired += '\\t'; continue; }
      }
      repaired += ch;
    }

    return JSON.parse(repaired);
  }
}

