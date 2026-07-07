import { describe, it, expect } from 'vitest';
import { BROWSER_DEFAULTS } from '../config';

describe('BROWSER_DEFAULTS', () => {
  it('has mode default auto', () => {
    expect(BROWSER_DEFAULTS.mode).toBe('auto');
  });
});
