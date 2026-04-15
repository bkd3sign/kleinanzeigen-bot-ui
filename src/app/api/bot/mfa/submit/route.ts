import { handleApiError } from '@/lib/api/error-handler';
import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth/middleware';
import { jobs, startJob } from '@/lib/bot/jobs';
import { submitMfaCode, submitMfaToRunningBot } from '@/lib/bot/mfa-resolver';
import { z } from 'zod';

const schema = z.object({
  job_id: z.string().min(1),
  code: z.string().regex(/^\d{4,8}$/, 'Code muss 4–8 Ziffern sein'),
});

export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser(request);
    if (!user) {
      return NextResponse.json({ detail: 'Authentication required' }, { status: 401 });
    }

    const { job_id, code } = schema.parse(await request.json());

    const job = jobs.get(job_id);
    if (!job) return NextResponse.json({ detail: 'Job nicht gefunden' }, { status: 404 });

    // Primary: inject code directly into bot's running Chrome via CDP
    if (job.cdp_port && job.status === 'running') {
      const directResult = await submitMfaToRunningBot(job_id, code);
      if (directResult.success) {
        return NextResponse.json({ message: 'MFA erfolgreich — Bot fährt fort' });
      }
      // Direct inject failed — fall through to legacy flow
    }

    // Fallback: use separately prepared MFA session (requires prior prepareMfaSession call)
    const result = await submitMfaCode(job_id, code);
    if (!result.success) return NextResponse.json({ detail: result.error }, { status: 422 });

    job.mfa_required = false;
    const newJob = startJob(job.command, job.workspace || user.workspace, job.user_id || user.id);

    return NextResponse.json({ message: 'MFA erfolgreich — Befehl wird wiederholt', job: newJob });
  } catch (error) {
    return handleApiError(error);
  }
}
