import { handleApiError } from '@/lib/api/error-handler';
import { NextRequest, NextResponse } from 'next/server';
import { adminUserUpdateSchema } from '@/validation/schemas';
import { getCurrentUser, requireAdmin } from '@/lib/auth/middleware';
import { loadUsers, saveUsers, getUserWorkspace } from '@/lib/yaml/users';
import { rm } from 'fs/promises';

interface RouteContext {
  params: Promise<{ userId: string }>;
}

export async function PUT(request: NextRequest, context: RouteContext) {
  try {
    const user = await getCurrentUser(request);
    requireAdmin(user);

    const { userId } = await context.params;
    const body = await request.json();
    const parsed = adminUserUpdateSchema.safeParse(body);
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

    const target = data.users?.find((u) => u.id === userId);
    if (!target) {
      return NextResponse.json({ detail: 'User not found' }, { status: 404 });
    }

    // Protect owner (first user) from role changes
    if (data.users?.[0]?.id === userId && parsed.data.role !== undefined && parsed.data.role !== 'admin') {
      return NextResponse.json({ detail: 'Cannot change owner role' }, { status: 403 });
    }

    if (parsed.data.role !== undefined) {
      target.role = parsed.data.role;
    }
    if (parsed.data.display_name !== undefined) {
      target.display_name = parsed.data.display_name;
    }

    await saveUsers(data);
    return NextResponse.json({ status: 'ok' });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  try {
    const user = await getCurrentUser(request);
    requireAdmin(user);

    const { userId } = await context.params;

    if (userId === user.id) {
      return NextResponse.json({ detail: 'Cannot delete yourself' }, { status: 400 });
    }

    const data = await loadUsers();
    if (!data) {
      return NextResponse.json({ detail: 'User store not found' }, { status: 500 });
    }

    const target = data.users?.find((u) => u.id === userId);
    if (!target) {
      return NextResponse.json({ detail: 'User not found' }, { status: 404 });
    }

    // Protect owner (first user)
    if (data.users?.[0]?.id === userId) {
      return NextResponse.json({ detail: 'Cannot delete the owner' }, { status: 403 });
    }

    data.users = data.users.filter((u) => u.id !== userId);
    await saveUsers(data);

    // Remove workspace
    const ws = getUserWorkspace(userId);
    try {
      await rm(ws, { recursive: true, force: true });
    } catch (error) {
      // Workspace may not exist
    }

    return NextResponse.json({ status: 'ok', message: `User ${userId} deleted` });
  } catch (error) {
    return handleApiError(error);
  }
}
