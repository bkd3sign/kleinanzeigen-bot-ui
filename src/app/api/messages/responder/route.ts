import { handleApiError } from '@/lib/api/error-handler';
import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth/middleware';
import {
  startResponder,
  stopResponder,
  getResponderStatus,
  approvePendingReply,
  rejectPendingReply,
  readAiStats,
} from '@/lib/messaging/responder';

/**
 * GET: Get responder status + pending replies.
 */
export async function GET(request: NextRequest) {
  try {
    const user = await getCurrentUser(request);
    if (!user) {
      return NextResponse.json({ detail: 'Authentication required' }, { status: 401 });
    }

    const status = await getResponderStatus(user.workspace);
    const aiStats = readAiStats(user.workspace);
    return NextResponse.json({
      ...status,
      aiAdGen: { adGenerations: aiStats.adGenerations, adImageAnalyses: aiStats.adImageAnalyses },
    });
  } catch (error) {
    return handleApiError(error);
  }
}

/**
 * POST: Control the responder (start/stop/approve/reject).
 */
export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser(request);
    if (!user) {
      return NextResponse.json({ detail: 'Authentication required' }, { status: 401 });
    }

    const body = await request.json();
    const action = body.action as string;

    switch (action) {
      case 'start': {
        const mode = (body.mode as 'auto' | 'review') || 'review';
        startResponder(user.workspace, mode);
        return NextResponse.json({ message: `Responder gestartet (${mode})` });
      }
      case 'stop':
        stopResponder(user.workspace);
        return NextResponse.json({ message: 'Responder gestoppt' });
      case 'approve': {
        const convId = body.conversationId as string;
        const edited = body.editedMessage as string | undefined;
        if (!convId) {
          return NextResponse.json({ detail: 'conversationId erforderlich' }, { status: 400 });
        }
        await approvePendingReply(user.workspace, convId, edited);
        return NextResponse.json({ message: 'Antwort gesendet' });
      }
      case 'reject': {
        const convId = body.conversationId as string;
        if (!convId) {
          return NextResponse.json({ detail: 'conversationId erforderlich' }, { status: 400 });
        }
        rejectPendingReply(user.workspace, convId);
        return NextResponse.json({ message: 'Antwort verworfen' });
      }
      default:
        return NextResponse.json({ detail: `Unbekannte Aktion: ${action}` }, { status: 400 });
    }
  } catch (error) {
    return handleApiError(error);
  }
}
