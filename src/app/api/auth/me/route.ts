import { handleApiError } from '@/lib/api/error-handler';
import { NextRequest, NextResponse } from 'next/server';
import { profileUpdateSchema } from '@/validation/schemas';
import { getCurrentUser } from '@/lib/auth/middleware';
import { loadUsers, saveUsers } from '@/lib/yaml/users';
import { hashPassword } from '@/lib/auth/password';
import { initMessaging } from '@/lib/messaging/gateway';

// Auto-start messaging sessions on first auth check (guaranteed early load)
initMessaging();

export async function GET(request: NextRequest) {
  try {
    const user = await getCurrentUser(request);
    if (!user) {
      return NextResponse.json({ detail: 'Authentication required' }, { status: 401 });
    }
    return NextResponse.json({
      id: user.id,
      email: user.email,
      role: user.role,
      display_name: user.display_name,
    });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PUT(request: NextRequest) {
  try {
    const user = await getCurrentUser(request);
    if (!user) {
      return NextResponse.json({ detail: 'Authentication required' }, { status: 401 });
    }

    const body = await request.json();
    const parsed = profileUpdateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { detail: parsed.error.issues[0]?.message ?? 'Invalid input' },
        { status: 400 },
      );
    }

    const data = await loadUsers();
    if (!data) {
      return NextResponse.json({ detail: 'User store not found' }, { status: 500 });
    }

    const dbUser = data.users?.find((u) => u.id === user.id);
    if (!dbUser) {
      return NextResponse.json({ detail: 'User not found' }, { status: 404 });
    }

    if (parsed.data.display_name !== undefined) {
      dbUser.display_name = parsed.data.display_name;
    }
    if (parsed.data.password) {
      dbUser.password_hash = await hashPassword(parsed.data.password);
      dbUser.token_version = (dbUser.token_version ?? 0) + 1;
    }

    await saveUsers(data);
    return NextResponse.json({ status: 'ok' });
  } catch (error) {
    return handleApiError(error);
  }
}
