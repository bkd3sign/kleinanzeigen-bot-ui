// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

vi.mock('child_process', () => ({
  execFileSync: vi.fn(),
}));

import { execFileSync } from 'child_process';
import { waitForProfileFree, cleanBrowserProfile, killOrphanedChromium } from '../browser-cleanup';

const mockExecFileSync = vi.mocked(execFileSync);

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

  it('does not throw when files are already missing (ENOENT)', () => {
    // Profile dir exists but files don't
    expect(() => cleanBrowserProfile(tmpDir)).not.toThrow();
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

describe('killOrphanedChromium', () => {
  beforeEach(() => {
    mockExecFileSync.mockReset();
  });

  it('sends SIGKILL to every pid returned by pgrep', () => {
    const killSpy = vi.spyOn(process, 'kill').mockReturnValue(true);
    mockExecFileSync.mockReturnValueOnce('111\n222\n' as unknown as ReturnType<typeof execFileSync>);

    killOrphanedChromium('/workspace');

    expect(killSpy).toHaveBeenCalledWith(111, 'SIGKILL');
    expect(killSpy).toHaveBeenCalledWith(222, 'SIGKILL');
    killSpy.mockRestore();
  });

  it('does not call kill when pgrep returns empty output', () => {
    const killSpy = vi.spyOn(process, 'kill').mockReturnValue(true);
    mockExecFileSync.mockReturnValueOnce('' as unknown as ReturnType<typeof execFileSync>);

    killOrphanedChromium('/workspace');

    expect(killSpy).not.toHaveBeenCalled();
    killSpy.mockRestore();
  });

  it('does not throw when pgrep exits 1 (no processes found)', () => {
    const killSpy = vi.spyOn(process, 'kill').mockReturnValue(true);
    mockExecFileSync.mockImplementationOnce(() => { throw new Error('exit 1'); });

    expect(() => killOrphanedChromium('/workspace')).not.toThrow();
    expect(killSpy).not.toHaveBeenCalled();
    killSpy.mockRestore();
  });
});

describe('waitForProfileFree', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockExecFileSync.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('resolves immediately when pgrep finds no processes (exit 1)', async () => {
    mockExecFileSync.mockImplementation(() => { throw new Error('exit 1'); });

    const promise = waitForProfileFree('/workspace', 2000);
    await vi.runAllTimersAsync();
    await promise;

    expect(mockExecFileSync).toHaveBeenCalledTimes(1);
    expect(mockExecFileSync).toHaveBeenCalledWith(
      'pgrep',
      ['-f', 'user-data-dir=/workspace/.temp/browser-profile'],
      { timeout: 500 },
    );
  });

  it('polls until no processes remain, then resolves', async () => {
    let calls = 0;
    mockExecFileSync.mockImplementation(() => {
      calls++;
      // first 2 polls: process still alive; 3rd: gone
      if (calls < 3) return '12345\n' as unknown as ReturnType<typeof execFileSync>;
      throw new Error('exit 1');
    });

    const promise = waitForProfileFree('/workspace', 5000);
    await vi.runAllTimersAsync();
    await promise;

    expect(calls).toBe(3);
  });

  it('resolves after timeout even if processes never exit', async () => {
    mockExecFileSync.mockReturnValue('12345\n' as unknown as ReturnType<typeof execFileSync>);

    const promise = waitForProfileFree('/workspace', 300);
    await vi.runAllTimersAsync();
    await expect(promise).resolves.toBeUndefined();
  });
});
