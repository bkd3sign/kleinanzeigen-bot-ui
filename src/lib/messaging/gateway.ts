import { spawn, ChildProcess } from 'child_process';
import fs from 'fs';
import path from 'path';
import WebSocket from 'ws';
import yaml from 'js-yaml';
import type { ConversationsResponse, ConversationDetail } from '@/types/message';
import { startResponder } from './responder';
import { prepareCleanBrowserState, detectBrowserBin, killOrphanedChromium, cleanBrowserProfile } from '@/lib/bot/browser-cleanup';
import {
  createCdpClient,
  cdpHttpGet,
  sleep,
  waitForCondition,
  extractCookiesFromCDP,
  waitForCdp,
} from '@/lib/browser/cdp';
import { STEALTH_ARGS, STEALTH_UA, injectStealthScript } from '@/lib/browser/stealth';
import { LOGIN_URL, MFA_CODE_INPUT_SELECTOR, dismissConsentBanner, fillLoginForm, fillInput, detectLoginState } from '@/lib/browser/login';
import { readMergedConfig } from '@/lib/yaml/config';
import { SESSION_FILE as COOKIE_FILE } from '@/lib/ka/management-api';

const GATEWAY_BASE = 'https://gateway.kleinanzeigen.de/messagebox/api';
const CDP_BASE_PORT = 9223;

interface PersistedCookies {
  cookies: string;
  userId: number;
  savedAt: number;
}

/**
 * Save cookies to disk so messaging can work without a browser.
 */
function saveCookiesToDisk(workspace: string, cookies: string, userId: number): void {
  const filePath = path.join(workspace, COOKIE_FILE);
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify({ cookies, userId, savedAt: Date.now() } satisfies PersistedCookies));
  } catch { /* non-critical — browser session still works */ }
}

/**
 * Delete stale cookies from disk so ensureSession doesn't re-use them.
 */
function deleteCookiesFromDisk(workspace: string): void {
  const filePath = path.join(workspace, COOKIE_FILE);
  try { fs.unlinkSync(filePath); } catch { /* file already gone */ }
}

/**
 * Load cookies from disk. Returns null if file missing or unreadable.
 */
function loadCookiesFromDisk(workspace: string): PersistedCookies | null {
  const filePath = path.join(workspace, COOKIE_FILE);
  try {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as PersistedCookies;
    if (data.cookies && data.userId) return data;
  } catch { /* file missing or corrupt */ }
  return null;
}

// Each workspace gets a unique CDP port to avoid conflicts in multi-user mode
let nextPort = CDP_BASE_PORT;
const workspacePorts = new Map<string, number>();
function getCdpPort(workspace: string): number {
  let port = workspacePorts.get(workspace);
  if (!port) {
    port = nextPort++;
    workspacePorts.set(workspace, port);
  }
  return port;
}

// Persistent browser session per workspace
interface BrowserSession {
  proc: ChildProcess | null;
  cdpPort: number;
  cookies: string;
  userId: number | null;
  lastCookieRefresh: number;
  status: 'starting' | 'logging_in' | 'ready' | 'error' | 'browserless' | 'awaiting_mfa';
  error?: string;
  cdpWs?: WebSocket;
}

// Persist across HMR
const g = globalThis as unknown as {
  __msgSessions?: Map<string, BrowserSession>;
};
if (!g.__msgSessions) g.__msgSessions = new Map();



/**
 * Auto-detect user ID via profile API.
 */
export async function fetchUserId(cookies: string): Promise<number | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const res = await fetch('https://www.kleinanzeigen.de/m-mein-profil.json', {
      headers: { 'Cookie': cookies, 'Accept': 'application/json', 'User-Agent': STEALTH_UA },
      signal: controller.signal,
    });
    if (res.ok) {
      const profile = await res.json() as { userId?: string };
      if (profile.userId) return parseInt(profile.userId, 10);
    }
  } catch { /* profile fetch failed or aborted */ }
  finally { clearTimeout(timer); }
  return null;
}

/**
 * Decode access_token JWT without network call and check if it expires within 30s.
 * Returns true if the token is missing or expired/about to expire.
 */
