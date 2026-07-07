import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getCurrentUser } from '@/lib/auth/middleware';
import { handleApiError } from '@/lib/api/error-handler';
import { jobs } from '@/lib/bot/jobs';
import { resumePausedJob } from '@/lib/bot/runner';

const schema = z.object({ job_id: z.string().min(1) });

/**
 * Resume a job that paused at a login/CAPTCHA wall (status waiting_for_user) after the user
 * signed in / solved the challenge in the VNC browser. Releases the bot's stdin wait.
 */
export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser(request);
    if (!user) {
      return NextResponse.json({ detail: 'Authentication required' }, { status: 401 });
    }

    const { job_id } = schema.parse(await request.json());
    const job = jobs.get(job_id);
    if (!job) return NextResponse.json({ detail: 'Job nicht gefunden' }, { status: 404 });
    if (job.workspace !== user.workspace) {
      return NextResponse.json({ detail: 'Kein Zugriff auf diesen Job' }, { status: 403 });
    }

    if (!resumePausedJob(job_id)) {
      return NextResponse.json({ detail: 'Job wartet nicht auf eine Eingabe' }, { status: 422 });
    }
    return NextResponse.json({ message: 'Anmeldung bestätigt — Bot fährt fort' });
  } catch (error) {
    return handleApiError(error);
  }
}
