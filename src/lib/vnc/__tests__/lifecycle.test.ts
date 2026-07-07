// @vitest-environment node
import { describe, it, expect, beforeEach, vi } from 'vitest';

const {
  mockSpawnFn,
  mockWaitForCdpFn,
  mockEnsureProfileFreeForLaunchFn,
  mockWriteVncTokenFn,
  mockRemoveVncTokenFn,
  mockClearVncTokenFn,
  mockVncTokenFn,
  mockReleaseVncSlotFn,
  mockAcquireBrowserLockFn,
  mockReleaseBrowserLockFn,
} = vi.hoisted(() => ({
  mockSpawnFn: vi.fn(),
  mockWaitForCdpFn: vi.fn().mockResolvedValue(undefined),
  mockEnsureProfileFreeForLaunchFn: vi.fn().mockResolvedValue(true),
  mockWriteVncTokenFn: vi.fn(),
  mockRemoveVncTokenFn: vi.fn(),
  mockClearVncTokenFn: vi.fn(),
  mockVncTokenFn: vi.fn((ws: string) => `token-${ws.replace(/\//g, '-')}`),
  mockReleaseVncSlotFn: vi.fn(),
  mockAcquireBrowserLockFn: vi.fn().mockReturnValue(true),
  mockReleaseBrowserLockFn: vi.fn(),
}));

vi.mock('child_process', () => ({
  spawn: mockSpawnFn,
  execFileSync: vi.fn(),
  execSync: vi.fn(),
}));

vi.mock('fs', () => ({
  mkdirSync: vi.fn(),
  // The X11 socket "exists" so waitForXServer resolves immediately; everything else
  // (Chromium Preferences seeding, stale lock/socket cleanup) reports absent.
  existsSync: vi.fn((p: string) => String(p).includes('/tmp/.X11-unix/X')),
  readFileSync: vi.fn(() => '{}'),
  writeFileSync: vi.fn(),
  unlinkSync: vi.fn(),
}));

vi.mock('@/lib/browser/cdp', () => ({
  waitForCdp: mockWaitForCdpFn,
  collapseToSingleTab: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/bot/browser-cleanup', () => ({
  ensureProfileFreeForLaunch: mockEnsureProfileFreeForLaunchFn,
}));

vi.mock('@/lib/vnc/tokens', () => ({
  vncToken: mockVncTokenFn,
  writeVncToken: mockWriteVncTokenFn,
  removeVncToken: mockRemoveVncTokenFn,
  clearVncToken: mockClearVncTokenFn,
}));

vi.mock('@/lib/bot/browser-lock', () => ({
  acquireBrowserLock: mockAcquireBrowserLockFn,
  releaseBrowserLock: mockReleaseBrowserLockFn,
}));

vi.mock('@/lib/vnc/ports', () => ({
  // Always return the first slot for simplicity; port arithmetic then gives cdpPort 9300
  allocateVncSlot: vi.fn(() => ({ display: 90, rfbPort: 5990 })),
  releaseVncSlot: mockReleaseVncSlotFn,
  getVncSlot: vi.fn(() => undefined),
  vncSessionCount: vi.fn(() => 0),
  MAX_VNC_SESSIONS: 25,
  DISPLAY_START: 90,
}));

import { startVncLogin, stopVncLogin, getVncSession } from '../lifecycle';

function makeFakeProc(pid: number) {
  return { pid, on: vi.fn(), once: vi.fn() };
}

beforeEach(() => {
  vi.clearAllMocks();

  // Re-apply default implementations after clearAllMocks
  mockWaitForCdpFn.mockResolvedValue(undefined);
  mockVncTokenFn.mockImplementation((ws: string) => `token-${ws.replace(/\//g, '-')}`);
  mockEnsureProfileFreeForLaunchFn.mockResolvedValue(true);
  mockAcquireBrowserLockFn.mockReturnValue(true);
  mockReleaseBrowserLockFn.mockImplementation(() => undefined);
  let callCount = 0;
  mockSpawnFn.mockImplementation(() => makeFakeProc(1000 + callCount++));

  // Reset the globalThis vnc session map
  const g = globalThis as unknown as {
    __vncSessions?: Map<string, unknown>;
    __vncStarting?: Map<string, unknown>;
  };
  if (g.__vncSessions) g.__vncSessions.clear();
  if (g.__vncStarting) g.__vncStarting.clear();

  // Reset the globalThis vnc slot maps (ports.ts state)
  const gp = globalThis as unknown as {
    __vncSlots?: Map<string, number>;
    __vncFree?: number[];
    __vncCounter?: number;
  };
  if (gp.__vncSlots) gp.__vncSlots.clear();
  if (gp.__vncFree) gp.__vncFree.length = 0;
  if (gp.__vncCounter !== undefined) gp.__vncCounter = 90;
});

