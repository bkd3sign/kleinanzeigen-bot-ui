import { describe, it, expect, vi, afterEach } from 'vitest';
import { getCurrentPrice, projectReposts } from '../pricing';
import type { AdListItem } from '@/types/ad';

describe('getCurrentPrice', () => {
  it('returns null when APR is not enabled', () => {
    expect(getCurrentPrice({ price: 100, price_reduction_count: 2 })).toBeNull();
    expect(getCurrentPrice({ price: 100, auto_price_reduction: { enabled: false }, price_reduction_count: 2 })).toBeNull();
  });

  it('returns null when no price is set', () => {
    expect(getCurrentPrice({
      auto_price_reduction: { enabled: true, strategy: 'PERCENTAGE', amount: 10, min_price: 50 },
      price_reduction_count: 2,
    })).toBeNull();
  });

  it('returns null when reduction count is 0', () => {
    expect(getCurrentPrice({
      price: 100,
      auto_price_reduction: { enabled: true, strategy: 'PERCENTAGE', amount: 10, min_price: 50 },
      price_reduction_count: 0,
    })).toBeNull();
  });

  it('calculates PERCENTAGE reductions with rounding', () => {
    const ad = {
      price: 29,
      auto_price_reduction: { enabled: true, strategy: 'PERCENTAGE' as const, amount: 5, min_price: 15 },
      price_reduction_count: 3,
    };
    // 29 * 0.95 = 27.55 → 28, 28 * 0.95 = 26.6 → 27, 27 * 0.95 = 25.65 → 26
    expect(getCurrentPrice(ad)).toBe(26);
  });

  it('calculates FIXED reductions', () => {
    const ad = {
      price: 150,
      auto_price_reduction: { enabled: true, strategy: 'FIXED' as const, amount: 15, min_price: 90 },
      price_reduction_count: 3,
    };
    // 150 - 15 = 135, 135 - 15 = 120, 120 - 15 = 105
    expect(getCurrentPrice(ad)).toBe(105);
  });

  it('clamps to min_price', () => {
    const ad = {
      price: 100,
      auto_price_reduction: { enabled: true, strategy: 'FIXED' as const, amount: 30, min_price: 50 },
      price_reduction_count: 10,
    };
    // 100 → 70 → 50 (clamped), stops at min
    expect(getCurrentPrice(ad)).toBe(50);
  });

  it('handles min_price of 0', () => {
    const ad = {
      price: 10,
      auto_price_reduction: { enabled: true, strategy: 'FIXED' as const, amount: 3, min_price: 0 },
      price_reduction_count: 5,
    };
    // 10 → 7 → 4 → 1 → 0 (clamped)
    expect(getCurrentPrice(ad)).toBe(0);
  });

  it('returns null when strategy or amount is missing', () => {
    expect(getCurrentPrice({
      price: 100,
      auto_price_reduction: { enabled: true, strategy: null, amount: 10, min_price: 50 },
      price_reduction_count: 2,
    })).toBeNull();
    expect(getCurrentPrice({
      price: 100,
      auto_price_reduction: { enabled: true, strategy: 'FIXED', amount: null, min_price: 50 },
      price_reduction_count: 2,
    })).toBeNull();
  });
});

// --- projectReposts ---

const DAY_MS = 86400000;

function makeAd(overrides: Partial<AdListItem> = {}): AdListItem {
  return {
    file: 'ad_test.yaml',
    title: 'Test',
    active: true,
    type: 'OFFER',
    images: 0,
    has_description: true,
    is_changed: false,
    is_orphaned: false,
    repost_count: 0,
    price_reduction_count: 0,
    ...overrides,
  } as AdListItem;
}

