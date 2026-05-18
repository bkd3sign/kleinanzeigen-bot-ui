import { describe, it, expect, vi } from 'vitest';
import { detectLoginState, LOGIN_URL, MFA_CODE_INPUT_SELECTOR, fillInput, dismissConsentBanner } from '../login';
import type { CdpClient } from '../cdp';

describe('LOGIN_URL', () => {
  it('uses sso endpoint', () => {
    expect(LOGIN_URL).toContain('m-einloggen-sso');
  });
});

describe('MFA_CODE_INPUT_SELECTOR', () => {
  it('is a self-invoking function that covers all known MFA input selectors', () => {
    expect(MFA_CODE_INPUT_SELECTOR).toContain('input[name="code"]');
    expect(MFA_CODE_INPUT_SELECTOR).toContain('input[autocomplete="one-time-code"]');
    expect(MFA_CODE_INPUT_SELECTOR).toContain('input[inputmode="numeric"]');
  });
});

describe('detectLoginState', () => {
  const makeCdp = (url: string): CdpClient => ({
    send: vi.fn(),
    evaluate: vi.fn().mockResolvedValue(url),
  });

  it('detects mfa', async () => {
    expect(await detectLoginState(makeCdp('https://login.kleinanzeigen.de/mfa'))).toBe('mfa');
  });
  it('detects logged_in', async () => {
    expect(await detectLoginState(makeCdp('https://www.kleinanzeigen.de/m-nachrichten.html'))).toBe('logged_in');
  });
  it('detects login_page', async () => {
    expect(await detectLoginState(makeCdp('https://login.kleinanzeigen.de/u/login/identifier'))).toBe('login_page');
  });
  it('returns unknown for unexpected url', async () => {
    expect(await detectLoginState(makeCdp('https://example.com'))).toBe('unknown');
  });
});

describe('fillInput', () => {
  it('returns true when element is found', async () => {
    const cdp: CdpClient = { send: vi.fn(), evaluate: vi.fn().mockResolvedValue(true) };
    const result = await fillInput(cdp, 'test@example.com', 'document.querySelector("input")');
    expect(result).toBe(true);
  });

  it('returns false when element is not found', async () => {
    const cdp: CdpClient = { send: vi.fn(), evaluate: vi.fn().mockResolvedValue(false) };
    const result = await fillInput(cdp, 'test@example.com', 'document.querySelector("input")');
    expect(result).toBe(false);
  });

  it('uses prototype.value setter to bypass framework state', async () => {
    const cdp: CdpClient = { send: vi.fn(), evaluate: vi.fn().mockResolvedValue(true) };
    await fillInput(cdp, 'myvalue', 'document.querySelector("input")');
    const expr = (cdp.evaluate as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(expr).toContain('prototype');
    expect(expr).toContain('desc.set');
    expect(expr).toContain('input');
    expect(expr).toContain('change');
  });

  it('returns false for null/undefined evaluate result', async () => {
    const cdp: CdpClient = { send: vi.fn(), evaluate: vi.fn().mockResolvedValue(null) };
    expect(await fillInput(cdp, 'x', 'null')).toBe(false);
  });
});

describe('dismissConsentBanner', () => {
  it('does not throw when banner is found', async () => {
    const cdp: CdpClient = { send: vi.fn(), evaluate: vi.fn().mockResolvedValue('direct') };
    await expect(dismissConsentBanner(cdp)).resolves.toBeUndefined();
  });

  it('does not throw when no banner present', async () => {
    const cdp: CdpClient = { send: vi.fn(), evaluate: vi.fn().mockResolvedValue('none') };
    await expect(dismissConsentBanner(cdp)).resolves.toBeUndefined();
  });

  it('never throws even if evaluate rejects', async () => {
    const cdp: CdpClient = { send: vi.fn(), evaluate: vi.fn().mockRejectedValue(new Error('CDP error')) };
    await expect(dismissConsentBanner(cdp)).resolves.toBeUndefined();
  });
});
