/**
 * Cookie configuration for auth tokens.
 *
 * Secure flag logic:
 *   - Local/LAN (HTTP, default): COOKIE_SECURE unset or =false → secure: false
 *   - Public/HTTPS:              COOKIE_SECURE=true             → secure: true
 */

const IS_SECURE = process.env.COOKIE_SECURE === 'true';

// Long-lived refresh token — httpOnly, only sent to the refresh endpoint
export const REFRESH_COOKIE = 'kb_refresh_token';
export const REFRESH_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: IS_SECURE,
  sameSite: 'strict' as const,
  path: '/api/auth/refresh',
};
export const REFRESH_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

// Short-lived access token mirror — httpOnly, sent to all /api routes (including <img> requests)
export const ACCESS_COOKIE = 'kb_token';
export const ACCESS_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: IS_SECURE,
  sameSite: 'strict' as const,
  path: '/api',
  maxAge: 15 * 60,
};
