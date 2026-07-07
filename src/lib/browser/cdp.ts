import WebSocket from 'ws';

interface CdpResponse {
  id: number;
  result?: {
    result?: { value?: unknown };
    targetId?: string;
    cookies?: Array<{ name: string; value: string; domain: string }>;
  };
  error?: { message: string };
}

export interface CdpClient {
  send(method: string, params?: Record<string, unknown>): Promise<CdpResponse>;
  evaluate(expression: string): Promise<unknown>;
}

const CDP_SEND_TIMEOUT_MS = 15000;
const CDP_HTTP_DEFAULT_TIMEOUT_MS = 20000;
const COOKIE_FETCH_TIMEOUT_MS = 10000;
const WS_OPEN_TIMEOUT_MS = 10000;

export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Poll a condition function until it returns true or timeout expires.
 * Polls every 500ms; swallows thrown errors from the check function.
 */
export async function waitForCondition(check: () => Promise<boolean>, timeout: number): Promise<boolean> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try {
      if (await check()) return true;
    } catch {
      // transient errors are swallowed and retried
    }
    await sleep(500);
  }
  return false;
}

/**
 * Wrap a CDP WebSocket with a request/response client.
 */
export function createCdpClient(ws: WebSocket): CdpClient {
  let msgId = 0;
  const pending = new Map<number, { resolve: (v: CdpResponse) => void; reject: (e: Error) => void }>();

  ws.on('message', (data: WebSocket.RawData) => {
    try {
      const msg = JSON.parse(data.toString()) as CdpResponse;
      if (msg.id !== undefined && pending.has(msg.id)) {
        pending.get(msg.id)!.resolve(msg);
        pending.delete(msg.id);
      }
    } catch {
      // ignore malformed CDP messages
    }
  });

  const client: CdpClient = {
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
        }, CDP_SEND_TIMEOUT_MS);
      });
    },
    async evaluate(expression: string): Promise<unknown> {
      const resp = await client.send('Runtime.evaluate', { expression, returnByValue: true });
      if (resp.error) throw new Error(resp.error.message);
      return resp.result?.result?.value;
    },
  };

  return client;
}

/**
 * Wait until the Chromium DevTools HTTP endpoint is reachable.
 */
export async function waitForCdp(
  port: number,
  timeout: number = CDP_HTTP_DEFAULT_TIMEOUT_MS,
  shouldAbort?: () => Error | null,
): Promise<void> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    // Bail out early (e.g. a required binary failed to spawn) instead of polling until
    // the full timeout. If shouldAbort returns an Error, throw it.
    const abortErr = shouldAbort?.();
    if (abortErr) throw abortErr;
    try {
      await cdpHttpGet(port, '/json/version');
      return;
    } catch {
      await sleep(500);
    }
  }
  throw new Error('Chromium CDP nicht erreichbar');
}

/**
 * Fetch a JSON response from the Chromium DevTools HTTP endpoint.
 */
export async function cdpHttpGet<T>(port: number, urlPath: string): Promise<T> {
  const res = await fetch(`http://127.0.0.1:${port}${urlPath}`);
  if (!res.ok) throw new Error(`CDP HTTP ${res.status}`);
  return res.json() as Promise<T>;
}

/**
 * Open a CDP WebSocket to the first page target of a running Chromium.
 * Shared by cookie extraction, credential insertion, and the messaging gateway.
 * Throws 'No browser tab found' if the browser has no page target.
 */
export async function openPageSocket(port: number): Promise<WebSocket> {
  const targets = await cdpHttpGet<Array<{ id: string; type: string; webSocketDebuggerUrl?: string }>>(port, '/json');
  const page = targets.find(t => t.type === 'page');
  if (!page) throw new Error('No browser tab found');

  const wsUrl = page.webSocketDebuggerUrl || `ws://127.0.0.1:${port}/devtools/page/${page.id}`;
  const ws = new WebSocket(wsUrl);
  await new Promise<void>((resolve, reject) => {
    ws.on('open', () => resolve());
    ws.on('error', reject);
    setTimeout(() => reject(new Error('WS timeout')), WS_OPEN_TIMEOUT_MS);
  });
  return ws;
}

/**
 * Type text into the currently focused input of a running Chromium via CDP.
 * Used by the VNC login flow so the user can paste credentials (Cmd/Ctrl+V or
 * the fallback field) into the remote browser — the clipboard never touches KA.
 */