export function isAccessTokenExpired(cookies: string): boolean {
  const token = cookies.split('; ')
    .find(c => c.startsWith('access_token='))
    ?.slice('access_token='.length);
  if (!token) return true;
  try {
    const raw = token.split('.')[1];
    const base64 = raw.replace(/-/g, '+').replace(/_/g, '/');
    const payload = JSON.parse(Buffer.from(base64, 'base64').toString('utf-8')) as { exp?: number };
    return payload.exp ? Date.now() >= (payload.exp - 30) * 1000 : false;
  } catch { return false; }
}

/**
 * Start a persistent browser session and log in automatically.
 * Uses the shared browser profile (.temp/browser-profile) for both bot CLI and messaging.
 */
export async function ensureSession(workspace: string): Promise<BrowserSession> {
  const existing = g.__msgSessions!.get(workspace);
  if (existing && existing.status === 'ready') {
    // Refresh cookies every 30 minutes (sessions are long-lived)
    if (Date.now() - existing.lastCookieRefresh > 30 * 60 * 1000) {
      try {
        existing.cookies = await extractCookiesFromCDP(existing.cdpPort);
        existing.lastCookieRefresh = Date.now();
        if (!existing.userId) {
          existing.userId = await fetchUserId(existing.cookies);
        }
        if (existing.userId) {
          saveCookiesToDisk(workspace, existing.cookies, existing.userId);
        }
      } catch { /* browser might have crashed, will restart */ }
    }
    return existing;
  }

  // Browserless mode: bot is using the shared profile, return session as-is
  // API calls continue with cached cookies — never launch a browser here
  if (existing && existing.status === 'browserless') {
    return existing;
  }

  // If already starting, wait for it
  if (existing && (existing.status === 'starting' || existing.status === 'logging_in')) {
    for (let i = 0; i < 60; i++) {
      await sleep(1000);
      const session = g.__msgSessions!.get(workspace);
      if (session?.status === 'ready') return session;
      if (session?.status === 'error') throw new Error(session.error || 'Login fehlgeschlagen');
      if (session?.status === 'browserless') return session;
      if (session?.status === 'awaiting_mfa') return session;
    }
    throw new Error('Browser-Start dauert zu lange');
  }

  // If awaiting MFA, return the session so the caller can handle it
  if (existing && existing.status === 'awaiting_mfa') {
    return existing;
  }

  // Try disk cookies before launching a browser (API-only mode)
  if (!existing || existing.status === 'error') {
    const persisted = loadCookiesFromDisk(workspace);
    if (persisted) {
      const userId = await fetchUserId(persisted.cookies);
      if (userId && !isAccessTokenExpired(persisted.cookies)) {
        const cookieSession: BrowserSession = {
          proc: null,
          cdpPort: getCdpPort(workspace),
          cookies: persisted.cookies,
          userId,
          lastCookieRefresh: persisted.savedAt,
          status: 'ready',
        };
        g.__msgSessions!.set(workspace, cookieSession);
        return cookieSession;
      }
    }
  }

  // Clean up old session
  if (existing?.proc) {
    try { existing.proc.kill('SIGTERM'); } catch { /* fine */ }
  }

  // Shared profile directory (used by both bot CLI and messaging)
  const profileDir = path.join(workspace, '.temp', 'browser-profile');
  fs.mkdirSync(profileDir, { recursive: true });

  // Kill orphaned chromium + clean stale profile files
  prepareCleanBrowserState(workspace);

  const session: BrowserSession = {
    proc: null,
    cdpPort: getCdpPort(workspace),
    cookies: '',
    userId: null,
    lastCookieRefresh: 0,
    status: 'starting',
  };
  g.__msgSessions!.set(workspace, session);

  try {
    // Start persistent headless Chromium in own process group
    // so stopForBot() can kill the entire tree with process.kill(-pid)
    const proc = spawn(detectBrowserBin(), [
      ...STEALTH_ARGS,
      '--headless=new',
      '--no-sandbox',
      '--disable-gpu',
      `--remote-debugging-port=${session.cdpPort}`,
      '--remote-debugging-address=127.0.0.1',
      `--user-data-dir=${profileDir}`,
      'about:blank',
    ], { stdio: ['ignore', 'pipe', 'pipe'], detached: true });
    session.proc = proc;

    proc.on('exit', () => {
      const s = g.__msgSessions!.get(workspace);
      if (s === session && s.status !== 'browserless') {
        s.status = 'error';
        s.error = 'Browser-Prozess beendet';
      }
    });

    // Wait for CDP HTTP endpoint to be reachable
    await waitForCdp(session.cdpPort, 20000);

    // Connect CDP and inject stealth patches BEFORE any real navigation
    // so Auth0 never sees an unpatched headless browser fingerprint
    const initTargets = await cdpHttpGet<Array<{ id: string; type: string; webSocketDebuggerUrl?: string }>>(session.cdpPort, '/json');
    const initPage = initTargets.find(t => t.type === 'page');
    if (!initPage) throw new Error('Kein Browser-Tab');

    const initWsUrl = initPage.webSocketDebuggerUrl || `ws://127.0.0.1:${session.cdpPort}/devtools/page/${initPage.id}`;
    const initWs = new WebSocket(initWsUrl);
    await new Promise<void>((resolve, reject) => {
      initWs.on('open', () => resolve());
      initWs.on('error', reject);
      setTimeout(() => reject(new Error('CDP WebSocket timeout')), 10000);
    });
    const initCdp = createCdpClient(initWs);
    await initCdp.send('Page.enable');
    await initCdp.send('Runtime.enable');
    await injectStealthScript(initCdp);
    initWs.close();

    // Network.getAllCookies works on about:blank — no navigation needed
    await sleep(500);
    const cookies = await extractCookiesFromCDP(session.cdpPort);
    const userId = await fetchUserId(cookies);

    if (userId) {
      if (!isAccessTokenExpired(cookies)) {
        // Already logged in from previous bot session with valid token
        session.cookies = cookies;
        session.userId = userId;
        session.lastCookieRefresh = Date.now();
        session.status = 'ready';
        saveCookiesToDisk(workspace, cookies, userId);
        return session;
      }
      // JSESSIONID valid but access_token expired — navigate to KA to get fresh token without re-login
      try {
        const refreshTargets = await cdpHttpGet<Array<{ id: string; type: string; webSocketDebuggerUrl?: string }>>(session.cdpPort, '/json');
        const refreshPage = refreshTargets.find(t => t.type === 'page');
        if (refreshPage) {
          const refreshWsUrl = refreshPage.webSocketDebuggerUrl || `ws://127.0.0.1:${session.cdpPort}/devtools/page/${refreshPage.id}`;
          const refreshWs = new WebSocket(refreshWsUrl);
          await new Promise<void>((resolve, reject) => {
            refreshWs.on('open', () => resolve());
            refreshWs.on('error', reject);
            setTimeout(() => reject(new Error('CDP WebSocket timeout')), 10000);
          });
          const refreshCdp = createCdpClient(refreshWs);
          await refreshCdp.send('Page.navigate', { url: 'https://www.kleinanzeigen.de/' });
          await sleep(3000);
          refreshWs.close();
          const freshCookies = await extractCookiesFromCDP(session.cdpPort);
          if (!isAccessTokenExpired(freshCookies)) {
            session.cookies = freshCookies;
            session.userId = userId;
            session.lastCookieRefresh = Date.now();
            session.status = 'ready';
            saveCookiesToDisk(workspace, freshCookies, userId);
            return session;
          }
        }
      } catch { /* refresh failed, fall through to full login */ }
    }

    // Need to log in — use the bot's login credentials
    session.status = 'logging_in';
    const mergedConfig = readMergedConfig(workspace);
    const loginSection = mergedConfig.login as { username?: string; password?: string } | undefined;
    const creds = (loginSection?.username && loginSection?.password)
      ? { username: loginSection.username, password: loginSection.password }
      : null;
    if (!creds) {
      session.status = 'error';
      session.error = 'Keine Login-Daten in der Konfiguration. Bitte config.yaml prüfen.';
      throw new Error(session.error);
    }

    // Open a fresh CDP WebSocket for the login flow
    const targets = await cdpHttpGet<Array<{ id: string; type: string; webSocketDebuggerUrl?: string }>>(session.cdpPort, '/json');
    const page = targets.find(t => t.type === 'page');
    if (!page) throw new Error('Kein Browser-Tab');

    const wsUrl = page.webSocketDebuggerUrl || `ws://127.0.0.1:${session.cdpPort}/devtools/page/${page.id}`;
    const ws = new WebSocket(wsUrl);
    await new Promise<void>((resolve, reject) => {
      ws.on('open', () => resolve());
      ws.on('error', reject);
      setTimeout(() => reject(new Error('CDP WebSocket timeout')), 10000);
    });

    const cdp = createCdpClient(ws);
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    // Stealth already registered via addScriptToEvaluateOnNewDocument above;
    // all future navigations in this browser process are covered
    await cdp.send('Page.navigate', { url: LOGIN_URL });
    await sleep(5000);

    // Dismiss GDPR consent banner before interacting with the form
    await dismissConsentBanner(cdp);

    // Fill credentials (email + optional password page)
    const loginResult = await fillLoginForm(cdp, creds.username, creds.password);
    if (!loginResult.success) {
      session.status = 'error';
      session.error = loginResult.error || 'Login fehlgeschlagen';
      try { ws.close(); } catch { /* fine */ }
      throw new Error(session.error);
    }

    // Determine where the login flow landed
    const state = await detectLoginState(cdp);
    if (state === 'mfa') {
      session.status = 'awaiting_mfa';
      session.cdpWs = ws;
      return session;
    }

    ws.close();

    // Re-extract cookies after login
    await sleep(3000);
    const freshCookies = await extractCookiesFromCDP(session.cdpPort);
    const freshUserId = await fetchUserId(freshCookies);

    if (!freshUserId) {
      // Check where we ended up
      session.status = 'error';
      session.error = 'Login fehlgeschlagen — Cookies ungültig nach Anmeldung.';
      throw new Error(session.error);
    }

    session.cookies = freshCookies;
    session.userId = freshUserId;
    session.lastCookieRefresh = Date.now();
    session.status = 'ready';
    saveCookiesToDisk(workspace, freshCookies, freshUserId);
    return session;
  } catch (err) {
    session.status = 'error';
    session.error = (err as Error).message;
    console.error('[messaging] Session start failed:', (err as Error).message);
    throw err;
  }
}

