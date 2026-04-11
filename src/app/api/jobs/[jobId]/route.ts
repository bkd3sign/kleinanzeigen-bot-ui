import { handleApiError } from '@/lib/api/error-handler';
import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth/middleware';
import { jobs } from '@/lib/bot/jobs';

interface RouteContext {
  params: Promise<{ jobId: string }>;
}

export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const user = await getCurrentUser(request);
    if (!user) {
      return NextResponse.json({ detail: 'Authentication required' }, { status: 401 });
    }

    const { jobId } = await context.params;
    const job = jobs.get(jobId);

    if (!job) {
      return NextResponse.json({ detail: `Job ${jobId} not found` }, { status: 404 });
    }

    // Non-admin can only see their own jobs
    if (user.role !== 'admin' && job.user_id !== user.id) {
      return NextResponse.json({ detail: `Job ${jobId} not found` }, { status: 404 });
    }

    return NextResponse.json(job);
  } catch (error) {
    return handleApiError(error);
  }
}
