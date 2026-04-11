import jwt from 'jsonwebtoken';
import { ApiError } from '@/lib/security/validation';

const JWT_EXPIRY_HOURS = 4;

export interface JwtPayload {
  sub: string;
  email: string;
  role: string;
  tv: number;
  exp: number;
  iat: number;
}

/**
 * Create a JWT with user id, email, role, token_version, exp (4h), iat.
 */
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
    exp: now + JWT_EXPIRY_HOURS * 3600,
    iat: now,
  };
  return jwt.sign(payload, secret, { algorithm: 'HS256' });
}

/**
 * Decode and verify a JWT. Returns the payload or throws on invalid/expired tokens.
 */
export function decodeJwt(token: string, secret: string): JwtPayload {
  try {
    return jwt.verify(token, secret, { algorithms: ['HS256'] }) as JwtPayload;
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) {
      throw new ApiError(401, 'Token expired');
    }
    throw new ApiError(401, 'Invalid token');
  }
}
