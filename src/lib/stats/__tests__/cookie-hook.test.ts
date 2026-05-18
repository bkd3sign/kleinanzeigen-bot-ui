import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/browser/login', () => ({
  detectLoginState: vi.fn(),
}));
vi.mock('@/lib/browser/cdp', () => ({
  sleep: vi.fn().mockResolvedValue(undefined),
  cdpHttpGet: vi.fn(),
  createCdpClient: vi.fn(),
}));
vi.mock('@/lib/messaging/gateway', () => ({
  fetchUserId: vi.fn(),
  isAccessTokenExpired: vi.fn(),
}));
vi.mock('fs', () => ({ default: { mkdirSync: vi.fn(), writeFileSync: vi.fn(), existsSync: vi.fn().mockReturnValue(true) } }));
vi.mock('ws', () => ({
  default: vi.fn(function MockWebSocket(this: { once: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn> }) {
    this.once = vi.fn(function(this: unknown, event: string, cb: () => void) { if (event === 'open') cb(); });
    this.close = vi.fn();
  }),
}));

import { detectLoginState } from '@/lib/browser/login';
import { cdpHttpGet, createCdpClient } from '@/lib/browser/cdp';
import { fetchUserId, isAccessTokenExpired } from '@/lib/messaging/gateway';
import fs from 'fs';
import { hookCookiesAfterLogin } from '../cookie-hook';

beforeEach(() => vi.clearAllMocks());

describe('hookCookiesAfterLogin', () => {
  it('saves cookies when login succeeds', async () => {
    const mockSend = vi.fn().mockResolvedValue({
      id: 1,
      result: {
        cookies: [
          { name: 'KAAS', value: 'abc123', domain: 'kleinanzeigen.de' },
          { name: 'foo', value: 'bar', domain: 'kleinanzeigen.de' },
          { name: 'other', value: 'val', domain: 'example.com' },
        ],
      },
    });
    vi.mocked(cdpHttpGet).mockResolvedValue([{ type: 'page', webSocketDebuggerUrl: 'ws://127.0.0.1:9222/page/1', id: '1' }]);
    vi.mocked(createCdpClient).mockReturnValue({ send: mockSend, evaluate: vi.fn() });
    vi.mocked(detectLoginState).mockResolvedValue('logged_in');
    vi.mocked(fetchUserId).mockResolvedValue(42);
    vi.mocked(isAccessTokenExpired).mockReturnValue(false);

    await hookCookiesAfterLogin(9222, '/workspace');

    expect(mockSend).toHaveBeenCalledWith('Network.getAllCookies');
    expect(fs.writeFileSync).toHaveBeenCalledWith(
      expect.stringContaining('login-session.json'),
      expect.stringContaining('"cookies":"KAAS=abc123; foo=bar"'),
      'utf-8',
    );
  });

  it('does nothing when never reaches logged_in within timeout', async () => {
    vi.mocked(cdpHttpGet).mockResolvedValue([{ type: 'page', webSocketDebuggerUrl: 'ws://127.0.0.1:9222/page/1', id: '1' }]);
    vi.mocked(createCdpClient).mockReturnValue({ send: vi.fn(), evaluate: vi.fn() });
    vi.mocked(detectLoginState).mockResolvedValue('login_page');

    await hookCookiesAfterLogin(9222, '/workspace');

    expect(fs.writeFileSync).not.toHaveBeenCalled();
  });

  it('does nothing when cookies are expired', async () => {
    const mockSend = vi.fn().mockResolvedValue({
      id: 1,
      result: {
        cookies: [
          { name: 'access_token', value: 'expired', domain: 'kleinanzeigen.de' },
        ],
      },
    });
    vi.mocked(cdpHttpGet).mockResolvedValue([{ type: 'page', webSocketDebuggerUrl: 'ws://127.0.0.1:9222/page/1', id: '1' }]);
    vi.mocked(createCdpClient).mockReturnValue({ send: mockSend, evaluate: vi.fn() });
    vi.mocked(detectLoginState).mockResolvedValue('logged_in');
    vi.mocked(fetchUserId).mockResolvedValue(42);
    vi.mocked(isAccessTokenExpired).mockReturnValue(true);

    await hookCookiesAfterLogin(9222, '/workspace');

    expect(fs.writeFileSync).not.toHaveBeenCalled();
  });

  it('filters out non-kleinanzeigen cookies', async () => {
    const mockSend = vi.fn().mockResolvedValue({
      id: 1,
      result: {
        cookies: [
          { name: 'session', value: 'abc', domain: 'kleinanzeigen.de' },
          { name: 'tracker', value: 'xyz', domain: 'google.com' },
        ],
      },
    });
    vi.mocked(cdpHttpGet).mockResolvedValue([{ type: 'page', webSocketDebuggerUrl: 'ws://127.0.0.1:9222/page/1', id: '1' }]);
    vi.mocked(createCdpClient).mockReturnValue({ send: mockSend, evaluate: vi.fn() });
    vi.mocked(detectLoginState).mockResolvedValue('logged_in');
    vi.mocked(fetchUserId).mockResolvedValue(7);
    vi.mocked(isAccessTokenExpired).mockReturnValue(false);

    await hookCookiesAfterLogin(9222, '/workspace');

    expect(fs.writeFileSync).toHaveBeenCalledWith(
      expect.stringContaining('login-session.json'),
      expect.stringContaining('"cookies":"session=abc"'),
      'utf-8',
    );
  });
});
