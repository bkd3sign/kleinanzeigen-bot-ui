import { jobs, cancelJob } from '@/lib/bot/jobs';
import { runBotCommand } from '@/lib/bot/runner';
import { onJobStarting, onJobCompleted } from '@/lib/bot/hooks';
import { stopForBot, restartAllBrowserless } from '@/lib/messaging/gateway';

// Auto-cancel jobs with no output for this many milliseconds
const STALE_JOB_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes
const WATCHDOG_INTERVAL_MS = 30 * 1000; // check every 30s

interface QueueEntry {
  jobId: string;
  command: string;
  workspace: string;
}

// Singleton queue via globalThis (survives HMR)
const globalQueue = globalThis as unknown as {
  __botQueue?: QueueEntry[];
  __botQueueRunning?: string | null;
};
if (!globalQueue.__botQueue) {
  globalQueue.__botQueue = [];
}
if (globalQueue.__botQueueRunning === undefined) {
  globalQueue.__botQueueRunning = null;
}

const queue: QueueEntry[] = globalQueue.__botQueue;

/**
 * Check if a bot process is currently running.
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
 */
function executeAndAdvance(jobId: string, command: string, workspace: string): void {
  // Bot has absolute priority — stop messaging browser on the shared profile
  stopForBot(workspace);

  const job = jobs.get(jobId);
  if (job) job.last_output_at = new Date().toISOString();

  // Start watchdog that auto-cancels stale jobs
  const watchdog = startWatchdog(jobId);

  onJobStarting(jobId, command, workspace);
  runBotCommand(command, jobId, workspace)
    .catch(() => { /* error handled in job status */ })
    .finally(() => {
      clearInterval(watchdog);
      onJobCompleted(jobId, command, workspace);
      globalQueue.__botQueueRunning = null;
      processNext();

      // Restart ALL messaging sessions stopped by bot jobs (multi-user safe)
      if (!isQueueBusy()) {
        restartAllBrowserless().catch(() => {});
      }
    });
}

/**
 * Periodically check if a running job has stalled (no output for STALE_JOB_TIMEOUT_MS).
 * Auto-cancels the job so the queue can advance.
 */
function startWatchdog(jobId: string): ReturnType<typeof setInterval> {
  return setInterval(() => {
    const job = jobs.get(jobId);
    if (!job || job.status !== 'running') return;

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
