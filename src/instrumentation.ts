/**
 * Next.js instrumentation hook — runs once when the server process starts.
 *
 * Registers process-level safety nets so a single unhandled promise rejection or
 * uncaught exception is logged instead of taking the whole server down. Node ≥15
 * (incl. Node 25) terminates the process by default on an unhandled rejection — on a
 * 24/7 self-hosted server that would knock every user offline because of one stray
 * promise somewhere in the stack.
 *
 * This is defense-in-depth only: the known cases (e.g. missing VNC binaries) are still
 * handled at their source. The guard just prevents an unforeseen stray rejection from
 * being fatal. Errors are logged loudly so they are not silently swallowed.
 */
const g = globalThis as unknown as { __crashGuardsRegistered?: boolean };

export async function register(): Promise<void> {
  // Only the Node.js server runtime owns a process to guard (not the edge runtime).
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  // Register once — the hook can run again on HMR reloads in dev.
  if (g.__crashGuardsRegistered) return;
  g.__crashGuardsRegistered = true;

  process.on('unhandledRejection', (reason) => {
    console.error('[unhandledRejection] kept server alive — please fix the source:', reason);
  });

  // Note: an uncaught exception may leave state inconsistent. We keep the server running
  // (availability over strictness for a self-hosted deployment) but log it prominently so
  // the underlying bug gets fixed rather than hidden.
  process.on('uncaughtException', (err) => {
    console.error('[uncaughtException] kept server alive — please fix the source:', err);
  });
}
