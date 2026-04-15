import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';

/**
 * Detect the chromium/chrome binary path on the current platform.
 */
export function detectBrowserBin(): string {
  if (fs.existsSync('/usr/bin/chromium')) return '/usr/bin/chromium';
  if (fs.existsSync('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')) {
    return '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  }
  return 'chromium';
}

/**
 * Kill orphaned chromium processes belonging to a specific workspace.
 * Only targets chromium instances using this workspace's browser profile,
 * so other users' sessions remain unaffected.
 */
export function killOrphanedChromium(workspace: string): void {
  const profileDir = path.join(workspace, '.temp', 'browser-profile');
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

// Files that block browser startup after unclean shutdown
const STALE_FILES = [
  'SingletonLock', 'SingletonCookie', 'SingletonSocket',
  'DevToolsActivePort',
  'CrashpadMetrics-active.pma',
];

// Cache directories that corrupt easily and regenerate automatically
const STALE_CACHE_DIRS = [
  'Default/GPUCache', 'Default/Cache', 'Default/Code Cache', 'Default/DawnCache',
];

/**
 * Remove stale files that block browser startup after crashes,
 * but preserve cookies/session to avoid triggering MFA on every run.
 */
export function cleanBrowserProfile(workspace: string, profileName: string = 'browser-profile'): void {
  const profileDir = path.join(workspace, '.temp', profileName);
  for (const f of STALE_FILES) {
    try { fs.unlinkSync(path.join(profileDir, f)); } catch { /* fine */ }
  }
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
