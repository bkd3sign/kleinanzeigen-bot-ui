import { handleApiError } from '@/lib/api/error-handler';
import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, requireAdmin } from '@/lib/auth/middleware';
import { loadUsers } from '@/lib/yaml/users';

export async function GET(request: NextRequest) {
  try {
    const user = await getCurrentUser(request);
    requireAdmin(user);

    const data = await loadUsers();
    const users = data?.users ?? [];
    return NextResponse.json({
      users: users.map((u) => ({
        id: u.id,
        email: u.email,
        role: u.role,
        display_name: u.display_name ?? '',
        created_at: u.created_at ?? '',
      })),
      total: users.length,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
