// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

vi.mock('child_process', () => ({
  execFile: vi.fn(),
  execFileSync: vi.fn(),
}));

import { execFile } from 'child_process';
import { waitForProfileFree, cleanBrowserProfile, cleanStaleLocks, killOrphanedChromium, ensureProfileFreeForLaunch } from '../browser-cleanup';

const mockExecFile = vi.mocked(execFile);

// The profile lookup now uses the ASYNC execFile via a hand-rolled Promise wrapper that invokes
// the callback as cb(err, stdout, stderr). These helpers drive that callback. On non-zero exit
// execFile's error carries `.code` = the exit code (number); a missing binary → `.code = 'ENOENT'`;
// a timeout → no numeric code. findProfilePids trusts code===1 (or ENOENT) as "no match / can't
// tell → assume free" and everything else as undetermined (null).
type ExecFileCb = (err: Error | null, stdout: string, stderr: string) => void;
function drivePgrep(next: () => { out?: string; err?: Error }): void {
  mockExecFile.mockImplementation(((_file: string, _args: string[], _opts: object, cb: ExecFileCb) => {
    const r = next();
    if (r.err) cb(r.err, '', '');
    else cb(null, r.out ?? '', '');
  }) as unknown as typeof execFile);
}
function pgrepReturns(stdout: string): void { drivePgrep(() => ({ out: stdout })); }
function pgrepThrows(err: Error): void { drivePgrep(() => ({ err })); }
function pgrepExit1(): Error {
  return Object.assign(new Error('Command failed'), { code: 1 });
}
function pgrepUndetermined(): Error {
  // No numeric `.code` — mimics a timeout (execFile sets killed/signal, not a numeric code).
  return Object.assign(new Error('ETIMEDOUT'), { killed: true, signal: 'SIGTERM' });
}

describe('cleanBrowserProfile', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'browser-test-'));
    const profileDir = path.join(tmpDir, '.temp', 'browser-profile');
    fs.mkdirSync(profileDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('removes SingletonLock, SingletonSocket, DevToolsActivePort, SingletonCookie', () => {
    const profileDir = path.join(tmpDir, '.temp', 'browser-profile');
    const lockFiles = ['SingletonLock', 'SingletonSocket', 'DevToolsActivePort', 'SingletonCookie'];
    for (const f of lockFiles) {
      fs.writeFileSync(path.join(profileDir, f), 'stale');
    }

    cleanBrowserProfile(tmpDir);

    for (const f of lockFiles) {
      expect(fs.existsSync(path.join(profileDir, f))).toBe(false);
    }
  });

  it('removes session-restore files that trigger headless-unsafe restore mode after crash', () => {
    const profileDir = path.join(tmpDir, '.temp', 'browser-profile');
    const defaultDir = path.join(profileDir, 'Default');
    fs.mkdirSync(defaultDir, { recursive: true });
    const sessionFiles = ['Current Session', 'Current Tabs', 'Last Session', 'Last Tabs'];
    for (const f of sessionFiles) {
      fs.writeFileSync(path.join(defaultDir, f), 'session-data');
    }

    cleanBrowserProfile(tmpDir);

    for (const f of sessionFiles) {
      expect(fs.existsSync(path.join(defaultDir, f))).toBe(false);
    }
  });

  it('does not throw when files are already missing (ENOENT)', () => {
    // Profile dir exists but files don't
    expect(() => cleanBrowserProfile(tmpDir)).not.toThrow();
  });

  it('removes cache directories recursively (Default/GPUCache, Default/Cache, etc.)', () => {
    const profileDir = path.join(tmpDir, '.temp', 'browser-profile');
    const cacheDirs = ['Default/GPUCache', 'Default/Cache', 'Default/Code Cache', 'Default/DawnCache'];
    for (const dir of cacheDirs) {
      const full = path.join(profileDir, dir);
      fs.mkdirSync(full, { recursive: true });
      fs.writeFileSync(path.join(full, 'data.bin'), 'cache');
    }

    cleanBrowserProfile(tmpDir);

    for (const dir of cacheDirs) {
      expect(fs.existsSync(path.join(profileDir, dir))).toBe(false);
    }
  });

  it('preserves files outside the stale list (e.g. Cookies)', () => {
    const profileDir = path.join(tmpDir, '.temp', 'browser-profile');
    const defaultDir = path.join(profileDir, 'Default');
    fs.mkdirSync(defaultDir, { recursive: true });
    fs.writeFileSync(path.join(defaultDir, 'Cookies'), 'auth-data');

    cleanBrowserProfile(tmpDir);

    expect(fs.existsSync(path.join(defaultDir, 'Cookies'))).toBe(true);
  });
});

