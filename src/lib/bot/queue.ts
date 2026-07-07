import { jobs, cancelJob } from '@/lib/bot/jobs';
import { runBotCommand, hasBrowserConnectionError } from '@/lib/bot/runner';
import { onJobStarting, onJobCompleted } from '@/lib/bot/hooks';
import { stopForBot, restartAllBrowserless } from '@/lib/messaging/gateway';
import { ensureProfileFreeForLaunch, getProfileHolderPids } from '@/lib/bot/browser-cleanup';
import { readMergedConfig } from '@/lib/yaml/config';
import { resolveBrowserMode, isAttachRun } from '@/lib/bot/browser-mode';
import { getVncSession, isVncWindowIdle } from '@/lib/vnc/lifecycle';

// Auto-cancel jobs with no output for this many milliseconds
const STALE_JOB_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes
const WATCHDOG_INTERVAL_MS = 30 * 1000; // check every 30s

// Delayed profile-lock recovery: after the in-place attempts fail because Chromium couldn't get
// the browser profile (a holder stuck in slow NAS I/O that only dies minutes later), re-queue the
// SAME job once after this delay. The wait happens OUTSIDE the queue slot, so other jobs run
// normally; the re-queued job then takes its normal turn (immediately if free, else behind the
// running/queued jobs). This automates the manual retry that reliably works after a few minutes.
const PROFILE_RETRY_DELAY_MS = 5 * 60 * 1000; // 5 minutes
const MAX_PROFILE_RETRIES = 1; // one delayed re-queue on top of the 2 in-place attempts

// Separates the current attempt's output from the appended previous-attempt error in the job log.
// Splitting on it isolates the LAST attempt's error, so retry decisions aren't tripped by an
// earlier attempt's (now-irrelevant) "Failed to connect" text still sitting in the accumulated log.
const PREVIOUS_ATTEMPT_MARKER = '\n\n--- [Vorheriger Versuch] ---';

interface QueueEntry {
  jobId: string;
  command: string;
  workspace: string;
}

// Singleton queue via globalThis (survives HMR)
const globalQueue = globalThis as unknown as {
  __botQueue?: QueueEntry[];
  __botQueueRunning?: string | null;
  __botRetryTimers?: Map<string, ReturnType<typeof setTimeout>>;
};
if (!globalQueue.__botQueue) {
  globalQueue.__botQueue = [];
}
if (globalQueue.__botQueueRunning === undefined) {
  globalQueue.__botQueueRunning = null;
}
if (!globalQueue.__botRetryTimers) {
  globalQueue.__botRetryTimers = new Map();
}

const queue: QueueEntry[] = globalQueue.__botQueue;
// Pending delayed-retry timers, keyed by jobId (so a cancel can clear the scheduled re-queue).
const retryTimers: Map<string, ReturnType<typeof setTimeout>> = globalQueue.__botRetryTimers;

/**
 * Cancel a pending delayed profile-lock retry for a job (called when the job is cancelled while it
 * sits in the post-failure wait). No-op if none is scheduled.
 */
export function cancelPendingRetry(jobId: string): void {
  const timer = retryTimers.get(jobId);
  if (timer) {
    clearTimeout(timer);
    retryTimers.delete(jobId);
  }
}

/**
 * Re-queue the SAME job (same id/output/modal — never a new job) after PROFILE_RETRY_DELAY_MS.
 * The job sits in 'queued' during the wait but is NOT in the live queue, so it blocks nothing.
 * Guarded against firing after a cancel or a status change while waiting.
 */
function scheduleProfileRetry(job: import('@/types/bot').Job, command: string, workspace: string): void {
  job.retry_count = (job.retry_count ?? 0) + 1;
  job.status = 'queued';
  job.exit_code = undefined;
  job.finished_at = undefined;
  job.queue_position = undefined;
  const at = new Date(Date.now() + PROFILE_RETRY_DELAY_MS);
  job.retry_at = at.toISOString();
  const mins = Math.round(PROFILE_RETRY_DELAY_MS / 60000);
  job.output += `\n--- Browser-Profil war gesperrt. Automatischer Wiederholversuch in ${mins} Min (${at.toLocaleTimeString('de-DE')}) ---\n`;

  const timer = setTimeout(() => {
    retryTimers.delete(job.job_id);
    const current = jobs.get(job.job_id);
    // Skip if the job was cancelled/removed or otherwise changed state while waiting.
    if (!current || current.status !== 'queued' || current.retry_at !== at.toISOString()) return;
    current.retry_at = undefined;
    current.output += `\n--- Automatischer Wiederholversuch gestartet ---\n`;
    enqueueJob(job.job_id, command, workspace);
  }, PROFILE_RETRY_DELAY_MS);
  // Don't let a pending retry keep the process alive on shutdown.
  timer.unref?.();
  retryTimers.set(job.job_id, timer);
}

