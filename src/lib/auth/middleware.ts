import { type NextRequest } from 'next/server';
import { ApiError } from '@/lib/security/validation';
import { decodeJwt } from '@/lib/auth/jwt';
import { loadUsers, ensureJwtSecret, getUserWorkspace } from '@/lib/yaml/users';

export interface AuthUser {
  id: string;
  email: string;
  role: string;
  display_name: string;
  workspace: string;
}

/**
 * Extract Bearer token from request, decode JWT, load user from users.yaml,
 * and verify token_version matches. Returns authenticated user with workspace path.
 */
export async function getCurrentUser(request: NextRequest): Promise<AuthUser> {
  const data = loadUsers();
  if (!data || !data.users?.length) {
    throw new ApiError(401, 'Setup required. No users configured.');
  }

  const authHeader = request.headers.get('authorization');
  let token: string | null = null;
  if (authHeader?.startsWith('Bearer ')) {
    token = authHeader.slice(7);
  }

  if (!token) {
    throw new ApiError(
      401,
      'Authentication required. Provide Authorization: Bearer <token>',
    );
  }

  const secret = ensureJwtSecret(data);
  const payload = decodeJwt(token, secret);

  const userId = payload.sub;
  const user = data.users.find((u) => u.id === userId);
  if (!user) {
    throw new ApiError(401, 'User not found');
  }

  if (payload.tv !== (user.token_version ?? 0)) {
    throw new ApiError(401, 'Token invalidated');
  }

  return {
    id: user.id,
    email: user.email,
    role: user.role,
    display_name: user.display_name ?? '',
    workspace: getUserWorkspace(userId),
  };
}

/**
 * Throw 403 if user is not an admin.
 */
export function requireAdmin(user: AuthUser): void {
  if (user.role !== 'admin') {
    throw new ApiError(403, 'Admin access required');
  }
}
