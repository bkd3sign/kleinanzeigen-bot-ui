import { spawn, ChildProcess } from 'child_process';
import fs from 'fs';
import path from 'path';
import WebSocket from 'ws';
import yaml from 'js-yaml';
import type { ConversationsResponse, ConversationDetail } from '@/types/message';
import { startResponder } from './responder';
import { prepareCleanBrowserState, detectBrowserBin, killOrphanedChromium, cleanBrowserProfile } from '@/lib/bot/browser-cleanup';

const GATEWAY_BASE = 'https://gateway.kleinanzeigen.de/messagebox/api';
const CDP_BASE_PORT = 9223;
const COOKIE_FILE = '.temp/messaging-cookies.json';

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

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Poll a condition function until it returns true or timeout expires.
 */
async function waitForCondition(check: () => Promise<boolean>, timeout: number): Promise<boolean> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try { if (await check()) return true; } catch { /* continue */ }
    await sleep(1000);
  }
  return false;
}


function readBotConfig(workspace: string): { username: string; password: string } | null {
  // Read merged config (same as bot runner does)
  for (const name of ['.bot-config.yaml', 'config.yaml']) {
    const configPath = path.join(workspace, name);
    if (fs.existsSync(configPath)) {
      const config = yaml.load(fs.readFileSync(configPath, 'utf-8')) as Record<string, unknown>;
      const login = config.login as { username?: string; password?: string } | undefined;
      if (login?.username && login?.password) {
        return { username: login.username, password: login.password };
      }
    }
  }

  // Check parent dir (single-user mode)
  const botDir = process.env.BOT_DIR || process.cwd();
  const rootConfig = path.join(botDir, 'config.yaml');
  if (fs.existsSync(rootConfig)) {
    const config = yaml.load(fs.readFileSync(rootConfig, 'utf-8')) as Record<string, unknown>;
    const login = config.login as { username?: string; password?: string } | undefined;
    if (login?.username && login?.password) {
      return { username: login.username, password: login.password };
    }
  }

  return null;
}

/**
 * Extract cookies from a running CDP browser.
 */
async function extractCookiesFromCDP(port: number): Promise<string> {
  const targetsRes = await fetch(`http://127.0.0.1:${port}/json`);
  const targets = await targetsRes.json() as Array<{ id: string; type: string; webSocketDebuggerUrl?: string }>;
  const page = targets.find(t => t.type === 'page');
  if (!page) throw new Error('No browser tab found');

  const wsUrl = page.webSocketDebuggerUrl || `ws://127.0.0.1:${port}/devtools/page/${page.id}`;
  const ws = new WebSocket(wsUrl);
  await new Promise<void>((resolve, reject) => {
    ws.on('open', resolve);
    ws.on('error', reject);
    setTimeout(() => reject(new Error('WS timeout')), 10000);
  });

  const cookieResponse = await new Promise<{
    id: number;
    result?: { cookies?: Array<{ name: string; value: string; domain: string }> };
  }>((resolve, reject) => {
    const id = 1;
    const handler = (data: WebSocket.Data) => {
      const msg = JSON.parse(data.toString());
      if (msg.id === id) { ws.off('message', handler); resolve(msg); }
    };
    ws.on('message', handler);
    ws.send(JSON.stringify({ id, method: 'Network.getAllCookies' }));
    setTimeout(() => reject(new Error('Cookie timeout')), 10000);
  });

  ws.close();

  const allCookies = cookieResponse.result?.cookies ?? [];
  return allCookies
    .filter(c => c.domain.includes('kleinanzeigen.de'))
    .map(c => `${c.name}=${c.value}`)
    .join('; ');
}

/**
 * Auto-detect user ID via profile API.
 */
