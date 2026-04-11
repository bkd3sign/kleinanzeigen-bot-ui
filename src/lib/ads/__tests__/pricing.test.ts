import { describe, it, expect } from 'vitest';
import { getCurrentPrice } from '../pricing';

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
