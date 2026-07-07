import { describe, it, expect, vi, afterEach } from 'vitest';
import { getNextRepubDate, getExpiryDate, isExpired, isExpiringSoon, getExpiryDaysLeft, liveDeleteAvailability, getStatusLabel, getStatusVariant } from '../status';
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

  it('calculates from updated_on + interval (bot due at ad_age >= interval, fix #1099)', () => {
    const ad = makeAd({ updated_on: '2026-01-01T00:00:00Z', republication_interval: 7 });
    const result = getNextRepubDate(ad);
    // Bot: ad_age.days >= 7 → earliest at day 7 → Jan 1 + 7 = Jan 8
    expect(result).toEqual(new Date('2026-01-08T00:00:00Z'));
  });

  it('falls back to created_on when no updated_on', () => {
    const ad = makeAd({ created_on: '2026-03-10T12:00:00Z', republication_interval: 14 });
    const result = getNextRepubDate(ad);
    // Mar 10 + 14d = Mar 24
    expect(result).toEqual(new Date('2026-03-24T12:00:00Z'));
  });

  it('prefers updated_on over created_on', () => {
    const ad = makeAd({
      created_on: '2026-01-01T00:00:00Z',
      updated_on: '2026-02-01T00:00:00Z',
      republication_interval: 7,
    });
    const result = getNextRepubDate(ad);
    // Feb 1 + 7d = Feb 8
    expect(result).toEqual(new Date('2026-02-08T00:00:00Z'));
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

describe('getStatusLabel', () => {
  it('returns Entwurf for an ad without id', () => {
    expect(getStatusLabel(makeAd())).toBe('Entwurf');
  });

  it('returns Reserviert when stats report paused', () => {
    expect(getStatusLabel(makeAd({ id: 1 }), { state: 'paused' } as never)).toBe('Reserviert');
  });

  it('returns Verwaist for an orphaned ad even when also inactive (orphaned wins over Inaktiv)', () => {
    expect(getStatusLabel(makeAd({ id: 1, active: false, is_orphaned: true }))).toBe('Verwaist');
  });

  it('returns Inaktiv for an inactive ad that is still online (not orphaned)', () => {
    expect(getStatusLabel(makeAd({ id: 1, active: false, is_orphaned: false }))).toBe('Inaktiv');
  });

  it('returns Aktiv for an active, online, unchanged ad', () => {
    expect(getStatusLabel(makeAd({ id: 1, active: true, is_orphaned: false }))).toBe('Aktiv');
  });
});

describe('getStatusVariant', () => {
  it('maps Verwaist to warning (not danger)', () => {
    expect(getStatusVariant('Verwaist')).toBe('warning');
  });

  it('maps Inaktiv to danger', () => {
    expect(getStatusVariant('Inaktiv')).toBe('danger');
  });

  it('maps every status label to a variant', () => {
    const labels = ['Entwurf', 'Reserviert', 'Verwaist', 'Inaktiv', 'Abgelaufen', 'Läuft bald ab', 'Geändert', 'Aktiv'] as const;
    for (const l of labels) expect(typeof getStatusVariant(l)).toBe('string');
  });
});

describe('liveDeleteAvailability', () => {
  it('hides delete for drafts (no id)', () => {
    expect(liveDeleteAvailability(makeAd())).toBe('hidden');
  });

  it('hides delete for orphaned ads (gone from KA)', () => {
    expect(liveDeleteAvailability(makeAd({ id: 123, is_orphaned: true }))).toBe('hidden');
  });

  it('hides delete for orphaned ads even when also inactive (orphaned wins over active)', () => {
    // getStatusLabel would label this "Inaktiv", but it is actually gone from KA.
    expect(liveDeleteAvailability(makeAd({ id: 123, active: false, is_orphaned: true }))).toBe('hidden');
  });

  it('blocks delete for inactive-but-online ads (e.g. reserved) → activate first', () => {
    expect(liveDeleteAvailability(makeAd({ id: 123, active: false, is_orphaned: false }))).toBe('blocked');
  });

  it('allows normal delete for active, online listings', () => {
    expect(liveDeleteAvailability(makeAd({ id: 123, active: true, is_orphaned: false }))).toBe('normal');
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
