/**
 * Per-workspace mutex ensuring the headless bot and the VNC login browser
 * never use the shared browser-profile concurrently. State is persisted on
 * globalThis so it survives Next.js HMR restarts, mirroring jobs.ts / ports.ts.
 */

export type BrowserLockOwner = 'bot' | 'vnc';

const g = globalThis as unknown as { __browserLocks?: Map<string, BrowserLockOwner> };
if (!g.__browserLocks) g.__browserLocks = new Map<string, BrowserLockOwner>();
const locks: Map<string, BrowserLockOwner> = g.__browserLocks;

/**
 * Attempt to acquire the lock for `owner`.
 * Returns true if the lock was free (acquired) or already held by the same owner (idempotent).
 * Returns false if the lock is held by the OTHER owner.
 */
export function acquireBrowserLock(workspace: string, owner: BrowserLockOwner): boolean {
  const current = locks.get(workspace);
  if (current === undefined || current === owner) {
    locks.set(workspace, owner);
    return true;
  }
  return false;
}

/**
 * Release the lock — only if currently held by `owner`.
 * Calls by the non-owner are a no-op (safe to call unconditionally in finally blocks).
 */
export function releaseBrowserLock(workspace: string, owner: BrowserLockOwner): void {
  if (locks.get(workspace) === owner) {
    locks.delete(workspace);
  }
}
