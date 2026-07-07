import { execFile, execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { loginProfilePath } from '@/lib/bot/profile-path';

/**
 * Run a command and resolve its stdout — the ASYNC counterpart to execFileSync. Used by the
 * profile lookup so it never blocks the event loop: waitForProfileFree polls this ~80× in an 8s
 * window across the messaging/MFA/VNC/bot launch paths, and a synchronous pgrep that goes slow on
 * a thrashing NAS would otherwise freeze every concurrent HTTP handler for up to its timeout.
 * We hand-roll the Promise (instead of util.promisify) so the callback shape is explicit and
 * mockable in tests. Rejects with the underlying error (carrying `.code` = exit code or 'ENOENT').
 */
function execFileText(file: string, args: string[], opts: { timeout?: number } = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(file, args, { encoding: 'utf8', timeout: opts.timeout ?? 3000, maxBuffer: 1 << 20 }, (err, stdout) => {
      if (err) reject(err);
      else resolve(typeof stdout === 'string' ? stdout : String(stdout));
    });
  });
}

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

const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

/**
 * True if the PID is a live process. `process.kill(pid, 0)` sends no signal but throws ESRCH when
 * the process is gone; EPERM means it exists but is owned by another user (still alive).
 */
function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as { code?: string }).code === 'EPERM';
  }
}

/**
 * Read the PID that currently holds the profile from Chromium's `SingletonLock`. Chromium writes
 * the lock as a symlink `SingletonLock -> <hostname>-<pid>`, so following it yields the holder PID
 * DIRECTLY — independent of pgrep. This is the pgrep-proof fallback: when the process lookup times
 * out on a thrashing NAS, we can still identify (and kill) the holder instead of giving up.
 * Returns null when the lock is absent, not a symlink, or has no parseable trailing PID.
 */
