import { describe, it, expect } from 'vitest';
import { encodeAdFilePath } from '../paths';

describe('encodeAdFilePath', () => {
  it('keeps slashes as separators and encodes each segment', () => {
    expect(encodeAdFilePath('ads/ad_a b/ad.yaml')).toBe('ads/ad_a%20b/ad.yaml');
  });

  it('encodes special URL characters per segment', () => {
    expect(encodeAdFilePath('downloaded-ads/ad_#1?/x.yaml')).toBe('downloaded-ads/ad_%231%3F/x.yaml');
  });

  it('encodes umlauts', () => {
    expect(encodeAdFilePath('ads/möbel/ad.yaml')).toBe('ads/m%C3%B6bel/ad.yaml');
  });

  it('handles a single segment', () => {
    expect(encodeAdFilePath('ad.yaml')).toBe('ad.yaml');
  });

  it('returns empty string unchanged', () => {
    expect(encodeAdFilePath('')).toBe('');
  });
});