/**
 * Stop the persistent browser session (used for auth errors / manual stop).
 */
export function stopSession(workspace: string): void {
  const session = g.__msgSessions!.get(workspace);
  if (!session) return;
  if (session.proc) {
    try { session.proc.kill('SIGTERM'); } catch { /* fine */ }
  }
  if (session.cdpWs) {
    try { session.cdpWs.close(); } catch { /* fine */ }
  }
  g.__msgSessions!.delete(workspace);
}

/**
 * Immediately kill messaging browser so the bot CLI can use the shared profile.
 * Bot has ABSOLUTE priority — messaging is downgraded to browserless mode
 * where it retains cached cookies for API calls but cannot refresh them.
 */
export function stopForBot(workspace: string): void {
  const session = g.__msgSessions!.get(workspace);
  if (!session) {
    // No tracked session — but orphaned chromium might still be running
    // (e.g. after server restart where session tracking was lost)
    killOrphanedChromium(workspace);
    cleanBrowserProfile(workspace);
    return;
  }

  // Close CDP WebSocket if open
  if (session.cdpWs) {
    try { session.cdpWs.close(); } catch { /* fine */ }
    session.cdpWs = undefined;
  }

  // Kill browser process group (detached: true enables this)
  // process.kill(-pid) sends SIGKILL to the entire process group,
  // catching all Chromium helper processes (GPU, utility, renderer)
  if (session.proc) {
    const pid = session.proc.pid;
    session.proc = null;

    if (pid) {
      try { process.kill(-pid, 'SIGKILL'); } catch { /* group already gone */ }
    }
  }

  // Fallback: kill any remaining orphaned chromium using this profile
  killOrphanedChromium(workspace);

  // Remove stale lock files so the bot's browser can acquire the profile
  cleanBrowserProfile(workspace);

  // Preserve cookies in RAM, downgrade to browserless
  session.status = 'browserless';
  session.error = undefined;
}

