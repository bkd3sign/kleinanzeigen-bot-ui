// Shared category + special_attributes resolution pipeline.
//
// Single source of truth for turning an article (title + description) into a
// SoT-conform { category, special_attributes } pair. Used identically by the
// AI generator (/api/ads/generate) and the quick-edit autosuggest
// (/api/ads/resolve-category) so both paths produce the same result for the
// same input — the only difference between them is the UI entry point.
//
// public/data/category_attributes.json is the source of truth: categories and
// attribute keys/values that are not confirmed entries in it are discarded.

import { shortKey as attrShortKey, INPUT_COMBOBOX_KEYS } from './category-attributes';
import {
  needsDisplayText,
  translateAttrValues,
  type CatAttrsData,
  type CatAttrEntry,
} from './normalize-attributes';

export interface AiCallConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  referer?: string;
  appName?: string;
}

export interface ResolveInput {
  title: string;
  description?: string;
  // Original user prompt / free text — used for the brand corpus check and as a mini-AI hint.
  userHint?: string;
  // Attributes a caller already filled (e.g. the main AI in the generator). Empty for quick-edit.
  aiAttrs?: Record<string, unknown>;
}

export interface ResolveResult {
  category: string | null;
  special_attributes: Record<string, string>;
}

// _i/_d fields are free numeric input — their options are UI hints only, not strict constraints.
// verfuegbarm/verfuegbary are month/year selects despite a numeric-looking suffix.
function isNumericKey(key: string): boolean {
  return (key.endsWith('_i') || key.endsWith('_d')) && !key.includes('verfuegbar');
}

// Case-insensitive lookup returning the canonical casing from the set, or undefined if not found.
export function findCanonical(set: Set<string>, needle: string): string | undefined {
  if (set.has(needle)) return needle;
  const lc = needle.toLowerCase();
  return [...set].find((opt) => opt.toLowerCase() === lc);
}

// Resolve a KA category ID against the source-of-truth IDs: exact match first,
// then prefix-fuzzy match for l3 slugs. KA's suggest API returns e.g. "sneaker"
// but the JSON key is "sneaker_sportschuhe". With no SoT loaded, accept as-is.
export function resolveKaCategoryId(
  base: string,
  l3: string | undefined,
  validCategoryIds: Set<string>,
): string | null {
  if (!l3) return validCategoryIds.size === 0 || validCategoryIds.has(base) ? base : null;
  const exact = `${base}/${l3}`;
  if (validCategoryIds.size === 0 || validCategoryIds.has(exact)) return exact;
  const prefix = `${base}/`;
  const fuzzy = [...validCategoryIds].find(
    (id) =>
      id.startsWith(prefix) &&
      (id.slice(prefix.length).startsWith(l3) || l3.startsWith(id.slice(prefix.length))),
  );
  return fuzzy ?? null;
}

// Build key → allowed-values map for a category.
// Boolean → {true,false}; numeric (_i/_d) → empty set (free input, no constraint);
// select/combobox → option values (display text for brand_s/marke_s). Unknown attr → empty set.
function buildAllowedValues(
  catEntry: CatAttrEntry,
  catAttrsData: CatAttrsData,
): Map<string, Set<string>> {
  const allowed = new Map<string, Set<string>>();
  const add = (key: string, type: string | undefined, options: Array<{ value: string; text: string }> | undefined) => {
    const sk = attrShortKey(key);
    if (key.endsWith('_b') || type === 'boolean') {
      allowed.set(sk, new Set(['true', 'false']));
    } else if (isNumericKey(sk)) {
      allowed.set(sk, new Set());
    } else if (options?.length) {
      const useText = needsDisplayText(sk, options);
      allowed.set(sk, new Set(options.map((o) => (useText ? o.text : o.value))));
    } else {
      allowed.set(sk, new Set());
    }
  };
  for (const ref of catEntry.shared ?? []) {
    const def = catAttrsData.shared_attributes[ref];
    add(ref, def?.type, def?.options);
  }
  for (const attr of catEntry.attributes ?? []) {
    add(attr.attribute_key, undefined, attr.options);
  }
  return allowed;
}

// Strip AI-invented keys and values not in the allowed options list, and normalize casing.
// Pure: no network. Empty allowed set = free input (kept as-is). Unknown key = deleted.
// brand_s/marke_s use case-insensitive canonical matching on display text; all others lowercase.
export function stripAndNormalizeAttrs(
  attrs: Record<string, string>,
  category: string,
  catAttrsData: CatAttrsData,
): Record<string, string> {
  const catEntry = catAttrsData.categories[category];
  if (!catEntry) return {};
  const allowedValues = buildAllowedValues(catEntry, catAttrsData);
  const result = { ...attrs };
  for (const key of Object.keys(result)) {
    const allowed = allowedValues.get(key);
    if (!allowed) {
      delete result[key];
      continue;
    }
    if (allowed.size === 0) continue; // free numeric/text input
    const val = result[key];
    if (INPUT_COMBOBOX_KEYS.has(key)) {
      const canonical = findCanonical(allowed, val);
      if (!canonical) delete result[key];
      else if (canonical !== val) result[key] = canonical;
    } else {
      const normalized = val.toLowerCase();
      if (!allowed.has(normalized)) delete result[key];
      else if (normalized !== val) result[key] = normalized;
    }
  }
  return result;
}

