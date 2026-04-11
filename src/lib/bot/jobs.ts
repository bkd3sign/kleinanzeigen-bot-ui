import crypto from 'crypto';
import type { Job } from '@/types/bot';
import { enqueueJob, dequeueJob, forceAdvanceQueue } from '@/lib/bot/queue';

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
  while (jobs.size > MAX_JOBS) {
    const firstKey = jobs.keys().next().value;
    if (firstKey === undefined) break;
    const oldest = jobs.get(firstKey);
    // Only remove completed/failed/queued jobs, never running ones
    if (oldest && oldest.status !== 'running') {
      jobs.delete(firstKey);
    } else {
      break;
    }
  }
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

  // Cancel queued job — remove from queue
  if (job.status === 'queued') {
    dequeueJob(jobId);
    job.status = 'failed';
    job.exit_code = -1;
    job.output += '--- Job aus Warteschlange entfernt ---\n';
    job.finished_at = new Date().toISOString();
    job.queue_position = undefined;
    return true;
  }

  // Cancel running job — force-kill the process
  if (job.status !== 'running') return false;

  // Mark job as cancelled immediately so the UI updates
  job.output += '\n--- Job abgebrochen ---\n';
  job.status = 'failed';
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
