import { describe, it, expect, vi, afterEach } from 'vitest';
import { getNextRepubDate, getExpiryDate, isExpired, isExpiringSoon, getExpiryDaysLeft } from '../status';
import type { AdListItem } from '@/types/ad';

function makeAd(overrides: Partial<AdListItem> = {}): AdListItem {
  return {
    file: 'ad_test.yaml',
    title: 'Test',
    active: true,
    price_reduction_count: 0,
    ...overrides,
  } as AdListItem;
}

const DAY_MS = 86400000;

describe('getNextRepubDate', () => {
  it('returns null when no base date', () => {
    expect(getNextRepubDate(makeAd({ republication_interval: 7 }))).toBeNull();
  });

  it('returns null when no interval', () => {
    expect(getNextRepubDate(makeAd({ updated_on: '2026-01-01T00:00:00Z' }))).toBeNull();
  });

  it('returns null for invalid date', () => {
    expect(getNextRepubDate(makeAd({ updated_on: 'not-a-date', republication_interval: 7 }))).toBeNull();
  });

  it('calculates from updated_on + interval + 1 (bot uses strict greater-than)', () => {
    const ad = makeAd({ updated_on: '2026-01-01T00:00:00Z', republication_interval: 7 });
    const result = getNextRepubDate(ad);
    // Bot: ad_age.days > 7 → earliest at day 8 → Jan 1 + 8 = Jan 9
    expect(result).toEqual(new Date('2026-01-09T00:00:00Z'));
  });

  it('falls back to created_on when no updated_on', () => {
    const ad = makeAd({ created_on: '2026-03-10T12:00:00Z', republication_interval: 14 });
    const result = getNextRepubDate(ad);
    // Mar 10 + 15d = Mar 25
    expect(result).toEqual(new Date('2026-03-25T12:00:00Z'));
  });

  it('prefers updated_on over created_on', () => {
    const ad = makeAd({
      created_on: '2026-01-01T00:00:00Z',
      updated_on: '2026-02-01T00:00:00Z',
      republication_interval: 7,
    });
    const result = getNextRepubDate(ad);
    // Feb 1 + 8d = Feb 9
    expect(result).toEqual(new Date('2026-02-09T00:00:00Z'));
  });
});

describe('getExpiryDate', () => {
  it('returns null when no base date', () => {
    expect(getExpiryDate(makeAd())).toBeNull();
  });

  it('returns null for invalid date', () => {
    expect(getExpiryDate(makeAd({ updated_on: 'not-a-date' }))).toBeNull();
  });

  it('calculates updated_on + 60 days', () => {
    const ad = makeAd({ updated_on: '2026-01-01T00:00:00Z' });
    expect(getExpiryDate(ad)).toEqual(new Date('2026-03-02T00:00:00Z'));
  });

  it('falls back to created_on', () => {
    const ad = makeAd({ created_on: '2026-01-01T00:00:00Z' });
    expect(getExpiryDate(ad)).toEqual(new Date('2026-03-02T00:00:00Z'));
  });

  it('prefers updated_on over created_on', () => {
    const ad = makeAd({ created_on: '2026-01-01T00:00:00Z', updated_on: '2026-02-01T00:00:00Z' });
    expect(getExpiryDate(ad)).toEqual(new Date('2026-04-02T00:00:00Z'));
  });
});

describe('isExpired', () => {
  afterEach(() => vi.useRealTimers());

  it('returns false for drafts (no id)', () => {
    const ad = makeAd({ updated_on: '2020-01-01T00:00:00Z' });
    expect(isExpired(ad)).toBe(false);
  });

  it('returns false when no base date', () => {
    const ad = makeAd({ id: 123 });
    expect(isExpired(ad)).toBe(false);
  });

  it('returns true when past 60 days', () => {
    vi.useFakeTimers({ now: new Date('2026-04-01T00:00:00Z') });
    const ad = makeAd({ id: 123, updated_on: '2026-01-01T00:00:00Z' });
    // Expiry: Jan 1 + 60d = Mar 2. Now: Apr 1. Expired.
    expect(isExpired(ad)).toBe(true);
  });

  it('returns false when within 60 days', () => {
    vi.useFakeTimers({ now: new Date('2026-02-15T00:00:00Z') });
    const ad = makeAd({ id: 123, updated_on: '2026-01-01T00:00:00Z' });
    // Expiry: Mar 2. Now: Feb 15. Not expired.
    expect(isExpired(ad)).toBe(false);
  });

  it('returns true exactly at 60 days', () => {
    vi.useFakeTimers({ now: new Date('2026-03-02T00:00:00Z') });
    const ad = makeAd({ id: 123, updated_on: '2026-01-01T00:00:00Z' });
    // Expiry: Mar 2 00:00. Now: Mar 2 00:00. Expired.
    expect(isExpired(ad)).toBe(true);
  });
});

