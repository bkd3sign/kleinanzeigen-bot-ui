// Client-side loader for /data/category_attributes.json (no Node.js dependencies)
import { shortKey, type AttributeOption } from './category-attributes';

export interface SharedAttrDef {
  options?: AttributeOption[];
  type?: string;
}

interface InlineAttrDef extends SharedAttrDef {
  attribute_key: string;
}

interface CategoryEntry {
  attributes: InlineAttrDef[];
  shared: string[];
}

export interface ClientCatAttrsData {
  categories: Record<string, CategoryEntry>;
  shared_attributes: Record<string, SharedAttrDef>;
}

let cache: ClientCatAttrsData | null = null;

export async function loadAttributeData(): Promise<ClientCatAttrsData> {
  if (cache) return cache;
  const res = await fetch('/data/category_attributes.json');
  cache = await res.json() as ClientCatAttrsData;
  return cache;
}

// Returns { attrShortKey: { apiValue: displayText } } for a given category.
// Used by AttributeChips to resolve display labels for stored API values.
export function buildAttrDisplayMap(
  categoryId: string,
  data: ClientCatAttrsData,
): Record<string, Record<string, string>> {
  const entry = data.categories[categoryId];
  if (!entry) return {};
  const map: Record<string, Record<string, string>> = {};

  for (const ref of entry.shared ?? []) {
    const sk = shortKey(ref);
    const opts = data.shared_attributes[ref]?.options;
    if (opts?.length) map[sk] = Object.fromEntries(opts.map((o) => [o.value, o.text]));
  }
  for (const attr of entry.attributes ?? []) {
    const sk = shortKey(attr.attribute_key);
    if (attr.options?.length) map[sk] = Object.fromEntries(attr.options.map((o) => [o.value, o.text]));
  }
  return map;
}
