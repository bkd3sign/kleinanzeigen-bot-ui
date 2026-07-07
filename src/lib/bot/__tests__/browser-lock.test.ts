// @vitest-environment node
import { describe, it, expect, beforeEach } from 'vitest';
import { acquireBrowserLock, releaseBrowserLock } from '../browser-lock';

const WS = '/test/workspace';

beforeEach(() => {
  // Reset the globalThis lock map between tests
  const g = globalThis as unknown as { __browserLocks?: Map<string, unknown> };
  if (g.__browserLocks) g.__browserLocks.clear();
});

describe('acquireBrowserLock', () => {
  it('returns true when lock is free and sets the owner', () => {
    expect(acquireBrowserLock(WS, 'bot')).toBe(true);
    // Owner is now 'bot' → the other owner cannot acquire.
    expect(acquireBrowserLock(WS, 'vnc')).toBe(false);
  });

  it('returns true when called twice by the same owner (idempotent)', () => {
    expect(acquireBrowserLock(WS, 'vnc')).toBe(true);
    expect(acquireBrowserLock(WS, 'vnc')).toBe(true);
    // Still held by 'vnc' → 'bot' is locked out.
    expect(acquireBrowserLock(WS, 'bot')).toBe(false);
  });

  it('returns false when held by the other owner', () => {
    acquireBrowserLock(WS, 'bot');
    expect(acquireBrowserLock(WS, 'vnc')).toBe(false);
  });
});

describe('releaseBrowserLock', () => {
  it('release by non-owner is a no-op (lock stays with original owner)', () => {
    acquireBrowserLock(WS, 'bot');
    releaseBrowserLock(WS, 'vnc');
    // 'bot' still holds it → 'vnc' still cannot acquire.
    expect(acquireBrowserLock(WS, 'vnc')).toBe(false);
  });

  it('release by owner frees the lock', () => {
    acquireBrowserLock(WS, 'bot');
    releaseBrowserLock(WS, 'bot');
    // Free again → the other owner can now acquire.
    expect(acquireBrowserLock(WS, 'vnc')).toBe(true);
  });
});
