import { handleApiError } from '@/lib/api/error-handler';
import { NextRequest, NextResponse } from 'next/server';
import { loadUsers, ensureJwtSecret } from '@/lib/yaml/users';
import { createJwt, verifyRefreshToken } from '@/lib/auth/jwt';
import { REFRESH_COOKIE, ACCESS_COOKIE, ACCESS_COOKIE_OPTIONS } from '@/lib/auth/cookies';

export async function POST(request: NextRequest) {
  try {
    const refreshToken = request.cookies.get(REFRESH_COOKIE)?.value;
    if (!refreshToken) {
      return NextResponse.json({ detail: 'No refresh token' }, { status: 401 });
    }

    const data = loadUsers();
    if (!data || !data.users?.length) {
      return NextResponse.json({ detail: 'Setup required' }, { status: 401 });
    }

    const secret = ensureJwtSecret(data);
    const payload = verifyRefreshToken(refreshToken, secret);

    const user = data.users.find((u) => u.id === payload.sub);
    if (!user) {
      return NextResponse.json({ detail: 'User not found' }, { status: 401 });
    }

    if (payload.tv !== (user.token_version ?? 0)) {
      return NextResponse.json({ detail: 'Token invalidated' }, { status: 401 });
    }

    const newToken = createJwt(user, secret);
    const response = NextResponse.json({ token: newToken });
    response.cookies.set(ACCESS_COOKIE, newToken, ACCESS_COOKIE_OPTIONS);
    return response;
  } catch (error) {
    return handleApiError(error);
  }
}