/**
 * Check if a bot process is currently running.
 *
 * NOTE: the queue is GLOBAL across all workspaces by design — at most one bot Chromium runs
 * at a time fleet-wide, because each run is a heavy headless browser and the bot shares one
 * host. A second user's bot job therefore waits behind the first (and that user's messaging
 * is only revived from 'browserless' once the global queue drains). This is an intentional
 * resource guard, not a per-workspace queue; revisit only if concurrent multi-user bot
 * execution becomes a requirement.
 */
export function isQueueBusy(): boolean {
  return globalQueue.__botQueueRunning !== null;
}

/**
 * Get current queue length (excluding running job).
 */
export function getQueueLength(): number {
  return queue.length;
}

/**
 * Get the job ID of the currently running bot process.
 */
export function getRunningJobId(): string | null {
  return globalQueue.__botQueueRunning ?? null;
}

/**
 * Enqueue a bot command. If no job is running, start immediately.
 * Otherwise, queue it and update the job's status to 'queued'.
 */
export function enqueueJob(jobId: string, command: string, workspace: string): void {
  const job = jobs.get(jobId);

  if (!isQueueBusy()) {
    // Start immediately
    globalQueue.__botQueueRunning = jobId;
    if (job) job.status = 'running';
    executeAndAdvance(jobId, command, workspace);
  } else {
    // Queue it
    queue.push({ jobId, command, workspace });
    if (job) {
      job.status = 'queued';
      job.queue_position = queue.length;
    }
    updateQueuePositions();
  }
}

/**
 * Force-advance the queue after a running job was cancelled externally.
 * Only acts if the given jobId is actually the currently running job.
 */
export function forceAdvanceQueue(jobId: string): void {
  if (globalQueue.__botQueueRunning === jobId) {
    globalQueue.__botQueueRunning = null;
    processNext();

    // Restart all messaging sessions stopped by bot (handles cancellation)
    if (!isQueueBusy()) {
      restartAllBrowserless().catch(() => {});
    }
  }
}

/**
 * Remove a queued job from the queue (before it starts).
 */
export function dequeueJob(jobId: string): boolean {
  const idx = queue.findIndex((e) => e.jobId === jobId);
  if (idx === -1) return false;
  queue.splice(idx, 1);
  updateQueuePositions();
  return true;
}

/**
 * Execute a job and advance the queue when done.
 * Automatically retries once if Chromium fails to connect (profile race).
 */
