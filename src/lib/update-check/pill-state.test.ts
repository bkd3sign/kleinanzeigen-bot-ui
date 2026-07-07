import { describe, it, expect } from 'vitest';
import {
  isVersionUpToDate,
  todayStamp,
  shouldCheckToday,
  shouldShowPill,
  parseStoredVersion,
} from './pill-state';

describe('isVersionUpToDate', () => {
  it('returns true for equal versions', () => {
    expect(isVersionUpToDate('2.64.0', '2.64.0')).toBe(true);
  });
  it('returns true when current major is newer', () => {
    expect(isVersionUpToDate('3.0.0', '2.99.9')).toBe(true);
  });
  it('returns true when current minor is newer', () => {
    expect(isVersionUpToDate('2.64.0', '2.52.3')).toBe(true);
  });
  it('returns false when latest minor is newer', () => {
    expect(isVersionUpToDate('2.64.0', '2.65.0')).toBe(false);
  });
  it('returns false when latest major is newer', () => {
    expect(isVersionUpToDate('1.99.9', '2.0.0')).toBe(false);
  });
  it('returns false when latest patch is newer', () => {
    expect(isVersionUpToDate('2.64.0', '2.64.1')).toBe(false);
  });
  it('treats a non-numeric (pre-release) segment as 0 instead of NaN', () => {
    // '2.76.0-beta' -> segments [2, 76, 0]; app 2.75.0 is behind -> not up to date.
    expect(isVersionUpToDate('2.75.0', '2.76.0-beta')).toBe(false);
    // Same base version -> up to date.
    expect(isVersionUpToDate('2.76.0', '2.76.0-beta')).toBe(true);
  });
});

describe('todayStamp', () => {
  it('formats a date as YYYY-MM-DD from local calendar parts', () => {
    // Local-constructed date so the assertion is timezone-independent.
    expect(todayStamp(new Date(2026, 6, 1, 13, 37))).toBe('2026-07-01');
  });
});

describe('shouldCheckToday', () => {
  it('returns true when never checked', () => {
    expect(shouldCheckToday(null, '2026-07-01')).toBe(true);
  });
  it('returns true when last check was another day', () => {
    expect(shouldCheckToday('2026-06-30', '2026-07-01')).toBe(true);
  });
  it('returns false when already checked today', () => {
    expect(shouldCheckToday('2026-07-01', '2026-07-01')).toBe(false);
  });
});

describe('shouldShowPill', () => {
  it('returns false when no cached version', () => {
    expect(shouldShowPill(null, null, '2.75.0')).toBe(false);
  });
  it('returns false when the app is already up to date', () => {
    expect(shouldShowPill('2.76.0', null, '2.76.0')).toBe(false);
  });
  it('returns false when the app is newer than the latest release', () => {
    expect(shouldShowPill('2.75.0', null, '2.76.0')).toBe(false);
  });
  it('returns true when outdated and not dismissed', () => {
    expect(shouldShowPill('2.76.0', null, '2.75.0')).toBe(true);
  });
  it('returns false when outdated but this version was dismissed', () => {
    expect(shouldShowPill('2.76.0', '2.76.0', '2.75.0')).toBe(false);
  });
  it('returns true when a newer version than the dismissed one appears', () => {
    expect(shouldShowPill('2.76.0', '2.75.5', '2.75.0')).toBe(true);
  });
});

describe('parseStoredVersion', () => {
  it('returns null for null input', () => {
    expect(parseStoredVersion(null)).toBeNull();
  });
  it('returns null for an empty string', () => {
    expect(parseStoredVersion('')).toBeNull();
  });
  it('returns null for a non-version string', () => {
    expect(parseStoredVersion('latest')).toBeNull();
  });
  it('returns null for a stale old-format JSON cache', () => {
    expect(parseStoredVersion('{"upToDate":false,"latestVersion":"2.76.0"}')).toBeNull();
  });
  it('returns the stored version string', () => {
    expect(parseStoredVersion('2.76.0')).toBe('2.76.0');
  });
});
