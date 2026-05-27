// Translates internal API values to display text for attributes that the bot
// sets via a text-search input combobox (web_select_combobox / input[role="combobox"]).
// That handler types the value as search text and matches by display-text normalization,
// so "jack_jones" fails to match "Jack & Jones" — the YAML must store the display text.
//
// Scope: ONLY brand_s and marke_s short keys. These are confirmed text-search fields
// with 100+ resp. 21-65 options. All other attributes (art_s, condition_s, color_s,
// groesse_s, …) use button[role="combobox"] or <select> and require the API value.
// condition_s has its own bot handler (_normalize_condition) that expects API values.

import path from 'path';
import { readFileSync, existsSync } from 'fs';
import { shortKey } from './category-attributes';

export interface AttrOption { value: string; text: string; }
export interface SharedAttrDef { options?: AttrOption[]; type?: string; text?: string; }
export interface CatAttrEntry {
  attributes: Array<{ attribute_key: string; options?: AttrOption[] }>;
  shared: string[];
}
export interface CatAttrsData {
  categories: Record<string, CatAttrEntry>;
  shared_attributes: Record<string, SharedAttrDef>;
}

// Short keys of attributes that use a text-search input combobox.
// All others use button/select handlers and must keep their API value.
const INPUT_COMBOBOX_KEYS = new Set(['brand_s', 'marke_s']);

let _cached: CatAttrsData | null | undefined;

export function loadCatAttrsData(): CatAttrsData | null {
  if (_cached !== undefined) return _cached ?? null;
  const p = path.join(process.cwd(), 'public', 'data', 'category_attributes.json');
  if (!existsSync(p)) { _cached = null; return null; }
  try { _cached = JSON.parse(readFileSync(p, 'utf-8')) as CatAttrsData; } catch { _cached = null; }
  return _cached ?? null;
}

const normAttr = (s: string) => s.replace(/_+/g, ' ').trim().toLowerCase();

// Returns true if this attribute uses a text-search input combobox AND has at least
// one option where normalize(value) differs from normalize(text). Both conditions
// must hold: the attribute must be a known text-search field (brand_s / marke_s),
// and the mismatch must actually exist (otherwise no translation is needed).
export function needsDisplayText(attrShortKey: string, options: AttrOption[]): boolean {
  if (!INPUT_COMBOBOX_KEYS.has(attrShortKey)) return false;
  return options.some(o => normAttr(o.value) !== normAttr(o.text));
}

// Translate API values → display text for text-search combobox attributes in a category.
// Pass-through for all other attributes (button/select — they need API values).
export function translateAttrValues(
  attrs: Record<string, string>,
  category: string,
  catAttrsData: CatAttrsData,
): Record<string, string> {
  const catEntry = catAttrsData.categories[category];
  if (!catEntry) return attrs;

  const result = { ...attrs };
  const sa = catAttrsData.shared_attributes;

  for (const ref of catEntry.shared ?? []) {
    const def = sa[ref];
    if (!def?.options?.length) continue;
    const sk = shortKey(ref);
    if (!needsDisplayText(sk, def.options) || !result[sk]) continue;
    const match = def.options.find(o => o.value === result[sk]);
    if (match) result[sk] = match.text;
  }

  for (const attr of catEntry.attributes ?? []) {
    if (!attr.options?.length) continue;
    const sk = shortKey(attr.attribute_key);
    if (!needsDisplayText(sk, attr.options) || !result[sk]) continue;
    const match = attr.options.find(o => o.value === result[sk]);
    if (match) result[sk] = match.text;
  }

  return result;
}
