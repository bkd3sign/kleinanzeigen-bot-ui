import cron, { type ScheduledTask } from 'node-cron';
import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import type { Schedule, JobStatus } from '@/types/bot';
import { startJob, jobs } from '@/lib/bot/jobs';
import { BOT_DIR } from '@/lib/bot/runner';
import { validateBotCommand } from '@/lib/security/validation';

const SCHEDULES_FILE = path.join(BOT_DIR, 'schedules.yaml');

// Default schedules — created on first load if file doesn't exist
const DEFAULT_SCHEDULES: Schedule[] = [
  {
    id: 'publish-new',
    name: 'Neue Anzeigen veröffentlichen',
    command: 'publish --ads=new',
    cron: '0 6 * * *',
    enabled: false,
    created_by: 'system',
  },
  {
    id: 'publish-due',
    name: 'Fällige Anzeigen veröffentlichen',
    command: 'publish --ads=due',
    cron: '0 6 * * *',
    enabled: false,
    created_by: 'system',
  },
  {
    id: 'download-new',
    name: 'Neue Anzeigen herunterladen',
    command: 'download --ads=new',
    cron: '0 6 * * *',
    enabled: false,
    created_by: 'system',
  },
  {
    id: 'verify',
    name: 'Anzeigen prüfen',
    command: 'verify --verbose',
    cron: '0 8 * * 6',
    enabled: false,
    created_by: 'system',
  },
];

// Singleton via globalThis (survives HMR)
const globalScheduler = globalThis as unknown as {
  __schedulerTasks?: Map<string, ScheduledTask>;
  __schedulerInitialized?: boolean;
};
if (!globalScheduler.__schedulerTasks) {
  globalScheduler.__schedulerTasks = new Map();
}

const activeTasks: Map<string, ScheduledTask> = globalScheduler.__schedulerTasks;

/**
 * Load schedules from YAML file. Creates defaults if file doesn't exist.
 */
export function loadSchedules(): Schedule[] {
  if (!fs.existsSync(SCHEDULES_FILE)) {
    saveSchedules(DEFAULT_SCHEDULES);
    return DEFAULT_SCHEDULES;
  }

  try {
    const raw = fs.readFileSync(SCHEDULES_FILE, 'utf-8');
    const data = yaml.load(raw) as { schedules?: Schedule[] } | null;
    return data?.schedules ?? DEFAULT_SCHEDULES;
  } catch {
    return DEFAULT_SCHEDULES;
  }
}

/**
 * Save schedules to YAML file.
 */
export function saveSchedules(schedules: Schedule[]): void {
  const dir = path.dirname(SCHEDULES_FILE);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(
    SCHEDULES_FILE,
    yaml.dump({ schedules }, { flowLevel: -1, sortKeys: false }),
    'utf-8',
  );
}

/**
 * Get the next run time for a cron expression.
 */
function getNextRun(cronExpr: string): string | undefined {
  if (!cron.validate(cronExpr)) return undefined;

  // Parse cron fields to calculate next execution
  const [minute, hour, dayOfMonth, month, dayOfWeek] = cronExpr.split(' ');
  const now = new Date();
  const next = new Date(now);

  // Simple approximation: set to the specified hour/minute today or tomorrow
  const targetHour = hour === '*' ? now.getHours() : parseInt(hour, 10);
  const targetMinute = minute === '*' ? 0 : parseInt(minute, 10);

  next.setHours(targetHour, targetMinute, 0, 0);
  if (next <= now) {
    // If today's time already passed, calculate next occurrence
    if (dayOfWeek !== '*') {
      // Weekly: find next matching day
      const targetDay = parseInt(dayOfWeek, 10);
      let daysUntil = targetDay - now.getDay();
      if (daysUntil <= 0) daysUntil += 7;
      next.setDate(now.getDate() + daysUntil);
      next.setHours(targetHour, targetMinute, 0, 0);
    } else {
      next.setDate(next.getDate() + 1);
    }
  }

  return next.toISOString();
}

/**
 * Get the workspace for a schedule based on its creator.
 * User schedules run in the user's workspace, system schedules in BOT_DIR.
 */
function getWorkspaceForSchedule(schedule: Schedule): string {
  if (schedule.created_by && schedule.created_by !== 'system') {
    return path.join(BOT_DIR, 'users', schedule.created_by);
  }
  return BOT_DIR;
}

/**
 * Execute a scheduled command and update schedule metadata.
 */
