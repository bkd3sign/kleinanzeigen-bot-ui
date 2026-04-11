import { handleApiError } from '@/lib/api/error-handler';
import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, requireAdmin } from '@/lib/auth/middleware';
import { loadUsers, saveUsers } from '@/lib/yaml/users';

interface RouteContext {
  params: Promise<{ tokenHash: string }>;
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  try {
    const user = await getCurrentUser(request);
    requireAdmin(user);

    const { tokenHash } = await context.params;
    const data = await loadUsers();
    if (!data) {
      return NextResponse.json({ detail: 'User store not found' }, { status: 500 });
    }

    const invites = data.invites ?? [];
    const originalLen = invites.length;
    data.invites = invites.filter((i) => i.token_hash !== tokenHash);

    if (data.invites.length === originalLen) {
      return NextResponse.json({ detail: 'Invite not found' }, { status: 404 });
    }

    await saveUsers(data);
    return NextResponse.json({ status: 'ok' });
  } catch (error) {
    return handleApiError(error);
  }
}
