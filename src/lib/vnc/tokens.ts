/**
 * Websockify token-file map per workspace.
 *
 * Websockify (--token-plugin TokenFile --token-source <dir>) reads one file per
 * token from a directory. Each file must contain exactly one line:
 *   <token>: <host>:<port>
 *
 * This module manages that directory so a single websockify process can route
 * ?token=<workspaceToken> to the correct per-workspace RFB port.
 */

import path from 'path';
import fs from 'fs';
import crypto from 'crypto';

/** Lazy resolver — lets tests override BOT_DIR before the first call. */
function tokenDir(): string {
  return path.join(process.env.BOT_DIR || process.cwd(), '.temp', 'vnc-tokens');
}

// Persist the token map across HMR restarts, mirroring the pattern from ports.ts
const g = globalThis as unknown as { __vncTokens?: Map<string, string> };
if (!g.__vncTokens) g.__vncTokens = new Map<string, string>();
const tokenCache: Map<string, string> = g.__vncTokens;

/**
 * Return a stable CSPRNG token for the given workspace path.
 * Generates a new 48-char hex token on first call and caches it in-process.
 * Repeated calls for the same workspace always return the same token.
 */
export function vncToken(workspace: string): string {
  const cached = tokenCache.get(workspace);
  if (cached) return cached;
  const token = crypto.randomBytes(24).toString('hex');
  tokenCache.set(workspace, token);
  return token;
}

/**
 * Write a websockify TokenFile entry for the given token and RFB port.
 * Creates the token directory with restrictive permissions (0o700).
 */
export function writeVncToken(token: string, rfbPort: number): void {
  const dir = tokenDir();
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  // Tighten permissions in case the directory pre-existed with looser perms
  fs.chmodSync(dir, 0o700);
  const content = `${token}: 127.0.0.1:${rfbPort}\n`;
  fs.writeFileSync(path.join(dir, token), content, { encoding: 'utf8', mode: 0o600 });
}

/**
 * Remove the workspace → token mapping from the in-process cache.
 * Call on session stop so the next startVncLogin generates a fresh token.
 */
export function clearVncToken(workspace: string): void {
  tokenCache.delete(workspace);
}

/**
 * Remove the websockify TokenFile entry for the given token.
 * Safe to call when the file is absent — does not throw.
 */
export function removeVncToken(token: string): void {
  try {
    fs.unlinkSync(path.join(tokenDir(), token));
  } catch (err: unknown) {
    // Ignore "file not found"; re-throw anything unexpected
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw err;
    }
  }
}