describe('cleanStaleLocks', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'browser-test-'));
    const profileDir = path.join(tmpDir, '.temp', 'browser-profile');
    fs.mkdirSync(profileDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('removes lock files but preserves session-restore files (warm login survives relaunch)', () => {
    const profileDir = path.join(tmpDir, '.temp', 'browser-profile');
    fs.writeFileSync(path.join(profileDir, 'SingletonLock'), 'stale');
    fs.mkdirSync(path.join(profileDir, 'Default'), { recursive: true });
    fs.writeFileSync(path.join(profileDir, 'Default', 'Current Session'), 'session');

    cleanStaleLocks(tmpDir);

    expect(fs.existsSync(path.join(profileDir, 'SingletonLock'))).toBe(false);
    expect(fs.existsSync(path.join(profileDir, 'Default', 'Current Session'))).toBe(true);
  });

  it('preserves cache dirs so Chromium can reuse V8/GPU caches', () => {
    const profileDir = path.join(tmpDir, '.temp', 'browser-profile');
    const gpuCache = path.join(profileDir, 'Default', 'GPUCache');
    fs.mkdirSync(gpuCache, { recursive: true });
    fs.writeFileSync(path.join(gpuCache, 'index'), 'shader-cache');

    cleanStaleLocks(tmpDir);

    expect(fs.existsSync(gpuCache)).toBe(true);
  });
});

describe('killOrphanedChromium', () => {
  beforeEach(() => {
    mockExecFile.mockReset();
  });

  it('sends SIGKILL to every pid returned by pgrep', async () => {
    const killSpy = vi.spyOn(process, 'kill').mockReturnValue(true);
    pgrepReturns('111\n222\n');

    await killOrphanedChromium('/workspace');

    expect(killSpy).toHaveBeenCalledWith(111, 'SIGKILL');
    expect(killSpy).toHaveBeenCalledWith(222, 'SIGKILL');
    killSpy.mockRestore();
  });

  it('does not call kill when pgrep returns empty output', async () => {
    const killSpy = vi.spyOn(process, 'kill').mockReturnValue(true);
    pgrepReturns('');

    await killOrphanedChromium('/workspace');

    expect(killSpy).not.toHaveBeenCalled();
    killSpy.mockRestore();
  });

  it('does not throw when pgrep exits 1 (no processes found)', async () => {
    const killSpy = vi.spyOn(process, 'kill').mockReturnValue(true);
    pgrepThrows(pgrepExit1());

    await expect(killOrphanedChromium('/workspace')).resolves.toBeUndefined();
    expect(killSpy).not.toHaveBeenCalled();
    killSpy.mockRestore();
  });

  it('does not kill when the lookup is undetermined (pgrep timeout / missing binary)', async () => {
    // Regression: an undetermined lookup must not be mistaken for "no processes" — but there is
    // also nothing to kill, so it is a safe no-op (waitForProfileFree keeps re-killing instead).
    const killSpy = vi.spyOn(process, 'kill').mockReturnValue(true);
    pgrepThrows(pgrepUndetermined());

    await expect(killOrphanedChromium('/workspace')).resolves.toBeUndefined();
    expect(killSpy).not.toHaveBeenCalled();
    killSpy.mockRestore();
  });
});

