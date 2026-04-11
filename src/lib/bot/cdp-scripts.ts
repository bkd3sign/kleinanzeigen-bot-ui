/**
 * CDP Script Injection for Browser Extensions
 *
 * Chrome extensions don't work with nodriver/CDP automation (--test-type flag
 * disables extension loading). This module injects JavaScript fixes directly
 * via Chrome DevTools Protocol.
 *
 * Strategy: Connect to browser-level WebSocket, auto-attach to all targets,
 * listen for Page.frameNavigated events, and inject scripts after each navigation.
 * The WebSocket stays open for the lifetime of the bot process.
 *
 * Scripts are loaded from the `extensions/` directory and configured via
 * `extensions.yaml` in the project root.
 */

import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import WebSocket from 'ws';

const BOT_DIR = process.env.BOT_DIR || process.cwd();
const EXTENSIONS_DIR = path.join(BOT_DIR, 'extensions');
const EXTENSIONS_CONFIG = path.join(BOT_DIR, 'extensions.yaml');

interface ExtensionEntry {
  name: string;
  file: string;
  enabled: boolean;
  description?: string;
}

const EXTENSIONS_YAML_TEMPLATE = `# Browser Extensions (CDP Script Injection)
#
# Temporary JavaScript fixes injected into Chrome via DevTools Protocol.
# These work around bugs in the kleinanzeigen-bot's browser automation
# until the upstream bot is fixed.
#
# To add a fix:  place a .js file in extensions/ and add an entry below.
# To disable:    set enabled: false
# To remove:     delete the entry and the .js file
#
# extensions:
#   - name: Shipping Dialog Fix
#     file: shipping-dialog-fix.js
#     enabled: true
#     description: >
#       Fixes broken element selectors in the shipping dialog after
#       Kleinanzeigen's 2026 site redesign.

extensions: []
`;

/**
 * Create extensions/ directory and extensions.yaml template if they don't exist.
 * Called during /setup to initialize the extension system.
 */
export function ensureExtensionsDir(): void {
  if (!fs.existsSync(EXTENSIONS_DIR)) {
    fs.mkdirSync(EXTENSIONS_DIR, { recursive: true });
  }
  if (!fs.existsSync(EXTENSIONS_CONFIG)) {
    fs.writeFileSync(EXTENSIONS_CONFIG, EXTENSIONS_YAML_TEMPLATE, 'utf-8');
  }
}

/**
 * Read extensions.yaml and return list of enabled scripts.
 */
function getEnabledScripts(): Array<{ name: string; source: string }> {
  if (!fs.existsSync(EXTENSIONS_CONFIG)) return [];

  let raw: { extensions?: ExtensionEntry[] } | null;
  try {
    raw = yaml.load(fs.readFileSync(EXTENSIONS_CONFIG, 'utf-8')) as typeof raw;
  } catch {
    return [];
  }

  if (!raw?.extensions) return [];

  const scripts: Array<{ name: string; source: string }> = [];
  for (const ext of raw.extensions) {
    if (!ext.enabled || !ext.file || !ext.name) continue;

    const filePath = path.resolve(EXTENSIONS_DIR, ext.file);
    if (!filePath.startsWith(EXTENSIONS_DIR)) continue;
    if (!fs.existsSync(filePath)) {
      console.warn(`[cdp-scripts] Extension "${ext.name}" not found: ${filePath}`);
      continue;
    }

    scripts.push({
      name: ext.name,
      source: fs.readFileSync(filePath, 'utf-8'),
    });
  }

  return scripts;
}

/**
 * Wait for Chrome to start and expose its CDP endpoint.
 */
async function waitForCDP(port: number, timeoutMs = 30_000): Promise<string | null> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (res.ok) {
        const data = await res.json() as { webSocketDebuggerUrl?: string };
        return data.webSocketDebuggerUrl ?? null;
      }
    } catch {
      // Chrome not ready yet
    }
    await new Promise(r => setTimeout(r, 500));
  }
  return null;
}

/**
 * Inject scripts into a target session via CDP.
 */
