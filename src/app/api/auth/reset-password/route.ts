import { handleApiError } from '@/lib/api/error-handler';
import { NextRequest, NextResponse } from 'next/server';
import { loadUsers, saveUsers } from '@/lib/yaml/users';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const { token, password } = body as { token?: string; password?: string };

    if (!token || !password) {
      return NextResponse.json({ detail: 'Token and password required' }, { status: 400 });
    }

    if (password.length < 8) {
      return NextResponse.json({ detail: 'Password must be at least 8 characters' }, { status: 400 });
    }

    const data = await loadUsers();
    if (!data) {
      return NextResponse.json({ detail: 'User store not found' }, { status: 500 });
    }

    // Find user by reset token hash
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const target = data.users?.find((u) => {
      const rec = u as unknown as Record<string, unknown>;
      return rec.reset_token_hash === tokenHash;
    });

    if (!target) {
      return NextResponse.json({ detail: 'Invalid or expired reset token' }, { status: 400 });
    }

    // Check expiry
    const rec = target as unknown as Record<string, unknown>;
    const expires = rec.reset_token_expires as string | undefined;
    if (expires && new Date(expires).getTime() < Date.now()) {
      // Clean up expired token
      delete rec.reset_token_hash;
      delete rec.reset_token_expires;
      await saveUsers(data);
      return NextResponse.json({ detail: 'Reset token expired' }, { status: 400 });
    }

    // Set new password
    target.password_hash = await bcrypt.hash(password, 12);

    // Invalidate all existing sessions by bumping token_version
    target.token_version = (target.token_version ?? 0) + 1;

    // Remove reset token
    delete rec.reset_token_hash;
    delete rec.reset_token_expires;

    await saveUsers(data);

    return NextResponse.json({ message: 'Password updated successfully' });
  } catch (error) {
    return handleApiError(error);
  }
}
