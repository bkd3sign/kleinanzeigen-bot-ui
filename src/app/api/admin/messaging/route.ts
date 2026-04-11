import { handleApiError } from '@/lib/api/error-handler';
import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, requireAdmin } from '@/lib/auth/middleware';
import { getMessagingStatus } from '@/lib/messaging/gateway';
import { getResponderStatus, readAiStats } from '@/lib/messaging/responder';
import { loadUsers } from '@/lib/yaml/users';
import { getUserWorkspace } from '@/lib/yaml/users';

/**
 * GET: Admin overview of all users' messaging/KI status.
 */
export async function GET(request: NextRequest) {
  try {
    const user = await getCurrentUser(request);
    if (!user) {
      return NextResponse.json({ detail: 'Authentication required' }, { status: 401 });
    }
    requireAdmin(user);

    const data = loadUsers();
    if (!data?.users) {
      return NextResponse.json({ users: [] });
    }

    const users = await Promise.all(data.users.map(async (u) => {
      const ws = getUserWorkspace(u.id as string);
      const session = await getMessagingStatus(ws);
      const responder = getResponderStatus(ws);
      const aiStats = readAiStats(ws);

      return {
        id: u.id,
        display_name: u.display_name ?? u.email ?? u.id,
        email: u.email,
        messaging: {
          sessionStatus: session.status,
          mode: responder.mode,
          running: responder.running,
          lastPoll: responder.lastPoll,
          sentCount: responder.sentCount,
          pendingCount: responder.pendingCount,
        },
        aiAdGen: {
          adGenerations: aiStats.adGenerations,
          adImageAnalyses: aiStats.adImageAnalyses,
        },
      };
    }));

    return NextResponse.json({ users });
  } catch (error) {
    return handleApiError(error);
  }
}