async function executeAndAdvance(jobId: string, command: string, workspace: string): Promise<void> {
  // In visible mode on a headless server the bot ATTACHES to the running Xvnc/noVNC
  // browser, which owns the shared profile on purpose. The clean-profile preparation below
  // would tear that browser down, leaving the bot with "Browser process not reachable at
  // 9300": stopForBot calls killOrphanedChromium on EVERY Chromium using the profile (incl.
  // the VNC browser), and waitForProfileFree/cleanStaleLocks/the wipe-retry assume a fresh
  // launch. startVncLogin does its own correctly-timed profile prep, so the attach path
  // skips ALL of this. Headless/auto launch their own browser → full prep runs as before.
  // force_visible (AUTO retry) also runs in the VNC browser → treat it like attach mode so
  // the profile prep below doesn't tear that browser down. Same predicate the runner uses.
  const job = jobs.get(jobId);
  if (job) job.last_output_at = new Date().toISOString();

  // attachMode is decided inside the try (readMergedConfig can throw on a malformed config.yaml)
  // but is read again in the finally, so it lives in the outer scope.
  let attachMode = false;

  // Start watchdog that auto-cancels stale jobs. Started before the try (setInterval never throws)
  // so the finally can always clear it; last_output_at above gives it a baseline before prep runs.
  const watchdog = startWatchdog(jobId);

  try {
    // Launch prep runs INSIDE the try so a throw here (e.g. yaml.load on a hand-edited, malformed
    // config.yaml) still reaches the finally and releases the global queue slot. Otherwise one bad
    // config would pin __botQueueRunning forever and deadlock EVERY user's queue until restart.
    attachMode = isAttachRun(
      resolveBrowserMode(readMergedConfig(workspace)),
      job?.force_visible ?? false,
    );

    if (!attachMode) {
      // Bot launches its own browser → it has absolute priority on the shared profile.
      await stopForBot(workspace);

      // Confirm the profile is actually free before launch: kills any Chromium still holding THIS
      // workspace's profile (e.g. a prior headless run that exited on a login wall, or a revived
      // messaging browser), polls (re-killing) until the SingletonLock is released, then clears
      // stale lock files. Shared with messaging/MFA/VNC so every launch site enforces the same
      // guarantee. Session files are preserved (no fullWipe) so a warm login survives into this run.
      if (!(await ensureProfileFreeForLaunch(workspace))) {
        // Profile could not be confirmed free within the window. Surface WHY into the job log so a
        // scheduled failure is self-diagnosing: a PID list means a live Chromium survived the kills
        // (uninterruptible I/O on a slow NAS); "unbestimmt" means the process lookup timed out and
        // we never identified the holder; "kein Prozess" points at a leftover lock file.
        const holders = await getProfileHolderPids(workspace);
        const detail = holders === null
          ? 'unbestimmt (Prozess-Lookup-Timeout unter Last)'
          : holders.length > 0 ? `noch aktiv: PID ${holders.join(', ')}` : 'kein Prozess mehr (evtl. verwaiste Lock-Datei)';
        const diag = `[Bereinigung] Browser-Profil nicht als frei bestätigt (${detail}) — Start könnte fehlschlagen`;
        console.warn(`[Queue] ${diag}: ${workspace}`);
        const jobRef = jobs.get(jobId);
        if (jobRef) jobRef.output += `${diag}\n`;
      }
    }

    onJobStarting(jobId, command, workspace);
    await runBotCommand(command, jobId, workspace);

    // Auto-retry once when Chromium couldn't connect (stale profile lock or crash).
    // Matches user behaviour: a manual retry always works after a clean profile wipe.
    // Skipped in attach mode: the wipe would kill the VNC browser the bot attaches to,
    // turning a transient hiccup into a guaranteed failure.
    if (!attachMode && job && job.status === 'failed' && hasBrowserConnectionError(job.output)) {
      const originalError = job.output;

      job.status = 'running';
      job.exit_code = undefined;
      job.finished_at = undefined;
      job.last_output_at = new Date().toISOString();
      job.output = '';

      // Full crash-recovery wipe (session + cache) before the retry, then confirm the profile is
      // free — matches the manual retry that reliably works after a clean wipe.
      if (!(await ensureProfileFreeForLaunch(workspace, { fullWipe: true }))) {
        console.warn(`[Queue] Browser-Profil vor Retry weiterhin gesperrt: ${workspace}`);
      }
      await runBotCommand(command, jobId, workspace);

      // If retry also failed, show both outputs so the user can diagnose.
      // Re-read from the map because runBotCommand mutates status by reference
      // and TypeScript's narrowing doesn't track that.
      const retried = jobs.get(jobId);
      if (retried?.status === 'failed') {
        retried.output += `${PREVIOUS_ATTEMPT_MARKER}\n${originalError}`;
      }
    } else if (attachMode && job && job.status === 'failed' && hasBrowserConnectionError(job.output)) {
      // Attach run hit a transient CDP connect race (VNC browser briefly unreachable, e.g.
      // mid-startup). Retry ONCE WITHOUT touching the profile — runBotCommand re-calls
      // startVncLogin (idempotent; revives the VNC browser if needed). A profile wipe here
      // would kill the warm browser the bot attaches to, so the non-attach path above is unsafe.
      const originalError = job.output;

      job.status = 'running';
      job.exit_code = undefined;
      job.finished_at = undefined;
      job.last_output_at = new Date().toISOString();
      job.output = '';

      await runBotCommand(command, jobId, workspace);

      const retried = jobs.get(jobId);
      if (retried?.status === 'failed') {
        retried.output += `${PREVIOUS_ATTEMPT_MARKER}\n${originalError}`;
      }
    }
  } catch (err) {
    // runBotCommand can throw before the child process spawns — e.g. visible mode where
    // startVncLogin fails because the VNC stack (Xvnc) is missing. executeAndAdvance is
    // called fire-and-forget, so an unhandled throw would surface as an unhandledRejection
    // (Node ≥15 exits the process). Mark the job failed with a clear message instead.
    const failed = jobs.get(jobId);
    if (failed && failed.status !== 'failed') {
      failed.status = 'failed';
      failed.exit_code = 1;
      failed.finished_at = new Date().toISOString();
      failed.output = `${failed.output ?? ''}\n${err instanceof Error ? err.message : String(err)}\n`;
    }
  } finally {
    clearInterval(watchdog);
    onJobCompleted(jobId, command, workspace);
    globalQueue.__botQueueRunning = null;

    // Delayed profile-lock recovery: if the job still failed with a browser-connection error after
    // the in-place attempts and we have retry budget left, re-queue the SAME job after a delay
    // instead of failing for good. Skipped in attach mode (a headless re-queue would bypass the
    // VNC browser). The slot is released below regardless, so the wait blocks no other job.
    const finalJob = jobs.get(jobId);
    // Only the LAST attempt's output decides — split off any appended previous-attempt error so a
    // job whose final failure was NON-transient (e.g. login/config) isn't re-queued just because an
    // earlier attempt's "Failed to connect" text still sits in the accumulated log.
    const lastAttemptOutput = finalJob?.output.split(PREVIOUS_ATTEMPT_MARKER)[0] ?? '';
    if (!attachMode && finalJob && finalJob.status === 'failed'
      && hasBrowserConnectionError(lastAttemptOutput)
      && (finalJob.retry_count ?? 0) < MAX_PROFILE_RETRIES) {
      scheduleProfileRetry(finalJob, command, workspace);
    }

    processNext();

    // Restart ALL messaging sessions stopped by bot jobs (multi-user safe)
    if (!isQueueBusy()) {
      restartAllBrowserless().catch(() => {});
    }
  }
}

