import { ApiError } from '@/lib/security/validation';

/**
 * Simple in-memory rate limiter using a sliding window with automatic cleanup.
 */
export class RateLimiter {
  private readonly maxAttempts: number;
  private readonly windowSeconds: number;
  private readonly maxKeys: number = 10_000;
  private attempts: Map<string, number[]> = new Map();
  private callCount: number = 0;

  constructor(maxAttempts: number = 5, windowSeconds: number = 300) {
    this.maxAttempts = maxAttempts;
    this.windowSeconds = windowSeconds;
  }

  /**
   * Check rate limit for a given key. Throws 429 if exceeded.
   * Auto-cleans expired entries every 100 calls.
   */
  check(key: string): void {
    const now = Date.now() / 1000;
    this.callCount += 1;

    if (this.callCount % 100 === 0) {
      this.cleanup();
    }

    let timestamps = this.attempts.get(key) ?? [];
    // Filter to only timestamps within the window
    timestamps = timestamps.filter((t) => now - t < this.windowSeconds);

    if (timestamps.length >= this.maxAttempts) {
      throw new ApiError(
        429,
        `Too many attempts. Try again in ${Math.floor(this.windowSeconds / 60)} minutes.`,
      );
    }

    timestamps.push(now);
    this.attempts.set(key, timestamps);

    // Hard limit: evict oldest keys if too many
    if (this.attempts.size > this.maxKeys) {
      const entries = Array.from(this.attempts.entries());
      entries.sort((a, b) => Math.min(...a[1]) - Math.min(...b[1]));
      for (let i = 0; i < 100 && i < entries.length; i++) {
        this.attempts.delete(entries[i][0]);
      }
    }
  }

  /**
   * Remove expired entries to prevent memory growth.
   */
  cleanup(): void {
    const now = Date.now() / 1000;
    for (const [key, timestamps] of this.attempts.entries()) {
      const valid = timestamps.filter((t) => now - t < this.windowSeconds);
      if (valid.length === 0) {
        this.attempts.delete(key);
      } else {
        this.attempts.set(key, valid);
      }
    }
  }
}

// Pre-configured limiter instances
export const loginLimiter = new RateLimiter(10, 300);
export const registerLimiter = new RateLimiter(5, 600);
export const setupLimiter = new RateLimiter(5, 600);
// AI generation is expensive — limit to 10 requests per minute per user
export const aiLimiter = new RateLimiter(10, 60);