function injectIntoSession(
  ws: WebSocket,
  sessionId: string,
  scripts: Array<{ name: string; source: string }>,
  msgIdRef: { value: number },
): void {
  for (const script of scripts) {
    // Register for future same-tab navigations
    ws.send(JSON.stringify({
      id: msgIdRef.value++,
      method: 'Page.addScriptToEvaluateOnNewDocument',
      params: { source: script.source },
      sessionId,
    }));
    // Inject on current page immediately
    ws.send(JSON.stringify({
      id: msgIdRef.value++,
      method: 'Runtime.evaluate',
      params: { expression: script.source },
      sessionId,
    }));
  }
}

/**
 * Connect to Chrome browser WebSocket and keep injecting scripts on every
 * navigation and new tab. The connection stays open until Chrome exits.
 */
async function startInjectionLoop(
  browserWsUrl: string,
  scripts: Array<{ name: string; source: string }>,
  log?: (msg: string) => void,
): Promise<void> {
  return new Promise((resolve) => {
    const ws = new WebSocket(browserWsUrl);
    const msgId = { value: 1 };
    const activeSessions = new Set<string>();

    ws.on('error', () => resolve());

    ws.on('close', () => resolve());

    ws.on('open', () => {
      // Auto-attach to all current and future targets
      ws.send(JSON.stringify({
        id: msgId.value++,
        method: 'Target.setAutoAttach',
        params: { autoAttach: true, waitForDebuggerOnStart: false, flatten: true },
      }));

      // Also discover existing targets
      ws.send(JSON.stringify({
        id: msgId.value++,
        method: 'Target.setDiscoverTargets',
        params: { discover: true },
      }));

      log?.(`[EXT]  ${scripts.map(s => s.name).join(', ')} loaded\n`);

      // Resolve immediately — the WS stays open in background
      resolve();
    });

    ws.on('message', (data) => {
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(data.toString());
      } catch { return; }

      const method = msg.method as string | undefined;
      const params = msg.params as Record<string, unknown> | undefined;

      // New target attached — inject scripts and enable Page events
      if (method === 'Target.attachedToTarget' && params) {
        const sessionId = params.sessionId as string;
        const targetInfo = params.targetInfo as { type?: string; url?: string } | undefined;

        if (sessionId && targetInfo?.type === 'page') {
          activeSessions.add(sessionId);

          // Enable Page domain to get frameNavigated events
          ws.send(JSON.stringify({
            id: msgId.value++,
            method: 'Page.enable',
            sessionId,
          }));

          // Inject now if it's a kleinanzeigen page
          if (targetInfo.url?.includes('kleinanzeigen.de')) {
            injectIntoSession(ws, sessionId, scripts, msgId);
          }
        }
      }

      // Page navigated — re-inject scripts
      if (method === 'Target.receivedMessageFromTarget' && params) {
        // Flattened sessions deliver events directly with sessionId
      }

      // Frame navigated within an attached session (flattened mode)
      if (msg.sessionId && method === 'Page.frameNavigated' && params) {
        const sessionId = msg.sessionId as string;
        const frame = params.frame as { url?: string; parentId?: string } | undefined;

        // Only inject on top-level frame navigations to kleinanzeigen
        if (frame && !frame.parentId && frame.url?.includes('kleinanzeigen.de')) {
          // Small delay to ensure document is ready for script evaluation
          setTimeout(() => {
            injectIntoSession(ws, sessionId, scripts, msgId);
          }, 100);
        }
      }

      // Target destroyed — clean up session
      if (method === 'Target.detachedFromTarget' && params) {
        activeSessions.delete(params.sessionId as string);
      }
    });
  });
}

/**
 * Extract the Chrome debug port from bot process output.
 * The bot logs: "Neue Browser-Sitzung ist ws://127.0.0.1:<port>/devtools/..."
 */
export function extractCDPPort(output: string): number | null {
  const match = output.match(/ws:\/\/127\.0\.0\.1:(\d+)\/devtools/);
  return match ? parseInt(match[1], 10) : null;
}

/**
 * Inject all enabled extension scripts into the bot's Chrome instance.
 * Keeps a persistent WebSocket connection that re-injects on every navigation.
 */
export async function injectExtensionScripts(
  cdpPort: number,
  log?: (msg: string) => void,
): Promise<void> {
  const scripts = getEnabledScripts();
  if (scripts.length === 0) return;

  const browserWsUrl = await waitForCDP(cdpPort);
  if (!browserWsUrl) {
    log?.('[EXT]  Could not connect to Chrome CDP\n');
    return;
  }

  await startInjectionLoop(browserWsUrl, scripts, log);
}
