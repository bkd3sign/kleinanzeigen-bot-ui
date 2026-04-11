import { handleApiError } from '@/lib/api/error-handler';
import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, requireAdmin } from '@/lib/auth/middleware';
import { loadUsers, saveUsers } from '@/lib/yaml/users';
import crypto from 'crypto';

export async function GET(request: NextRequest) {
  try {
    const user = await getCurrentUser(request);
    requireAdmin(user);

    const data = await loadUsers();
    if (!data) {
      return NextResponse.json({ invites: [], total: 0 });
    }

    const now = Date.now();
    const invites = data.invites ?? [];

    // Auto-purge expired invites
    const active = invites.filter((i) => new Date(i.expires_at).getTime() > now);
    if (active.length < invites.length) {
      data.invites = active;
      await saveUsers(data);
    }

    return NextResponse.json({
      invites: active.map((i) => ({
        token_hash: i.token_hash,
        created_by: i.created_by ?? '',
        created_at: i.created_at ?? '',
        expires_at: i.expires_at ?? '',
      })),
      total: active.length,
    });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser(request);
    requireAdmin(user);

    const data = await loadUsers();
    if (!data) {
      return NextResponse.json({ detail: 'User store not found' }, { status: 500 });
    }

    const invites = data.invites ?? [];
    const rawToken = crypto.randomBytes(32).toString('base64url');
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

    // Only store hash — raw token is returned once and never persisted
    invites.push({
      token_hash: tokenHash,
      created_by: user.id,
      created_at: new Date().toISOString(),
      expires_at: expiresAt,
    });
    data.invites = invites;
    await saveUsers(data);

    return NextResponse.json({ token: rawToken, expires_at: expiresAt });
  } catch (error) {
    return handleApiError(error);
  }
}