/**
 * Restart messaging browser after bot finishes.
 * Uses dynamic import to avoid circular dependency with bot/queue.
 * If queue is still busy, does NOT restart yet — caller should retry later.
 */
export async function restartAfterBot(workspace: string): Promise<void> {
  const session = g.__msgSessions!.get(workspace);
  if (!session || session.status !== 'browserless') return;

  // Dynamic import to avoid circular dependency
  const { isQueueBusy } = await import('@/lib/bot/queue');
  if (isQueueBusy()) return;

  // Remove the browserless session so ensureSession starts fresh
  g.__msgSessions!.delete(workspace);

  // Re-establish browser session
  try {
    await ensureSession(workspace);
  } catch {
    // Session will be in error state — frontend can show the error
  }
}

/**
 * Restart ALL messaging sessions stuck in browserless mode.
 * Called when the global bot queue empties — handles multi-user:
 * jobs from different workspaces may have stopped different sessions.
 */
export async function restartAllBrowserless(): Promise<void> {
  const { isQueueBusy } = await import('@/lib/bot/queue');
  if (isQueueBusy()) return;

  const workspaces = [...(g.__msgSessions?.keys() ?? [])];
  for (const workspace of workspaces) {
    const session = g.__msgSessions!.get(workspace);
    if (session?.status === 'browserless') {
      await restartAfterBot(workspace);
    }
  }
}

