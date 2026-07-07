import { handleApiError } from '@/lib/api/error-handler';
import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth/middleware';
import { jobs, startJob, withUserLabel } from '@/lib/bot/jobs';
import { submitMfaCode, submitMfaToRunningBot } from '@/lib/bot/mfa-resolver';
import { killOrphanedChromium } from '@/lib/bot/browser-cleanup';
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
    // Ownership guard (parity with /api/bot/resume): a job id must belong to the caller's
    // workspace — otherwise any authenticated user could drive another user's bot via a guessed id.
    if (job.workspace !== user.workspace) {
      return NextResponse.json({ detail: 'Kein Zugriff auf diesen Job' }, { status: 403 });
    }

    const workspace = job.workspace || user.workspace;

    // Primary: inject code into Chrome via CDP.
    // Works for running bot (Chrome + ainput() alive) and crashed bot (Chrome kept alive by runner).
    if (job.cdp_port) {
      const cdpResult = await submitMfaToRunningBot(job_id, code);
      if (cdpResult.success) {
        if (job.status === 'running') {
          return NextResponse.json({ message: 'MFA erfolgreich — Bot fährt fort' });
        }
        // Bot crashed — Chrome survived for code injection, now kill it and restart job
        await killOrphanedChromium(workspace);
        const newJob = startJob(job.command, workspace, job.user_id || user.id);
        return NextResponse.json({ message: 'MFA erfolgreich — Befehl wird wiederholt', job: withUserLabel(newJob) });
      }
      // CDP failed (Chrome died) — fall through to legacy prepare flow
    }

    // Fallback: use separately prepared MFA session (requires prior prepareMfaSession call)
    const result = await submitMfaCode(job_id, code);
    if (!result.success) return NextResponse.json({ detail: result.error }, { status: 422 });

    job.mfa_required = false;
    const newJob = startJob(job.command, workspace, job.user_id || user.id);

    return NextResponse.json({ message: 'MFA erfolgreich — Befehl wird wiederholt', job: withUserLabel(newJob) });
  } catch (error) {
    return handleApiError(error);
  }
}
