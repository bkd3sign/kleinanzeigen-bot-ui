import { handleApiError } from '@/lib/api/error-handler';
import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth/middleware';
import { jobs } from '@/lib/bot/jobs';

export async function GET(request: NextRequest) {
  try {
    const user = await getCurrentUser(request);
    if (!user) {
      return NextResponse.json({ detail: 'Authentication required' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status');
    const limit = Math.min(Math.max(parseInt(searchParams.get('limit') ?? '20', 10) || 20, 1), 100);

    let allJobs = Array.from(jobs.values());

    // Non-admin users only see their own jobs
    if (user.role !== 'admin') {
      allJobs = allJobs.filter((j) => j.user_id === user.id);
    }

    if (status) {
      allJobs = allJobs.filter((j) => j.status === status);
    }

    // Sort by started_at descending
    allJobs.sort((a, b) => (b.started_at > a.started_at ? 1 : -1));

    return NextResponse.json({
      jobs: allJobs.slice(0, limit),
      total: allJobs.length,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
