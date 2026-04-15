import { handleApiError } from '@/lib/api/error-handler';
import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth/middleware';
import { ensureSession, getMessagingStatus, listConversations } from '@/lib/messaging/gateway';
import { isQueueBusy, getRunningJobId } from '@/lib/bot/queue';
import { jobs } from '@/lib/bot/jobs';

/**
 * GET: Check messaging session status + unread count.
 * Does NOT auto-start a browser — use POST to explicitly start.
 * If disk cookies exist, creates a cookie-only session automatically.
 */
export async function GET(request: NextRequest) {
  try {
    const user = await getCurrentUser(request);
    if (!user) {
      return NextResponse.json({ detail: 'Authentication required' }, { status: 401 });
    }

    let status = await getMessagingStatus(user.workspace);

    // Try to (re)establish session when idle — covers both fresh start
    // and recovery from error (e.g. expired cookies during bot run)
    if ((status.status === 'not_started' || status.status === 'error') && !isQueueBusy()) {
      try {
        await ensureSession(user.workspace);
        status = await getMessagingStatus(user.workspace);
      } catch { /* no cookies or expired — stay not_started */ }
    }

    // Extract bot command name when in browserless mode (workspace-scoped)
    let botCommand: string | null = null;
    if (status.status === 'browserless') {
      const runningId = getRunningJobId();
      if (runningId) {
        const job = jobs.get(runningId);
        if (job?.workspace === user.workspace) {
          botCommand = job.command?.split(/\s+/)[0] ?? null;
        }
      }
    }

    // Fetch unread count if session can make API calls (ready or browserless with cached cookies)
    let numUnreadMessages = 0;
    if (status.status === 'ready' || status.status === 'browserless') {
      try {
        const data = await listConversations(user.workspace, 0, 1);
        numUnreadMessages = data.numUnreadMessages ?? 0;
      } catch {
        // Session was invalidated (e.g. 401 from gateway) — re-read actual status
        // so we don't return stale "ready" to the frontend
        status = await getMessagingStatus(user.workspace);
      }
    }

    return NextResponse.json({ ...status, numUnreadMessages, botCommand });
  } catch (error) {
    return handleApiError(error);
  }
}

/**
 * POST: Explicitly start messaging session (browser + login).
 * Called when user clicks "Anmelden" on the messages page.
 */
export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser(request);
    if (!user) {
      return NextResponse.json({ detail: 'Authentication required' }, { status: 401 });
    }

    if (isQueueBusy()) {
      return NextResponse.json({ detail: 'Bot läuft — bitte warten.' }, { status: 409 });
    }

    ensureSession(user.workspace).catch(() => {});
    return NextResponse.json({ status: 'starting' });
  } catch (error) {
    return handleApiError(error);
  }
}
