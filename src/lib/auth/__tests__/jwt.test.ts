import { describe, it, expect } from 'vitest';
import jwt from 'jsonwebtoken';
import { createJwt, decodeJwt, createRefreshToken, verifyRefreshToken } from '../jwt';
import { ApiError } from '@/lib/security/validation';

const TEST_SECRET = 'test-secret-key-for-jwt-testing';

describe('createJwt', () => {
  it('creates a valid token with all fields', () => {
    const user = { id: 'user-1', email: 'test@example.com', role: 'admin', token_version: 3 };
    const token = createJwt(user, TEST_SECRET);

    expect(typeof token).toBe('string');
    expect(token.split('.')).toHaveLength(3); // JWT has 3 parts

    const decoded = jwt.decode(token) as Record<string, unknown>;
    expect(decoded.sub).toBe('user-1');
    expect(decoded.email).toBe('test@example.com');
    expect(decoded.role).toBe('admin');
    expect(decoded.tv).toBe(3);
    expect(decoded.exp).toBeDefined();
    expect(decoded.iat).toBeDefined();
  });

  it('defaults token_version to 0', () => {
    const user = { id: 'user-1', email: 'test@example.com', role: 'user' };
    const token = createJwt(user, TEST_SECRET);

    const decoded = jwt.decode(token) as Record<string, unknown>;
    expect(decoded.tv).toBe(0);
  });

  it('sets expiry 15 minutes from now', () => {
    const user = { id: 'user-1', email: 'test@example.com', role: 'user' };
    const token = createJwt(user, TEST_SECRET);

    const decoded = jwt.decode(token) as Record<string, unknown>;
    const exp = decoded.exp as number;
    const iat = decoded.iat as number;
    expect(exp - iat).toBe(15 * 60);
  });
});

describe('createRefreshToken', () => {
  it('creates a valid refresh token with type marker', () => {
    const user = { id: 'user-1', token_version: 2 };
    const token = createRefreshToken(user, TEST_SECRET, false);

    expect(typeof token).toBe('string');
    const decoded = jwt.decode(token) as Record<string, unknown>;
    expect(decoded.sub).toBe('user-1');
    expect(decoded.tv).toBe(2);
    expect(decoded.type).toBe('refresh');
  });

  it('sets 1-day expiry when rememberMe is false', () => {
    const user = { id: 'user-1' };
    const token = createRefreshToken(user, TEST_SECRET, false);
    const decoded = jwt.decode(token) as Record<string, unknown>;
    const exp = decoded.exp as number;
    const iat = decoded.iat as number;
    expect(exp - iat).toBe(1 * 24 * 3600);
  });

  it('sets 30-day expiry when rememberMe is true', () => {
    const user = { id: 'user-1' };
    const token = createRefreshToken(user, TEST_SECRET, true);
    const decoded = jwt.decode(token) as Record<string, unknown>;
    const exp = decoded.exp as number;
    const iat = decoded.iat as number;
    expect(exp - iat).toBe(30 * 24 * 3600);
  });

  it('defaults token_version to 0', () => {
    const user = { id: 'user-1' };
    const token = createRefreshToken(user, TEST_SECRET, false);
    const decoded = jwt.decode(token) as Record<string, unknown>;
    expect(decoded.tv).toBe(0);
  });
});

