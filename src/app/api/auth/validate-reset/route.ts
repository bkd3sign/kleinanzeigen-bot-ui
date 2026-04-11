import { NextRequest, NextResponse } from 'next/server';
import { loadUsers } from '@/lib/yaml/users';
import crypto from 'crypto';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const { token } = body as { token?: string };

    if (!token) {
      return NextResponse.json({ valid: false }, { status: 400 });
    }

    const data = await loadUsers();
    if (!data) {
      return NextResponse.json({ valid: false }, { status: 400 });
    }

    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const target = data.users?.find((u) => {
      const rec = u as unknown as Record<string, unknown>;
      return rec.reset_token_hash === tokenHash;
    });

    if (!target) {
      return NextResponse.json({ valid: false });
    }

    const rec = target as unknown as Record<string, unknown>;
    const expires = rec.reset_token_expires as string | undefined;
    if (expires && new Date(expires).getTime() < Date.now()) {
      return NextResponse.json({ valid: false });
    }

    return NextResponse.json({ valid: true });
  } catch (error) {
    return NextResponse.json({ valid: false }, { status: 500 });
  }
}