describe('waitForProfileFree', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockExecFile.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns true after grace period when pgrep finds no processes (exit 1)', async () => {
    pgrepThrows(pgrepExit1());

    const promise = waitForProfileFree('/workspace', 5000);
    await vi.runAllTimersAsync();

    await expect(promise).resolves.toBe(true);
    expect(mockExecFile).toHaveBeenCalledTimes(1);
    expect(mockExecFile).toHaveBeenCalledWith(
      'pgrep',
      ['-f', 'user-data-dir=/workspace/.temp/browser-profile'],
      expect.objectContaining({ timeout: 3000 }),
      expect.any(Function),
    );
  });

  it('treats a missing pgrep binary (ENOENT) as free, not undetermined', async () => {
    // A tool that is absent can never tell us more, so fall back to "assume free" instead of
    // polling to the deadline forever on hosts without pgrep.
    pgrepThrows(Object.assign(new Error('spawn pgrep ENOENT'), { code: 'ENOENT' }));

    const promise = waitForProfileFree('/workspace', 5000);
    await vi.runAllTimersAsync();

    await expect(promise).resolves.toBe(true);
  });

  it('never reports free while the lookup is undetermined (pgrep timeout under load)', async () => {
    // Root cause of the scheduled "Failed to connect to browser": a slow pgrep at cron time used
    // to be swallowed as "no processes → free", so the launch proceeded onto a still-locked
    // profile. An undetermined lookup must poll to the deadline and return false, never true.
    const killSpy = vi.spyOn(process, 'kill').mockReturnValue(true);
    pgrepThrows(pgrepUndetermined());

    const promise = waitForProfileFree('/workspace', 500, { kill: true });
    await vi.runAllTimersAsync();

    await expect(promise).resolves.toBe(false);
    // No PID was ever identified, so nothing is killed on the unknown branch.
    expect(killSpy).not.toHaveBeenCalled();
    killSpy.mockRestore();
  });

  it('polls until no processes remain, then returns true', async () => {
    let calls = 0;
    drivePgrep(() => {
      calls++;
      // first 2 polls: process still alive; 3rd: gone
      return calls < 3 ? { out: '12345\n' } : { err: pgrepExit1() };
    });

    const promise = waitForProfileFree('/workspace', 5000);
    await vi.runAllTimersAsync();

    await expect(promise).resolves.toBe(true);
    expect(calls).toBe(3);
  });

  it('returns false after timeout when processes never exit', async () => {
    pgrepReturns('12345\n');

    const promise = waitForProfileFree('/workspace', 300);
    await vi.runAllTimersAsync();
    await expect(promise).resolves.toBe(false);
  });

  it('re-issues SIGKILL every poll when kill:true (reaps a process stuck in slow I/O)', async () => {
    const killSpy = vi.spyOn(process, 'kill').mockReturnValue(true);
    let calls = 0;
    drivePgrep(() => {
      calls++;
      // alive for the first 2 polls, gone on the 3rd
      return calls < 3 ? { out: '12345\n' } : { err: pgrepExit1() };
    });

    const promise = waitForProfileFree('/workspace', 5000, { kill: true });
    await vi.runAllTimersAsync();

    await expect(promise).resolves.toBe(true);
    // Killed on each of the 2 polls that still found the process.
    expect(killSpy).toHaveBeenCalledWith(12345, 'SIGKILL');
    expect(killSpy).toHaveBeenCalledTimes(2);
    killSpy.mockRestore();
  });

  it('does not kill when kill option is omitted', async () => {
    const killSpy = vi.spyOn(process, 'kill').mockReturnValue(true);
    pgrepReturns('12345\n');

    const promise = waitForProfileFree('/workspace', 300);
    await vi.runAllTimersAsync();
    await promise;

    expect(killSpy).not.toHaveBeenCalled();
    killSpy.mockRestore();
  });
});

