import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the runner module before importing jobs
vi.mock('@/lib/bot/runner', () => ({
  runBotCommand: vi.fn().mockResolvedValue(undefined),
}));

import { jobs, startJob, cancelJob, cleanupJobs, isWorkspaceJobRunning, isWorkspaceLoginRequired } from '../jobs';
import type { JobStatus } from '@/types/bot';

function addJob(id: string, workspace: string, status: JobStatus, startedAt: string): void {
  jobs.set(id, { job_id: id, command: 'publish', status, started_at: startedAt, output: '', user_id: '', workspace });
}

describe('cancelJob', () => {
  beforeEach(() => {
    jobs.clear();
  });

  it('cancels a paused (waiting_for_user) job — without this the queue stays blocked', () => {
    addJob('j1', '/ws', 'waiting_for_user', new Date().toISOString());
    const job = jobs.get('j1')!;
    job.waiting_for_user = true;
    expect(cancelJob('j1')).toBe(true);
    expect(job.status).toBe('failed');
    expect(job.waiting_for_user).toBe(false);
  });

  it('cancels a queued job', () => {
    addJob('j2', '/ws', 'queued', new Date().toISOString());
    expect(cancelJob('j2')).toBe(true);
    expect(jobs.get('j2')!.status).toBe('failed');
  });

  it('returns false for an already-finished job', () => {
    addJob('j3', '/ws', 'completed', new Date().toISOString());
    expect(cancelJob('j3')).toBe(false);
  });
});

describe('startJob', () => {
  beforeEach(() => {
    jobs.clear();
  });

  it('creates a job with correct fields', () => {
    const job = startJob('publish', '/workspace', 'user-1');
    expect(job.job_id).toMatch(/^job_[\d.]+_[a-f0-9]{6}$/);
    expect(job.command).toBe('publish');
    expect(job.status).toBe('running');
    expect(job.started_at).toBeDefined();
    expect(job.output).toBe('');
    expect(job.user_id).toBe('user-1');
    expect(job.workspace).toBe('/workspace');
  });

  it('jobs have unique IDs', () => {
    const job1 = startJob('publish', '/workspace');
    const job2 = startJob('verify', '/workspace');
    expect(job1.job_id).not.toBe(job2.job_id);
  });

  it('stores jobs in the Map', () => {
    const job = startJob('publish', '/workspace');
    expect(jobs.has(job.job_id)).toBe(true);
    expect(jobs.get(job.job_id)).toBe(job);
  });

  it('defaults user_id to empty string', () => {
    const job = startJob('publish', '/workspace');
    expect(job.user_id).toBe('');
  });
});

describe('cleanupJobs', () => {
  beforeEach(() => {
    jobs.clear();
  });

  it('removes oldest jobs when over limit', () => {
    // Add 1001 completed jobs directly to the map
    for (let i = 0; i < 1001; i++) {
      jobs.set(`job_${i}`, {
        job_id: `job_${i}`,
        command: 'test',
        status: 'completed',
        started_at: new Date().toISOString(),
        output: '',
        user_id: '',
        workspace: '/workspace',
      });
    }

    expect(jobs.size).toBe(1001);
    cleanupJobs();
    expect(jobs.size).toBeLessThanOrEqual(1000);
  });

  it('does not remove running jobs', () => {
    // Fill to over limit with first job being "running"
    jobs.set('running_job', {
      job_id: 'running_job',
      command: 'publish',
      status: 'running',
      started_at: new Date().toISOString(),
      output: '',
      user_id: '',
      workspace: '/workspace',
    });

    for (let i = 0; i < 1001; i++) {
      jobs.set(`done_${i}`, {
        job_id: `done_${i}`,
        command: 'test',
        status: 'completed',
        started_at: new Date().toISOString(),
        output: '',
        user_id: '',
        workspace: '/workspace',
      });
    }

    cleanupJobs();
    // Running job should still be present
    expect(jobs.has('running_job')).toBe(true);
  });

  it('does nothing when under limit', () => {
    jobs.set('job_1', {
      job_id: 'job_1',
      command: 'test',
      status: 'completed',
      started_at: new Date().toISOString(),
      output: '',
      user_id: '',
      workspace: '/workspace',
    });

    cleanupJobs();
    expect(jobs.size).toBe(1);
  });
});

describe('job store', () => {
  it('is a Map', () => {
    expect(jobs).toBeInstanceOf(Map);
  });
});

describe('isWorkspaceJobRunning', () => {
  beforeEach(() => jobs.clear());

  it('true when a running job exists for the workspace', () => {
    addJob('a', '/ws1', 'running', '2026-01-01T00:00:00Z');
    expect(isWorkspaceJobRunning('/ws1')).toBe(true);
  });
  it('false for a different workspace (per-workspace scoping)', () => {
    addJob('a', '/ws1', 'running', '2026-01-01T00:00:00Z');
    expect(isWorkspaceJobRunning('/ws2')).toBe(false);
  });
  it('false when the workspace has only completed/failed jobs', () => {
    addJob('a', '/ws1', 'completed', '2026-01-01T00:00:00Z');
    addJob('b', '/ws1', 'failed', '2026-01-02T00:00:00Z');
    expect(isWorkspaceJobRunning('/ws1')).toBe(false);
  });
  it('false on an empty store', () => {
    expect(isWorkspaceJobRunning('/ws1')).toBe(false);
  });
});

describe('isWorkspaceLoginRequired', () => {
  beforeEach(() => jobs.clear());

  it('true when the newest job of the workspace is login_required', () => {
    addJob('old', '/ws1', 'completed', '2026-01-01T00:00:00Z');
    addJob('new', '/ws1', 'login_required', '2026-01-02T00:00:00Z');
    expect(isWorkspaceLoginRequired('/ws1')).toBe(true);
  });
  it('false once a newer job supersedes the login_required one (re-run clears it)', () => {
    addJob('login', '/ws1', 'login_required', '2026-01-01T00:00:00Z');
    addJob('newer', '/ws1', 'running', '2026-01-02T00:00:00Z');
    expect(isWorkspaceLoginRequired('/ws1')).toBe(false);
  });
  it('scopes per workspace', () => {
    addJob('a', '/ws1', 'login_required', '2026-01-02T00:00:00Z');
    expect(isWorkspaceLoginRequired('/ws2')).toBe(false);
  });
  it('false on an empty store', () => {
    expect(isWorkspaceLoginRequired('/ws1')).toBe(false);
  });
});
