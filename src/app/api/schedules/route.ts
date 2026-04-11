import { handleApiError } from '@/lib/api/error-handler';
import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth/middleware';
import {
  loadSchedules,
  updateSchedule,
  addSchedule,
  removeSchedule,
  triggerSchedule,
  validateCron,
  initScheduler,
} from '@/lib/bot/scheduler';
import { validateBotCommand } from '@/lib/security/validation';

// Initialize scheduler on first import (server startup)
initScheduler();

// System schedules (non-custom) can only be managed by admins
function isSystemSchedule(id: string): boolean {
  return !id.startsWith('custom-');
}

/**
 * GET /api/schedules — List schedules for current user
 * Everyone sees: system defaults (where no personal fork exists) + own custom/forked schedules.
 * Nobody sees other users' schedules.
 */
export async function GET(request: NextRequest) {
  try {
    const user = await getCurrentUser(request);
    if (!user) {
      return NextResponse.json({ detail: 'Authentication required' }, { status: 401 });
    }

    const schedules = loadSchedules();
    const { searchParams } = new URL(request.url);
    const view = searchParams.get('view');

    // ?view=active — all active schedules from all users (for "Anstehend" tab)
    if (view === 'active') {
      const active = schedules.filter((s) => s.enabled && !isSystemSchedule(s.id));
      return NextResponse.json({ schedules: active });
    }

    // Default: own schedules + unforked system defaults
    const mySchedules = schedules.filter((s) => s.created_by === user.id);
    const myForkedIds = new Set(mySchedules.map((s) => s.forked_from).filter(Boolean));
    const visible = [
      ...schedules.filter((s) => isSystemSchedule(s.id) && !myForkedIds.has(s.id)),
      ...mySchedules,
    ];
    return NextResponse.json({ schedules: visible });
  } catch (error) {
    return handleApiError(error);
  }
}

/**
 * PUT /api/schedules — Update a schedule
 * Body: { id, enabled?, cron?, name?, command? }
 * System schedules are templates — editing always creates a personal fork.
 * Custom schedules can only be edited by their creator or an admin.
 */
export async function PUT(request: NextRequest) {
  try {
    const user = await getCurrentUser(request);
    if (!user) {
      return NextResponse.json({ detail: 'Authentication required' }, { status: 401 });
    }

    const body = await request.json();
    const { id, ...updates } = body;

    if (!id || typeof id !== 'string') {
      return NextResponse.json({ detail: 'Schedule ID required' }, { status: 400 });
    }

    if (updates.cron && !validateCron(updates.cron)) {
      return NextResponse.json({ detail: 'Ungültiger Cron-Ausdruck' }, { status: 400 });
    }

    // Validate command against whitelist before saving
    if (updates.command !== undefined) {
      try {
        validateBotCommand(updates.command);
      } catch {
        return NextResponse.json({ detail: 'Ungültiger Bot-Befehl' }, { status: 400 });
      }
    }

    // System schedule → always fork into a personal copy (admin and user alike)
    if (isSystemSchedule(id)) {
      const schedules = loadSchedules();
      const original = schedules.find((s) => s.id === id);
      if (!original) {
        return NextResponse.json({ detail: 'Schedule not found' }, { status: 404 });
      }

      const forked = addSchedule({
        name: updates.name || original.name,
        command: updates.command || original.command,
        cron: updates.cron || original.cron,
        enabled: updates.enabled ?? original.enabled,
        created_by: user.id,
        forked_from: original.id,
      });

      return NextResponse.json(forked, { status: 201 });
    }

    // Custom schedule → must be owner or admin
    if (user.role !== 'admin') {
      const schedules = loadSchedules();
      const schedule = schedules.find((s) => s.id === id);
      if (!schedule || schedule.created_by !== user.id) {
        return NextResponse.json({ detail: 'Keine Berechtigung für diesen Zeitplan' }, { status: 403 });
      }
    }

    const result = updateSchedule(id, updates);
    if (!result) {
      return NextResponse.json({ detail: 'Schedule not found' }, { status: 404 });
    }

    return NextResponse.json(result);
  } catch (error) {
    return handleApiError(error);
  }
}

/**
 * POST /api/schedules — Create a new schedule or trigger an existing one
 * Body: { action: 'trigger', id } — trigger immediately
 * Body: { name, command, cron, enabled } — create new schedule
 */
export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser(request);
    if (!user) {
      return NextResponse.json({ detail: 'Authentication required' }, { status: 401 });
    }

    const body = await request.json();

    // Trigger existing schedule
    if (body.action === 'trigger' && body.id) {
      // Non-admins can only trigger their own custom schedules
      if (user.role !== 'admin' && isSystemSchedule(body.id)) {
        return NextResponse.json({ detail: 'System-Zeitpläne können nur von Admins ausgeführt werden' }, { status: 403 });
      }
      if (user.role !== 'admin') {
        const schedules = loadSchedules();
        const schedule = schedules.find((s) => s.id === body.id);
        if (!schedule || schedule.created_by !== user.id) {
          return NextResponse.json({ detail: 'Keine Berechtigung' }, { status: 403 });
        }
      }
      const jobId = triggerSchedule(body.id, user.id);
      if (!jobId) {
        return NextResponse.json({ detail: 'Schedule not found' }, { status: 404 });
      }
      return NextResponse.json({ job_id: jobId });
    }

    // Create new schedule
    if (!body.name || !body.command || !body.cron) {
      return NextResponse.json(
        { detail: 'name, command, and cron are required' },
        { status: 400 },
      );
    }

    if (!validateCron(body.cron)) {
      return NextResponse.json({ detail: 'Ungültiger Cron-Ausdruck' }, { status: 400 });
    }

    try {
      validateBotCommand(body.command);
    } catch {
      return NextResponse.json({ detail: 'Ungültiger Bot-Befehl' }, { status: 400 });
    }

    const schedule = addSchedule({
      name: body.name,
      command: body.command,
      cron: body.cron,
      enabled: body.enabled ?? false,
      created_by: user.id,
    });

    return NextResponse.json(schedule, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}

/**
 * DELETE /api/schedules — Remove a custom schedule
 * Body: { id }
 */
export async function DELETE(request: NextRequest) {
  try {
    const user = await getCurrentUser(request);
    if (!user) {
      return NextResponse.json({ detail: 'Authentication required' }, { status: 401 });
    }

    const body = await request.json();
    if (!body.id) {
      return NextResponse.json({ detail: 'Schedule ID required' }, { status: 400 });
    }

    // Non-admins can only delete their own custom schedules
    if (user.role !== 'admin') {
      const schedules = loadSchedules();
      const schedule = schedules.find((s) => s.id === body.id);
      if (!schedule || schedule.created_by !== user.id) {
        return NextResponse.json({ detail: 'Keine Berechtigung' }, { status: 403 });
      }
    }

    const removed = removeSchedule(body.id);
    if (!removed) {
      return NextResponse.json(
        { detail: 'Standard-Zeitpläne können nicht gelöscht werden' },
        { status: 400 },
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    return handleApiError(error);
  }
}