describe('SingletonLock holder fallback (pgrep-independent)', () => {
  let tmpDir: string;
  let profileDir: string;

  beforeEach(() => {
    mockExecFile.mockReset();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lockholder-'));
    profileDir = path.join(tmpDir, '.temp', 'browser-profile');
    fs.mkdirSync(profileDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('kills the SingletonLock holder when the lookup is undetermined AND its cmdline matches', async () => {
    // pgrep times out (undetermined) → the only way to find the holder is the lock symlink, but we
    // must confirm the PID actually uses this profile (via /proc cmdline) before killing it.
    const killSpy = vi.spyOn(process, 'kill').mockReturnValue(true); // kill(pid,0)=alive, SIGKILL captured
    const readSpy = vi.spyOn(fs, 'readFileSync').mockImplementation((p: fs.PathOrFileDescriptor) => {
      if (String(p).startsWith('/proc/')) return `chromium\0--user-data-dir=${profileDir}\0`;
      throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    });
    pgrepThrows(pgrepUndetermined());
    fs.symlinkSync(`somehost-${process.pid}`, path.join(profileDir, 'SingletonLock'));

    await killOrphanedChromium(tmpDir);

    expect(killSpy).toHaveBeenCalledWith(process.pid, 'SIGKILL');
    killSpy.mockRestore();
    readSpy.mockRestore();
  });

  it('does NOT kill a stale-lock PID when the tool positively reports no match', async () => {
    // Regression guard: a leftover SingletonLock pointing at a (recycled) live PID must not be
    // killed when pgrep says the profile is genuinely free — that PID may be an unrelated process.
    const killSpy = vi.spyOn(process, 'kill').mockReturnValue(true);
    pgrepThrows(pgrepExit1()); // tool positively: none
    fs.symlinkSync(`somehost-${process.pid}`, path.join(profileDir, 'SingletonLock'));

    await killOrphanedChromium(tmpDir);

    expect(killSpy).not.toHaveBeenCalledWith(process.pid, 'SIGKILL');
    killSpy.mockRestore();
  });

  it('does NOT kill an undetermined-case lock PID whose cmdline does not reference the profile', async () => {
    // Recycled PID: alive, but /proc cmdline shows it is not the Chromium on this profile.
    const killSpy = vi.spyOn(process, 'kill').mockReturnValue(true);
    const readSpy = vi.spyOn(fs, 'readFileSync').mockImplementation((p: fs.PathOrFileDescriptor) => {
      if (String(p).startsWith('/proc/')) return 'some-unrelated-process\0--flag\0';
      throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    });
    pgrepThrows(pgrepUndetermined());
    fs.symlinkSync(`somehost-${process.pid}`, path.join(profileDir, 'SingletonLock'));

    await killOrphanedChromium(tmpDir);

    expect(killSpy).not.toHaveBeenCalledWith(process.pid, 'SIGKILL');
    killSpy.mockRestore();
    readSpy.mockRestore();
  });
});

describe('ensureProfileFreeForLaunch', () => {
  let tmpDir: string;

  beforeEach(() => {
    vi.useFakeTimers();
    mockExecFile.mockReset();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ensure-free-'));
    fs.mkdirSync(path.join(tmpDir, '.temp', 'browser-profile'), { recursive: true });
  });

  afterEach(() => {
    vi.useRealTimers();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns true and removes lock files but PRESERVES the session (locks-only default)', async () => {
    pgrepThrows(pgrepExit1()); // profile positively free
    const profileDir = path.join(tmpDir, '.temp', 'browser-profile');
    fs.writeFileSync(path.join(profileDir, 'SingletonLock'), 'stale');
    fs.mkdirSync(path.join(profileDir, 'Default'), { recursive: true });
    fs.writeFileSync(path.join(profileDir, 'Default', 'Current Session'), 'warm-login');

    const promise = ensureProfileFreeForLaunch(tmpDir);
    await vi.runAllTimersAsync();

    await expect(promise).resolves.toBe(true);
    expect(fs.existsSync(path.join(profileDir, 'SingletonLock'))).toBe(false);
    expect(fs.existsSync(path.join(profileDir, 'Default', 'Current Session'))).toBe(true);
  });

  it('with fullWipe also clears session-restore files (crash recovery)', async () => {
    pgrepThrows(pgrepExit1());
    const profileDir = path.join(tmpDir, '.temp', 'browser-profile');
    fs.mkdirSync(path.join(profileDir, 'Default'), { recursive: true });
    fs.writeFileSync(path.join(profileDir, 'Default', 'Current Session'), 'session');

    const promise = ensureProfileFreeForLaunch(tmpDir, { fullWipe: true });
    await vi.runAllTimersAsync();

    await expect(promise).resolves.toBe(true);
    expect(fs.existsSync(path.join(profileDir, 'Default', 'Current Session'))).toBe(false);
  });

  it('returns false when a holder never releases the profile', async () => {
    pgrepReturns('12345\n');
    vi.spyOn(process, 'kill').mockReturnValue(true);

    const promise = ensureProfileFreeForLaunch(tmpDir, { timeoutMs: 300 });
    await vi.runAllTimersAsync();

    await expect(promise).resolves.toBe(false);
  });
});