// Brand corpus check: if a brand value doesn't appear in the article text, replace it with
// the category's "Sonstige" fallback option, or drop it when no fallback exists. Pure.
export function applyBrandCorpusFallback(
  attrs: Record<string, string>,
  category: string,
  catAttrsData: CatAttrsData,
  textCorpus: string,
): Record<string, string> {
  const catEntry = catAttrsData.categories[category];
  if (!catEntry) return attrs;
  const result = { ...attrs };
  const corpus = textCorpus.toLowerCase();

  const applyFallback = (sk: string, options: Array<{ value: string; text: string }> | undefined) => {
    const currentVal = result[sk];
    if (!currentVal) return;
    if (corpus.includes(currentVal.toLowerCase())) return;
    const fallback = options?.find(
      (o) =>
        o.value.startsWith('sonstige') ||
        o.text.toLowerCase().startsWith('sonstige') ||
        o.text.toLowerCase().startsWith('weitere'),
    );
    if (fallback) result[sk] = fallback.text;
    else delete result[sk];
  };

  for (const ref of catEntry.shared ?? []) {
    const sk = attrShortKey(ref);
    if (!INPUT_COMBOBOX_KEYS.has(sk)) continue;
    applyFallback(sk, catAttrsData.shared_attributes[ref]?.options);
  }
  for (const attr of catEntry.attributes ?? []) {
    const sk = attrShortKey(attr.attribute_key);
    if (!INPUT_COMBOBOX_KEYS.has(sk)) continue;
    applyFallback(sk, attr.options);
  }
  return result;
}

// Build the "key: option | option" lines describing a category's fillable select/bool attrs.
// `filled` is consulted to optionally skip already-filled slots (used for the mini-AI fill prompt).
function buildAttrLines(
  catEntry: CatAttrEntry,
  catAttrsData: CatAttrsData,
  filled?: Record<string, string>,
): string[] {
  const lines: string[] = [];
  const addLine = (key: string, type: string | undefined, options: Array<{ value: string; text: string }> | undefined) => {
    const sk = attrShortKey(key);
    if (filled && filled[sk]) return;
    if (isNumericKey(sk)) return;
    if (key.endsWith('_b') || type === 'boolean') {
      lines.push(`${sk}: true | false`);
    } else if (options?.length) {
      const useText = needsDisplayText(sk, options);
      lines.push(`${sk}: ${options.map((o) => (useText ? o.text : o.value)).join(' | ')}`);
    }
  };
  for (const ref of catEntry.shared ?? []) {
    const def = catAttrsData.shared_attributes[ref];
    addLine(ref, def?.type, def?.options);
  }
  for (const attr of catEntry.attributes ?? []) {
    addLine(attr.attribute_key, undefined, attr.options);
  }
  return lines;
}

function aiHeaders(cfg: AiCallConfig): Record<string, string> {
  return {
    Authorization: `Bearer ${cfg.apiKey}`,
    'Content-Type': 'application/json',
    ...(cfg.referer ? { 'HTTP-Referer': cfg.referer } : {}),
    ...(cfg.appName ? { 'X-Title': cfg.appName } : {}),
  };
}

