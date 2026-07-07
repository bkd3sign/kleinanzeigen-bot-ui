import { handleApiError } from '@/lib/api/error-handler';
import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth/middleware';
import { jobs, startJob, withUserLabel } from '@/lib/bot/jobs';
import { readMergedConfig } from '@/lib/yaml/config';
import { resolveBrowserMode } from '@/lib/bot/browser-mode';

interface RouteContext {
  params: Promise<{ jobId: string }>;
}

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const user = await getCurrentUser(request);
    if (!user) {
      return NextResponse.json({ detail: 'Authentication required' }, { status: 401 });
    }

    const { jobId } = await context.params;
    const originalJob = jobs.get(jobId);

    if (!originalJob) {
      return NextResponse.json({ detail: 'Job not found' }, { status: 404 });
    }

    // Non-admin can only repeat their OWN jobs (parity with cancel/GET) — without this a guessed
    // job id would let any authenticated user re-run another user's (possibly destructive) command.
    if (user.role !== 'admin' && originalJob.user_id !== user.id) {
      return NextResponse.json({ detail: 'Not authorized' }, { status: 403 });
    }

    // Re-run the same command in the original job's workspace
    const workspace = originalJob.workspace || user.workspace;
    const userId = originalJob.user_id || user.id;
    // Retry after a login wall: run in the visible VNC browser so the user can sign in live.
    // Only when the workspace isn't strict-headless (which has no VNC fallback).
    const forceVisible = originalJob.status === 'login_required'
      && resolveBrowserMode(readMergedConfig(workspace)) !== 'headless';
    const newJob = startJob(originalJob.command, workspace, userId, undefined, forceVisible);
    return NextResponse.json(withUserLabel(newJob));
  } catch (error) {
    return handleApiError(error);
  }
}
