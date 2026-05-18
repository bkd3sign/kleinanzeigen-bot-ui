import { describe, it, expect } from 'vitest';
import { isVersionUpToDate } from '../version-compare';

describe('isVersionUpToDate', () => {
  it('returns true when current equals latest', () => {
    expect(isVersionUpToDate('2.64.0', '2.64.0')).toBe(true);
  });

  it('returns true when current is ahead of latest (major)', () => {
    expect(isVersionUpToDate('3.0.0', '2.99.9')).toBe(true);
  });

  it('returns true when current is ahead of latest (minor)', () => {
    expect(isVersionUpToDate('2.64.0', '2.52.3')).toBe(true);
  });

  it('returns false when current is behind latest (minor)', () => {
    expect(isVersionUpToDate('2.64.0', '2.65.0')).toBe(false);
  });

  it('returns false when current is behind latest (major)', () => {
    expect(isVersionUpToDate('1.99.9', '2.0.0')).toBe(false);
  });

  it('returns false when current is behind latest (patch)', () => {
    expect(isVersionUpToDate('2.64.0', '2.64.1')).toBe(false);
  });
});