// Pick the best-matching category ID from the SoT using a fast mini-AI call.
// Passes the KA suggestion (if available) as a hint — the AI confirms it or picks a better match.
// Returns null on failure so the caller can fall back gracefully.
async function selectCategoryViaAi(
  title: string,
  descPreview: string,
  catAttrsData: CatAttrsData,
  cfg: AiCallConfig,
  kaSuggestedId?: string | null,
): Promise<string | null> {
  const categoryList = Object.entries(catAttrsData.categories)
    .map(([id, entry]) => `${id}: ${entry.category_name}`)
    .join('\n');

  const kaHint =
    kaSuggestedId && catAttrsData.categories[kaSuggestedId]
      ? `\nKleinanzeigen-Vorschlag: ${kaSuggestedId} (${catAttrsData.categories[kaSuggestedId].category_name}) — bestätige diesen wenn er passt, wähle sonst eine bessere Kategorie.`
      : '';

  try {
    const resp = await fetch(`${cfg.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: aiHeaders(cfg),
      body: JSON.stringify({
        model: cfg.model,
        messages: [
          {
            role: 'system',
            content:
              'Du bist ein Kategorisierungsassistent für Kleinanzeigen.de. Wähle die passendste Kategorie aus der Liste. Antworte NUR mit der exakten Kategorie-ID (z.B. "161/175/kopfhoerer_kopfhoerer"), ohne Erklärung, ohne Anführungszeichen.',
          },
          {
            role: 'user',
            content: `Artikel: "${title}"\nBeschreibung: "${descPreview}"${kaHint}\n\nVerfügbare Kategorien:\n${categoryList}`,
          },
        ],
        temperature: 0,
        max_tokens: 60,
      }),
      signal: AbortSignal.timeout(10000),
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    const selected = (data.choices?.[0]?.message?.content ?? '').trim().replace(/^["']|["']$/g, '');
    return catAttrsData.categories[selected] ? selected : null;
  } catch {
    return null;
  }
}

// Mini-AI call: fill empty select-type attributes that neither the caller nor KA filled.
// Only values from the allowed options are applied. Returns the keys to merge in.
async function fillMissingAttrsViaAi(
  input: ResolveInput,
  missingLines: string[],
  cfg: AiCallConfig,
): Promise<Record<string, string>> {
  const userHint = input.userHint ? `Nutzerbeschreibung: ${input.userHint.slice(0, 200)}\n` : '';
  const miniPrompt = `Artikel: ${input.title}
${userHint}Beschreibung: ${(input.description ?? '').slice(0, 400)}

Wähle für die folgenden Felder den passendsten Wert aus den erlaubten Optionen. Antworte NUR mit einem JSON-Objekt (keine Erklärung). Wenn du einen Wert nicht sicher bestimmen kannst, lass das Feld weg. NIEMALS Platzhalter verwenden.

${missingLines.join('\n')}`;

  try {
    const resp = await fetch(`${cfg.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: aiHeaders(cfg),
      body: JSON.stringify({
        model: cfg.model,
        messages: [
          {
            role: 'system',
            content:
              'Du bist ein Assistent der Produktattribute für Kleinanzeigen bestimmt. Antworte ausschließlich mit einem JSON-Objekt.',
          },
          { role: 'user', content: miniPrompt },
        ],
        temperature: 0.3,
        response_format: { type: 'json_object' },
      }),
      signal: AbortSignal.timeout(15000),
    });
    if (!resp.ok) return {};
    const data = await resp.json();
    const content = data.choices?.[0]?.message?.content ?? '';
    const miniAttrs = parseAiJson(content) as Record<string, string>;

    // Only apply values that are from the allowed options list
    const allowedMap: Record<string, Set<string>> = {};
    for (const line of missingLines) {
      const [key, rest] = line.split(': ');
      if (key && rest) allowedMap[key] = new Set(rest.split(' | '));
    }
    const filled: Record<string, string> = {};
    for (const [k, v] of Object.entries(miniAttrs)) {
      if (v == null) continue;
      const strVal = String(v);
      if (INPUT_COMBOBOX_KEYS.has(k)) {
        const canonical = findCanonical(allowedMap[k] ?? new Set(), strVal);
        if (canonical !== undefined) filled[k] = canonical;
      } else {
        const normalized = strVal.toLowerCase();
        if (allowedMap[k]?.has(normalized)) filled[k] = normalized;
      }
    }
    return filled;
  } catch {
    return {};
  }
}

