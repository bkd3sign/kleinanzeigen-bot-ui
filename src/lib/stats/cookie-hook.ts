import fs from 'fs';
import path from 'path';
import WebSocket from 'ws';
import { type CdpClient, createCdpClient, cdpHttpGet, sleep } from '@/lib/browser/cdp';
import { detectLoginState } from '@/lib/browser/login';
import { fetchUserId, isAccessTokenExpired } from '@/lib/messaging/gateway';
import { SESSION_FILE } from '@/lib/ka/management-api';
export const MAX_WAIT_MS = 360_000;
const POLL_INTERVAL_MS = 1_500;
const MAX_ITERATIONS = Math.ceil(MAX_WAIT_MS / POLL_INTERVAL_MS);

async function connectToPage(cdpPort: number): Promise<{ client: CdpClient; close: () => void } | null> {
  try {
    const targets = await cdpHttpGet<Array<{ type: string; webSocketDebuggerUrl?: string; id: string }>>(
      cdpPort, '/json',
    );
    const page = targets.find(t => t.type === 'page');
    if (!page) return null;
    const wsUrl = page.webSocketDebuggerUrl ?? `ws://127.0.0.1:${cdpPort}/devtools/page/${page.id}`;
    const ws = new WebSocket(wsUrl);
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('WS open timeout')), 10_000);
      ws.once('open', () => { clearTimeout(timer); resolve(); });
      ws.once('error', (err) => { clearTimeout(timer); reject(err); });
    });
    return { client: createCdpClient(ws), close: () => ws.close() };
  } catch {
    return null;
  }
}

function saveSession(workspace: string, cookies: string, userId: number): void {
  const filePath = path.join(workspace, SESSION_FILE);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify({ cookies, userId, savedAt: Date.now() }), 'utf-8');
}

export async function hookCookiesAfterLogin(cdpPort: number, workspace: string): Promise<void> {
  let iterations = 0;

  while (iterations < MAX_ITERATIONS) {
    iterations++;
    try {
      const connection = await connectToPage(cdpPort);
      if (!connection) { await sleep(POLL_INTERVAL_MS); continue; }
      const { client, close } = connection;
      try {
        const state = await detectLoginState(client);
        if (state === 'logged_in') {
          const cookieResponse = await client.send('Network.getAllCookies');
          close();
          const allCookies = cookieResponse.result?.cookies ?? [];
          const cookies = allCookies
            .filter(c => c.domain.includes('kleinanzeigen.de'))
            .map(c => `${c.name}=${c.value}`)
            .join('; ');
          // No valid auth yet (incognito start or login not completed) — keep polling
          if (isAccessTokenExpired(cookies)) { await sleep(POLL_INTERVAL_MS); continue; }
          const userId = await fetchUserId(cookies);
          if (!userId) { await sleep(POLL_INTERVAL_MS); continue; }
          saveSession(workspace, cookies, userId);
          return;
        }
        close();
      } catch {
        close();
      }
    } catch { /* browser not ready yet */ }
    await sleep(POLL_INTERVAL_MS);
  }
}
