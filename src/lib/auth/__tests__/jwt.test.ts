import { describe, it, expect } from 'vitest';
import jwt from 'jsonwebtoken';
import { createJwt, decodeJwt } from '../jwt';
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

  it('sets expiry 4 hours from now', () => {
    const user = { id: 'user-1', email: 'test@example.com', role: 'user' };
    const token = createJwt(user, TEST_SECRET);

    const decoded = jwt.decode(token) as Record<string, unknown>;
    const exp = decoded.exp as number;
    const iat = decoded.iat as number;
    expect(exp - iat).toBe(4 * 3600);
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
});
