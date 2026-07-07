import { describe, it, expect } from 'vitest';
import { jobStatusLabel, jobStatusShortLabel } from '../job-status';
import type { JobStatus } from '@/types/bot';

const ALL: JobStatus[] = ['queued', 'running', 'completed', 'completed_with_errors', 'failed', 'login_required', 'mfa_required', 'waiting_for_user'];

describe('jobStatusLabel', () => {
  it('returns a non-empty English label for every status (no language mix)', () => {
    for (const s of ALL) {
      const label = jobStatusLabel(s);
      expect(label).toBeTruthy();
      // Guards against the regression that prompted this: a German label among English ones.
      expect(label).not.toMatch(/erforderlich|fehlgeschlagen|abgeschlossen|Wartend/);
    }
  });

  it('includes the queue position for a queued job when provided', () => {
    expect(jobStatusLabel('queued', 3)).toBe('queued (#3)');
    expect(jobStatusLabel('queued')).toBe('queued');
  });

  it('shows the retry time for a queued job waiting out a delayed retry', () => {
    const at = new Date(); at.setHours(7, 5, 0, 0);
    const hhmm = at.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    expect(jobStatusLabel('queued', undefined, at.toISOString())).toBe(`retry at ${hhmm}`);
    // A live queue position takes precedence over the retry hint.
    expect(jobStatusLabel('queued', 1, at.toISOString())).toBe('queued (#1)');
    // Invalid/absent retryAt falls back to plain "queued".
    expect(jobStatusLabel('queued', undefined, 'not-a-date')).toBe('queued');
  });

  it('maps the previously inconsistent statuses to consistent English', () => {
    expect(jobStatusLabel('login_required')).toBe('login required');
    expect(jobStatusLabel('completed_with_errors')).toBe('completed with errors');
    expect(jobStatusLabel('failed')).toBe('failed');
  });
});

describe('jobStatusShortLabel', () => {
  it('returns a compact label for every status', () => {
    for (const s of ALL) expect(jobStatusShortLabel(s)).toBeTruthy();
  });

  it('shortens the long labels so badges do not overflow', () => {
    expect(jobStatusShortLabel('login_required')).toBe('login');
    // waiting_for_user must NOT collide with login_required's short label.
    expect(jobStatusShortLabel('waiting_for_user')).toBe('waiting');
    expect(jobStatusShortLabel('waiting_for_user')).not.toBe(jobStatusShortLabel('login_required'));
    expect(jobStatusShortLabel('mfa_required')).toBe('MFA');
    expect(jobStatusShortLabel('queued', 2)).toBe('#2');
    expect(jobStatusShortLabel('queued')).toBe('queued');
  });

  it('shows a compact retry time for a queued job in the delayed-retry wait', () => {
    const at = new Date(); at.setHours(7, 5, 0, 0);
    const hhmm = at.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    expect(jobStatusShortLabel('queued', undefined, at.toISOString())).toBe(`retry ${hhmm}`);
    expect(jobStatusShortLabel('queued', 2, at.toISOString())).toBe('#2');
  });
});
