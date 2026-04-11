import { handleApiError } from '@/lib/api/error-handler';
import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, requireAdmin } from '@/lib/auth/middleware';
import { loadUsers, saveUsers } from '@/lib/yaml/users';
import crypto from 'crypto';

interface RouteContext {
  params: Promise<{ userId: string }>;
}

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const user = await getCurrentUser(request);
    requireAdmin(user);

    const { userId } = await context.params;

    const data = await loadUsers();
    if (!data) {
      return NextResponse.json({ detail: 'User store not found' }, { status: 500 });
    }

    const target = data.users?.find((u) => u.id === userId);
    if (!target) {
      return NextResponse.json({ detail: 'User not found' }, { status: 404 });
    }

    // Generate reset token
    const rawToken = crypto.randomBytes(32).toString('base64url');
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(); // 24h

    // Store reset token on user
    (target as unknown as Record<string, unknown>).reset_token_hash = tokenHash;
    (target as unknown as Record<string, unknown>).reset_token_expires = expiresAt;

    await saveUsers(data);

    return NextResponse.json({
      token: rawToken,
      expires_at: expiresAt,
      user_id: userId,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
