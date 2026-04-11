import { handleApiError } from '@/lib/api/error-handler';
import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth/middleware';
import { startJob } from '@/lib/bot/jobs';
import { BOT_DIR } from '@/lib/bot/runner';

export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser(request);
    if (!user) {
      return NextResponse.json({ detail: 'Authentication required' }, { status: 401 });
    }

    // System command — runs in root workspace, not user workspace
    const job = startJob('diagnose', BOT_DIR, user.id);
    return NextResponse.json(job);
  } catch (error) {
    return handleApiError(error);
  }
}