async function fetchUserId(cookies: string): Promise<number | null> {
  try {
    const res = await fetch('https://www.kleinanzeigen.de/m-mein-profil.json', {
      headers: {
        'Cookie': cookies,
        'Accept': 'application/json',
        'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36',
      },
    });
    if (res.ok) {
      const profile = await res.json() as { userId?: string };
      if (profile.userId) return parseInt(profile.userId, 10);
    }
  } catch { /* profile fetch failed */ }
  return null;
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
      if (userId) {
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
      '--headless=new',
      '--no-sandbox',
      '--disable-gpu',
      '--disable-dev-shm-usage',
      `--remote-debugging-port=${session.cdpPort}`,
      '--remote-debugging-address=127.0.0.1',
      `--user-data-dir=${profileDir}`,
      'https://www.kleinanzeigen.de/m-nachrichten.html',
    ], { stdio: ['ignore', 'pipe', 'pipe'], detached: true });
    session.proc = proc;

    proc.on('exit', () => {
      const s = g.__msgSessions!.get(workspace);
      if (s === session && s.status !== 'browserless') {
        s.status = 'error';
        s.error = 'Browser-Prozess beendet';
      }
    });

    // Wait for CDP
    const deadline = Date.now() + 20000;
    while (Date.now() < deadline) {
      try {
        const res = await fetch(`http://127.0.0.1:${session.cdpPort}/json/version`);
        if (res.ok) break;
      } catch { /* retry */ }
      await sleep(500);
    }

    // Wait for page to load
    await sleep(3000);

    // Check if we need to log in
    const cookies = await extractCookiesFromCDP(session.cdpPort);
    const userId = await fetchUserId(cookies);

    if (userId) {
      // Already logged in from previous bot session
      session.cookies = cookies;
      session.userId = userId;
      session.lastCookieRefresh = Date.now();
      session.status = 'ready';
      saveCookiesToDisk(workspace, cookies, userId);
      return session;
    }

    // Need to log in — use the bot's login credentials
    session.status = 'logging_in';
    const creds = readBotConfig(workspace);
    if (!creds) {
      session.status = 'error';
      session.error = 'Keine Login-Daten in der Konfiguration. Bitte config.yaml prüfen.';
      throw new Error(session.error);
    }

    // Navigate to login page and fill credentials via CDP
    const targetsRes = await fetch(`http://127.0.0.1:${session.cdpPort}/json`);
    const targets = await targetsRes.json() as Array<{ id: string; type: string; webSocketDebuggerUrl?: string }>;
    const page = targets.find(t => t.type === 'page');
    if (!page) throw new Error('Kein Browser-Tab');

    const wsUrl = page.webSocketDebuggerUrl || `ws://127.0.0.1:${session.cdpPort}/devtools/page/${page.id}`;
    const ws = new WebSocket(wsUrl);
    await new Promise<void>((resolve, reject) => {
      ws.on('open', resolve);
      ws.on('error', reject);
    });

    const cdp = createCdpClient(ws);
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');

    // Navigate to login
    await cdp.send('Page.navigate', { url: 'https://www.kleinanzeigen.de/m-einloggen.html' });
    await sleep(5000);

    // Wait for Auth0 redirect
    let url = await cdp.evaluate('window.location.href') as string;
    if (url.includes('login.kleinanzeigen.de') || url.includes('m-einloggen')) {
      // Wait for login form
      await sleep(2000);

      // Fill email
      await cdp.evaluate(`
        (() => {
          const inputs = document.querySelectorAll('input');
          for (const input of inputs) {
            if (input.type === 'email' || input.name === 'username' || input.name === 'email') {
              input.focus(); input.value = '';
              return 'found';
            }
          }
          return 'not_found';
        })()
      `);
      await cdp.send('Input.insertText', { text: creds.username });
      await sleep(500);
      await cdp.evaluate(`document.querySelector('button[type="submit"], button[name="action"]')?.click()`);
      await sleep(4000);

      // Fill password
      url = await cdp.evaluate('window.location.href') as string;
      if (url.includes('/u/login/password') || url.includes('login.kleinanzeigen.de')) {
        await cdp.evaluate(`
          const pw = document.querySelector('input[type="password"], input[name="password"]');
          if (pw) { pw.focus(); pw.value = ''; }
        `);
        await cdp.send('Input.insertText', { text: creds.password });
        await sleep(500);
        await cdp.evaluate(`document.querySelector('button[type="submit"], button[name="action"]')?.click()`);
        await sleep(6000);
      }

      // Check for MFA — keep browser alive for code submission
      url = await cdp.evaluate('window.location.href') as string;
      if (url.includes('mfa') || url.includes('challenge') || url.includes('verification')) {
        session.status = 'awaiting_mfa';
        session.cdpWs = ws;
        return session;
      }
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
    throw err;
  }
}

function createCdpClient(ws: WebSocket) {
  let msgId = 0;
  const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();

  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString());
      if (msg.id !== undefined && pending.has(msg.id)) {
        pending.get(msg.id)!.resolve(msg);
        pending.delete(msg.id);
      }
    } catch { /* ignore */ }
  });

  return {
    send(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
      return new Promise((resolve, reject) => {
        const id = ++msgId;
        pending.set(id, { resolve, reject });
        ws.send(JSON.stringify({ id, method, params }));
        setTimeout(() => {
          if (pending.has(id)) { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }
        }, 15000);
      });
    },
    async evaluate(expression: string): Promise<unknown> {
      const resp = await this.send('Runtime.evaluate', { expression, returnByValue: true }) as {
        error?: { message: string };
        result?: { result?: { value?: unknown } };
      };
      if (resp.error) throw new Error(resp.error.message);
      return resp.result?.result?.value;
    },
  };
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
    // Find and fill the MFA code input
    const codeFilled = await cdp.evaluate(`
      (() => {
        const selectors = ['input[name="code"]', 'input[inputmode="numeric"]', 'input[autocomplete="one-time-code"]', 'input[type="tel"]'];
        for (const sel of selectors) {
          const input = document.querySelector(sel);
          if (input && input.offsetParent !== null) {
            input.focus(); input.value = '';
            return 'found';
          }
        }
        return 'not_found';
      })()
    `) as string;

    if (codeFilled !== 'found') {
      session.status = 'error';
      session.error = 'Code-Eingabefeld nicht gefunden. Bitte Messaging neu starten.';
      return { success: false, error: session.error };
    }

    await cdp.send('Input.insertText', { text: code });
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
    'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36',
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
    // Session expired — purge both in-memory session AND disk cookies
    // so ensureSession doesn't re-use the same stale credentials
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
