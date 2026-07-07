import crypto from 'crypto';
import type { Job } from '@/types/bot';
import { enqueueJob, dequeueJob, forceAdvanceQueue, cancelPendingRetry } from '@/lib/bot/queue';
import { getUserLabelMap } from '@/lib/yaml/users';

const MAX_JOBS = 1000;

// In-memory job store — survives HMR via globalThis
const globalJobs = globalThis as unknown as { __jobs?: Map<string, Job> };
if (!globalJobs.__jobs) {
  globalJobs.__jobs = new Map();
}
export const jobs: Map<string, Job> = globalJobs.__jobs;

// Store process references for cancellation (server-side only)
const globalProcs = globalThis as unknown as { __jobProcs?: Map<string, number> };
if (!globalProcs.__jobProcs) {
  globalProcs.__jobProcs = new Map();
}
export const jobPids: Map<string, number> = globalProcs.__jobProcs;

/**
 * Return copies of jobs with a display-ready `user_label` (the current email)
 * resolved from the frozen workspace id. The id itself stays untouched so
 * internal ownership comparisons keep working. Use on every API response that
 * exposes a job to the UI, so labels match the live email everywhere.
 */
export function withUserLabels(list: Job[]): Job[] {
  const labels = getUserLabelMap();
  return list.map((job) => ({ ...job, user_label: labels[job.user_id] ?? job.user_id }));
}

/**
 * Single-job variant of withUserLabels().
 */
export function withUserLabel(job: Job): Job {
  return withUserLabels([job])[0];
}

/**
 * Generate a unique job ID with optional prefix.
 */
export function generateJobId(prefix: string = 'job'): string {
  const now = new Date();
  const ts = now.toISOString().replace(/[-:T]/g, '').slice(0, 15);
  const hex = crypto.randomBytes(3).toString('hex');
  return `${prefix}_${ts}_${hex}`;
}

/**
 * Remove oldest completed/failed jobs when exceeding MAX_JOBS limit.
 */
export function cleanupJobs(): void {
  // Evict oldest-first, but SKIP (don't stop at) entries we must keep: running jobs and jobs
  // waiting out a delayed profile-lock retry (retry_at set — dropping one loses the retry the UI
  // promised). Skip-and-continue instead of break, so a protected oldest entry doesn't wedge the
  // whole eviction and let jobs.size grow unbounded behind it.
  let removedThisPass = true;
  while (jobs.size > MAX_JOBS && removedThisPass) {
    removedThisPass = false;
    for (const [key, job] of jobs) {
      if (jobs.size <= MAX_JOBS) break;
      if (job.status !== 'running' && !job.retry_at) {
        jobs.delete(key);
        removedThisPass = true;
      }
    }
  }
}

/**
 * Whether a bot job is currently running for the given workspace.
 * Used to keep the VNC browser alive while the bot is attached to it (visible mode):
 * tearing the session down mid-run would kill the bot's browser.
 */
export function isWorkspaceJobRunning(workspace: string): boolean {
  for (const job of jobs.values()) {
    if (job.workspace === workspace && job.status === 'running') return true;
  }
  return false;
}

/**
 * Whether the most recent job of the workspace is waiting for a manual login.
 * Uses the newest job (by started_at) so a successful re-run clears the state:
 * the fresh running/queued job becomes newest and login is no longer required.
 */
export function isWorkspaceLoginRequired(workspace: string): boolean {
  let newest: Job | undefined;
  for (const job of jobs.values()) {
    if (job.workspace !== workspace) continue;
    if (!newest || job.started_at > newest.started_at) newest = job;
  }
  // Both states need the user to act in the VNC browser, so both keep the "Chrome öffnen"
  // controls visible: login_required (job ended, needs a retry) and waiting_for_user
  // (job paused live at the login/CAPTCHA wall).
  return newest?.status === 'login_required' || newest?.status === 'waiting_for_user';
}

/**
 * Create a job and enqueue it. If no other job is running, starts immediately.
 * Otherwise the job waits in queue with status 'queued'.
 */
export function startJob(
  command: string,
  workspace: string,
  userId: string = '',
  scheduledBy?: string,
  forceVisible: boolean = false,
): Job {
  cleanupJobs();

  const jobId = generateJobId(scheduledBy ? 'sched' : 'job');
  const job: Job = {
    job_id: jobId,
    command,
    status: 'queued',
    started_at: new Date().toISOString(),
    output: '',
    user_id: userId,
    workspace,
    scheduled_by: scheduledBy,
    force_visible: forceVisible || undefined,
  };

  jobs.set(jobId, job);

  // Enqueue — the queue decides whether to start immediately or wait
  enqueueJob(jobId, command, workspace);

  return job;
}

/**
 * Cancel a running or queued job.
 */
export function cancelJob(jobId: string): boolean {
  const job = jobs.get(jobId);
  if (!job) return false;

  // Clear any pending delayed profile-lock retry so it can't re-queue after cancellation.
  cancelPendingRetry(jobId);

  // Cancel queued job — remove from queue (also covers a job waiting out a delayed retry, which
  // sits in 'queued' but is not in the live queue; dequeueJob is then a harmless no-op).
  if (job.status === 'queued') {
    dequeueJob(jobId);
    job.status = 'failed';
    job.exit_code = -1;
    job.output += '--- Job aus Warteschlange entfernt ---\n';
    job.finished_at = new Date().toISOString();
    job.queue_position = undefined;
    job.retry_at = undefined;
    return true;
  }

  // Cancel a running OR paused job — force-kill the process. A waiting_for_user job is paused
  // on stdin (ainput) inside its live PTY, so it has a real process to kill and holds the queue
  // slot; without this it could never be cancelled and would block the queue forever.
  if (job.status !== 'running' && job.status !== 'waiting_for_user') return false;

  // Mark job as cancelled immediately so the UI updates
  job.output += '\n--- Job abgebrochen ---\n';
  job.status = 'failed';
  job.waiting_for_user = false;
  job.exit_code = -1;
  job.finished_at = new Date().toISOString();

  const pid = jobPids.get(jobId);
  jobPids.delete(jobId);

  if (!pid) {
    // No PID registered — force-advance queue so it doesn't stay blocked
    forceAdvanceQueue(jobId);
    return true;
  }

  // Kill entire process group (negative PID) to include chromium child processes
  try {
    process.kill(-pid, 'SIGTERM');
  } catch {
    // Process group already gone — try single PID as fallback
    try { process.kill(pid, 'SIGTERM'); } catch { /* already gone */ }
    forceAdvanceQueue(jobId);
    return true;
  }

  // SIGKILL fallback: if SIGTERM is ignored, force-kill after 3 seconds
  setTimeout(() => {
    try {
      process.kill(-pid, 'SIGKILL');
    } catch {
      try { process.kill(pid, 'SIGKILL'); } catch { /* already gone */ }
    }
  }, 3000);

  return true;
}
