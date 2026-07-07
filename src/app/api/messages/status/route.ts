import { handleApiError } from '@/lib/api/error-handler';
import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth/middleware';
import { ensureSession, getMessagingStatus, listConversations, stopSession } from '@/lib/messaging/gateway';
import { isQueueBusy, getRunningJobId } from '@/lib/bot/queue';
import { jobs } from '@/lib/bot/jobs';
import { getVncSession } from '@/lib/vnc/lifecycle';

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

    // Try cookie-only session recovery: restore a session from valid disk cookies
    // but NEVER launch a browser here. A real browser + login only happens on the
    // explicit "Anmelden" action (POST), so merely opening the tab stays passive.
    // Race with 3s timeout so cookie validation (a quick network call) can't hang.
    // cookieOnly never launches a browser (it reads disk/VNC cookies or bails), so it is
    // always safe to attempt — even while the bot is busy. In visible mode this auto-connects
    // messaging from the warm VNC browser on page load.
    if (status.status === 'not_started' || status.status === 'error') {
      try {
        await Promise.race([
          ensureSession(user.workspace, { cookieOnly: true }),
          new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), 3000)),
        ]);
      } catch { /* no valid cookies — stay not_started until user logs in */ }
      status = await getMessagingStatus(user.workspace);
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

    // Block only when the bot is busy AND there is no VNC browser to read cookies from.
    // In visible mode the warm VNC browser is present, so messaging reads its cookies (HTTP
    // mode) without launching a second Chromium — no collision with the running bot.
    if (isQueueBusy() && !getVncSession(user.workspace)) {
      return NextResponse.json({ detail: 'Bot läuft — bitte warten.' }, { status: 409 });
    }

    ensureSession(user.workspace).catch(() => {});
    return NextResponse.json({ status: 'starting' });
  } catch (error) {
    return handleApiError(error);
  }
}

/**
 * DELETE: Cancel a running messaging session (e.g. a stuck login).
 * Kills the browser, drops the in-memory session, resets to 'not_started'.
 */
export async function DELETE(request: NextRequest) {
  try {
    const user = await getCurrentUser(request);
    if (!user) {
      return NextResponse.json({ detail: 'Authentication required' }, { status: 401 });
    }

    stopSession(user.workspace);
    return NextResponse.json({ status: 'not_started' });
  } catch (error) {
    return handleApiError(error);
  }
}
