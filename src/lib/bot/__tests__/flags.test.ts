import { describe, it, expect } from 'vitest';
import { buildFlags } from '../flags';

describe('buildFlags', () => {
  it('builds empty string when no options', () => {
    expect(buildFlags({})).toBe('');
  });

  it('includes --ads= flag', () => {
    expect(buildFlags({ ads: 'all' })).toBe('--ads=all');
  });

  it('includes --force flag', () => {
    expect(buildFlags({ force: true })).toBe('--force');
  });

  it('includes --keep-old flag', () => {
    expect(buildFlags({ keepOld: true })).toBe('--keep-old');
  });

  it('includes --verbose flag', () => {
    expect(buildFlags({ verbose: true })).toBe('--verbose');
  });

  it('combines multiple flags', () => {
    const result = buildFlags({ ads: 'due', keepOld: true, verbose: true });
    expect(result).toBe('--ads=due --keep-old --verbose');
  });

  it('--force suppresses --ads', () => {
    const result = buildFlags({ ads: 'all', force: true });
    expect(result).toContain('--force');
    expect(result).not.toContain('--ads');
  });

  it('--force with --keep-old and --verbose', () => {
    const result = buildFlags({ force: true, keepOld: true, verbose: true });
    expect(result).toBe('--force --keep-old --verbose');
  });

  it('handles numeric ads IDs', () => {
    expect(buildFlags({ ads: '123,456' })).toBe('--ads=123,456');
  });
});
