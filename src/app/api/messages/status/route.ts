import { handleApiError } from '@/lib/api/error-handler';
import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth/middleware';
import { ensureSession, getMessagingStatus, listConversations } from '@/lib/messaging/gateway';

/**
 * GET: Check messaging session status + unread count.
 * Automatically starts browser + login if not running.
 */
export async function GET(request: NextRequest) {
  try {
    const user = await getCurrentUser(request);
    if (!user) {
      return NextResponse.json({ detail: 'Authentication required' }, { status: 401 });
    }

    const status = await getMessagingStatus(user.workspace);

    if (status.status === 'not_started') {
      ensureSession(user.workspace).catch(() => {});
      return NextResponse.json({ status: 'starting', userId: null, numUnreadMessages: 0 });
    }

    // Fetch unread count if session is ready
    let numUnreadMessages = 0;
    if (status.status === 'ready') {
      try {
        const data = await listConversations(user.workspace, 0, 1);
        numUnreadMessages = data.numUnreadMessages ?? 0;
      } catch { /* session might be stale */ }
    }

    return NextResponse.json({ ...status, numUnreadMessages });
  } catch (error) {
    return handleApiError(error);
  }
}