/**
 * Submit MFA code to the messaging browser that is awaiting 2FA input.
 * Fills the code input, clicks submit, waits for redirect, extracts fresh cookies.
 */
export async function submitMessagingMfa(
  workspace: string,
  code: string,
): Promise<{ success: boolean; error?: string }> {
  const session = g.__msgSessions!.get(workspace);
  if (!session || session.status !== 'awaiting_mfa') {
    return { success: false, error: 'Keine aktive MFA-Session für Messaging.' };
  }

  const ws = session.cdpWs;
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    session.status = 'error';
    session.error = 'MFA-WebSocket nicht mehr verbunden.';
    return { success: false, error: session.error };
  }

  const cdp = createCdpClient(ws);

  try {
    // Fill the MFA code input via the shared helper
    const codeFilled = await fillInput(cdp, code, MFA_CODE_INPUT_SELECTOR);

    if (!codeFilled) {
      session.status = 'error';
      session.error = 'Code-Eingabefeld nicht gefunden. Bitte Messaging neu starten.';
      return { success: false, error: session.error };
    }

    await sleep(500);
    await cdp.evaluate(`document.querySelector('button[type="submit"], button[name="action"]')?.click()`);

    // Wait for redirect away from login page
    const success = await waitForCondition(async () => {
      const url = await cdp.evaluate('window.location.href') as string;
      return url.includes('kleinanzeigen.de') && !url.includes('login.kleinanzeigen.de');
    }, 30000);

    if (!success) {
      session.status = 'error';
      session.error = 'Login nach Code-Eingabe nicht erfolgreich — falscher Code?';
      try { ws.close(); } catch { /* fine */ }
      session.cdpWs = undefined;
      return { success: false, error: session.error };
    }

    // Close the CDP WebSocket used for MFA
    try { ws.close(); } catch { /* fine */ }
    session.cdpWs = undefined;

    // Extract fresh cookies and user ID
    await sleep(2000);
    const freshCookies = await extractCookiesFromCDP(session.cdpPort);
    const freshUserId = await fetchUserId(freshCookies);

    if (!freshUserId) {
      session.status = 'error';
      session.error = 'Cookies ungültig nach MFA-Login.';
      return { success: false, error: session.error };
    }

    session.cookies = freshCookies;
    session.userId = freshUserId;
    session.lastCookieRefresh = Date.now();
    session.status = 'ready';
    saveCookiesToDisk(workspace, freshCookies, freshUserId);
    return { success: true };
  } catch (err) {
    session.status = 'error';
    session.error = (err as Error).message;
    try { ws.close(); } catch { /* fine */ }
    session.cdpWs = undefined;
    return { success: false, error: session.error };
  }
}

/**
 * Get current session status for the frontend.
 */
export async function getMessagingStatus(workspace: string): Promise<{
  status: 'ready' | 'starting' | 'logging_in' | 'error' | 'not_started' | 'browserless' | 'awaiting_mfa';
  userId: number | null;
  error?: string;
}> {
  const existing = g.__msgSessions!.get(workspace);
  if (!existing) {
    return { status: 'not_started', userId: null };
  }
  return {
    status: existing.status,
    userId: existing.userId,
    error: existing.error,
  };
}

/**
 * Auto-start messaging session for all workspaces with a browser profile.
 * Called once at server startup (like initScheduler).
 */
