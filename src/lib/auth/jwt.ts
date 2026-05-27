import jwt from 'jsonwebtoken';
import { ApiError } from '@/lib/security/validation';

const JWT_EXPIRY_MINUTES = 15;
const REFRESH_EXPIRY_DAYS_REMEMBER = 30;
const REFRESH_EXPIRY_DAYS_SESSION = 1; // Safety net when no rememberMe

export interface JwtPayload {
  sub: string;
  email: string;
  role: string;
  tv: number;
  exp: number;
  iat: number;
}

export interface RefreshPayload {
  sub: string;
  tv: number;
  type: 'refresh';
  exp: number;
  iat: number;
}

export function createJwt(
  user: { id: string; email: string; role: string; token_version?: number },
  secret: string,
): string {
  const now = Math.floor(Date.now() / 1000);
  const payload: JwtPayload = {
    sub: user.id,
    email: user.email,
    role: user.role,
    tv: user.token_version ?? 0,
    exp: now + JWT_EXPIRY_MINUTES * 60,
    iat: now,
  };
  return jwt.sign(payload, secret, { algorithm: 'HS256' });
}

export function createRefreshToken(
  user: { id: string; token_version?: number },
  secret: string,
  rememberMe: boolean,
): string {
  const days = rememberMe ? REFRESH_EXPIRY_DAYS_REMEMBER : REFRESH_EXPIRY_DAYS_SESSION;
  const now = Math.floor(Date.now() / 1000);
  const payload: RefreshPayload = {
    sub: user.id,
    tv: user.token_version ?? 0,
    type: 'refresh',
    exp: now + days * 24 * 3600,
    iat: now,
  };
  return jwt.sign(payload, secret, { algorithm: 'HS256' });
}

export function decodeJwt(token: string, secret: string): JwtPayload {
  try {
    const payload = jwt.verify(token, secret, { algorithms: ['HS256'] }) as JwtPayload & { type?: string };
    if (payload.type === 'refresh') {
      throw new ApiError(401, 'Invalid token type');
    }
    return payload;
  } catch (err) {
    if (err instanceof ApiError) throw err;
    if (err instanceof jwt.TokenExpiredError) {
      throw new ApiError(401, 'Token expired');
    }
    throw new ApiError(401, 'Invalid token');
  }
}

export function verifyRefreshToken(token: string, secret: string): RefreshPayload {
  try {
    const payload = jwt.verify(token, secret, { algorithms: ['HS256'] }) as RefreshPayload;
    if (payload.type !== 'refresh') {
      throw new ApiError(401, 'Invalid token type');
    }
    return payload;
  } catch (err) {
    if (err instanceof ApiError) throw err;
    if (err instanceof jwt.TokenExpiredError) {
      throw new ApiError(401, 'Refresh token expired');
    }
    throw new ApiError(401, 'Invalid refresh token');
  }
}
