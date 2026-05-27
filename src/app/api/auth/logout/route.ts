import { NextResponse } from 'next/server';
import { REFRESH_COOKIE, REFRESH_COOKIE_OPTIONS, ACCESS_COOKIE, ACCESS_COOKIE_OPTIONS } from '@/lib/auth/cookies';

export async function POST() {
  const response = NextResponse.json({ ok: true });
  response.cookies.set(REFRESH_COOKIE, '', { ...REFRESH_COOKIE_OPTIONS, maxAge: 0 });
  response.cookies.set(ACCESS_COOKIE, '', { ...ACCESS_COOKIE_OPTIONS, maxAge: 0 });
  return response;
}
