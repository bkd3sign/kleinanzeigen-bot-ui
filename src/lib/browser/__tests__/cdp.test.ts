import { describe, it, expect, vi, afterEach } from 'vitest';
import { sleep, waitForCondition, cdpHttpGet, waitForCdp } from '../cdp';

afterEach(() => vi.restoreAllMocks());

describe('sleep', () => {
  it('resolves after delay', async () => {
    const start = Date.now();
    await sleep(50);
    expect(Date.now() - start).toBeGreaterThanOrEqual(40);
  });
});

describe('waitForCondition', () => {
  it('returns true when condition met', async () => {
    let count = 0;
    const result = await waitForCondition(async () => ++count >= 2, 2000);
    expect(result).toBe(true);
  });
  it('returns false on timeout', async () => {
    const result = await waitForCondition(async () => false, 200);
    expect(result).toBe(false);
  });
  it('handles check() throwing without crashing', async () => {
    let calls = 0;
    const result = await waitForCondition(async () => {
      calls++;
      if (calls < 3) throw new Error('transient');
      return true;
    }, 2000);
    expect(result).toBe(true);
  });
});

describe('cdpHttpGet', () => {
  it('returns parsed JSON on success', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ webSocketDebuggerUrl: 'ws://127.0.0.1:9222/devtools' }),
    } as Response);
    const result = await cdpHttpGet<{ webSocketDebuggerUrl: string }>(9222, '/json/version');
    expect(result.webSocketDebuggerUrl).toContain('devtools');
  });

  it('throws on non-ok HTTP response', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: false,
      status: 404,
    } as Response);
    await expect(cdpHttpGet(9222, '/json/version')).rejects.toThrow('CDP HTTP 404');
  });

  it('constructs the correct URL', async () => {
    const spy = vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({}),
    } as Response);
    await cdpHttpGet(9223, '/json');
    expect(spy).toHaveBeenCalledWith('http://127.0.0.1:9223/json');
  });
});

describe('waitForCdp', () => {
  it('resolves immediately when CDP is ready', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue({ ok: true, json: async () => ({}) } as Response);
    await expect(waitForCdp(9222, 5000)).resolves.toBeUndefined();
  });

  it('retries on failure and resolves when ready', async () => {
    let calls = 0;
    vi.spyOn(global, 'fetch').mockImplementation(async () => {
      calls++;
      if (calls < 3) throw new Error('not ready');
      return { ok: true, json: async () => ({}) } as Response;
    });
    await expect(waitForCdp(9222, 5000)).resolves.toBeUndefined();
    expect(calls).toBeGreaterThanOrEqual(3);
  });

  it('throws when timeout expires', async () => {
    vi.spyOn(global, 'fetch').mockRejectedValue(new Error('refused'));
    await expect(waitForCdp(9999, 200)).rejects.toThrow('Chromium CDP nicht erreichbar');
  }, 3000);
});