// Fetch KA category suggestion by title and resolve it against the SoT.
async function fetchKaCategory(
  title: string,
  validCategoryIds: Set<string>,
): Promise<{ suggestion: Record<string, unknown> | null; id: string | null }> {
  try {
    const res = await fetch(
      `https://www.kleinanzeigen.de/p-category-suggestion.json?title=${encodeURIComponent(title)}`,
      { headers: { Accept: 'application/json', 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(4000) },
    );
    if (!res.ok) return { suggestion: null, id: null };
    const suggestion = (await res.json()) as Record<string, unknown>;
    const base = `${suggestion.parent_id}/${suggestion.category_id}`;
    const id = resolveKaCategoryId(base, suggestion.l3_value as string | undefined, validCategoryIds);
    return { suggestion, id };
  } catch {
    return { suggestion: null, id: null };
  }
}

// Fetch KA attribute suggestion and merge into the seed kaAttrs map (in place).
async function enrichKaAttributes(
  title: string,
  numericCatId: string,
  kaAttrs: Record<string, string>,
): Promise<void> {
  try {
    const res = await fetch('https://www.kleinanzeigen.de/p-attribute-suggestion.json', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'User-Agent': 'Mozilla/5.0' },
      body: JSON.stringify({
        title,
        categoryId: numericCatId,
        previousCategoryId: numericCatId,
        attributes: JSON.stringify(kaAttrs),
      }),
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return;
    const data = (await res.json()) as Record<string, unknown>;
    for (const [k, v] of Object.entries(data)) {
      if (typeof v === 'string' && k !== 'categoryId' && k !== 'previousCategoryId') kaAttrs[k] = v;
    }
  } catch {
    /* ignore */
  }
}

// Orchestrator: article → SoT-conform { category, special_attributes }.
// Identical pipeline for the AI generator and quick-edit autosuggest.
export async function resolveCategoryAndAttributes(
  input: ResolveInput,
  catAttrsData: CatAttrsData,
  cfg: AiCallConfig,
): Promise<ResolveResult> {
  const empty: ResolveResult = { category: null, special_attributes: {} };
  const title = input.title.trim();
  if (!title) return empty;

  const validCategoryIds = new Set(Object.keys(catAttrsData.categories));

  // 1. KA category suggestion by title → fuzzy-resolve against SoT
  const { suggestion, id: kaId } = await fetchKaCategory(title, validCategoryIds);

  // 2. Mini-AI category selection — authoritative when it returns a valid SoT id
  let activeSuggestion: Record<string, unknown> | null = suggestion;
  let activeId = kaId;
  const aiCatId = await selectCategoryViaAi(
    title,
    (input.description ?? '').slice(0, 300),
    catAttrsData,
    cfg,
    activeId,
  );
  if (aiCatId) {
    activeId = aiCatId;
    activeSuggestion = null; // AI selection is authoritative — discard KA result
  }

  // 3. SoT category validation — unknown category discards everything
  if (!activeId || !catAttrsData.categories[activeId]) return empty;

  // 4. Seed attributes from the caller (AI-filled) and KA lN_id/lN_value pairs
  const kaAttrs: Record<string, string> = {};
  if (activeSuggestion) {
    for (let n = 1; n <= 9; n++) {
      const key = activeSuggestion[`l${n}_id`] as string | undefined;
      const val = activeSuggestion[`l${n}_value`] as string | undefined;
      if (key && val) kaAttrs[key] = val;
    }
  }

  // 5. Enrich with KA attribute-suggest. Numeric category_id from KA response or derived from "parent/catId/slug".
  const numericCatId =
    activeSuggestion?.category_id != null ? String(activeSuggestion.category_id) : activeId.split('/')[1];
  if (numericCatId) {
    await enrichKaAttributes(title, numericCatId, kaAttrs);
  }

  // 6. Merge: caller attrs first, KA attrs override (KA is authoritative for known keys)
  let merged: Record<string, string> = Object.fromEntries(
    Object.entries(input.aiAttrs ?? {})
      .filter(([, v]) => v != null && v !== '')
      .map(([k, v]) => [k, String(v)]),
  );
  merged = { ...merged, ...kaAttrs };

  // 7. Translate API values → display text for text-search combobox attributes (brand_s/marke_s)
  merged = translateAttrValues(merged, activeId, catAttrsData);

  // 8. Strip invalid keys/values + normalize casing against the SoT
  merged = stripAndNormalizeAttrs(merged, activeId, catAttrsData);

  // 9. Mini-AI fill for select/bool attributes still empty
  const catEntry = catAttrsData.categories[activeId];
  const missingLines = buildAttrLines(catEntry, catAttrsData, merged);
  if (missingLines.length > 0) {
    const filled = await fillMissingAttrsViaAi(input, missingLines, cfg);
    merged = stripAndNormalizeAttrs({ ...merged, ...filled }, activeId, catAttrsData);
  }

  // 10. Brand corpus fallback → "Sonstige" when the brand isn't in the article text
  const textCorpus = [input.userHint, title, (input.description ?? '').slice(0, 500)].filter(Boolean).join(' ');
  merged = applyBrandCorpusFallback(merged, activeId, catAttrsData, textCorpus);

  return { category: activeId, special_attributes: merged };
}

// Robustly parse JSON from an AI response (strips markdown fences, extracts the first object,
// repairs unescaped control characters inside strings).
export function parseAiJson(content: string): Record<string, unknown> {
  let cleaned = content.trim();

  if (cleaned.startsWith('```')) {
    cleaned = cleaned.split('\n').slice(1).join('\n');
    cleaned = cleaned.replace(/```\s*$/, '').trim();
  }

  if (!cleaned.startsWith('{')) {
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start !== -1 && end !== -1) cleaned = cleaned.slice(start, end + 1);
  }

  try {
    return JSON.parse(cleaned);
  } catch {
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
        if (ch === '\n') {
          repaired += '\\n';
          continue;
        }
        if (ch === '\t') {
          repaired += '\\t';
          continue;
        }
      }
      repaired += ch;
    }
    return JSON.parse(repaired);
  }
}
