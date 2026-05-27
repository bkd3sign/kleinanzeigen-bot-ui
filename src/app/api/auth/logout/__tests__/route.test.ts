import { describe, it, expect } from 'vitest';
import { REFRESH_COOKIE, ACCESS_COOKIE } from '@/lib/auth/cookies';
import { POST } from '../route';

describe('POST /api/auth/logout', () => {
  it('returns 200 with { ok: true }', async () => {
    const response = await POST();
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ ok: true });
  });

  it('clears the REFRESH_COOKIE with maxAge: 0', async () => {
    const response = await POST();
    const cookie = response.cookies.get(REFRESH_COOKIE);
    expect(cookie).toBeDefined();
    expect(cookie?.value).toBe('');
    expect(cookie?.maxAge).toBe(0);
  });

  it('clears the ACCESS_COOKIE with maxAge: 0', async () => {
    const response = await POST();
    const cookie = response.cookies.get(ACCESS_COOKIE);
    expect(cookie).toBeDefined();
    expect(cookie?.value).toBe('');
    expect(cookie?.maxAge).toBe(0);
  });

  it('preserves the REFRESH_COOKIE path scope when clearing', async () => {
    const response = await POST();
    const cookie = response.cookies.get(REFRESH_COOKIE);
    expect(cookie?.path).toBe('/api/auth/refresh');
    expect(cookie?.httpOnly).toBe(true);
    expect(cookie?.sameSite).toBe('strict');
  });

  it('preserves the ACCESS_COOKIE path scope when clearing', async () => {
    const response = await POST();
    const cookie = response.cookies.get(ACCESS_COOKIE);
    expect(cookie?.path).toBe('/api');
    expect(cookie?.httpOnly).toBe(true);
    expect(cookie?.sameSite).toBe('strict');
  });
});
