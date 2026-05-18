import WebSocket from 'ws';

export interface CdpResponse {
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
export async function waitForCdp(port: number, timeout: number = CDP_HTTP_DEFAULT_TIMEOUT_MS): Promise<void> {
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

/**
 * Fetch a JSON response from the Chromium DevTools HTTP endpoint.
 */
export async function cdpHttpGet<T>(port: number, urlPath: string): Promise<T> {
  const res = await fetch(`http://127.0.0.1:${port}${urlPath}`);
  if (!res.ok) throw new Error(`CDP HTTP ${res.status}`);
  return res.json() as Promise<T>;
}

/**
 * Connect to a running Chromium via CDP and extract Kleinanzeigen cookies.
 */
export async function extractCookiesFromCDP(port: number): Promise<string> {
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
