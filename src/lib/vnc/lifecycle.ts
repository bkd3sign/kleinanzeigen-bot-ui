import { spawn, execFileSync, type ChildProcess } from 'child_process';
import { mkdirSync, existsSync, readFileSync, writeFileSync, unlinkSync } from 'fs';
import path from 'path';
import { allocateVncSlot, releaseVncSlot, getVncSlot, vncSessionCount, MAX_VNC_SESSIONS, DISPLAY_START } from '@/lib/vnc/ports';
import { vncToken, writeVncToken, removeVncToken, clearVncToken } from '@/lib/vnc/tokens';
import { loginProfilePath } from '@/lib/bot/profile-path';
import { ensureProfileFreeForLaunch } from '@/lib/bot/browser-cleanup';
import { waitForCdp, cdpHttpGet, collapseToSingleTab, sleep } from '@/lib/browser/cdp';
import { isLoggedInUrl } from '@/lib/vnc/login-url';
import { acquireBrowserLock, releaseBrowserLock } from '@/lib/bot/browser-lock';

// Start directly on the SSO login page so a logged-out user lands straight in the Auth0
// login (a protected start page like "Meine Anzeigen" returned HTTP 500 right after a manual
// login). A returning logged-in user is redirected away from the login page, which
// isLoggedInUrl detects as the transition back to the logged-in state.
const KA_START_URL = 'https://www.kleinanzeigen.de/m-einloggen-sso.html';
// CDP_BASE starts at 9300 to stay clear of the messaging-browser range defined in ports.ts
const CDP_BASE = 9300;
// Cold Chromium+Xvnc boot on slow/loaded hosts (small aarch64 VMs) can take well over the
// old 45s; a warm restart returns in seconds. Keep useVncLogin's connecting-timeout > this.
const CDP_COLD_START_TIMEOUT_MS = 90_000;
// Xvnc creates its X11 socket shortly after spawn; Chromium aborts with "Missing X server
// or $DISPLAY" (→ CDP never opens) if it connects first. Poll for the socket before launching
// Chromium instead of racing it — cheap when Xvnc is quick (~1s observed). Budget is generous
// so a slow-to-bind Xvnc on a loaded host still gets its display up (a too-short budget would
// silently steal from the cold-start window). Kept small relative to useVncLogin's 120s
// connecting timeout: the X-wait (≤20s) plus the 90s CDP-wait leave headroom for the brief
// pre-spawn cleanup, so the client's escape hatch effectively never fires on a healthy host.
const X_SERVER_READY_TIMEOUT_MS = 20_000;
// Grace period after SIGTERM before escalating an orphaned Xvnc to SIGKILL (freeXDisplay).
const XVNC_TERM_GRACE_MS = 2_000;
const XVNC_TERM_POLL_MS = 100;

export interface VncSession {
  workspace: string;
  display: number;
  rfbPort: number;
  cdpPort: number;
  token: string;
  status: 'starting' | 'ready' | 'error';
}

interface VncEntry {
  session: VncSession;
  xvnc: ChildProcess;
  wm: ChildProcess;
  chromium: ChildProcess;
  // Epoch ms when the login window was last seen open (client heartbeat). Used to
  // auto-stop idle visible-mode sessions that would otherwise run until container restart.
  lastWindowSeenAt: number;
}

// Persist across HMR restarts, mirroring the pattern from jobs.ts / ports.ts
const g = globalThis as unknown as {
  __vncSessions?: Map<string, VncEntry>;
  __vncStarting?: Map<string, Promise<VncSession>>;
};
if (!g.__vncSessions) g.__vncSessions = new Map<string, VncEntry>();
if (!g.__vncStarting) g.__vncStarting = new Map<string, Promise<VncSession>>();
const sessions: Map<string, VncEntry> = g.__vncSessions;
const starting: Map<string, Promise<VncSession>> = g.__vncStarting;

export function getVncSession(workspace: string): VncSession | undefined {
  return sessions.get(workspace)?.session;
}