describe('projectReposts', () => {
  afterEach(() => { vi.useRealTimers(); });

  it('returns empty when APR is not enabled', () => {
    expect(projectReposts(makeAd({ price: 100 }))).toEqual([]);
    expect(projectReposts(makeAd({ price: 100, auto_price_reduction: { enabled: false } }))).toEqual([]);
  });

  it('returns empty when price is missing', () => {
    const ad = makeAd({ auto_price_reduction: { enabled: true, strategy: 'FIXED', amount: 5, min_price: 1 } });
    expect(projectReposts(ad)).toEqual([]);
  });

  it('projects future reposts for a new ad (no past reposts)', () => {
    vi.useFakeTimers({ now: new Date('2026-04-13T00:00:00Z') });
    const ad = makeAd({
      price: 5,
      republication_interval: 7,
      created_on: '2026-04-06T00:00:00Z',
      updated_on: '2026-04-06T00:00:00Z',
      repost_count: 0,
      price_reduction_count: 0,
      auto_price_reduction: { enabled: true, strategy: 'FIXED', amount: 1, min_price: 3 },
    });

    const result = projectReposts(ad);
    expect(result.every(r => !r.isPast)).toBe(true);
    // First repost: delayed (bot sees repost_count=0, no reduction on 1st publish)
    expect(result[0].repostNumber).toBe(1);
    expect(result[0].isDelayed).toBe(true);
    expect(result[0].price).toBe(5);
    expect(result[0].reducedBy).toBeNull();
    // Second repost: first actual reduction 5 → 4
    expect(result[1].repostNumber).toBe(2);
    expect(result[1].price).toBe(4);
    expect(result[1].reducedBy).toBe(1);
    // Third repost: 4 → 3 (min)
    expect(result[2].repostNumber).toBe(3);
    expect(result[2].price).toBe(3);
    expect(result[2].isFinal).toBe(true);
    expect(result).toHaveLength(3);
  });

  it('includes past reposts with correct prices', () => {
    vi.useFakeTimers({ now: new Date('2026-04-13T00:00:00Z') });
    // With delay_reposts=0: repost #1 is implicit delay, reductions start at #2.
    // repost_count=3, price_reduction_count=2 → reductions at reposts #2 and #3.
    const ad = makeAd({
      price: 10,
      republication_interval: 7,
      created_on: '2026-03-16T00:00:00Z',
      updated_on: '2026-04-06T00:00:00Z',
      repost_count: 3,
      price_reduction_count: 2,
      auto_price_reduction: { enabled: true, strategy: 'FIXED', amount: 2, min_price: 4 },
    });

    const result = projectReposts(ad);
    // Past repost #1: delayed (1st publish, bot sees repost_count=0)
    expect(result[0].isPast).toBe(true);
    expect(result[0].repostNumber).toBe(1);
    expect(result[0].isDelayed).toBe(true);
    expect(result[0].price).toBe(10);
    expect(result[0].reducedBy).toBeNull();
    // Past repost #2: first reduction 10 → 8
    expect(result[1].isPast).toBe(true);
    expect(result[1].repostNumber).toBe(2);
    expect(result[1].price).toBe(8);
    expect(result[1].reducedBy).toBe(2);
    // Past repost #3: second reduction 8 → 6
    expect(result[2].isPast).toBe(true);
    expect(result[2].repostNumber).toBe(3);
    expect(result[2].price).toBe(6);
    expect(result[2].reducedBy).toBe(2);
    // Future repost #4: 6 → 4 (minimum)
    expect(result[3].isPast).toBe(false);
    expect(result[3].repostNumber).toBe(4);
    expect(result[3].price).toBe(4);
    expect(result[3].isFinal).toBe(true);
  });

  it('respects delay_reposts correctly', () => {
    vi.useFakeTimers({ now: new Date('2026-04-13T00:00:00Z') });
    // With delay_reposts=2: bot delays reposts 1-3 (implicit +1), first reduction at #4.
    // repost_count=4, price_reduction_count=1 → one reduction happened at repost #4.
    const ad = makeAd({
      price: 100,
      republication_interval: 7,
      created_on: '2026-03-09T00:00:00Z',
      updated_on: '2026-04-06T00:00:00Z',
      repost_count: 4,
      price_reduction_count: 1,
      auto_price_reduction: { enabled: true, strategy: 'FIXED', amount: 10, min_price: 50, delay_reposts: 2 },
    });

    const result = projectReposts(ad);
    // Past #1: delayed (1 <= 2+1=3)
    expect(result[0].isDelayed).toBe(true);
    expect(result[0].reducedBy).toBeNull();
    expect(result[0].price).toBe(100);
    // Past #2: delayed (2 <= 3)
    expect(result[1].isDelayed).toBe(true);
    expect(result[1].reducedBy).toBeNull();
    // Past #3: delayed (3 <= 3)
    expect(result[2].isDelayed).toBe(true);
    expect(result[2].reducedBy).toBeNull();
    expect(result[2].price).toBe(100);
    // Past #4: not delayed (4 > 3), reduction 100 → 90
    expect(result[3].isDelayed).toBe(false);
    expect(result[3].price).toBe(90);
    expect(result[3].reducedBy).toBe(10);
  });

  it('respects delay_days correctly (uses days since previous publish, not creation)', () => {
    vi.useFakeTimers({ now: new Date('2026-04-13T00:00:00Z') });
    // delay_days=5, interval=7: elapsed between reposts = 7 >= 5 → delay satisfied after implicit +1
    const ad = makeAd({
      price: 50,
      republication_interval: 7,
      created_on: '2026-03-30T00:00:00Z',
      updated_on: '2026-04-06T00:00:00Z',
      repost_count: 1,
      price_reduction_count: 0,
      auto_price_reduction: { enabled: true, strategy: 'FIXED', amount: 5, min_price: 30, delay_days: 5 },
    });

    const result = projectReposts(ad);
    // Past #1: delayed by implicit +1 repost delay
    expect(result[0].isPast).toBe(true);
    expect(result[0].isDelayed).toBe(true);
    expect(result[0].price).toBe(50);
    // Future #2: not delayed (7 days since prev >= 5 delay_days, repost 2 > 1)
    expect(result[1].isPast).toBe(false);
    expect(result[1].isDelayed).toBe(false);
    expect(result[1].price).toBe(45);
    expect(result[1].reducedBy).toBe(5);
  });

  it('delay_days > interval+1 means delay is never satisfied', () => {
    vi.useFakeTimers({ now: new Date('2026-04-13T00:00:00Z') });
    // delay_days=14, interval=7: actual elapsed between reposts = 8 (interval+1) < 14 → never satisfied
    const ad = makeAd({
      price: 50,
      republication_interval: 7,
      created_on: '2026-03-30T00:00:00Z',
      updated_on: '2026-04-06T00:00:00Z',
      repost_count: 1,
      price_reduction_count: 0,
      auto_price_reduction: { enabled: true, strategy: 'FIXED', amount: 5, min_price: 30, delay_days: 14 },
    });

    const result = projectReposts(ad);
    // ALL future steps should be delayed because 8 < 14
    const futureSteps = result.filter(r => !r.isPast);
    expect(futureSteps.every(r => r.isDelayed)).toBe(true);
    expect(futureSteps.every(r => r.price === 50)).toBe(true);
  });

  it('future dates are anchored to getNextRepubDate (updated_on + interval + 1)', () => {
    vi.useFakeTimers({ now: new Date('2026-04-13T00:00:00Z') });
    const ad = makeAd({
      price: 20,
      republication_interval: 7,
      created_on: '2026-03-15T00:00:00Z',
      updated_on: '2026-04-07T00:00:00Z',
      repost_count: 1,
      price_reduction_count: 0,
      auto_price_reduction: { enabled: true, strategy: 'FIXED', amount: 1, min_price: 10 },
    });

    const result = projectReposts(ad);
    const futureSteps = result.filter(r => !r.isPast);
    // Bot: ad_age.days > 7 → earliest at day 8 → Apr 7 + 8 = Apr 15
    expect(futureSteps[0].date.toISOString().slice(0, 10)).toBe('2026-04-15');
    // Second future: Apr 15 + 8 = Apr 23
    expect(futureSteps[1].date.toISOString().slice(0, 10)).toBe('2026-04-23');
  });

  it('stops projecting when min_price is already reached', () => {
    vi.useFakeTimers({ now: new Date('2026-04-13T00:00:00Z') });
    const ad = makeAd({
      price: 10,
      republication_interval: 7,
      created_on: '2026-03-16T00:00:00Z',
      updated_on: '2026-04-06T00:00:00Z',
      repost_count: 3,
      price_reduction_count: 3,
      auto_price_reduction: { enabled: true, strategy: 'FIXED', amount: 5, min_price: 5 },
    });

    const result = projectReposts(ad);
    // Past: 10 → 5 (reached min after 1 reduction), rest are at min
    const futureSteps = result.filter(r => !r.isPast);
    // Should return no future steps since already at minimum
    expect(futureSteps).toHaveLength(0);
  });

  it('respects actual price_reduction_count=0 for past reposts (no guessing)', () => {
    vi.useFakeTimers({ now: new Date('2026-04-13T00:00:00Z') });
    // Selfie stick case: 1 repost happened but 0 reductions applied
    const ad = makeAd({
      price: 5,
      republication_interval: 7,
      created_on: '2026-03-15T00:00:00Z',
      updated_on: '2026-04-07T00:00:00Z',
      repost_count: 1,
      price_reduction_count: 0,
      auto_price_reduction: { enabled: true, strategy: 'FIXED', amount: 1, min_price: 3 },
    });

    const result = projectReposts(ad);
    // Past #1: price stays at 5 because price_reduction_count=0
    expect(result[0].isPast).toBe(true);
    expect(result[0].isMissed).toBe(false);
    expect(result[0].price).toBe(5);
    expect(result[0].reducedBy).toBeNull();
    // Missed intervals between past and future (Mar 29, Apr 5)
    const missed = result.filter(r => r.isMissed);
    expect(missed.length).toBeGreaterThan(0);
    missed.forEach(m => {
      expect(m.isPast).toBe(true);
      expect(m.price).toBe(5);
    });
    // Future steps: first actual reduction 5 → 4
    const future = result.filter(r => !r.isPast);
    expect(future[0].price).toBe(4);
    expect(future[0].reducedBy).toBe(1);
    // Last future: 3 (minimum)
    expect(future[future.length - 1].price).toBe(3);
    expect(future[future.length - 1].isFinal).toBe(true);
  });

  it('handles PERCENTAGE strategy correctly', () => {
    vi.useFakeTimers({ now: new Date('2026-04-13T00:00:00Z') });
    const ad = makeAd({
      price: 150,
      republication_interval: 7,
      created_on: '2026-04-06T00:00:00Z',
      updated_on: '2026-04-06T00:00:00Z',
      repost_count: 0,
      price_reduction_count: 0,
      auto_price_reduction: { enabled: true, strategy: 'PERCENTAGE', amount: 10, min_price: 90 },
    });

    const result = projectReposts(ad);
    // Repost #1: delayed (1st publish, no reduction)
    expect(result[0].price).toBe(150);
    expect(result[0].isDelayed).toBe(true);
    expect(result[0].reducedBy).toBeNull();
    // Repost #2: 150 * 0.9 = 135
    expect(result[1].price).toBe(135);
    expect(result[1].reducedBy).toBe(15);
    // Repost #3: 135 * 0.9 = 121.5 → 122
    expect(result[2].price).toBe(122);
    // Repost #4: 122 * 0.9 = 109.8 → 110
    expect(result[3].price).toBe(110);
    // Repost #5: 110 * 0.9 = 99
    expect(result[4].price).toBe(99);
    // Repost #6: 99 * 0.9 = 89.1 → 89 < 90 → clamped to 90
    expect(result[5].price).toBe(90);
    expect(result[5].isFinal).toBe(true);
    expect(result).toHaveLength(6);
  });
});
