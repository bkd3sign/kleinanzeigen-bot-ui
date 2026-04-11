import { spawn, ChildProcess } from 'child_process';
import path from 'path';
import WebSocket from 'ws';
import { readMergedConfig } from '@/lib/yaml/config';
import { prepareCleanBrowserState, detectBrowserBin } from '@/lib/bot/browser-cleanup';

const LOGIN_URL = 'https://www.kleinanzeigen.de/m-einloggen.html';
const CDP_PORT = 9222;
const STEP_TIMEOUT = 15000;

interface CdpResponse {
  id: number;
  result?: { result?: { value?: unknown }; targetId?: string };
  error?: { message: string };
}

interface CdpClient {
  send(method: string, params?: Record<string, unknown>): Promise<CdpResponse>;
  evaluate(expression: string): Promise<unknown>;
}

interface MfaSession {
  proc: ChildProcess;
  ws: WebSocket;
  cdp: CdpClient;
  workspace: string;
  createdAt: number;
}

// Persist MFA session across API calls via globalThis
const globalMfa = globalThis as unknown as { __mfaSessions?: Map<string, MfaSession> };
if (!globalMfa.__mfaSessions) globalMfa.__mfaSessions = new Map();
const mfaSessions = globalMfa.__mfaSessions;

const SESSION_TTL = 5 * 60 * 1000;

function cleanupSession(jobId: string): void {
  const session = mfaSessions.get(jobId);
  if (!session) return;
  try { session.ws.close(); } catch { /* fine */ }
  setTimeout(() => {
    try { session.proc.kill('SIGTERM'); } catch { /* fine */ }
    setTimeout(() => { try { session.proc.kill('SIGKILL'); } catch { /* fine */ } }, 3000);
  }, 2000);
  mfaSessions.delete(jobId);
}


/**
 * Phase 1: Start login flow up to MFA page. Browser stays running.
 */
export async function prepareMfaSession(
  workspace: string,
  jobId: string,
): Promise<{ success: boolean; error?: string }> {
  cleanupSession(jobId);

  // Cleanup stale sessions
  for (const [id, s] of mfaSessions) {
    if (Date.now() - s.createdAt > SESSION_TTL) cleanupSession(id);
  }

  const config = readMergedConfig(workspace);
  const login = config.login as { username?: string; password?: string } | undefined;
  if (!login?.username || !login?.password) {
    return { success: false, error: 'Login-Daten nicht in der Konfiguration gefunden' };
  }

  const profileDir = path.join(workspace, '.temp', 'browser-profile');

  // Kill orphaned chromium + clean stale profile files
  prepareCleanBrowserState(workspace);

  const browserBin = detectBrowserBin();

  const proc = spawn(browserBin, [
    '--headless=new',
    '--no-sandbox',
    '--disable-gpu',
    '--disable-dev-shm-usage',
    `--remote-debugging-port=${CDP_PORT}`,
    '--remote-debugging-address=127.0.0.1',
    `--user-data-dir=${profileDir}`,
    LOGIN_URL,
  ], { stdio: ['ignore', 'pipe', 'pipe'] });

  try {
    await waitForCdp(CDP_PORT);

    const targets = await cdpHttpGet<{ id: string; url: string; type: string; webSocketDebuggerUrl?: string }[]>(CDP_PORT, '/json');
    const page = targets.find(t => t.type === 'page');
    if (!page) throw new Error('Kein Browser-Tab gefunden');

    const ws = new WebSocket(page.webSocketDebuggerUrl || `ws://127.0.0.1:${CDP_PORT}/devtools/page/${page.id}`);
    await new Promise<void>((resolve, reject) => {
      ws.on('open', resolve);
      ws.on('error', reject);
    });

    const cdp = createCdpClient(ws);
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await sleep(4000);

    // Step 1: Enter email
    let url = await cdp.evaluate('window.location.href') as string;

    if (url.includes('m-einloggen') || url.includes('/u/login/identifier') || url.includes('m-einloggen-sso')) {
      await waitForCondition(async () => {
        url = await cdp.evaluate('window.location.href') as string;
        return url.includes('login.kleinanzeigen.de');
      }, 10000);
      await sleep(2000);

      const emailFilled = await cdp.evaluate(`
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
      `) as string;

      if (emailFilled !== 'found') throw new Error('E-Mail-Feld nicht gefunden');

      await cdp.send('Input.insertText', { text: login.username });
      await sleep(500);
      await cdp.evaluate(`document.querySelector('button[type="submit"], button[name="action"]')?.click()`);
      await sleep(4000);
    }

    // Step 2: Enter password
    url = await cdp.evaluate('window.location.href') as string;
    if (url.includes('/u/login/password')) {
      await cdp.evaluate(`
        const pw = document.querySelector('input[type="password"], input[name="password"]');
        if (pw) { pw.focus(); pw.value = ''; }
      `);
      await cdp.send('Input.insertText', { text: login.password });
      await sleep(500);
      await cdp.evaluate(`document.querySelector('button[type="submit"], button[name="action"]')?.click()`);
      await sleep(6000);
    }

    // Check if we reached MFA
    url = await cdp.evaluate('window.location.href') as string;

    if (url.includes('mfa') || url.includes('challenge') || url.includes('verification')) {
      mfaSessions.set(jobId, { proc, ws, cdp, workspace, createdAt: Date.now() });
      return { success: true };
    }

    // Already logged in
    if (url.includes('kleinanzeigen.de') && !url.includes('login.')) {
      ws.close();
      proc.kill('SIGTERM');
      return { success: true };
    }

    throw new Error(`Unerwartete Seite: ${url}`);
  } catch (err) {
    proc.kill('SIGTERM');
    return { success: false, error: (err as Error).message };
  }
}