describe('isExpiringSoon', () => {
  afterEach(() => vi.useRealTimers());

  it('returns false for drafts', () => {
    vi.useFakeTimers({ now: new Date('2026-02-25T00:00:00Z') });
    const ad = makeAd({ updated_on: '2026-01-01T00:00:00Z' });
    expect(isExpiringSoon(ad)).toBe(false);
  });

  it('returns true within 7 days of 60-day expiry', () => {
    vi.useFakeTimers({ now: new Date('2026-02-25T00:00:00Z') });
    const ad = makeAd({ id: 123, updated_on: '2026-01-01T00:00:00Z' });
    // Expiry: Mar 2. Now: Feb 25. 5 days left → within 7-day window.
    expect(isExpiringSoon(ad)).toBe(true);
  });

  it('returns false when more than 7 days left', () => {
    vi.useFakeTimers({ now: new Date('2026-02-15T00:00:00Z') });
    const ad = makeAd({ id: 123, updated_on: '2026-01-01T00:00:00Z' });
    // Expiry: Mar 2. Now: Feb 15. 15 days left → outside window.
    expect(isExpiringSoon(ad)).toBe(false);
  });

  it('returns false when already expired', () => {
    vi.useFakeTimers({ now: new Date('2026-04-01T00:00:00Z') });
    const ad = makeAd({ id: 123, updated_on: '2026-01-01T00:00:00Z' });
    // Expiry: Mar 2. Now: Apr 1. Already expired → not "expiring soon".
    expect(isExpiringSoon(ad)).toBe(false);
  });

  it('returns true at exactly 7 days before expiry', () => {
    vi.useFakeTimers({ now: new Date('2026-02-23T00:00:00Z') });
    const ad = makeAd({ id: 123, updated_on: '2026-01-01T00:00:00Z' });
    // Expiry: Mar 2. Now: Feb 23. Exactly 7 days → within window.
    expect(isExpiringSoon(ad)).toBe(true);
  });
});

describe('getExpiryDaysLeft', () => {
  afterEach(() => vi.useRealTimers());

  it('returns 0 when no base date', () => {
    expect(getExpiryDaysLeft(makeAd())).toBe(0);
  });

  it('returns positive days when not expired', () => {
    vi.useFakeTimers({ now: new Date('2026-02-01T00:00:00Z') });
    const ad = makeAd({ updated_on: '2026-01-01T00:00:00Z' });
    // Expiry: Mar 2. Now: Feb 1. 29 days left.
    expect(getExpiryDaysLeft(ad)).toBe(29);
  });

  it('returns negative days when overdue', () => {
    vi.useFakeTimers({ now: new Date('2026-04-01T00:00:00Z') });
    const ad = makeAd({ updated_on: '2026-01-01T00:00:00Z' });
    // Expiry: Mar 2. Now: Apr 1. 30 days overdue.
    expect(getExpiryDaysLeft(ad)).toBe(-30);
  });

  it('rounds up partial days', () => {
    vi.useFakeTimers({ now: new Date('2026-02-28T12:00:00Z') });
    const ad = makeAd({ updated_on: '2026-01-01T00:00:00Z' });
    // Expiry: Mar 2 00:00. Now: Feb 28 12:00. 1.5 days → ceil → 2.
    expect(getExpiryDaysLeft(ad)).toBe(2);
  });
});
