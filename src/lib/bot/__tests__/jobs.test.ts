import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the runner module before importing jobs
vi.mock('@/lib/bot/runner', () => ({
  runBotCommand: vi.fn().mockResolvedValue(undefined),
}));

import { jobs, startJob, cleanupJobs } from '../jobs';

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
