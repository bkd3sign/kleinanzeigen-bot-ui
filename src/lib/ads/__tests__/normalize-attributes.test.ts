import { describe, it, expect } from 'vitest';
import { needsDisplayText, translateAttrValues } from '../normalize-attributes';
import type { AttrOption, CatAttrsData } from '../normalize-attributes';

function opt(value: string, text: string): AttrOption {
  return { value, text };
}

const brandOpts: AttrOption[] = [
  opt('jack_jones', 'Jack & Jones'),
  opt('levis', "Levi's"),
  opt('soliver', 'S.Oliver'),
  opt('asics', 'ASICS'),
  opt('sonstige', 'Sonstige'),
];

const artOpts: AttrOption[] = [
  opt('hemden', 'Hemden'),
  opt('shirts', 'Shirts'),
  opt('hosen', 'Hosen'),
];

const conditionOpts: AttrOption[] = [
  opt('new', 'Neu'),
  opt('like_new', 'Sehr Gut'),
  opt('ok', 'Gut'),
];

const catData: CatAttrsData = {
  categories: {
    '153/160/hemden': {
      shared: ['kleidung_herren.brand_s'],
      attributes: [
        { attribute_key: 'kleidung_herren.art_s', options: artOpts },
        { attribute_key: 'kleidung_herren.condition_s', options: conditionOpts },
      ],
    },
    '153/160/hosen': {
      shared: [],
      attributes: [
        { attribute_key: 'kleidung_herren.art_s', options: artOpts },
      ],
    },
  },
  shared_attributes: {
    'kleidung_herren.brand_s': { options: brandOpts },
  },
};

describe('needsDisplayText', () => {
  it('returns true for brand_s with mismatch options', () => {
    expect(needsDisplayText('brand_s', brandOpts)).toBe(true);
  });

  it('returns true for marke_s with mismatch options', () => {
    const markeOpts = [opt('bmw', 'BMW'), opt('rolls_royce', 'Rolls-Royce')];
    expect(needsDisplayText('marke_s', markeOpts)).toBe(true);
  });

  it('returns false for brand_s when all options normalize identically', () => {
    const simpleOpts = [opt('asics', 'ASICS'), opt('sonstige', 'Sonstige')];
    expect(needsDisplayText('brand_s', simpleOpts)).toBe(false);
  });

  it('returns false for art_s even with mismatch options', () => {
    const opts = [opt('hemden', 'Hemden')];
    expect(needsDisplayText('art_s', opts)).toBe(false);
  });

  it('returns false for condition_s', () => {
    expect(needsDisplayText('condition_s', conditionOpts)).toBe(false);
  });

  it('returns false for color_s', () => {
    expect(needsDisplayText('color_s', [opt('blau', 'Blau')])).toBe(false);
  });

  it('returns false for groesse_s', () => {
    expect(needsDisplayText('groesse_s', [opt('s', 'S')])).toBe(false);
  });
});

describe('translateAttrValues', () => {
  it('translates brand_s API value to display text via shared attr', () => {
    const result = translateAttrValues(
      { brand_s: 'jack_jones', art_s: 'hemden', condition_s: 'like_new' },
      '153/160/hemden',
      catData,
    );
    expect(result.brand_s).toBe('Jack & Jones');
    expect(result.art_s).toBe('hemden');
    expect(result.condition_s).toBe('like_new');
  });

  it('translates brand_s with special apostrophe', () => {
    const result = translateAttrValues({ brand_s: 'levis' }, '153/160/hemden', catData);
    expect(result.brand_s).toBe("Levi's");
  });

  it('translates brand_s with dot', () => {
    const result = translateAttrValues({ brand_s: 'soliver' }, '153/160/hemden', catData);
    expect(result.brand_s).toBe('S.Oliver');
  });

  it('is idempotent — already-correct display text is not double-translated', () => {
    const result = translateAttrValues(
      { brand_s: 'Jack & Jones' },
      '153/160/hemden',
      catData,
    );
    expect(result.brand_s).toBe('Jack & Jones');
  });

  it('leaves art_s and condition_s untouched (not text-search comboboxes)', () => {
    const result = translateAttrValues(
      { art_s: 'hemden', condition_s: 'like_new' },
      '153/160/hemden',
      catData,
    );
    expect(result.art_s).toBe('hemden');
    expect(result.condition_s).toBe('like_new');
  });

  it('translates brand_s to display text even when normalize(value)==normalize(text), because set contains other mismatches', () => {
    // asics→ASICS: normalize both to "asics", still translated because jack_jones triggers needsDisplayText
    const result = translateAttrValues({ brand_s: 'asics' }, '153/160/hemden', catData);
    expect(result.brand_s).toBe('ASICS');
  });

  it('returns attrs unchanged for unknown category', () => {
    const result = translateAttrValues(
      { brand_s: 'jack_jones' },
      'unknown/category',
      catData,
    );
    expect(result.brand_s).toBe('jack_jones');
  });

  it('returns attrs unchanged when brand_s value has no matching option', () => {
    const result = translateAttrValues(
      { brand_s: 'unknown_brand' },
      '153/160/hemden',
      catData,
    );
    expect(result.brand_s).toBe('unknown_brand');
  });

  it('does not translate inline art_s attribute (not a combobox)', () => {
    const result = translateAttrValues(
      { art_s: 'hemden', brand_s: 'jack_jones' },
      '153/160/hemden',
      catData,
    );
    expect(result.art_s).toBe('hemden');
    expect(result.brand_s).toBe('Jack & Jones');
  });

  it('handles category with no special_attributes gracefully', () => {
    const result = translateAttrValues(
      { art_s: 'hosen' },
      '153/160/hosen',
      catData,
    );
    expect(result.art_s).toBe('hosen');
  });

  it('does not mutate the original attrs object', () => {
    const input = { brand_s: 'jack_jones', art_s: 'hemden' };
    translateAttrValues(input, '153/160/hemden', catData);
    expect(input.brand_s).toBe('jack_jones');
  });
});
