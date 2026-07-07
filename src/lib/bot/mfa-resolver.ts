import { spawn, ChildProcess } from 'child_process';
import path from 'path';
import WebSocket from 'ws';
import { readMergedConfig } from '@/lib/yaml/config';
import { ensureProfileFreeForLaunch, detectBrowserBin } from '@/lib/bot/browser-cleanup';
import { isQueueBusy } from '@/lib/bot/queue';
import { jobs } from '@/lib/bot/jobs';
import { jobStdins } from '@/lib/bot/runner';
import {
  type CdpClient,
  createCdpClient,
  cdpHttpGet,
  waitForCdp,
  waitForCondition,
  sleep,
} from '@/lib/browser/cdp';
import { STEALTH_ARGS, injectStealthScript } from '@/lib/browser/stealth';
import {
  LOGIN_URL,
  MFA_CODE_INPUT_SELECTOR,
  dismissConsentBanner,
  fillLoginForm,
  fillInput,
  detectLoginState,
} from '@/lib/browser/login';

const CDP_PORT = 9222;


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
  // Don't start MFA while bot is using the shared browser profile
  if (isQueueBusy()) {
    return { success: false, error: 'Bot läuft gerade — MFA nach Abschluss erneut versuchen.' };
  }

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

  // Kill any Chromium holding the shared profile and POLL until the SingletonLock is released
  // before spawning. isQueueBusy() above rules out the bot, but a live messaging browser can
  // still hold the same profile — without this wait the MFA browser races the lock and fails.
  await ensureProfileFreeForLaunch(workspace, { fullWipe: true });

  const browserBin = detectBrowserBin();

  const proc = spawn(browserBin, [
    ...STEALTH_ARGS,
    '--headless=new',
    '--no-sandbox',
    '--disable-gpu',
    `--remote-debugging-port=${CDP_PORT}`,
    '--remote-debugging-address=127.0.0.1',
    `--user-data-dir=${profileDir}`,
    'about:blank',
  ], { stdio: ['ignore', 'pipe', 'pipe'] });

  try {
    await waitForCdp(CDP_PORT, 15000);

    const targets = await cdpHttpGet<{ id: string; url: string; type: string; webSocketDebuggerUrl?: string }[]>(CDP_PORT, '/json');
    const page = targets.find(t => t.type === 'page');
    if (!page) throw new Error('Kein Browser-Tab gefunden');

    const ws = new WebSocket(page.webSocketDebuggerUrl || `ws://127.0.0.1:${CDP_PORT}/devtools/page/${page.id}`);
    await new Promise<void>((resolve, reject) => {
      ws.on('open', () => resolve());
      ws.on('error', reject);
      setTimeout(() => reject(new Error('CDP WebSocket timeout')), 10000);
    });

    const cdp = createCdpClient(ws);
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await injectStealthScript(cdp);
    await cdp.send('Page.navigate', { url: LOGIN_URL });
    await sleep(4000);

    // Dismiss GDPR consent banner before interacting with the form
    await dismissConsentBanner(cdp);

    // Fill credentials (email + optional password page)
    const loginResult = await fillLoginForm(cdp, login.username, login.password);
    if (!loginResult.success) {
      try { ws.close(); } catch { /* fine */ }
      proc.kill('SIGTERM');
      return { success: false, error: loginResult.error || 'Login fehlgeschlagen' };
    }

    // Determine where the login flow landed
    const state = await detectLoginState(cdp);

    if (state === 'mfa') {
      mfaSessions.set(jobId, { proc, ws, cdp, workspace, createdAt: Date.now() });
      return { success: true };
    }

    if (state === 'logged_in') {
      ws.close();
      proc.kill('SIGTERM');
      return { success: true };
    }

    const url = await cdp.evaluate('window.location.href') as string;
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
    return { success: false, error: 'Keine aktive MFA-Session. Bitte „Neuen Code anfordern" klicken.' };
  }

  const { cdp } = session;

  try {
    const codeFilled = await fillInput(cdp, smsCode, MFA_CODE_INPUT_SELECTOR);

    if (!codeFilled) {
      return { success: false, error: 'Code-Eingabefeld nicht mehr gefunden. Bitte neu starten.' };
    }

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

/**
 * Submit MFA code via CDP into the Chrome that the bot opened.
 * Works for two cases:
 *  - Bot still running (status=running): Chrome is live, bot waits at ainput() → inject code + send \n to stdin
 *  - Bot crashed at MFA (status=mfa_required): Chrome was kept alive by runner → inject code, no stdin needed
 */
export async function submitMfaToRunningBot(
  jobId: string,
  smsCode: string,
): Promise<{ success: boolean; error?: string }> {
  const job = jobs.get(jobId);
  if (!job?.cdp_port) {
    return { success: false, error: 'Kein CDP-Port verfügbar' };
  }

  // stdin only needed to unblock ainput() when bot is still running
  const stdin = jobStdins.get(jobId);

  let ws: WebSocket | null = null;

  try {
    // Connect to the bot's Chrome
    const targets = await cdpHttpGet<Array<{ id: string; type: string; webSocketDebuggerUrl?: string }>>(job.cdp_port, '/json');
    const page = targets.find(t => t.type === 'page');
    if (!page) throw new Error('Kein Browser-Tab gefunden');

    ws = new WebSocket(page.webSocketDebuggerUrl || `ws://127.0.0.1:${job.cdp_port}/devtools/page/${page.id}`);
    await new Promise<void>((resolve, reject) => {
      ws!.on('open', () => resolve());
      ws!.on('error', reject);
      setTimeout(() => reject(new Error('WebSocket-Timeout')), 10000);
    });

    const cdp = createCdpClient(ws);

    // Find and fill the MFA code input on the Kleinanzeigen page
    const codeFilled = await fillInput(cdp, smsCode, MFA_CODE_INPUT_SELECTOR);

    if (!codeFilled) {
      ws.close();
      return { success: false, error: 'Code-Eingabefeld nicht gefunden — Bot evtl. nicht auf MFA-Seite' };
    }

    await sleep(500);
    await cdp.evaluate(`document.querySelector('button[type="submit"], button[name="action"]')?.click()`);

    // Wait for navigation away from the login page
    const success = await waitForCondition(async () => {
      const url = await cdp.evaluate('window.location.href') as string;
      return url.includes('kleinanzeigen.de') && !url.includes('login.kleinanzeigen.de');
    }, 30000);

    ws.close();

    if (!success) {
      return { success: false, error: 'Login nach Code-Eingabe nicht erfolgreich — falscher Code?' };
    }

    // Unblock ainput() if bot is still running
    if (stdin && !stdin.destroyed) {
      try { stdin.write('\n'); } catch { /* fine */ }
    }

    if (job) job.mfa_required = false;
    return { success: true };
  } catch (err) {
    if (ws) try { ws.close(); } catch { /* fine */ }
    return { success: false, error: (err as Error).message };
  }
}
