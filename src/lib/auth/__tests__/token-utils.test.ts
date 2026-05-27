import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { parseJwtExp, isTokenNearExpiry, REFRESH_THRESHOLD_MS } from '../token-utils';

function makeToken(payload: Record<string, unknown>): string {
  const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = btoa(JSON.stringify(payload));
  return `${header}.${body}.fakesig`;
}

describe('parseJwtExp', () => {
  it('returns exp from a valid JWT', () => {
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const token = makeToken({ sub: 'u1', exp });
    expect(parseJwtExp(token)).toBe(exp);
  });

  it('returns 0 when token has no exp field', () => {
    const token = makeToken({ sub: 'u1' });
    expect(parseJwtExp(token)).toBe(0);
  });

  it('returns 0 for a malformed JWT (wrong segment count)', () => {
    expect(parseJwtExp('notavalidtoken')).toBe(0);
  });

  it('returns 0 when payload is not valid base64', () => {
    expect(parseJwtExp('header.!!!.sig')).toBe(0);
  });

  it('returns 0 when payload is not JSON', () => {
    const token = `header.${btoa('not json')}.sig`;
    expect(parseJwtExp(token)).toBe(0);
  });
});

describe('isTokenNearExpiry', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns false when token expires well in the future', () => {
    const exp = Math.floor(Date.now() / 1000) + 600; // 10 min left
    const token = makeToken({ exp });
    expect(isTokenNearExpiry(token)).toBe(false);
  });

  it('returns true when token expires within the threshold', () => {
    const exp = Math.floor(Date.now() / 1000) + 60; // 1 min left (< 2 min threshold)
    const token = makeToken({ exp });
    expect(isTokenNearExpiry(token)).toBe(true);
  });

  it('returns true for an already-expired token', () => {
    const exp = Math.floor(Date.now() / 1000) - 10; // expired 10s ago
    const token = makeToken({ exp });
    expect(isTokenNearExpiry(token)).toBe(true);
  });

  it('returns true for a malformed token (parseJwtExp returns 0)', () => {
    // exp=0 → 0*1000 - now < threshold → always near-expiry, triggering a refresh
    expect(isTokenNearExpiry('not.a.token')).toBe(true);
  });

  it('REFRESH_THRESHOLD_MS is 2 minutes', () => {
    expect(REFRESH_THRESHOLD_MS).toBe(2 * 60 * 1000);
  });
});