describe('verifyRefreshToken', () => {
  it('verifies a valid refresh token', () => {
    const user = { id: 'user-1', token_version: 3 };
    const token = createRefreshToken(user, TEST_SECRET, true);
    const payload = verifyRefreshToken(token, TEST_SECRET);
    expect(payload.sub).toBe('user-1');
    expect(payload.tv).toBe(3);
    expect(payload.type).toBe('refresh');
  });

  it('roundtrips with tv=0 (default token_version)', () => {
    const user = { id: 'user-1' };
    const token = createRefreshToken(user, TEST_SECRET, false);
    const payload = verifyRefreshToken(token, TEST_SECRET);
    expect(payload.sub).toBe('user-1');
    expect(payload.tv).toBe(0);
    expect(payload.type).toBe('refresh');
  });

  it('throws on access token passed as refresh token', () => {
    const user = { id: 'user-1', email: 'test@example.com', role: 'user' };
    const accessToken = createJwt(user, TEST_SECRET);
    expect(() => verifyRefreshToken(accessToken, TEST_SECRET)).toThrow(ApiError);
    try {
      verifyRefreshToken(accessToken, TEST_SECRET);
    } catch (err) {
      expect((err as ApiError).statusCode).toBe(401);
    }
  });

  it('throws on self-crafted token with type: "access"', () => {
    // Token has a type field, but its value is wrong
    const now = Math.floor(Date.now() / 1000);
    const payload = { sub: 'user-1', tv: 0, type: 'access', iat: now, exp: now + 3600 };
    const token = jwt.sign(payload, TEST_SECRET, { algorithm: 'HS256' });
    expect(() => verifyRefreshToken(token, TEST_SECRET)).toThrow(ApiError);
    try {
      verifyRefreshToken(token, TEST_SECRET);
    } catch (err) {
      expect((err as ApiError).statusCode).toBe(401);
      expect((err as ApiError).message).toBe('Invalid token type');
    }
  });

  it('throws on token without type field (legacy access-style payload)', () => {
    const now = Math.floor(Date.now() / 1000);
    const payload = {
      sub: 'user-1',
      email: 'attacker@example.com',
      role: 'admin',
      tv: 0,
      iat: now,
      exp: now + 3600,
    };
    const token = jwt.sign(payload, TEST_SECRET, { algorithm: 'HS256' });
    expect(() => verifyRefreshToken(token, TEST_SECRET)).toThrow(ApiError);
    try {
      verifyRefreshToken(token, TEST_SECRET);
    } catch (err) {
      expect((err as ApiError).statusCode).toBe(401);
      expect((err as ApiError).message).toBe('Invalid token type');
    }
  });

  it('throws on wrong secret', () => {
    const user = { id: 'user-1' };
    const token = createRefreshToken(user, TEST_SECRET, false);
    expect(() => verifyRefreshToken(token, 'wrong-secret')).toThrow(ApiError);
  });

  it('throws on expired refresh token', () => {
    const now = Math.floor(Date.now() / 1000);
    const payload = { sub: 'user-1', tv: 0, type: 'refresh', iat: now - 7200, exp: now - 3600 };
    const token = jwt.sign(payload, TEST_SECRET, { algorithm: 'HS256' });
    expect(() => verifyRefreshToken(token, TEST_SECRET)).toThrow(ApiError);
    try {
      verifyRefreshToken(token, TEST_SECRET);
    } catch (err) {
      expect((err as ApiError).message).toBe('Refresh token expired');
    }
  });
});

describe('decodeJwt', () => {
  it('decodes a valid token', () => {
    const user = { id: 'user-1', email: 'test@example.com', role: 'admin', token_version: 5 };
    const token = createJwt(user, TEST_SECRET);

    const payload = decodeJwt(token, TEST_SECRET);
    expect(payload.sub).toBe('user-1');
    expect(payload.email).toBe('test@example.com');
    expect(payload.role).toBe('admin');
    expect(payload.tv).toBe(5);
  });

  it('throws on expired token', () => {
    // Manually create an already-expired token
    const now = Math.floor(Date.now() / 1000);
    const payload = {
      sub: 'user-1',
      email: 'test@example.com',
      role: 'user',
      tv: 0,
      iat: now - 7200,
      exp: now - 3600,
    };
    const token = jwt.sign(payload, TEST_SECRET, { algorithm: 'HS256' });

    expect(() => decodeJwt(token, TEST_SECRET)).toThrow(ApiError);
    try {
      decodeJwt(token, TEST_SECRET);
    } catch (err) {
      expect((err as ApiError).statusCode).toBe(401);
      expect((err as ApiError).message).toBe('Token expired');
    }
  });

  it('throws on invalid token', () => {
    expect(() => decodeJwt('not.a.valid.token', TEST_SECRET)).toThrow(ApiError);
    try {
      decodeJwt('garbage', TEST_SECRET);
    } catch (err) {
      expect((err as ApiError).statusCode).toBe(401);
      expect((err as ApiError).message).toBe('Invalid token');
    }
  });

  it('throws on wrong secret', () => {
    const user = { id: 'user-1', email: 'test@example.com', role: 'user' };
    const token = createJwt(user, TEST_SECRET);

    expect(() => decodeJwt(token, 'wrong-secret')).toThrow(ApiError);
    try {
      decodeJwt(token, 'wrong-secret');
    } catch (err) {
      expect((err as ApiError).statusCode).toBe(401);
      expect((err as ApiError).message).toBe('Invalid token');
    }
  });

  it('includes token_version (tv) field', () => {
    const user = { id: 'user-1', email: 'test@example.com', role: 'user', token_version: 42 };
    const token = createJwt(user, TEST_SECRET);
    const payload = decodeJwt(token, TEST_SECRET);
    expect(payload.tv).toBe(42);
  });

  it('rejects a refresh token with Invalid token type', () => {
    const user = { id: 'user-1', token_version: 7 };
    const token = createRefreshToken(user, TEST_SECRET, false);
    expect(() => decodeJwt(token, TEST_SECRET)).toThrow('Invalid token type');
  });
});
