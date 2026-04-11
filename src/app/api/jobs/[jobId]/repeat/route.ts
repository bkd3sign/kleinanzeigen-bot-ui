import { handleApiError } from '@/lib/api/error-handler';
import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth/middleware';
import { jobs, startJob } from '@/lib/bot/jobs';

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

    // Re-run the same command in the original job's workspace
    const workspace = originalJob.workspace || user.workspace;
    const userId = originalJob.user_id || user.id;
    const newJob = startJob(originalJob.command, workspace, userId);
    return NextResponse.json(newJob);
  } catch (error) {
    return handleApiError(error);
  }
}