/** Mark the login window as currently open (client heartbeat), resetting the idle timer. */
export function touchVncWindow(workspace: string): void {
  const entry = sessions.get(workspace);
  if (entry) entry.lastWindowSeenAt = Date.now();
}

/** Whether the session's window has been closed longer than idleMs (no recent heartbeat). */
export function isVncWindowIdle(workspace: string, idleMs: number): boolean {
  const entry = sessions.get(workspace);
  return entry ? Date.now() - entry.lastWindowSeenAt > idleMs : false;
}

// Poll whether the manual login in the VNC browser has succeeded, by reading the
// active page URL via the CDP HTTP endpoint (no WebSocket needed). Used to
// auto-close the login modal and re-run the job once the user is logged in.
export async function isVncLoggedIn(workspace: string): Promise<boolean> {
  const session = getVncSession(workspace);
  if (!session || session.status !== 'ready') return false;
  try {
    const targets = await cdpHttpGet<Array<{ type: string; url: string }>>(session.cdpPort, '/json');
    const page = targets.find(t => t.type === 'page');
    return page ? isLoggedInUrl(page.url) : false;
  } catch {
    return false;
  }
}

// Configure the Chromium profile's Preferences before launch. Merges into existing
// Preferences (a returning profile already has them) so the settings apply on EVERY
// start, not just the first — otherwise the translate bar reappears and session cookies
// are never persisted on a profile that has been used before.
//   - translate/intl: suppress the "translate this page?" infobar (the command-line
//     --disable-features flag is unreliable across Chromium builds).
//   - session.restore_on_startup = 1 ("continue where you left off") + a clean exit_type:
//     makes Chromium persist in-memory (session) cookies across restarts and restore them
//     cleanly (no crash-restore prompt), so the manual VNC login survives into the
//     subsequent headless bot run on the shared profile.
function seedChromiumPrefs(profile: string): void {
  try {
    const defaultDir = path.join(profile, 'Default');
    const prefsFile = path.join(defaultDir, 'Preferences');
    mkdirSync(defaultDir, { recursive: true });

    let prefs: Record<string, unknown> = {};
    if (existsSync(prefsFile)) {
      try {
        prefs = JSON.parse(readFileSync(prefsFile, 'utf8')) as Record<string, unknown>;
      } catch {
        prefs = {}; // corrupt Preferences → reseed from scratch
      }
    }

    const profileSection = (prefs.profile ?? {}) as Record<string, unknown>;
    const sessionSection = (prefs.session ?? {}) as Record<string, unknown>;

    prefs.translate = { enabled: false };
    prefs.translate_blocked_languages = ['de', 'en'];
    prefs.intl = { accept_languages: 'de,de-DE,en-US,en' };
    prefs.session = { ...sessionSection, restore_on_startup: 1 };
    prefs.profile = { ...profileSection, exit_type: 'Normal', exited_cleanly: true };

    writeFileSync(prefsFile, JSON.stringify(prefs), 'utf8');
  } catch {
    // best-effort — the --disable-features flag remains as fallback
  }
}

function killVncProcesses(procs: ChildProcess[]): void {
  for (const proc of procs) {
    try {
      if (proc.pid != null) process.kill(-proc.pid, 'SIGTERM');
    } catch {
      // Process may have already exited
    }
  }
}

// Wait until Xvnc has created its X11 socket (/tmp/.X11-unix/X<display>), i.e. the display
// is ready to accept clients. Condition-based (not a fixed sleep): returns as soon as the
// socket appears, or false on timeout / abort. Prevents the Chromium "Missing X server" race.
async function waitForXServer(display: number, timeoutMs: number, shouldAbort?: () => Error | null): Promise<boolean> {
  const socket = `/tmp/.X11-unix/X${display}`;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (shouldAbort?.()) return false;
    if (existsSync(socket)) return true;
    await sleep(100);
  }
  return false;
}

