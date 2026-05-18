import { describe, it, expect, vi } from 'vitest';
import { STEALTH_ARGS, STEALTH_UA, injectStealthScript } from '../stealth';
import type { CdpClient } from '../cdp';

describe('STEALTH_ARGS', () => {
  it('includes AutomationControlled disable', () => {
    expect(STEALTH_ARGS.some(a => a.includes('AutomationControlled'))).toBe(true);
  });
  it('includes user-agent override', () => {
    expect(STEALTH_ARGS.some(a => a.startsWith('--user-agent='))).toBe(true);
  });
  it('includes de-DE language', () => {
    expect(STEALTH_ARGS.some(a => a.includes('de-DE'))).toBe(true);
  });
  it('does NOT include --headless (set by caller)', () => {
    expect(STEALTH_ARGS.some(a => a.startsWith('--headless'))).toBe(false);
  });
  it('does NOT include --no-sandbox (set by caller)', () => {
    expect(STEALTH_ARGS.some(a => a === '--no-sandbox')).toBe(false);
  });
  it('does NOT include remote-debugging-port (set by caller)', () => {
    expect(STEALTH_ARGS.some(a => a.includes('remote-debugging-port'))).toBe(false);
  });
  it('STEALTH_UA does not contain "Headless"', () => {
    expect(STEALTH_UA).not.toContain('Headless');
  });
});

describe('injectStealthScript', () => {
  it('calls Page.addScriptToEvaluateOnNewDocument', async () => {
    const cdp: CdpClient = { send: vi.fn().mockResolvedValue({}), evaluate: vi.fn() };
    await injectStealthScript(cdp);
    expect(cdp.send).toHaveBeenCalledWith(
      'Page.addScriptToEvaluateOnNewDocument',
      expect.objectContaining({ source: expect.any(String) }),
    );
  });

  it('patch source hides navigator.webdriver', async () => {
    const cdp: CdpClient = { send: vi.fn().mockResolvedValue({}), evaluate: vi.fn() };
    await injectStealthScript(cdp);
    const source = (cdp.send as ReturnType<typeof vi.fn>).mock.calls[0][1].source as string;
    expect(source).toContain('webdriver');
    expect(source).toContain('plugins');
    expect(source).toContain('Intel');
  });
});
