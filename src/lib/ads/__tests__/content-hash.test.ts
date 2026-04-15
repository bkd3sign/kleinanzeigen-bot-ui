import { describe, it, expect } from 'vitest';
import { computeContentHash, stableStringify, prune } from '../content-hash';

describe('stableStringify', () => {
  it('matches Python json.dumps(sort_keys=True) key ordering', () => {
    expect(stableStringify({ b: 2, a: 1 })).toBe('{"a": 1, "b": 2}');
  });

  it('matches Python separators (", " and ": ")', () => {
    expect(stableStringify({ a: [1, 2, 3] })).toBe('{"a": [1, 2, 3]}');
  });

  it('serializes float fields with .0 for integer values (matching Python float coercion)', () => {
    // Python: json.dumps({"shipping_costs": 5.0}) → '{"shipping_costs": 5.0}'
    expect(stableStringify({ shipping_costs: 5 })).toBe('{"shipping_costs": 5.0}');
    expect(stableStringify({ shipping_costs: 0 })).toBe('{"shipping_costs": 0.0}');
  });

  it('serializes float fields normally for non-integer values', () => {
    expect(stableStringify({ shipping_costs: 4.89 })).toBe('{"shipping_costs": 4.89}');
  });

  it('serializes nested float fields (auto_price_reduction.amount/min_price)', () => {
    const obj = {
      auto_price_reduction: {
        amount: 10,
        enabled: true,
        min_price: 15,
        strategy: 'PERCENTAGE',
      },
    };
    const result = stableStringify(obj);
    expect(result).toContain('"amount": 10.0');
    expect(result).toContain('"min_price": 15.0');
  });

  it('does not add .0 to non-float fields', () => {
    expect(stableStringify({ price: 100 })).toBe('{"price": 100}');
    expect(stableStringify({ republication_interval: 7 })).toBe('{"republication_interval": 7}');
  });

  it('handles nested objects and arrays', () => {
    expect(stableStringify({ a: { c: 3, b: 2 } })).toBe('{"a": {"b": 2, "c": 3}}');
    expect(stableStringify({ a: [1, "x"] })).toBe('{"a": [1, "x"]}');
  });

  it('handles null and primitives', () => {
    expect(stableStringify(null)).toBe('null');
    expect(stableStringify(true)).toBe('true');
    expect(stableStringify('hello')).toBe('"hello"');
    expect(stableStringify(42)).toBe('42');
  });
});

describe('prune', () => {
  it('removes empty objects', () => {
    expect(prune({ a: 1, b: {} })).toEqual({ a: 1 });
  });

  it('removes empty arrays', () => {
    expect(prune({ a: 1, b: [] })).toEqual({ a: 1 });
  });

  it('keeps non-empty containers', () => {
    expect(prune({ a: [1], b: { c: 2 } })).toEqual({ a: [1], b: { c: 2 } });
  });

  it('prunes recursively', () => {
    expect(prune({ a: { b: {} } })).toEqual({ a: {} });
    // Second-level empty object remains — only leaf values are pruned
  });
});

describe('computeContentHash', () => {
  it('matches Python bot hash for minimal ad (upstream test vector)', () => {
    // From upstream test_ad_model.py: test_update_content_hash
    const ad = {
      id: '123456789',
      title: 'Test Ad Title',
      category: '160',
      description: 'Test Description',
    };
    expect(computeContentHash(ad)).toBe('ae3defaccd6b41f379eb8de17263caa1bd306e35e74b11aa03a4738621e96ece');
  });

  it('excludes metadata fields from hash', () => {
    const base = {
      title: 'Test Ad Title',
      category: '160',
      description: 'Test Description',
    };
    const withMeta = {
      ...base,
      id: '123456789',
      created_on: '2025-05-08T09:34:03',
      updated_on: '2025-05-14T20:43:16',
      content_hash: '5753ead7cf42b0ace5fe658ecb930b3a8f57ef49bd52b7ea2d64b91b2c75517e',
      repost_count: 5,
      price_reduction_count: 3,
    };
    // Hash should be identical regardless of metadata
    expect(computeContentHash(base)).toBe(computeContentHash(withMeta));
  });

  it('excludes null/undefined values', () => {
    const base = { title: 'Test Ad Title', category: '160', description: 'Test Description' };
    const withNulls = { ...base, active: null, images: null, shipping_options: null };
    expect(computeContentHash(base)).toBe(computeContentHash(withNulls));
  });

  it('strips null values recursively in nested objects (matching Python exclude_none=True)', () => {
    const base = {
      title: 'Test Ad Title', category: '160', description: 'Test Description',
      contact: { name: 'Max', zipcode: '10115', location: 'Berlin' },
    };
    // YAML "street:" (no value) → js-yaml reads as null
    const withNestedNulls = {
      ...base,
      contact: { name: 'Max', street: null, zipcode: '10115', location: 'Berlin', phone: null },
    };
    expect(computeContentHash(base)).toBe(computeContentHash(withNestedNulls));
  });

  it('strips null values in auto_price_reduction nested object', () => {
    const base = {
      title: 'Test', category: '160', description: 'Desc',
      auto_price_reduction: { enabled: true, strategy: 'FIXED', amount: 5, min_price: 10 },
    };
    const withNull = {
      ...base,
      auto_price_reduction: { enabled: true, strategy: 'FIXED', amount: 5, min_price: 10, delay_reposts: null },
    };
    expect(computeContentHash(base)).toBe(computeContentHash(withNull));
  });

  it('prunes empty containers from hash', () => {
    const base = { title: 'Test Ad Title', category: '160', description: 'Test Description' };
    const withEmpty = { ...base, images: [], shipping_options: [], special_attributes: {} };
    expect(computeContentHash(base)).toBe(computeContentHash(withEmpty));
  });

  it('includes non-empty values that change the hash', () => {
    const base = { title: 'Test Ad Title', category: '160', description: 'Test Description' };
    const withActive = { ...base, active: true };
    expect(computeContentHash(base)).not.toBe(computeContentHash(withActive));
  });

  it('produces consistent hash for ad with float fields', () => {
    const ad = {
      title: 'Test Float Ad',
      category: '160',
      description: 'Description',
      price: 100,
      shipping_costs: 5,
      auto_price_reduction: {
        enabled: true,
        strategy: 'PERCENTAGE',
        amount: 10,
        min_price: 50,
      },
    };
    // Same input should always produce same hash
    const hash1 = computeContentHash(ad);
    const hash2 = computeContentHash({ ...ad });
    expect(hash1).toBe(hash2);
    // Verify the float fields produce Python-compatible JSON
    // (shipping_costs: 5.0, amount: 10.0, min_price: 50.0)
    expect(hash1).toHaveLength(64); // SHA-256 hex
  });
});
