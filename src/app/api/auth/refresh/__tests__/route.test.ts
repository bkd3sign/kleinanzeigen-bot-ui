import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import jwt from 'jsonwebtoken';
import { createRefreshToken, createJwt } from '@/lib/auth/jwt';
import { REFRESH_COOKIE, ACCESS_COOKIE } from '@/lib/auth/cookies';

// Mock the YAML loader so we don't touch the filesystem
vi.mock('@/lib/yaml/users', () => ({
  loadUsers: vi.fn(),
  ensureJwtSecret: vi.fn(),
}));

import { loadUsers, ensureJwtSecret } from '@/lib/yaml/users';
import { POST } from '../route';

const TEST_SECRET = 'test-secret-key-for-refresh-route-tests';

type MockUser = {
  id: string;
  email: string;
  role: 'admin' | 'user';
  display_name: string;
  password_hash: string;
  token_version?: number;
  created_at: string;
};

function makeUser(overrides: Partial<MockUser> = {}): MockUser {
  return {
    id: 'user-1',
    email: 'test@example.com',
    role: 'user',
    display_name: 'Test User',
    password_hash: 'hashed',
    token_version: 0,
    created_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

function buildRequest(cookieValue?: string): NextRequest {
  const headers: Record<string, string> = {};
  if (cookieValue !== undefined) {
    headers.cookie = `${REFRESH_COOKIE}=${cookieValue}`;
  }
  return new NextRequest('http://localhost/api/auth/refresh', {
    method: 'POST',
    headers,
  });
}

describe('POST /api/auth/refresh', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(ensureJwtSecret).mockReturnValue(TEST_SECRET);
  });

  it('returns 401 when no refresh cookie is present', async () => {
    const response = await POST(buildRequest());
    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.detail).toBe('No refresh token');
  });

  it('returns 401 when users.yaml has no users (setup required)', async () => {
    vi.mocked(loadUsers).mockReturnValue({ users: [], invites: [] });
    const user = makeUser();
    const refreshToken = createRefreshToken(user, TEST_SECRET, true);

    const response = await POST(buildRequest(refreshToken));
    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.detail).toBe('Setup required');
  });

  it('returns 401 when loadUsers returns null', async () => {
    vi.mocked(loadUsers).mockReturnValue(null);
    const user = makeUser();
    const refreshToken = createRefreshToken(user, TEST_SECRET, true);

    const response = await POST(buildRequest(refreshToken));
    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.detail).toBe('Setup required');
  });

  it('returns 200 with a fresh access token on valid refresh', async () => {
    const user = makeUser({ token_version: 2 });
    vi.mocked(loadUsers).mockReturnValue({ users: [user], invites: [] });
    const refreshToken = createRefreshToken(user, TEST_SECRET, true);

    const response = await POST(buildRequest(refreshToken));
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(typeof body.token).toBe('string');

    const decoded = jwt.decode(body.token) as Record<string, unknown>;
    expect(decoded.sub).toBe('user-1');
    expect(decoded.email).toBe('test@example.com');
    expect(decoded.role).toBe('user');
    expect(decoded.tv).toBe(2);
  });

  it('sets the ACCESS_COOKIE on a successful refresh', async () => {
    const user = makeUser({ token_version: 1 });
    vi.mocked(loadUsers).mockReturnValue({ users: [user], invites: [] });
    const refreshToken = createRefreshToken(user, TEST_SECRET, false);

    const response = await POST(buildRequest(refreshToken));
    expect(response.status).toBe(200);

    const setCookie = response.cookies.get(ACCESS_COOKIE);
    expect(setCookie).toBeDefined();
    expect(setCookie?.value).toBeTruthy();
    expect(setCookie?.value).toBe((await response.json()).token);
  });

  it('returns 401 when payload.tv mismatches user.token_version (token invalidated)', async () => {
    // Token was issued for tv=2, but user has since been bumped to tv=5
    const tokenForUser = makeUser({ token_version: 2 });
    const refreshToken = createRefreshToken(tokenForUser, TEST_SECRET, true);

    const currentUser = makeUser({ token_version: 5 });
    vi.mocked(loadUsers).mockReturnValue({ users: [currentUser], invites: [] });

    const response = await POST(buildRequest(refreshToken));
    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.detail).toBe('Token invalidated');
  });

  it('treats missing token_version on user as 0', async () => {
    // Token has tv=0, user record has no token_version field at all
    const tokenForUser = makeUser({ token_version: 0 });
    const refreshToken = createRefreshToken(tokenForUser, TEST_SECRET, true);

    const userWithoutTv = makeUser();
    delete userWithoutTv.token_version;
    vi.mocked(loadUsers).mockReturnValue({ users: [userWithoutTv], invites: [] });

    const response = await POST(buildRequest(refreshToken));
    expect(response.status).toBe(200);
  });

  it('returns 401 when the user from the token sub is no longer in users.yaml', async () => {
    const deletedUser = makeUser({ id: 'ghost-user' });
    const refreshToken = createRefreshToken(deletedUser, TEST_SECRET, true);

    const otherUser = makeUser({ id: 'someone-else' });
    vi.mocked(loadUsers).mockReturnValue({ users: [otherUser], invites: [] });

    const response = await POST(buildRequest(refreshToken));
    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.detail).toBe('User not found');
  });

  it('returns 401 when the refresh cookie is not a valid JWT', async () => {
    vi.mocked(loadUsers).mockReturnValue({ users: [makeUser()], invites: [] });

    const response = await POST(buildRequest('not.a.valid.token'));
    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.detail).toBe('Invalid refresh token');
  });

  it('returns 401 when the refresh cookie is expired', async () => {
    vi.mocked(loadUsers).mockReturnValue({ users: [makeUser()], invites: [] });

    const now = Math.floor(Date.now() / 1000);
    const expiredPayload = {
      sub: 'user-1',
      tv: 0,
      type: 'refresh',
      iat: now - 7200,
      exp: now - 3600,
    };
    const expired = jwt.sign(expiredPayload, TEST_SECRET, { algorithm: 'HS256' });

    const response = await POST(buildRequest(expired));
    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.detail).toBe('Refresh token expired');
  });

  it('returns 401 when an access token is supplied instead of a refresh token', async () => {
    const user = makeUser();
    vi.mocked(loadUsers).mockReturnValue({ users: [user], invites: [] });
    const accessToken = createJwt(user, TEST_SECRET);

    const response = await POST(buildRequest(accessToken));
    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.detail).toBe('Invalid token type');
  });

  it('returns 401 when the refresh cookie was signed with a different secret', async () => {
    vi.mocked(loadUsers).mockReturnValue({ users: [makeUser()], invites: [] });
    const refreshToken = createRefreshToken(makeUser(), 'attacker-secret', true);

    const response = await POST(buildRequest(refreshToken));
    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.detail).toBe('Invalid refresh token');
  });
});
