import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';

/**
 * Detect the chromium/chrome binary path on the current platform.
 * Tries Linux, macOS, Windows in order, then falls back to which/where lookup.
 */
export function detectBrowserBin(): string {
  // Linux standard paths
  const linuxPaths = [
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/snap/bin/chromium',
    '/usr/bin/microsoft-edge',
  ];
  for (const p of linuxPaths) {
    if (fs.existsSync(p)) return p;
  }

  // macOS paths
  const macPaths = [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  ];
  for (const p of macPaths) {
    if (fs.existsSync(p)) return p;
  }

  // Windows paths
  if (process.platform === 'win32') {
    const winPaths: string[] = [
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
      process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Google', 'Chrome', 'Application', 'chrome.exe') : '',
      'C:\\Program Files\\Chromium\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    ].filter(Boolean);
    for (const p of winPaths) {
      if (p && fs.existsSync(p)) return p;
    }
  }

  // Generic fallback: try which/where
  const candidates = ['chromium', 'chromium-browser', 'google-chrome', 'google-chrome-stable'];
  for (const bin of candidates) {
    try {
      const cmd = process.platform === 'win32' ? 'where' : 'which';
      const result = execFileSync(cmd, [bin], { encoding: 'utf-8', timeout: 2000 }).trim().split('\n')[0];
      if (result && fs.existsSync(result)) return result;
    } catch {
      // not found
    }
  }

  return 'chromium';
}

/**
 * Kill orphaned chromium processes belonging to a specific workspace.
 * Only targets chromium instances using this workspace's browser profile,
 * so other users' sessions remain unaffected. Supports Linux/macOS (pgrep)
 * and Windows (wmic + taskkill).
 */
export function killOrphanedChromium(workspace: string): void {
  const profileDir = path.join(workspace, '.temp', 'browser-profile');

  if (process.platform === 'win32') {
    try {
      const escaped = profileDir.replace(/\\/g, '\\\\');
      const result = execFileSync(
        'wmic',
        ['process', 'where', `commandline like '%${escaped}%'`, 'get', 'processid', '/format:csv'],
        { encoding: 'utf-8', timeout: 3000 },
      );
      const pids = result
        .split('\n')
        .slice(1)
        .map(line => line.trim().split(',').pop()?.trim())
        .filter((pid): pid is string => Boolean(pid && /^\d+$/.test(pid)));
      for (const pid of pids) {
        try {
          execFileSync('taskkill', ['/F', '/PID', pid], { timeout: 3000 });
        } catch {
          // already gone
        }
      }
    } catch {
      // wmic not available or no matches
    }
    return;
  }

  // Unix: pgrep + SIGKILL
  try {
    const result = execFileSync('pgrep', ['-f', `user-data-dir=${profileDir}`], {
      encoding: 'utf-8',
      timeout: 3000,
    }).trim();
    if (!result) return;
    for (const pid of result.split('\n').filter(Boolean)) {
      try { process.kill(Number(pid), 'SIGKILL'); } catch { /* already gone */ }
    }
  } catch {
    // pgrep exits with code 1 when no matches — expected.
    // Also handles missing pgrep binary gracefully.
  }
}

// Files that block browser startup or trigger crash-recovery mode after unclean shutdown.
// Session files (Current/Last Session+Tabs) prevent Chromium from entering headless-unsafe
// restore mode when it detects a previous crash.
const STALE_FILES = [
  'SingletonLock', 'SingletonCookie', 'SingletonSocket',
  'DevToolsActivePort',
  'CrashpadMetrics-active.pma',
  path.join('Default', 'Current Session'),
  path.join('Default', 'Current Tabs'),
  path.join('Default', 'Last Session'),
  path.join('Default', 'Last Tabs'),
];

// Cache directories that corrupt easily and regenerate automatically
const STALE_CACHE_DIRS = [
  'Default/GPUCache', 'Default/Cache', 'Default/Code Cache', 'Default/DawnCache',
];

/**
 * Remove only lock files and session-restore files — safe before every run.
 * Does not wipe caches so Chromium can reuse V8 bytecode and GPU shaders.
 */
export function cleanStaleLocks(workspace: string, profileName: string = 'browser-profile'): void {
  const profileDir = path.join(workspace, '.temp', profileName);
  for (const f of STALE_FILES) {
    try { fs.unlinkSync(path.join(profileDir, f)); } catch { /* fine */ }
  }
}

/**
 * Full cleanup: remove lock files, session files, and cache dirs.
 * Only call on crash recovery — cache wipe forces Chromium to rebuild
 * V8 bytecode and GPU shaders on the next startup.
 */
export function cleanBrowserProfile(workspace: string, profileName: string = 'browser-profile'): void {
  cleanStaleLocks(workspace, profileName);
  const profileDir = path.join(workspace, '.temp', profileName);
  for (const dir of STALE_CACHE_DIRS) {
    try { fs.rmSync(path.join(profileDir, dir), { recursive: true, force: true }); } catch { /* fine */ }
  }
}

/**
 * Full cleanup: kill orphaned processes + clean stale profile files.
 * Call before spawning any browser instance.
 */
export function prepareCleanBrowserState(workspace: string): void {
  killOrphanedChromium(workspace);
  cleanBrowserProfile(workspace);
}

/**
 * Poll until no Chromium process is using the workspace's browser profile,
 * or the timeout expires. More robust than a fixed sleep because the OS
 * process exit + file-handle release timing varies across systems.
 */
export async function waitForProfileFree(workspace: string, timeoutMs = 5000): Promise<void> {
  const profileDir = path.join(workspace, '.temp', 'browser-profile');
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      execFileSync('pgrep', ['-f', `user-data-dir=${profileDir}`], { timeout: 500 });
      // pgrep exited 0 → processes still alive, wait a bit
      await new Promise(resolve => setTimeout(resolve, 100));
    } catch {
      // pgrep exits 1 when no matches → profile is free.
      // Short grace period: OS releases file handles asynchronously after process exit,
      // so a new Chromium starting immediately may still find locked files.
      await new Promise(resolve => setTimeout(resolve, 300));
      return;
    }
  }
}