function readSingletonLockPid(profileDir: string): number | null {
  try {
    const target = fs.readlinkSync(path.join(profileDir, 'SingletonLock'));
    const match = target.match(/-(\d+)$/);
    if (!match) return null;
    const pid = Number(match[1]);
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch {
    return null; // no lock / not a symlink / unreadable
  }
}

/**
 * Confirm a PID is actually a Chromium using THIS profile before we trust the lock file and kill
 * it — a stale SingletonLock can point at a PID the OS has since recycled for an unrelated process.
 * Linux only (reads the NUL-separated /proc/<pid>/cmdline); returns false where /proc is absent
 * (macOS/Windows), so the lock-file fallback simply doesn't fire there (pgrep/wmic work anyway).
 */
function pidReferencesProfile(pid: number, profileDir: string): boolean {
  try {
    const cmdline = fs.readFileSync(`/proc/${pid}/cmdline`, 'utf-8');
    return cmdline.includes(`user-data-dir=${profileDir}`);
  } catch {
    return false;
  }
}

/**
 * Ask the OS process table who references this profile. Cross-platform: pgrep on Unix, wmic on
 * Windows. Returns `[]` ONLY when the tool POSITIVELY reported no match (pgrep exit code 1 / empty
 * wmic result), or `null` when it could NOT determine the answer (timeout on a thrashing host,
 * missing binary, or any other error). Mirrors the hardening in vnc/lifecycle.ts (xvncPids).
 */
async function findProfilePidsViaTool(profileDir: string): Promise<number[] | null> {
  if (process.platform === 'win32') {
    try {
      const escaped = profileDir.replace(/\\/g, '\\\\');
      const result = await execFileText(
        'wmic',
        ['process', 'where', `commandline like '%${escaped}%'`, 'get', 'processid', '/format:csv'],
      );
      return result
        .split('\n')
        .slice(1)
        .map(line => line.trim().split(',').pop()?.trim())
        .filter((pid): pid is string => Boolean(pid && /^\d+$/.test(pid)))
        .map(Number);
    } catch (err) {
      // wmic removed (modern Windows) → cannot detect, fall back to "assume free" like the old
      // behavior. Any other error (timeout) → genuinely undetermined.
      return (err as { code?: string }).code === 'ENOENT' ? [] : null;
    }
  }

  try {
    const result = (await execFileText('pgrep', ['-f', `user-data-dir=${profileDir}`])).trim();
    if (!result) return [];
    return result
      .split('\n')
      .filter(Boolean)
      .map(Number)
      .filter(n => Number.isInteger(n) && n > 0);
  } catch (err) {
    // execFile rejects with `.code` = the process exit code (number) on non-zero exit, or the
    // string 'ENOENT' when the binary is missing. Exit code 1 = definitive "no match"; ENOENT can
    // never tell us more → fall back to "assume free". Everything else (timeout on a thrashing
    // host, permission error) is genuinely undetermined → null, so callers never mistake it for
    // "free".
    const code = (err as { code?: number | string }).code;
    if (code === 1 || code === 'ENOENT') return [];
    return null;
  }
}

/**
 * Who holds this profile. The OS process lookup is authoritative when it can answer; the
 * SingletonLock symlink is a pgrep-independent FALLBACK for the one case the lookup can't cover.
 * Callers MUST treat `null` as "unknown", never as "free": launching onto an unconfirmed profile
 * dies with "Failed to connect to browser".
 *
 * - Tool answered (a PID list OR a positive "none") → trust it verbatim. A leftover SingletonLock
 *   with the tool reporting "none" is just a stale file (cleanStaleLocks removes it) — we must NOT
 *   kill the PID it names, since the OS may have recycled it for an unrelated process.
 * - Tool "undetermined" (timeout on a thrashing host — the incident this fallback exists for) →
 *   use the lock-file holder, but ONLY if it is alive AND its cmdline actually references this
 *   profile, so a recycled PID is never killed. Otherwise null (still unknown).
 *
 * Shared by killOrphanedChromium and waitForProfileFree so both agree on "who holds the profile".
 */
async function findProfilePids(profileDir: string): Promise<number[] | null> {
  const viaTool = await findProfilePidsViaTool(profileDir);
  if (viaTool !== null) return viaTool;

  const lockPid = readSingletonLockPid(profileDir);
  if (lockPid !== null && isProcessAlive(lockPid) && pidReferencesProfile(lockPid, profileDir)) {
    return [lockPid];
  }
  return null;
}

/**
 * PIDs of live Chromium processes holding this workspace's browser profile, or `null` when the
 * lookup could not be determined (see findProfilePids). Exported so callers can surface the
 * cleanup state (e.g. into a job log) when a launch is about to proceed on an unconfirmed profile.
 */
export function getProfileHolderPids(workspace: string): Promise<number[] | null> {
  return findProfilePids(loginProfilePath(workspace));
}

/**
 * Send a hard kill (SIGKILL / taskkill /F) to a single PID. No-op if already gone.
 */
function hardKill(pid: number): void {
  if (process.platform === 'win32') {
    try { execFileSync('taskkill', ['/F', '/PID', String(pid)], { timeout: 3000 }); } catch { /* already gone */ }
  } else {
    try { process.kill(pid, 'SIGKILL'); } catch { /* already gone */ }
  }
}

/**
 * Kill orphaned chromium processes belonging to a specific workspace.
 * Only targets chromium instances using this workspace's browser profile,
 * so other users' sessions remain unaffected. Supports Linux/macOS (pgrep)
 * and Windows (wmic + taskkill).
 */
export async function killOrphanedChromium(workspace: string): Promise<void> {
  const profileDir = loginProfilePath(workspace);
  const pids = await findProfilePids(profileDir);
  // null = lookup undetermined (pgrep timeout / missing). We have no PIDs to target, so this is
  // a no-op — but waitForProfileFree({kill:true}) keeps re-issuing kills across its poll window,
  // which is where an under-load host eventually reaps the holder once pgrep recovers.
  if (pids === null) return;
  for (const pid of pids) {
    hardKill(pid);
  }
}

// Lock / IPC files that block a fresh browser startup after an unclean shutdown.
// Carry no user state, so they are always safe to remove before every run.
// NOTE: keep this list (and STALE_CACHE_DIRS below) in sync with docker/entrypoint.sh's
// boot-time sweep — two sources of truth by necessity (TS runtime vs shell boot).
const LOCK_FILES = [
  'SingletonLock', 'SingletonCookie', 'SingletonSocket',
  'DevToolsActivePort',
  'CrashpadMetrics-active.pma',
];

// Session-restore files. Chromium keeps in-memory (session) cookies here when
// restore-on-startup is enabled (see seedChromiumPrefs), so a manual VNC login survives
// into the later headless bot run. Only wiped on full crash recovery (cleanBrowserProfile)
// — deleting them on every routine relaunch would throw away the warm login session.
const SESSION_FILES = [
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
 * Remove only lock files — safe before every run. Preserves session-restore files (so a
 * warm login survives a relaunch) and caches (so Chromium can reuse V8/GPU bytecode).
 */
export function cleanStaleLocks(workspace: string, profileName: string = 'browser-profile'): void {
  const profileDir = path.join(workspace, '.temp', profileName);
  for (const f of LOCK_FILES) {
    try { fs.unlinkSync(path.join(profileDir, f)); } catch { /* fine */ }
  }
}

/**
 * Full cleanup: remove lock files, session-restore files, and cache dirs.
 * Only call on crash recovery — wiping session files discards the warm login and the
 * cache wipe forces Chromium to rebuild V8 bytecode and GPU shaders on the next startup.
 */
export function cleanBrowserProfile(workspace: string, profileName: string = 'browser-profile'): void {
  cleanStaleLocks(workspace, profileName);
  const profileDir = path.join(workspace, '.temp', profileName);
  for (const f of SESSION_FILES) {
    try { fs.unlinkSync(path.join(profileDir, f)); } catch { /* fine */ }
  }
  for (const dir of STALE_CACHE_DIRS) {
    try { fs.rmSync(path.join(profileDir, dir), { recursive: true, force: true }); } catch { /* fine */ }
  }
}

/**
 * Ensure the workspace's shared browser profile is actually FREE before a fresh headless launch.
 * Every non-attach launch site (bot queue, messaging, MFA, VNC) MUST funnel through this so they
 * all enforce the SAME guarantee — a site that only fires one kill and spawns immediately races a
 * slow-dying Chromium and hits "Failed to connect to browser" (the scheduled-job incident).
 *
 * Sequence: POLL the profile, re-killing any holder each round (kill:true), until the lock is
 * confirmed released, then remove stale lock files. Returns false when the profile could not be
 * confirmed free within the window (a live holder survived every SIGKILL, or the process lookup
 * was undetermined) — the caller should surface a diagnostic and/or retry, not assume success.
 *
 * `fullWipe` additionally clears session-restore + cache files (crash recovery); omit it to
 * PRESERVE a warm login session across the relaunch.
 */
export async function ensureProfileFreeForLaunch(
  workspace: string,
  opts: { fullWipe?: boolean; timeoutMs?: number } = {},
): Promise<boolean> {
  const { fullWipe = false, timeoutMs = 8000 } = opts;
  // No standalone kill here: the first waitForProfileFree poll already looks up and SIGKILLs any
  // holder (kill:true), so a separate killOrphanedChromium would just duplicate that lookup+kill.
  const free = await waitForProfileFree(workspace, timeoutMs, { kill: true });
  if (fullWipe) cleanBrowserProfile(workspace);
  else cleanStaleLocks(workspace);
  return free;
}

/**
 * Poll until no Chromium process is using the workspace's browser profile,
 * or the timeout expires. More robust than a fixed sleep because the OS
 * process exit + file-handle release timing varies across systems.
 */
export async function waitForProfileFree(
  workspace: string,
  timeoutMs = 8000,
  opts: { kill?: boolean } = {},
): Promise<boolean> {
  const profileDir = loginProfilePath(workspace);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const pids = await findProfilePids(profileDir);
    if (pids !== null && pids.length === 0) {
      // POSITIVELY free (pgrep exit 1 / empty). Short grace period: the OS releases file handles
      // asynchronously after process exit, so a new Chromium starting immediately may still find
      // locked files. Only an empty array counts — never a `null` (undetermined) result.
      await sleep(300);
      return true;
    }
    // pids === null → lookup undetermined (pgrep timed out on a thrashing host). Do NOT treat as
    // free: keep polling so a recovering pgrep can confirm the state before we time out. There is
    // nothing to kill in this branch because we could not identify any PID.
    if (opts.kill && pids !== null) {
      // Re-issue the kill every poll: a process stuck in uninterruptible I/O (e.g. a slow
      // NAS mount) does not die on the first SIGKILL — the signal is delivered only once the
      // syscall returns. Repeated signalling reaps it as soon as it becomes killable, instead
      // of passively waiting out the whole timeout while it keeps holding the profile lock.
      for (const pid of pids) { hardKill(pid); }
    }
    await sleep(100);
  }
  // Timed out — profile is still held (or its state could not be confirmed). Caller decides
  // whether to proceed or surface a warning.
  return false;
}