// PIDs of any Xvnc bound to the given display: [] when pgrep positively reports none, or null
// when pgrep could not determine (timeout / error / binary absent). Callers MUST treat null as
// "unknown", never as "free" — otherwise a slow pgrep on a thrashing host would let us delete a
// live server's lock/socket. Mirrors the execFileSync + pgrep approach of killOrphanedChromium.
function xvncPids(display: number): number[] | null {
  try {
    const out = execFileSync('pgrep', ['-f', `Xvnc :${display}`], { encoding: 'utf-8', timeout: 2000 }).trim();
    return out ? out.split('\n').map(Number).filter(Number.isInteger) : [];
  } catch (err) {
    // Only pgrep's exit code 1 is a definitive "no match"; timeout / ENOENT / other → unknown.
    return (err as { status?: number }).status === 1 ? [] : null;
  }
}

// Remove an X display's stale lock + socket. A clean Xvnc exit removes them itself; a
// SIGKILLed one leaves them behind, and the stale lock blocks the next server on that display.
function cleanupXDisplayFiles(display: number): void {
  for (const f of [`/tmp/.X${display}-lock`, `/tmp/.X11-unix/X${display}`]) {
    try { if (existsSync(f)) unlinkSync(f); } catch { /* best-effort */ }
  }
}

// Forcibly free an X display before reuse: kill any Xvnc still bound to it (SIGTERM, then
// SIGKILL after a grace period), drop the stale lock/socket, and confirm it is gone. Orphans
// arise because Xvnc is spawned detached and outlives a server restart (see startVncLogin),
// and a lingering server makes the new Xvnc refuse to start ("Server is already active").
async function freeXDisplay(display: number): Promise<void> {
  const pids = xvncPids(display);
  // Unknown (pgrep timed out / errored): we cannot tell whether a server is bound, so leave the
  // lock/socket untouched — deleting a live server's files would strand it and make the new Xvnc
  // collide. The subsequent spawn surfaces a real error instead.
  if (pids === null) return;
  if (pids.length === 0) { cleanupXDisplayFiles(display); return; }

  console.warn(`[vnc] freeing stale X display :${display} (orphaned Xvnc from a prior run)`);
  for (const pid of pids) { try { process.kill(pid, 'SIGTERM'); } catch { /* already gone */ } }
  for (let i = 0; i < XVNC_TERM_GRACE_MS / XVNC_TERM_POLL_MS; i++) {
    const p = xvncPids(display);
    if (p !== null && p.length === 0) break;
    await sleep(XVNC_TERM_POLL_MS);
  }
  const survivors = xvncPids(display) ?? [];
  for (const pid of survivors) { try { process.kill(pid, 'SIGKILL'); } catch { /* already gone */ } }
  if (survivors.length) await sleep(200);
  // Drop the lock/socket only once pgrep POSITIVELY confirms the display is free (empty, not
  // null) — never on an "unknown", and never while a wedged server still lingers.
  const remaining = xvncPids(display);
  if (remaining !== null && remaining.length === 0) cleanupXDisplayFiles(display);
}