/**
 * Phase 2: Submit SMS code to the already-open MFA page.
 */
export async function submitMfaCode(
  jobId: string,
  smsCode: string,
): Promise<{ success: boolean; error?: string }> {
  const session = mfaSessions.get(jobId);
  if (!session) {
    return { success: false, error: 'Keine aktive MFA-Session. Bitte erst „Login starten" klicken.' };
  }

  const { cdp } = session;

  try {
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
      return { success: false, error: 'Code-Eingabefeld nicht mehr gefunden. Bitte neu starten.' };
    }

    await cdp.send('Input.insertText', { text: smsCode });
    await sleep(500);
    await cdp.evaluate(`document.querySelector('button[type="submit"], button[name="action"]')?.click()`);

    const success = await waitForCondition(async () => {
      const url = await cdp.evaluate('window.location.href') as string;
      return url.includes('kleinanzeigen.de') && !url.includes('login.kleinanzeigen.de');
    }, 30000);

    cleanupSession(jobId);

    if (success) return { success: true };
    return { success: false, error: 'Login nach Code-Eingabe nicht erfolgreich — falscher Code?' };
  } catch (err) {
    cleanupSession(jobId);
    return { success: false, error: (err as Error).message };
  }
}

// --- CDP Helpers ---

function createCdpClient(ws: WebSocket): CdpClient {
  let msgId = 0;
  const pending = new Map<number, { resolve: (v: CdpResponse) => void; reject: (e: Error) => void }>();

  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString()) as CdpResponse;
      if (msg.id !== undefined && pending.has(msg.id)) {
        pending.get(msg.id)!.resolve(msg);
        pending.delete(msg.id);
      }
    } catch { /* ignore */ }
  });

  return {
    send(method: string, params: Record<string, unknown> = {}): Promise<CdpResponse> {
      return new Promise((resolve, reject) => {
        const id = ++msgId;
        pending.set(id, { resolve, reject });
        ws.send(JSON.stringify({ id, method, params }));
        setTimeout(() => {
          if (pending.has(id)) {
            pending.delete(id);
            reject(new Error(`CDP timeout: ${method}`));
          }
        }, STEP_TIMEOUT);
      });
    },
    async evaluate(expression: string): Promise<unknown> {
      const resp = await this.send('Runtime.evaluate', { expression, returnByValue: true });
      if (resp.error) throw new Error(resp.error.message);
      return resp.result?.result?.value;
    },
  };
}

async function waitForCdp(port: number, timeout = 15000): Promise<void> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try {
      await cdpHttpGet(port, '/json/version');
      return;
    } catch {
      await sleep(500);
    }
  }
  throw new Error('Chromium CDP nicht erreichbar');
}

async function cdpHttpGet<T>(port: number, urlPath: string): Promise<T> {
  const res = await fetch(`http://127.0.0.1:${port}${urlPath}`);
  if (!res.ok) throw new Error(`CDP HTTP ${res.status}`);
  return res.json() as Promise<T>;
}

async function waitForCondition(check: () => Promise<boolean>, timeout: number): Promise<boolean> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try { if (await check()) return true; } catch { /* continue */ }
    await sleep(1000);
  }
  return false;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
