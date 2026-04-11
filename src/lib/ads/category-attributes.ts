/**
 * Pure logic for resolving category-specific attributes.
 * Extracted from CategoryAttributesPicker for testability.
 */

export interface AttributeOption {
  value: string;
  text: string;
}

export interface SharedAttributeDef {
  options?: AttributeOption[];
  type?: string;
  text?: string;
}

interface InlineAttributeDef extends SharedAttributeDef {
  attribute_key: string;
}

export interface CategoryEntry {
  attributes: InlineAttributeDef[];
  shared: string[];
}

export interface ResolvedAttribute {
  key: string;
  label: string;
  options?: AttributeOption[];
  type: 'select' | 'boolean' | 'number' | 'range' | 'month-year';
  yearKey?: string;
  yearOptions?: AttributeOption[];
}

// Translations for attribute base names
const LABEL_DE: Record<string, string> = {
  type: 'Typ', condition: 'Zustand', color: 'Farbe', brand: 'Marke',
  model: 'Modell', fuel: 'Kraftstoff', shift: 'Getriebe', location: 'Lage',
  swap: 'Tausch', online_tour: 'Online-Besichtigung', working_hours: 'Arbeitszeit',
  device_equipment: 'Ausstattung', wage: 'Gehalt',
  anzahl_tueren: 'Türanzahl', material_innenausstattung: 'Innenausstattung',
  schaden: 'Unfallschaden', groesse: 'Größe', preis_pro_qm: 'Preis pro m²',
  km: 'Kilometerstand', ez: 'Erstzulassung', power: 'Leistung (PS)',
  leistung: 'Leistung (PS)', hubraum: 'Hubraum (ccm)', qm: 'Wohnfläche (m²)',
  zimmer: 'Zimmer', anzahl_mitbewohner: 'Mitbewohner', baujahr: 'Baujahr',
  verfuegbarm: 'Monat', verfuegbary: 'Jahr',
};

const HIDDEN_ATTR_SUFFIXES = ['guarantee_b'];

export function getLabel(key: string, def?: SharedAttributeDef): string {
  if (def?.text) return def.text;
  const base = (key.split('.').pop() ?? key).replace(/_[sbid]$/, '');
  return LABEL_DE[base] ?? (base.charAt(0).toUpperCase() + base.slice(1));
}

export function shortKey(key: string): string {
  return key.includes('.') ? key.split('.').pop()! : key;
}

export function resolveAttributes(
  entry: CategoryEntry,
  shared: Record<string, SharedAttributeDef>,
  category: string,
): ResolvedAttribute[] {
  const result: ResolvedAttribute[] = [];
  const skipKeys = new Set<string>();
  const catSlug = category.split('/').pop() ?? '';
  const refs = entry.shared ?? [];
  const isHidden = (key: string) => HIDDEN_ATTR_SUFFIXES.some((s) => key.endsWith(s));

  // Pair up verfuegbarm/verfuegbary as month-year selects
  for (const ref of refs) {
    if (ref.includes('verfuegbarm')) {
      const yearRef = ref.replace('verfuegbarm', 'verfuegbary');
      const monthDef = shared[ref];
      const yearDef = shared[yearRef];
      result.push({
        key: ref, yearKey: yearRef, label: 'Verfügbar ab', type: 'month-year',
        options: monthDef?.options, yearOptions: yearDef?.options,
      });
      skipKeys.add(ref);
      skipKeys.add(yearRef);
    }
  }

  // Deduplicate shared refs with the same short key (e.g. zubehoer.art_s + pferde.art_s + fische.art_s).
  // Prefer the ref whose namespace matches the last category segment:
  //   category "130/313/pferde" → prefer "pferde.art_s" over "zubehoer.art_s" or "fische.art_s"
  const seenShort = new Map<string, number>();
  for (const ref of refs) {
    if (skipKeys.has(ref) || isHidden(ref)) continue;
    const def = shared[ref];
    if (!def) continue;
    const short = shortKey(ref);
    const type = ref.endsWith('_b') || def.type === 'boolean' ? 'boolean'
      : def.type === 'range' ? 'range'
      : (ref.endsWith('_i') || ref.endsWith('_d')) ? 'number'
      : 'select';

    const existingIdx = seenShort.get(short);
    if (existingIdx !== undefined) {
      const namespace = ref.split('.')[0];
      if (namespace === catSlug) {
        result[existingIdx] = { key: ref, label: getLabel(ref, def), options: def.options ? [...def.options] : undefined, type };
      }
    } else {
      seenShort.set(short, result.length);
      result.push({ key: ref, label: getLabel(ref, def), options: def.options ? [...def.options] : undefined, type });
    }
  }

  for (const attr of entry.attributes ?? []) {
    const key = attr.attribute_key;
    if (skipKeys.has(key) || isHidden(key)) continue;
    const type = key.endsWith('_b') || attr.type === 'boolean' ? 'boolean'
      : attr.type === 'range' ? 'range'
      : (key.endsWith('_i') || key.endsWith('_d')) ? 'number'
      : 'select';
    result.push({ key, label: getLabel(key, attr), options: attr.options, type });
  }

  return result;
}
