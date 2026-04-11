import { handleApiError } from '@/lib/api/error-handler';
import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth/middleware';
import { cancelJob, jobs } from '@/lib/bot/jobs';

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
    const job = jobs.get(jobId);

    if (!job) {
      return NextResponse.json({ detail: 'Job not found' }, { status: 404 });
    }

    // Non-admin can only cancel their own jobs
    if (user.role !== 'admin' && job.user_id !== user.id) {
      return NextResponse.json({ detail: 'Not authorized' }, { status: 403 });
    }

    if (job.status !== 'running' && job.status !== 'queued') {
      return NextResponse.json({ detail: 'Job is not running' }, { status: 400 });
    }

    const cancelled = cancelJob(jobId);
    if (!cancelled) {
      return NextResponse.json({ detail: 'Could not cancel job' }, { status: 500 });
    }

    return NextResponse.json({ status: 'ok', message: 'Job cancelled' });
  } catch (error) {
    return handleApiError(error);
  }
}