export async function insertTextIntoBrowser(port: number, text: string): Promise<void> {
  const ws = await openPageSocket(port);
  try {
    const client = createCdpClient(ws);
    const resp = await client.send('Input.insertText', { text });
    if (resp.error) throw new Error(resp.error.message);
  } finally {
    try { ws.close(); } catch { /* fine */ }
  }
}

/**
 * List the IDs of all page targets (browser tabs), in CDP's most-recently-active order
 * (index 0 = the tab currently shown on the Xvnc kiosk display).
 */
export async function listPageTargetIds(port: number): Promise<string[]> {
  const targets = await cdpHttpGet<Array<{ id: string; type: string }>>(port, '/json');
  return targets.filter(t => t.type === 'page').map(t => t.id);
}

/**
 * Collapse the browser to a single tab, keeping the most-recently-active one (index 0).
 *
 * The VNC profile uses restore_on_startup=1 to persist the warm login session across
 * restarts — but that also reopens every tab from the previous run, so they pile up (a
 * fresh start can show a dozen stale login tabs). Closing the extra tabs does NOT drop the
 * session cookies (those live in the cookie store, not the tabs), so the warm login is
 * preserved while the kiosk view and the bot's tab handling stay clean. Called once when a
 * fresh VNC session becomes ready, before any bot attaches.
 */
export async function collapseToSingleTab(port: number): Promise<void> {
  let ids: string[];
  try {
    ids = await listPageTargetIds(port);
  } catch {
    return;
  }
  for (const id of ids.slice(1)) {
    await fetch(`http://127.0.0.1:${port}/json/close/${id}`).catch(() => {});
  }
}

/**
 * Bring the bot's own tab to the foreground of the (kiosk) display.
 *
 * The Xvnc kiosk shows whatever tab is most-recently-activated (CDP /json index 0).
 * nodriver drives its tab over CDP WITHOUT activating it, so the initial KA_START_URL tab
 * the VNC browser launched with stays in front while the bot works in a background tab — a
 * user clicking "Chrome öffnen" then only sees the login page. `initialIds` are the tab IDs
 * that existed before the bot attached; any newer page target is the bot's. If an initial
 * tab is in front while a bot tab exists, activate the bot's most-recent tab so the user
 * sees where the bot actually is. No-op once a bot tab is already in front, so it never
 * fights a tab the bot itself brought forward.
 */
export async function focusBotTab(port: number, initialIds: Set<string>): Promise<void> {
  let targets: Array<{ id: string; type: string }>;
  try {
    targets = await cdpHttpGet(port, '/json');
  } catch {
    return; // browser gone / transient — nothing to do
  }
  const pages = targets.filter(t => t.type === 'page');
  if (pages.length === 0) return;
  const botTabs = pages.filter(t => !initialIds.has(t.id));
  if (botTabs.length === 0) return;          // bot has not opened its own tab yet
  if (!initialIds.has(pages[0].id)) return;  // a bot tab is already in front → leave it
  // /json/activate returns plain text ("Target activated"), so don't parse it as JSON.
  await fetch(`http://127.0.0.1:${port}/json/activate/${botTabs[0].id}`).catch(() => {});
}

/**
 * Connect to a running Chromium via CDP and extract Kleinanzeigen cookies.
 */
export async function extractCookiesFromCDP(port: number): Promise<string> {
  const ws = await openPageSocket(port);

  try {
    const cookieResponse = await new Promise<CdpResponse>((resolve, reject) => {
      const id = 1;
      const handler = (data: WebSocket.RawData): void => {
        try {
          const msg = JSON.parse(data.toString()) as CdpResponse;
          if (msg.id === id) {
            ws.off('message', handler);
            resolve(msg);
          }
        } catch {
          // ignore malformed messages
        }
      };
      ws.on('message', handler);
      ws.send(JSON.stringify({ id, method: 'Network.getAllCookies' }));
      setTimeout(() => reject(new Error('Cookie timeout')), COOKIE_FETCH_TIMEOUT_MS);
    });

    const allCookies = cookieResponse.result?.cookies ?? [];
    return allCookies
      .filter(c => c.domain.includes('kleinanzeigen.de'))
      .map(c => `${c.name}=${c.value}`)
      .join('; ');
  } finally {
    try { ws.close(); } catch { /* fine */ }
  }
}
