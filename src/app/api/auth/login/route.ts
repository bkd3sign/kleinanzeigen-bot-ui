import { handleApiError } from '@/lib/api/error-handler';
import { NextRequest, NextResponse } from 'next/server';
import { loginSchema } from '@/validation/schemas';
import { loadUsers, ensureJwtSecret } from '@/lib/yaml/users';
import { verifyPassword } from '@/lib/auth/password';
import { createJwt, createRefreshToken } from '@/lib/auth/jwt';
import { REFRESH_COOKIE, REFRESH_COOKIE_OPTIONS, REFRESH_MAX_AGE_SECONDS, ACCESS_COOKIE, ACCESS_COOKIE_OPTIONS } from '@/lib/auth/cookies';
import { loginLimiter } from '@/lib/auth/rate-limiter';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const parsed = loginSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { detail: parsed.error.issues[0]?.message ?? 'Invalid input' },
        { status: 400 },
      );
    }

    const { email, password, rememberMe } = parsed.data;

    const clientIp = request.headers.get('x-forwarded-for')?.split(',')[0] ?? 'unknown';
    loginLimiter.check(`${clientIp}:${email}`);

    const data = loadUsers();
    if (!data || !data.users?.length) {
      return NextResponse.json(
        { detail: 'Multi-user mode not enabled' },
        { status: 400 },
      );
    }

    const secret = ensureJwtSecret(data);
    const user = data.users.find((u) => u.email === email);
    if (!user || !(await verifyPassword(password, user.password_hash))) {
      return NextResponse.json(
        { detail: 'Invalid email or password' },
        { status: 401 },
      );
    }

    const token = createJwt(user, secret);
    const refreshToken = createRefreshToken(user, secret, !!rememberMe);

    const response = NextResponse.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        display_name: user.display_name ?? '',
      },
    });

    response.cookies.set(REFRESH_COOKIE, refreshToken, {
      ...REFRESH_COOKIE_OPTIONS,
      ...(rememberMe ? { maxAge: REFRESH_MAX_AGE_SECONDS } : {}),
    });
    response.cookies.set(ACCESS_COOKIE, token, ACCESS_COOKIE_OPTIONS);

    return response;
  } catch (error) {
    return handleApiError(error);
  }
}
