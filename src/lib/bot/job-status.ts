import type { JobStatus } from '@/types/bot';

/**
 * Local HH:MM for a scheduled retry time, or null if the ISO string is missing/invalid.
 */
function retryClock(retryAt?: string): string | null {
  if (!retryAt) return null;
  const t = new Date(retryAt);
  if (Number.isNaN(t.getTime())) return null;
  return t.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/**
 * English label for a job status — full form, for places with room (e.g. the job detail
 * modal header). Single source of truth: every status text/badge MUST use this (or
 * jobStatusShortLabel) instead of inlining its own translation, so the labels stay
 * consistent and never mix languages (the "Login erforderlich" next to "failed" bug).
 * Job status labels are deliberately English (matching the bot CLI status vocabulary).
 *
 * A queued job waiting out a delayed profile-lock retry (retryAt set, not yet in the live
 * queue) reads as "retry at HH:MM" so it's distinguishable from a normal queue wait.
 */
export function jobStatusLabel(status: JobStatus, queuePosition?: number, retryAt?: string): string {
  switch (status) {
    case 'queued': {
      if (queuePosition) return `queued (#${queuePosition})`;
      const clock = retryClock(retryAt);
      return clock ? `retry at ${clock}` : 'queued';
    }
    case 'running': return 'running';
    case 'completed': return 'completed';
    case 'completed_with_errors': return 'completed with errors';
    case 'failed': return 'failed';
    case 'login_required': return 'login required';
    case 'mfa_required': return 'mfa required';
    case 'waiting_for_user': return 'waiting for login';
  }
}

/**
 * Compact English label for tight badges (job pill, tables, schedule status) where the
 * full label would overflow into adjacent text. Same status values, shorter wording.
 */
export function jobStatusShortLabel(status: JobStatus, queuePosition?: number, retryAt?: string): string {
  switch (status) {
    case 'queued': {
      if (queuePosition) return `#${queuePosition}`;
      const clock = retryClock(retryAt);
      return clock ? `retry ${clock}` : 'queued';
    }
    case 'running': return 'running';
    case 'completed': return 'completed';
    case 'completed_with_errors': return 'with errors';
    case 'failed': return 'failed';
    case 'login_required': return 'login';
    case 'mfa_required': return 'MFA';
    case 'waiting_for_user': return 'waiting';
  }
}