describe('startVncLogin', () => {
  it('ensures the profile is free before launching the VNC browser', async () => {
    await startVncLogin('/ws');
    expect(mockEnsureProfileFreeForLaunchFn).toHaveBeenCalledOnce();
    expect(mockEnsureProfileFreeForLaunchFn).toHaveBeenCalledWith('/ws');
  });

  it('spawns Xvnc with correct display, rfbPort, and loopback flag', async () => {
    await startVncLogin('/ws');
    // freeXDisplay uses execFileSync (not spawn), so spawn calls are: [0] Xvnc, [1] wm, [2] Chromium
    const xvncCall = mockSpawnFn.mock.calls[0];
    expect(xvncCall[0]).toBe('Xvnc');
    const args = xvncCall[1] as string[];
    expect(args).toContain(':90');
    expect(args).toContain('-rfbport');
    expect(args[args.indexOf('-rfbport') + 1]).toBe('5990');
    // Xvnc must bind loopback only so the RFB port is not reachable off-host
    expect(args).toContain('-localhost');
    expect(args[args.indexOf('-localhost') + 1]).toBe('yes');
    expect(xvncCall[2]).toMatchObject({ detached: true, stdio: 'ignore' });
  });

  it('spawns chromium with correct kiosk args', async () => {
    await startVncLogin('/ws');
    // spawn calls: [0] Xvnc, [1] window manager (sh -c matchbox), [2] Chromium
    const chromiumCall = mockSpawnFn.mock.calls[2];
    const args = chromiumCall[1] as string[];
    expect(args).toContain('--kiosk');
    expect(args).toContain('--remote-debugging-port=9300');
    expect(args).toContain('--user-data-dir=/ws/.temp/browser-profile');
    expect(args).toContain('https://www.kleinanzeigen.de/m-einloggen-sso.html');
    expect(chromiumCall[2]).toMatchObject({ detached: true, stdio: 'ignore' });
    expect((chromiumCall[2] as Record<string, unknown>).env).toMatchObject({ DISPLAY: ':90' });
  });

  it('writes the VNC token', async () => {
    await startVncLogin('/ws');
    expect(mockWriteVncTokenFn).toHaveBeenCalledOnce();
    expect(mockWriteVncTokenFn).toHaveBeenCalledWith(expect.any(String), 5990);
  });

  it('returns session with status ready and correct slot values', async () => {
    const session = await startVncLogin('/ws');
    expect(session.status).toBe('ready');
    expect(session.display).toBe(90);
    expect(session.rfbPort).toBe(5990);
    expect(session.cdpPort).toBe(9300);
    expect(session.workspace).toBe('/ws');
    expect(session.token).toBeTruthy();
  });

  it('is idempotent — calling twice does not spawn again', async () => {
    await startVncLogin('/ws');
    await startVncLogin('/ws');
    // spawn called 3 times total: Xvnc + window manager + Chromium (second call returns cached session)
    expect(mockSpawnFn).toHaveBeenCalledTimes(3);
  });

  it('concurrent calls — only one Xvnc + one Chromium are spawned', async () => {
    // Both promises start before either settles; the second must reuse the in-flight promise
    const [s1, s2] = await Promise.all([startVncLogin('/ws'), startVncLogin('/ws')]);
    // Xvnc + window manager + Chromium = 3 total
    expect(mockSpawnFn).toHaveBeenCalledTimes(3);
    expect(s1).toBe(s2);
  });

  it('sets status to error and rethrows when waitForCdp fails', async () => {
    mockWaitForCdpFn.mockRejectedValueOnce(new Error('cdp timeout'));
    await expect(startVncLogin('/ws')).rejects.toThrow('cdp timeout');
    // Session should be cleaned up
    expect(getVncSession('/ws')).toBeUndefined();
  });

  it('throws when the bot lock is active for the workspace', async () => {
    // acquireBrowserLock returns false when the 'bot' owner holds the lock
    mockAcquireBrowserLockFn.mockReturnValue(false);
    await expect(startVncLogin('/ws')).rejects.toThrow('Der Bot läuft gerade');
    // Must NOT have spawned anything
    expect(mockSpawnFn).not.toHaveBeenCalled();
  });

  it('acquires the vnc lock on successful start', async () => {
    await startVncLogin('/ws');
    expect(mockAcquireBrowserLockFn).toHaveBeenCalledWith('/ws', 'vnc');
  });

  it('releases the vnc lock when waitForCdp fails', async () => {
    mockWaitForCdpFn.mockRejectedValueOnce(new Error('cdp timeout'));
    await expect(startVncLogin('/ws')).rejects.toThrow();
    expect(mockReleaseBrowserLockFn).toHaveBeenCalledWith('/ws', 'vnc');
  });

  it('releases slot + vnc lock when a prelude step throws — no half-persistent leak', async () => {
    // writeVncToken runs in the prelude, BEFORE the CDP wait. A throw there (e.g. disk full)
    // used to leak the already-acquired slot + 'vnc' lock, blocking VNC until server restart.
    mockWriteVncTokenFn.mockImplementationOnce(() => { throw new Error('disk full'); });
    await expect(startVncLogin('/ws')).rejects.toThrow('disk full');
    expect(mockReleaseVncSlotFn).toHaveBeenCalledWith('/ws');
    expect(mockReleaseBrowserLockFn).toHaveBeenCalledWith('/ws', 'vnc');
    expect(getVncSession('/ws')).toBeUndefined();
  });
});

describe('stopVncLogin', () => {
  it('removes token, releases slot, and clears session', async () => {
    await startVncLogin('/ws');
    expect(getVncSession('/ws')).toBeDefined();

    const token = getVncSession('/ws')!.token;
    await stopVncLogin('/ws');

    expect(mockRemoveVncTokenFn).toHaveBeenCalledWith(token);
    expect(mockReleaseVncSlotFn).toHaveBeenCalledWith('/ws');
    expect(getVncSession('/ws')).toBeUndefined();
  });

  it('is a no-op when no session exists', async () => {
    await expect(stopVncLogin('/no-session')).resolves.toBeUndefined();
  });

  it('releases the vnc lock on stop', async () => {
    await startVncLogin('/ws');
    await stopVncLogin('/ws');
    expect(mockReleaseBrowserLockFn).toHaveBeenCalledWith('/ws', 'vnc');
  });
});

describe('getVncSession', () => {
  it('returns undefined for unknown workspace', () => {
    expect(getVncSession('/unknown')).toBeUndefined();
  });

  it('returns session after startVncLogin', async () => {
    await startVncLogin('/ws');
    const session = getVncSession('/ws');
    expect(session).toBeDefined();
    expect(session!.workspace).toBe('/ws');
  });
});
