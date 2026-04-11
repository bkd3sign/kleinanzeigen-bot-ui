import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { RateLimiter } from '../rate-limiter';
import { ApiError } from '@/lib/security/validation';

describe('RateLimiter', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('allows attempts within limit', () => {
    const limiter = new RateLimiter(3, 300);
    expect(() => limiter.check('key1')).not.toThrow();
    expect(() => limiter.check('key1')).not.toThrow();
    expect(() => limiter.check('key1')).not.toThrow();
  });

  it('blocks when over limit', () => {
    const limiter = new RateLimiter(3, 300);
    limiter.check('key1');
    limiter.check('key1');
    limiter.check('key1');
    expect(() => limiter.check('key1')).toThrow(ApiError);
    try {
      limiter.check('key1');
    } catch (err) {
      expect((err as ApiError).statusCode).toBe(429);
      expect((err as ApiError).message).toContain('Too many attempts');
    }
  });

  it('tracks different keys independently', () => {
    const limiter = new RateLimiter(2, 300);
    limiter.check('key-a');
    limiter.check('key-a');
    // key-a is now at limit
    expect(() => limiter.check('key-a')).toThrow(ApiError);
    // key-b should still work
    expect(() => limiter.check('key-b')).not.toThrow();
    expect(() => limiter.check('key-b')).not.toThrow();
  });

  it('expires entries after the window passes', () => {
    const limiter = new RateLimiter(2, 60);
    limiter.check('key1');
    limiter.check('key1');
    // At limit
    expect(() => limiter.check('key1')).toThrow(ApiError);

    // Advance time past the window
    vi.advanceTimersByTime(61_000);

    // Should work again since old timestamps are expired
    expect(() => limiter.check('key1')).not.toThrow();
  });

  it('cleanup removes expired entries', () => {
    const limiter = new RateLimiter(5, 10);
    limiter.check('expired-key');

    // Advance time past the window
    vi.advanceTimersByTime(11_000);

    limiter.cleanup();

    // After cleanup, key should allow full attempts again
    for (let i = 0; i < 5; i++) {
      expect(() => limiter.check('expired-key')).not.toThrow();
    }
  });

  it('auto-cleanup triggers every 100 calls', () => {
    const limiter = new RateLimiter(200, 10);
    const cleanupSpy = vi.spyOn(limiter, 'cleanup');

    // Make 99 calls - no cleanup yet
    for (let i = 0; i < 99; i++) {
      limiter.check(`auto-${i}`);
    }
    expect(cleanupSpy).not.toHaveBeenCalled();

    // 100th call triggers cleanup
    limiter.check('auto-99');
    expect(cleanupSpy).toHaveBeenCalledTimes(1);

    // 200th call triggers again
    for (let i = 100; i < 199; i++) {
      limiter.check(`auto-${i}`);
    }
    expect(cleanupSpy).toHaveBeenCalledTimes(1);

    limiter.check('auto-199');
    expect(cleanupSpy).toHaveBeenCalledTimes(2);
  });
});