/**
 * Periodically check if a running job has stalled (no output for STALE_JOB_TIMEOUT_MS).
 * Auto-cancels the job so the queue can advance.
 */
function startWatchdog(jobId: string): ReturnType<typeof setInterval> {
  return setInterval(() => {
    const job = jobs.get(jobId);
    if (!job || job.status !== 'running') return;

    // Don't auto-cancel a job the user is actively supervising in the VNC browser: if a VNC
    // session exists for this workspace and its window was seen recently (client heartbeat),
    // the silence is a manual login/CAPTCHA in progress after a resume — not a hang. Once the
    // window is closed the heartbeat stops (isVncWindowIdle → true) and normal behaviour resumes.
    if (getVncSession(job.workspace) && !isVncWindowIdle(job.workspace, STALE_JOB_TIMEOUT_MS)) return;

    const lastOutput = job.last_output_at ? new Date(job.last_output_at).getTime() : 0;
    const silentMs = Date.now() - lastOutput;

    if (silentMs > STALE_JOB_TIMEOUT_MS) {
      const silentMin = Math.round(silentMs / 60000);
      job.output += `\n--- Job automatisch abgebrochen: kein Output seit ${silentMin} Minuten ---\n`;
      cancelJob(jobId);
    }
  }, WATCHDOG_INTERVAL_MS);
}

/**
 * Start the next queued job if available.
 */
function processNext(): void {
  if (queue.length === 0) return;
  if (isQueueBusy()) return;

  const next = queue.shift()!;
  const job = jobs.get(next.jobId);

  // Skip if job was cancelled while queued
  if (job && job.status !== 'queued') {
    processNext();
    return;
  }

  globalQueue.__botQueueRunning = next.jobId;
  if (job) {
    job.status = 'running';
    job.queue_position = undefined;
  }
  updateQueuePositions();
  executeAndAdvance(next.jobId, next.command, next.workspace);
}

/**
 * Update queue_position on all queued jobs.
 */
function updateQueuePositions(): void {
  for (let i = 0; i < queue.length; i++) {
    const job = jobs.get(queue[i].jobId);
    if (job) job.queue_position = i + 1;
  }
}
