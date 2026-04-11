import { handleApiError } from '@/lib/api/error-handler';
import { NextRequest, NextResponse } from 'next/server';
import { loginSchema } from '@/validation/schemas';
import { loadUsers, ensureJwtSecret } from '@/lib/yaml/users';
import { verifyPassword } from '@/lib/auth/password';
import { createJwt } from '@/lib/auth/jwt';
import { RateLimiter } from '@/lib/auth/rate-limiter';

const loginLimiter = new RateLimiter(10, 300);

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

    const { email, password } = parsed.data;

    // Rate limit by IP + email
    const clientIp = request.headers.get('x-forwarded-for')?.split(',')[0] ?? 'unknown';
    loginLimiter.check(`${clientIp}:${email}`);

    const data = await loadUsers();
    if (!data || !data.users?.length) {
      return NextResponse.json(
        { detail: 'Multi-user mode not enabled' },
        { status: 400 },
      );
    }

    const secret = await ensureJwtSecret(data);
    const user = data.users.find((u) => u.email === email);
    if (!user || !(await verifyPassword(password, user.password_hash))) {
      return NextResponse.json(
        { detail: 'Invalid email or password' },
        { status: 401 },
      );
    }

    const token = await createJwt(user, secret);
    return NextResponse.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        display_name: user.display_name ?? '',
      },
    });
  } catch (error) {
    return handleApiError(error);
  }
}
