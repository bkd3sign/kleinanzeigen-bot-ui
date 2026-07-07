import { describe, it, expect } from 'vitest';
import type { CatAttrsData } from '@/lib/ads/normalize-attributes';
import {
  stripAndNormalizeAttrs,
  applyBrandCorpusFallback,
  resolveKaCategoryId,
  findCanonical,
} from '@/lib/ads/resolve-category-attributes';

// Exercises the REAL deterministic pipeline functions shared by the AI generator
// (/api/ads/generate) and the quick-edit autosuggest (/api/ads/resolve-category).
// Covers versioned-key extraction (Bug 1), case normalization (Bug 2), brand handling.

type AttrOption = { value: string; text: string };

const colorOptions: AttrOption[] = [
  { value: 'blau', text: 'Blau' },
  { value: 'schwarz', text: 'Schwarz' },
  { value: 'grau', text: 'Grau' },
];
const conditionOptions: AttrOption[] = [
  { value: 'new_with_tag', text: 'Neu mit Etikett' },
  { value: 'like_new', text: 'Sehr Gut' },
  { value: 'ok', text: 'Gut' },
];
const groesseOptions: AttrOption[] = [
  { value: 'm', text: 'M' },
  { value: 'l', text: 'L' },
  { value: 'xl', text: 'XL' },
];
const brandOptions: AttrOption[] = [
  { value: 'jack_jones', text: 'Jack & Jones' },
  { value: 'nike', text: 'Nike' },
  { value: 'sonstige_marken', text: 'Sonstige' },
];

const data: CatAttrsData = {
  categories: {
    'kleidung/herren': {
      category_name: 'Herrenbekleidung',
      attributes: [{ attribute_key: 'preis_pro_qm_i', options: [] }],
      shared: ['color_s__v2', 'condition_s__v3', 'kleidung_herren.groesse_s'],
    },
    'kleidung/marken': {
      category_name: 'Markenmode',
      attributes: [{ attribute_key: 'brand_s', options: brandOptions }],
      shared: [],
    },
  },
  shared_attributes: {
    'color_s__v2': { options: colorOptions },
    'condition_s__v3': { options: conditionOptions },
    'kleidung_herren.groesse_s': { options: groesseOptions },
  },
};

describe('stripAndNormalizeAttrs — key extraction (Bug 1) + casing (Bug 2)', () => {
  it('preserves valid attrs whose SoT ref carries a __v suffix or namespace', () => {
    const result = stripAndNormalizeAttrs(
      { color_s: 'blau', condition_s: 'ok', groesse_s: 'm' },
      'kleidung/herren',
      data,
    );
    expect(result).toEqual({ color_s: 'blau', condition_s: 'ok', groesse_s: 'm' });
  });

  it('removes invalid option values', () => {
    const result = stripAndNormalizeAttrs({ color_s: 'ERFUNDEN', condition_s: 'ok' }, 'kleidung/herren', data);
    expect(result.color_s).toBeUndefined();
    expect(result.condition_s).toBe('ok');
  });

  it('removes AI-invented keys not in the category', () => {
    const result = stripAndNormalizeAttrs({ color_s: 'blau', ki_invented: 'irgendwas' }, 'kleidung/herren', data);
    expect(result.color_s).toBe('blau');
    expect(result.ki_invented).toBeUndefined();
  });

  it('keeps numeric free-input fields (empty allowed set = no constraint)', () => {
    const result = stripAndNormalizeAttrs({ groesse_s: 'm', preis_pro_qm_i: '15' }, 'kleidung/herren', data);
    expect(result.groesse_s).toBe('m');
    expect(result.preis_pro_qm_i).toBe('15');
  });

  it('case-normalizes select values (M→m, Ok→ok, Blau→blau)', () => {
    const result = stripAndNormalizeAttrs(
      { groesse_s: 'M', condition_s: 'Ok', color_s: 'Blau' },
      'kleidung/herren',
      data,
    );
    expect(result).toEqual({ groesse_s: 'm', condition_s: 'ok', color_s: 'blau' });
  });

  it('preserves brand_s display-text casing via case-insensitive canonical match', () => {
    const result = stripAndNormalizeAttrs({ brand_s: 'jack & jones' }, 'kleidung/marken', data);
    expect(result.brand_s).toBe('Jack & Jones');
  });

  it('removes a brand value not in the option list', () => {
    const result = stripAndNormalizeAttrs({ brand_s: 'Adidas' }, 'kleidung/marken', data);
    expect(result.brand_s).toBeUndefined();
  });

  it('returns empty object for an unknown category', () => {
    expect(stripAndNormalizeAttrs({ color_s: 'blau' }, 'unknown/cat', data)).toEqual({});
  });
});

describe('applyBrandCorpusFallback', () => {
  it('keeps a brand that appears in the article text', () => {
    const result = applyBrandCorpusFallback(
      { brand_s: 'Jack & Jones' },
      'kleidung/marken',
      data,
      'Verkaufe Jeans von Jack & Jones',
    );
    expect(result.brand_s).toBe('Jack & Jones');
  });

  it('falls back to Sonstige when the brand is absent from the text', () => {
    const result = applyBrandCorpusFallback(
      { brand_s: 'Nike' },
      'kleidung/marken',
      data,
      'Verkaufe eine schöne Jeans',
    );
    expect(result.brand_s).toBe('Sonstige');
  });

  it('leaves non-brand attributes untouched', () => {
    const result = applyBrandCorpusFallback({ color_s: 'blau' }, 'kleidung/herren', data, 'irgendein Text');
    expect(result.color_s).toBe('blau');
  });
});

describe('resolveKaCategoryId', () => {
  const valid = new Set(['161/175/kopfhoerer_kopfhoerer', '161/175']);

  it('matches an exact id', () => {
    expect(resolveKaCategoryId('161/175', 'kopfhoerer_kopfhoerer', valid)).toBe('161/175/kopfhoerer_kopfhoerer');
  });

  it('fuzzy-matches a prefix slug (KA "kopfhoerer" → SoT "kopfhoerer_kopfhoerer")', () => {
    expect(resolveKaCategoryId('161/175', 'kopfhoerer', valid)).toBe('161/175/kopfhoerer_kopfhoerer');
  });

  it('returns the base id when there is no l3 slug and the base is valid', () => {
    expect(resolveKaCategoryId('161/175', undefined, valid)).toBe('161/175');
  });

  it('returns null when nothing matches', () => {
    expect(resolveKaCategoryId('999/999', 'nichts', valid)).toBeNull();
  });

  it('accepts any id when no SoT ids are provided (empty set)', () => {
    expect(resolveKaCategoryId('1/2', 'foo', new Set())).toBe('1/2/foo');
  });
});

describe('findCanonical', () => {
  it('returns the exact match', () => {
    expect(findCanonical(new Set(['m', 'l']), 'm')).toBe('m');
  });

  it('returns canonical casing for a case-insensitive match', () => {
    expect(findCanonical(new Set(['Jack & Jones']), 'jack & jones')).toBe('Jack & Jones');
  });

  it('returns undefined when absent', () => {
    expect(findCanonical(new Set(['m', 'l']), 'xxl')).toBeUndefined();
  });
});
