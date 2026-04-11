import { handleApiError } from '@/lib/api/error-handler';
import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth/middleware';
import { startJob } from '@/lib/bot/jobs';

export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser(request);
    if (!user) {
      return NextResponse.json({ detail: 'Authentication required' }, { status: 401 });
    }

    const job = startJob('update-content-hash', user.workspace, user.id);
    return NextResponse.json(job);
  } catch (error) {
    return handleApiError(error);
  }
}
