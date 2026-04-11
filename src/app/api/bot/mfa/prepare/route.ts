import { handleApiError } from '@/lib/api/error-handler';
import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth/middleware';
import { jobs } from '@/lib/bot/jobs';
import { prepareMfaSession } from '@/lib/bot/mfa-resolver';
import { z } from 'zod';

const schema = z.object({ job_id: z.string().min(1) });

export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser(request);
    if (!user) {
      return NextResponse.json({ detail: 'Authentication required' }, { status: 401 });
    }

    const { job_id } = schema.parse(await request.json());

    const job = jobs.get(job_id);
    if (!job) return NextResponse.json({ detail: 'Job nicht gefunden' }, { status: 404 });
    if (!job.mfa_required) return NextResponse.json({ detail: 'Kein MFA erforderlich' }, { status: 400 });

    const result = await prepareMfaSession(job.workspace || user.workspace, job_id);
    if (!result.success) return NextResponse.json({ detail: result.error }, { status: 422 });

    return NextResponse.json({ message: 'MFA-Session bereit' });
  } catch (error) {
    return handleApiError(error);
  }
}