export function initMessaging(): void {
  const botDir = process.env.BOT_DIR || process.cwd();
  const usersDir = path.join(botDir, 'users');

  // Collect workspaces that have messaging rules configured
  const workspaces: string[] = [];

  // Single-user mode: check root
  if (fs.existsSync(path.join(botDir, '.messaging-rules.yaml'))) {
    workspaces.push(botDir);
  }

  // Multi-user mode: check each user directory
  if (fs.existsSync(usersDir)) {
    for (const entry of fs.readdirSync(usersDir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        const ws = path.join(usersDir, entry.name);
        if (fs.existsSync(path.join(ws, '.messaging-rules.yaml'))) {
          workspaces.push(ws);
        }
      }
    }
  }

  if (workspaces.length === 0) return;

  // Only auto-start browser for workspaces with KI mode enabled
  // Other workspaces start on-demand when user opens /messages
  for (const ws of workspaces) {
    const rulesPath = path.join(ws, '.messaging-rules.yaml');
    try {
      const rules = yaml.load(fs.readFileSync(rulesPath, 'utf-8')) as Record<string, string>;
      if (rules.mode === 'auto' || rules.mode === 'review') {
        ensureSession(ws)
          .then(() => startResponder(ws, rules.mode as 'auto' | 'review'))
          .catch(() => {});
      }
    } catch { /* no config — skip, browser starts on-demand */ }
  }
}

// --- Gateway API methods ---

async function getSession(workspace: string): Promise<BrowserSession> {
  const session = await ensureSession(workspace);
  // Browserless mode still has cached cookies for API calls
  if ((session.status === 'ready' || session.status === 'browserless') && session.userId) {
    return session;
  }
  if (session.status === 'awaiting_mfa') {
    throw new Error('MFA erforderlich — Bitte den MFA-Code eingeben.');
  }
  throw new Error('Messaging-Session nicht bereit');
}

async function gatewayFetch(url: string, workspace: string, options?: RequestInit): Promise<Response> {
  const session = await getSession(workspace);

  // Extract access_token from cookies for Bearer auth
  const accessToken = session.cookies
    .split('; ')
    .find(c => c.startsWith('access_token='))
    ?.split('=')
    .slice(1)
    .join('=');

  const headers: Record<string, string> = {
    'Cookie': session.cookies,
    'Accept': 'application/json',
    'User-Agent': STEALTH_UA,
    ...(options?.headers as Record<string, string> || {}),
  };

  // Gateway API likely needs Bearer token
  if (accessToken) {
    headers['Authorization'] = `Bearer ${accessToken}`;
  }

  const response = await fetch(url, {
    ...options,
    headers,
  });

  if (response.status === 401 || response.status === 403) {
    stopSession(workspace);
    deleteCookiesFromDisk(workspace);
    throw new Error('Kleinanzeigen-Session abgelaufen. Seite neu laden zum Re-Login.');
  }

  if (!response.ok) {
    throw new Error(`Gateway API Fehler: ${response.status} ${response.statusText}`);
  }

  return response;
}

export async function listConversations(workspace: string, page = 0, size = 25): Promise<ConversationsResponse> {
  const session = await getSession(workspace);
  const response = await gatewayFetch(
    `${GATEWAY_BASE}/users/${session.userId}/conversations?page=${page}&size=${size}`,
    workspace,
  );
  return response.json();
}

export async function getConversation(workspace: string, conversationId: string): Promise<ConversationDetail> {
  const session = await getSession(workspace);
  const response = await gatewayFetch(
    `${GATEWAY_BASE}/users/${session.userId}/conversations/${encodeURIComponent(conversationId)}?warnPhoneNumber=true&warnEmail=true&warnBankDetails=true`,
    workspace,
  );
  return response.json();
}

export async function sendMessage(workspace: string, conversationId: string, text: string): Promise<unknown> {
  const session = await getSession(workspace);
  const response = await gatewayFetch(
    `${GATEWAY_BASE}/users/${session.userId}/conversations/${encodeURIComponent(conversationId)}?warnPhoneNumber=true&warnEmail=true&warnBankDetails=true`,
    workspace,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: text }),
    },
  );
  // 204 No Content = success, no body to parse
  if (response.status === 204) return { success: true };
  return response.json();
}
