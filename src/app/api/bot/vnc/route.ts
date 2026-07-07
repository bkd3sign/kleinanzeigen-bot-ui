import { handleApiError } from '@/lib/api/error-handler';
import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth/middleware';
import { startVncLogin, stopVncLogin, getVncSession, isVncLoggedIn, touchVncWindow, isVncWindowIdle } from '@/lib/vnc/lifecycle';
import { insertTextIntoBrowser } from '@/lib/browser/cdp';
import { isWorkspaceJobRunning, isWorkspaceLoginRequired } from '@/lib/bot/jobs';
import { readMergedConfig } from '@/lib/yaml/config';
import { resolveBrowserMode, isVncAttachMode } from '@/lib/bot/browser-mode';

const MAX_PASTE_LENGTH = 4096;
// Auto-stop a session whose login window has been closed this long with no attached job.
const VNC_IDLE_MS = 10 * 60 * 1000;

// Start a VNC login session for the authenticated user's workspace
export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser(request);
    if (!user) {
      return NextResponse.json({ detail: 'Authentication required' }, { status: 401 });
    }

    const session = await startVncLogin(user.workspace);
    return NextResponse.json({ token: session.token, status: session.status });
  } catch (error) {
    return handleApiError(error);
  }
}

// Get the current VNC session status for the authenticated user's workspace
export async function GET(request: NextRequest) {
  try {
    const user = await getCurrentUser(request);
    if (!user) {
      return NextResponse.json({ detail: 'Authentication required' }, { status: 401 });
    }

    // jobRunning tells the client to treat an open window as a read-only viewer:
    // the bot is attached to this browser (visible mode), so it must not be torn down.
    const jobRunning = isWorkspaceJobRunning(user.workspace);

    // Client heartbeat: ?open=1 means the login window is currently open → keep alive.
    if (request.nextUrl.searchParams.get('open') === '1') {
      touchVncWindow(user.workspace);
    }
    // Browser mode drives where "Chrome öffnen" controls appear:
    // headless → nowhere; auto → only on login-required; visible → always.
    const mode = resolveBrowserMode(readMergedConfig(user.workspace));
    // attachMode is the single source of truth for "the bot runs IN this VNC browser"
    // (visible + no native display). The client must NOT recompute it from mode alone —
    // it can't see hasNativeDisplay() — so it drives the auto-close teardown guard from this.
    const attachMode = isVncAttachMode(mode);
    // Idle reap — but NOT in visible/attach mode: there the browser stays open on purpose so
    // the session stays warm (same Chromium instance + fingerprint → KA accepts it, no
    // re-login, instant attach). AUTO/headless reap after the login window is idle to free
    // the ~1 GB Chromium when it's no longer needed.
    if (!attachMode && !jobRunning && isVncWindowIdle(user.workspace, VNC_IDLE_MS)) {
      await stopVncLogin(user.workspace);
    }
    // loginRequired drives the auto-mode section: show it only while a login is pending.
    const loginRequired = isWorkspaceLoginRequired(user.workspace);
    const session = getVncSession(user.workspace);
    if (session) {
      const loggedIn = await isVncLoggedIn(user.workspace);
      return NextResponse.json({ status: session.status, token: session.token, loggedIn, jobRunning, mode, attachMode, loginRequired });
    }
    return NextResponse.json({ status: 'none', loggedIn: false, jobRunning, mode, attachMode, loginRequired });
  } catch (error) {
    return handleApiError(error);
  }
}

// Paste text into the focused field of the workspace's VNC browser via CDP.
// The clipboard is read client-side and forwarded here — it never reaches KA directly.
export async function PUT(request: NextRequest) {
  try {
    const user = await getCurrentUser(request);
    if (!user) {
      return NextResponse.json({ detail: 'Authentication required' }, { status: 401 });
    }

    const session = getVncSession(user.workspace);
    if (!session || session.status !== 'ready') {
      return NextResponse.json({ detail: 'Keine aktive VNC-Sitzung.' }, { status: 409 });
    }

    const body = await request.json().catch(() => ({}));
    const text = typeof body?.text === 'string' ? body.text : '';
    if (!text) {
      return NextResponse.json({ detail: 'Kein Text zum Einfügen.' }, { status: 400 });
    }
    if (text.length > MAX_PASTE_LENGTH) {
      return NextResponse.json({ detail: 'Text zu lang.' }, { status: 400 });
    }

    await insertTextIntoBrowser(session.cdpPort, text);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return handleApiError(error);
  }
}

// Stop and clean up the VNC session for the authenticated user's workspace
export async function DELETE(request: NextRequest) {
  try {
    const user = await getCurrentUser(request);
    if (!user) {
      return NextResponse.json({ detail: 'Authentication required' }, { status: 401 });
    }

    // Guard: never tear down while a bot job is attached to this browser (visible mode).
    // Closing the viewer window then only hides it; the session lives until the job ends.
    if (isWorkspaceJobRunning(user.workspace)) {
      return NextResponse.json({ ok: true, skipped: 'job-running' });
    }

    await stopVncLogin(user.workspace);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return handleApiError(error);
  }
}