export async function startVncLogin(workspace: string): Promise<VncSession> {
  // Only return an existing session if it is fully ready
  const existing = getVncSession(workspace);
  if (existing && existing.status === 'ready') return existing;

  // Concurrent callers await the same in-flight promise — prevents double-spawn
  const inflight = starting.get(workspace);
  if (inflight) return inflight;

  // Cap total concurrent sessions (defense-in-depth against host resource exhaustion).
  // Checked before acquiring the lock so a rejection never leaks it. Idempotent: a
  // workspace that already holds a slot may always re-acquire its own session.
  if (!getVncSlot(workspace) && vncSessionCount() >= MAX_VNC_SESSIONS) {
    throw new Error(`Maximale Anzahl gleichzeitiger Browser-Sitzungen (${MAX_VNC_SESSIONS}) erreicht. Bitte später erneut versuchen.`);
  }

  // Refuse if the headless bot currently owns the profile — starting Xvnc
  // would call killOrphanedChromium and kill the running bot's browser.
  if (!acquireBrowserLock(workspace, 'vnc')) {
    throw new Error('Der Bot läuft gerade für diesen Workspace — bitte nach dem Job erneut anmelden.');
  }

  // All side effects run inside the IIFE so starting.set is synchronous — no await between
  // the inflight check above and the starting.set below.
  const promise = (async (): Promise<VncSession> => {
    // Handles + session are declared before the try so the catch can release EVERY resource
    // (slot, 'vnc' lock, token file, spawned processes) no matter where startup fails. A throw
    // anywhere in the prelude (freeXDisplay, writeVncToken, allocateVncSlot, …) would otherwise
    // leak them and block VNC for this workspace until the server restarts.
    let session: VncSession | undefined;
    let xvnc: ChildProcess | undefined;
    let wm: ChildProcess | undefined;
    let chromium: ChildProcess | undefined;

    // Capture spawn failures (e.g. a non-Docker install without the VNC stack: Xvnc or
    // Chromium binary missing). Without an 'error' listener a spawn ENOENT becomes an
    // uncaughtException that crashes the server. We record the first failure in a plain
    // flag (NOT a rejecting promise — a losing Promise.race branch would surface as an
    // unhandledRejection) and let the X-server/CDP waits bail out on it.
    let spawnError: Error | null = null;
    const onSpawnError = (name: string) => (e: NodeJS.ErrnoException) => {
      spawnError ??= new Error(`${name} konnte nicht gestartet werden (${e.code ?? e.message}). Ist der VNC-Stack (Xvnc, Chromium) installiert?`);
    };

    try {
      const { display, rfbPort } = allocateVncSlot(workspace);
      const cdpPort = CDP_BASE + (display - DISPLAY_START);
      const token = vncToken(workspace);

      // Register the session as 'starting' synchronously so the runner's
      // profile-lock guard can detect an active session during startup
      session = { workspace, display, rfbPort, cdpPort, token, status: 'starting' };

      // Messaging shares the same browser-profile. Stop it cleanly first — this marks its
      // session 'browserless' (so it auto-restarts when VNC ends) instead of letting the
      // killOrphanedChromium below tear its Chromium out from under it. Mirrors the bot
      // queue's stopForBot priority. Dynamic import avoids a circular dependency.
      try {
        const { stopForBot } = await import('@/lib/messaging/gateway');
        await stopForBot(workspace);
      } catch { /* messaging module/session may be absent */ }

      // Confirm the profile is free before launch: kill any Chromium left over from a previous
      // node-process run that still holds the SingletonLock, poll until it is released, then clear
      // stale lock files. Shared with the bot/messaging/MFA launch sites so all four enforce the
      // same guarantee (locks-only — preserve the warm login session for the attached browser).
      try {
        await ensureProfileFreeForLaunch(workspace);
      } catch {
        // Best-effort — never block startup on this
      }

      const profile = loginProfilePath(workspace);
      seedChromiumPrefs(profile);

      // Free the display before reusing it. Xvnc is spawned detached, so it SURVIVES a
      // Node/server restart while the in-memory session map does not — a recycled display can
      // still be held by an orphan whose stale /tmp/.X<display>-lock makes the new Xvnc refuse
      // to start ("Server is already active for display N" → socket never appears → timeout).
      await freeXDisplay(display);

      xvnc = spawn(
        'Xvnc',
        [
          `:${display}`,
          '-geometry', '520x600',
          '-depth', '24',
          '-SecurityTypes', 'None',
          '-AlwaysShared',
          '-rfbport', String(rfbPort),
          // Bind RFB socket to loopback only; websockify connects via 127.0.0.1
          '-localhost', 'yes',
        ],
        { detached: true, stdio: 'ignore' },
      );
      xvnc.once('error', onSpawnError('Xvnc'));

      // Tiny window manager: keeps the Chromium window maximized to the framebuffer
      // and re-fits it whenever noVNC (resize=remote) changes the Xvnc resolution, so
      // the page always fills the view with no black desktop border. matchbox has its own
      // sleep to wait for the X server before managing the kiosk window.
      wm = spawn(
        'sh',
        ['-c', 'sleep 1; exec matchbox-window-manager -use_titlebar no -use_cursor yes'],
        { detached: true, stdio: 'ignore', env: { ...process.env, DISPLAY: `:${display}` } },
      );
      wm.on('error', () => { /* optional window manager — ignore */ });

      // Wait for Xvnc's X11 socket before launching Chromium: connecting before it exists
      // makes Chromium abort with "Missing X server or $DISPLAY", CDP never opens, and the
      // start dies on the 90s timeout. This race is why a cold "Chrome öffnen" failed while a
      // warm retry (display already up) succeeded.
      const xReady = await waitForXServer(display, X_SERVER_READY_TIMEOUT_MS, () => spawnError);
      if (!xReady) {
        spawnError ??= new Error('Anzeige (Xvnc) wurde nicht rechtzeitig bereit — bitte erneut versuchen.');
      }

      // Optional env override to point at a specific Chromium binary in dev/test
      const chromiumBin = process.env.CHROMIUM_BIN || 'chromium';
      chromium = spawn(
        chromiumBin,
        [
          '--kiosk',
          `--user-data-dir=${profile}`,
          `--remote-debugging-port=${cdpPort}`,
          '--remote-debugging-address=127.0.0.1',
          '--no-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu',
          // Without a running keyring/D-Bus (typical on headless LXC/servers) Chromium
          // otherwise stalls on the OS password store at startup → CDP never opens.
          '--password-store=basic',
          '--no-first-run',
          '--no-default-browser-check',
          '--lang=de',
          '--disable-features=Translate,TranslateUI',
          KA_START_URL,
        ],
        { detached: true, stdio: 'ignore', env: { ...process.env, DISPLAY: `:${display}` } },
      );
      chromium.once('error', onSpawnError('Chromium'));

      writeVncToken(token, rfbPort);

      sessions.set(workspace, { session, xvnc, wm, chromium, lastWindowSeenAt: Date.now() });

      // Generous window for a COLD Chromium boot inside Xvnc on slow/loaded hosts.
      // spawnError still bails out within ~500ms if a binary failed to spawn rather than
      // blocking the full timeout.
      await waitForCdp(cdpPort, CDP_COLD_START_TIMEOUT_MS, () => spawnError);
      // restore_on_startup=1 keeps the warm session but also reopens every tab from the last
      // run; collapse them to one so the kiosk view stays clean and the bot's tab is easy to
      // surface. Cookies are unaffected (they live in the cookie store, not the tabs).
      await collapseToSingleTab(cdpPort);
      session.status = 'ready';
      return session;
    } catch (err) {
      // Idempotent teardown — every release fn no-ops when its resource was never acquired,
      // so this is safe no matter how far startup got before throwing.
      if (session) {
        session.status = 'error';
        removeVncToken(session.token);
      }
      const procs = [xvnc, wm, chromium].filter((p): p is ChildProcess => p !== undefined);
      if (procs.length) killVncProcesses(procs);
      clearVncToken(workspace);
      releaseVncSlot(workspace);
      releaseBrowserLock(workspace, 'vnc');
      sessions.delete(workspace);
      throw err;
    }
  })();

  starting.set(workspace, promise); // synchronous — no await before this line
  try {
    return await promise;
  } finally {
    starting.delete(workspace);
  }
}

export async function stopVncLogin(workspace: string): Promise<void> {
  const entry = sessions.get(workspace);
  if (!entry) return;

  const { session, xvnc, wm, chromium } = entry;

  killVncProcesses([xvnc, wm, chromium]);

  removeVncToken(session.token);
  clearVncToken(workspace);
  releaseVncSlot(workspace);
  releaseBrowserLock(workspace, 'vnc');
  sessions.delete(workspace);

  // The shared browser-profile is free again — let any messaging session that was
  // stopped for VNC reclaim it (no-op if the bot queue is busy or none is browserless).
  // Fire-and-forget; dynamic import avoids a circular dependency.
  import('@/lib/messaging/gateway')
    .then(m => m.restartAllBrowserless())
    .catch(() => { /* messaging module absent or restart not applicable */ });
}