function executeSchedule(schedule: Schedule): void {
  // Re-validate command at execution time (defense-in-depth against tampered YAML)
  try {
    validateBotCommand(schedule.command);
  } catch {
    console.error(`[Scheduler] Blocked invalid command for schedule '${schedule.id}': ${schedule.command}`);
    return;
  }

  const workspace = getWorkspaceForSchedule(schedule);
  const userId = schedule.created_by && schedule.created_by !== 'system' ? schedule.created_by : 'scheduler';
  const job = startJob(schedule.command, workspace, userId, schedule.id);

  // Update last_run on schedule
  const schedules = loadSchedules();
  const idx = schedules.findIndex((s) => s.id === schedule.id);
  if (idx !== -1) {
    schedules[idx].last_run = new Date().toISOString();
    schedules[idx].next_run = getNextRun(schedule.cron);

    // Track job completion to update last_status
    const checkInterval = setInterval(() => {
      const j = jobs.get(job.job_id);
      if (j && j.status !== 'running' && j.status !== 'queued') {
        clearInterval(checkInterval);
        const current = loadSchedules();
        const cidx = current.findIndex((s) => s.id === schedule.id);
        if (cidx !== -1) {
          current[cidx].last_status = j.status as JobStatus;
          saveSchedules(current);
        }
      }
    }, 5000);

    // Timeout after 30 minutes
    setTimeout(() => clearInterval(checkInterval), 30 * 60 * 1000);

    saveSchedules(schedules);
  }
}

/**
 * Register a single cron task for a schedule.
 */
function registerTask(schedule: Schedule): void {
  // Stop existing task if any
  const existing = activeTasks.get(schedule.id);
  if (existing) {
    existing.stop();
    activeTasks.delete(schedule.id);
  }

  if (!schedule.enabled) return;
  if (!cron.validate(schedule.cron)) return;

  const task = cron.schedule(schedule.cron, () => {
    executeSchedule(schedule);
  }, {
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  });

  activeTasks.set(schedule.id, task);
}

/**
 * Initialize the scheduler — load schedules and register all enabled cron tasks.
 * Safe to call multiple times (idempotent).
 */
export function initScheduler(): void {
  // Stop all existing tasks
  for (const [id, task] of activeTasks) {
    task.stop();
    activeTasks.delete(id);
  }

  const schedules = loadSchedules();

  for (const schedule of schedules) {
    // Update next_run
    if (schedule.enabled) {
      schedule.next_run = getNextRun(schedule.cron);
    }
    registerTask(schedule);
  }

  // Save with updated next_run times
  saveSchedules(schedules);

  if (!globalScheduler.__schedulerInitialized) {
    globalScheduler.__schedulerInitialized = true;
    const enabledCount = schedules.filter((s) => s.enabled).length;
    if (enabledCount > 0) {
      console.warn(`[Scheduler] ${enabledCount} Zeitplan${enabledCount > 1 ? 'e' : ''} aktiv`);
    }
  }
}

/**
 * Update a single schedule and re-register its cron task.
 */
export function updateSchedule(id: string, updates: Partial<Schedule>): Schedule | null {
  const schedules = loadSchedules();
  const idx = schedules.findIndex((s) => s.id === id);
  if (idx === -1) return null;

  const updated = { ...schedules[idx], ...updates, id };
  if (updated.enabled && updated.cron) {
    updated.next_run = getNextRun(updated.cron);
  } else {
    updated.next_run = undefined;
  }

  schedules[idx] = updated;
  saveSchedules(schedules);
  registerTask(updated);

  return updated;
}

/**
 * Add a new custom schedule.
 */
export function addSchedule(schedule: Omit<Schedule, 'id'>): Schedule {
  const schedules = loadSchedules();
  const id = `custom-${Date.now().toString(36)}`;
  const newSchedule: Schedule = {
    id,
    ...schedule,
    next_run: schedule.enabled ? getNextRun(schedule.cron) : undefined,
  };

  schedules.push(newSchedule);
  saveSchedules(schedules);
  registerTask(newSchedule);

  return newSchedule;
}

/**
 * Remove a custom schedule (built-in schedules can only be disabled).
 */
export function removeSchedule(id: string): boolean {
  const schedules = loadSchedules();
  const idx = schedules.findIndex((s) => s.id === id);
  if (idx === -1) return false;

  // Don't allow removing built-in schedules
  if (!id.startsWith('custom-')) return false;

  const existing = activeTasks.get(id);
  if (existing) {
    existing.stop();
    activeTasks.delete(id);
  }

  schedules.splice(idx, 1);
  saveSchedules(schedules);
  return true;
}

/**
 * Manually trigger a schedule immediately (outside its cron timing).
 */
export function triggerSchedule(id: string, userId?: string): string | null {
  const schedules = loadSchedules();
  const schedule = schedules.find((s) => s.id === id);
  if (!schedule) return null;

  const workspace = getWorkspaceForSchedule(schedule);
  const job = startJob(schedule.command, workspace, userId || schedule.created_by || 'scheduler', schedule.id);
  return job.job_id;
}

/**
 * Validate a cron expression.
 */
export function validateCron(expr: string): boolean {
  return cron.validate(expr);
}
