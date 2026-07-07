import { describe, it, expect } from 'vitest';
import { applyBrowserMode } from '../runner';

describe('applyBrowserMode', () => {
  it('headless mode → headless args on the shared profile', () => {
    const merged: Record<string, unknown> = { browser: { mode: 'headless', arguments: ['--no-sandbox'] } };
    applyBrowserMode(merged, '/ws');
    const b = merged.browser as Record<string, unknown>;
    expect(b.arguments).toContain('--headless=new');
    expect(b.user_data_dir).toBe('/ws/.temp/browser-profile');
    expect(b.use_private_window).toBe(false);
  });
});
