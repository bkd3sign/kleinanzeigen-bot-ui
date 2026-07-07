import { describe, it, expect } from 'vitest';
import { buildBulkEditPayload } from '../buildBulkEditPayload';
import type { BulkEditOptions } from '../buildBulkEditPayload';
import { allCarriersOf } from '@/lib/shipping';

const none: BulkEditOptions = {
  priceType: null,
  priceAdjust: null,
  absolutePrice: null,
  shippingChoice: null,
  aprEnabled: null,
  aprStrategy: null,
  aprAmount: null,
  aprMinPrice: null,
  intervalPreset: null,
  customInterval: '',
  updatePriceOnUpdate: null,
};

const ad = { price: 100, auto_price_reduction: undefined };

describe('buildBulkEditPayload', () => {
  // ── Empty / no-op ──────────────────────────────────────────────────────────

  it('returns empty payload when nothing is selected', () => {
    expect(buildBulkEditPayload(ad, none)).toEqual({});
  });

  // ── Price type ─────────────────────────────────────────────────────────────

  it('sets price_type FIXED', () => {
    const p = buildBulkEditPayload(ad, { ...none, priceType: 'FIXED' });
    expect(p.price_type).toBe('FIXED');
    expect(p.price).toBeUndefined();
  });

  it('sets price_type NEGOTIABLE', () => {
    const p = buildBulkEditPayload(ad, { ...none, priceType: 'NEGOTIABLE' });
    expect(p.price_type).toBe('NEGOTIABLE');
  });

  it('sets price_type GIVE_AWAY and forces price to 0', () => {
    const p = buildBulkEditPayload(ad, { ...none, priceType: 'GIVE_AWAY' });
    expect(p.price_type).toBe('GIVE_AWAY');
    expect(p.price).toBe(0);
  });

  // ── Price adjustment ───────────────────────────────────────────────────────

  it('applies -10% on ad with price 100 → 90', () => {
    const p = buildBulkEditPayload(ad, { ...none, priceAdjust: -10 });
    expect(p.price).toBe(90);
  });

  it('applies +20% on ad with price 50 → 60', () => {
    const p = buildBulkEditPayload({ ...ad, price: 50 }, { ...none, priceAdjust: 20 });
    expect(p.price).toBe(60);
  });

  it('rounds price adjustment to whole number', () => {
    const p = buildBulkEditPayload({ ...ad, price: 33 }, { ...none, priceAdjust: -10 });
    expect(p.price).toBe(30); // 33 * 0.9 = 29.7 → rounds to 30
  });

  it('clamps price to minimum 0', () => {
    const p = buildBulkEditPayload({ ...ad, price: 5 }, { ...none, priceAdjust: -30 });
    expect(p.price).toBe(4); // 5 * 0.7 = 3.5 → rounds to 4, not negative
  });

  it('skips price adjustment when ad has no price', () => {
    const p = buildBulkEditPayload({ price: undefined, auto_price_reduction: undefined }, { ...none, priceAdjust: -10 });
    expect(p.price).toBeUndefined();
  });

  it('skips price adjustment when ad price is 0', () => {
    const p = buildBulkEditPayload({ ...ad, price: 0 }, { ...none, priceAdjust: -10 });
    expect(p.price).toBeUndefined();
  });

  it('ignores priceAdjust when priceType is GIVE_AWAY — price stays 0', () => {
    const p = buildBulkEditPayload(ad, { ...none, priceType: 'GIVE_AWAY', priceAdjust: -10 });
    expect(p.price).toBe(0);
    expect(p.price_type).toBe('GIVE_AWAY');
  });

  // ── Absolute price ─────────────────────────────────────────────────────────

  it('sets absolute price when absolutePrice is provided', () => {
    const p = buildBulkEditPayload(ad, { ...none, absolutePrice: 5 });
    expect(p.price).toBe(5);
  });

  it('sets absolute price 0', () => {
    const p = buildBulkEditPayload(ad, { ...none, absolutePrice: 0 });
    expect(p.price).toBe(0);
  });

  it('absolute price takes precedence over priceAdjust', () => {
    const p = buildBulkEditPayload(ad, { ...none, absolutePrice: 25, priceAdjust: -50 });
    expect(p.price).toBe(25);
  });

  it('ignores absolutePrice when priceType is GIVE_AWAY — price stays 0', () => {
    const p = buildBulkEditPayload(ad, { ...none, priceType: 'GIVE_AWAY', absolutePrice: 99 });
    expect(p.price).toBe(0);
    expect(p.price_type).toBe('GIVE_AWAY');
  });

  // ── Shipping ───────────────────────────────────────────────────────────────

  it('sets PICKUP and clears shipping options and costs', () => {
    const p = buildBulkEditPayload(ad, { ...none, shippingChoice: 'PICKUP' });
    expect(p.shipping_type).toBe('PICKUP');
    expect(p.shipping_options).toEqual([]);
    expect(p.shipping_costs).toBeNull();
  });

  it('sets SHIPPING with all S carriers', () => {
    const p = buildBulkEditPayload(ad, { ...none, shippingChoice: 'S' });
    expect(p.shipping_type).toBe('SHIPPING');
    expect(p.shipping_options).toEqual(allCarriersOf('S'));
    expect(p.shipping_costs).toBeNull();
  });

  it('sets SHIPPING with all M carriers', () => {
    const p = buildBulkEditPayload(ad, { ...none, shippingChoice: 'M' });
    expect(p.shipping_options).toEqual(allCarriersOf('M'));
  });

  it('sets SHIPPING with all L carriers', () => {
    const p = buildBulkEditPayload(ad, { ...none, shippingChoice: 'L' });
    expect(p.shipping_options).toEqual(allCarriersOf('L'));
  });

  // ── APR ───────────────────────────────────────────────────────────────────

  it('enables APR on ad with no existing APR', () => {
    const p = buildBulkEditPayload(ad, { ...none, aprEnabled: true });
    expect(p.auto_price_reduction).toEqual({ enabled: true });
  });

  it('disables APR on ad with no existing APR', () => {
    const p = buildBulkEditPayload(ad, { ...none, aprEnabled: false });
    expect(p.auto_price_reduction).toEqual({ enabled: false });
  });

  it('enables APR while preserving existing APR settings', () => {
    const existing = { enabled: false, strategy: 'PERCENTAGE' as const, amount: 10, min_price: 5 };
    const p = buildBulkEditPayload({ ...ad, auto_price_reduction: existing }, { ...none, aprEnabled: true });
    expect(p.auto_price_reduction).toEqual({ ...existing, enabled: true });
  });

  it('does not touch APR when both aprEnabled and updatePriceOnUpdate are null', () => {
    const p = buildBulkEditPayload(ad, none);
    expect(p.auto_price_reduction).toBeUndefined();
  });

  // ── Preisanpassung beim Update ─────────────────────────────────────────────

  it('sets on_update true on ad with no existing APR', () => {
    const p = buildBulkEditPayload(ad, { ...none, updatePriceOnUpdate: true });
    expect(p.auto_price_reduction).toEqual({ enabled: false, on_update: true });
  });

  it('sets on_update false while preserving existing APR', () => {
    const existing = { enabled: true, strategy: 'PERCENTAGE' as const, amount: 5, min_price: 2 };
    const p = buildBulkEditPayload({ ...ad, auto_price_reduction: existing }, { ...none, updatePriceOnUpdate: false });
    expect(p.auto_price_reduction).toEqual({ ...existing, on_update: false });
  });

  it('applies aprEnabled and updatePriceOnUpdate together', () => {
    const existing = { enabled: false, amount: 10 };
    const p = buildBulkEditPayload(
      { ...ad, auto_price_reduction: existing as never },
      { ...none, aprEnabled: true, updatePriceOnUpdate: true },
    );
    expect(p.auto_price_reduction).toEqual({ enabled: true, amount: 10, on_update: true });
  });

  // ── APR — strategy / amount / min_price ───────────────────────────────────

  it('sets strategy PERCENTAGE without changing other fields', () => {
    const p = buildBulkEditPayload(ad, { ...none, aprStrategy: 'PERCENTAGE' });
    expect((p.auto_price_reduction as Record<string, unknown>).strategy).toBe('PERCENTAGE');
    expect((p.auto_price_reduction as Record<string, unknown>).enabled).toBe(false);
  });

  it('sets strategy FIXED', () => {
    const p = buildBulkEditPayload(ad, { ...none, aprStrategy: 'FIXED' });
    expect((p.auto_price_reduction as Record<string, unknown>).strategy).toBe('FIXED');
  });

  it('sets amount', () => {
    const p = buildBulkEditPayload(ad, { ...none, aprAmount: 5 });
    expect((p.auto_price_reduction as Record<string, unknown>).amount).toBe(5);
  });

  it('sets min_price', () => {
    const p = buildBulkEditPayload(ad, { ...none, aprMinPrice: 20 });
    expect((p.auto_price_reduction as Record<string, unknown>).min_price).toBe(20);
  });

  it('merges strategy + amount + min_price with existing APR', () => {
    const p = buildBulkEditPayload(
      { price: 100, auto_price_reduction: { enabled: true, strategy: 'FIXED', amount: 2, min_price: 10 } },
      { ...none, aprStrategy: 'PERCENTAGE', aprAmount: 5, aprMinPrice: 15 },
    );
    expect(p.auto_price_reduction).toEqual({
      enabled: true,
      strategy: 'PERCENTAGE',
      amount: 5,
      min_price: 15,
    });
  });

  it('sets strategy + amount without touching enabled when aprEnabled is null', () => {
    const p = buildBulkEditPayload(
      { price: 100, auto_price_reduction: { enabled: true } },
      { ...none, aprStrategy: 'PERCENTAGE', aprAmount: 3 },
    );
    const apr = p.auto_price_reduction as Record<string, unknown>;
    expect(apr.enabled).toBe(true);
    expect(apr.strategy).toBe('PERCENTAGE');
    expect(apr.amount).toBe(3);
  });

  it('does not set auto_price_reduction when all APR fields are null', () => {
    const p = buildBulkEditPayload(ad, none);
    expect(p.auto_price_reduction).toBeUndefined();
  });

  // ── Intervall ─────────────────────────────────────────────────────────────

  it('sets interval to 7 days', () => {
    const p = buildBulkEditPayload(ad, { ...none, intervalPreset: 7 });
    expect(p.republication_interval).toBe(7);
  });

  it('sets interval to 28 days', () => {
    const p = buildBulkEditPayload(ad, { ...none, intervalPreset: 28 });
    expect(p.republication_interval).toBe(28);
  });

  it('sets custom interval from valid string', () => {
    const p = buildBulkEditPayload(ad, { ...none, intervalPreset: 'CUSTOM', customInterval: '10' });
    expect(p.republication_interval).toBe(10);
  });

  it('skips interval when CUSTOM input is empty', () => {
    const p = buildBulkEditPayload(ad, { ...none, intervalPreset: 'CUSTOM', customInterval: '' });
    expect(p.republication_interval).toBeUndefined();
  });

  it('skips interval when CUSTOM input is not a number', () => {
    const p = buildBulkEditPayload(ad, { ...none, intervalPreset: 'CUSTOM', customInterval: 'xyz' });
    expect(p.republication_interval).toBeUndefined();
  });

  it('skips interval when CUSTOM input is 0 or negative', () => {
    const p = buildBulkEditPayload(ad, { ...none, intervalPreset: 'CUSTOM', customInterval: '0' });
    expect(p.republication_interval).toBeUndefined();
  });

  // ── Combined ───────────────────────────────────────────────────────────────

  it('builds full payload when all options are set', () => {
    const p = buildBulkEditPayload(
      { price: 80, auto_price_reduction: { enabled: false } },
      {
        priceType: 'FIXED',
        priceAdjust: -10,
        absolutePrice: null,
        shippingChoice: 'S',
        aprEnabled: true,
        aprStrategy: 'PERCENTAGE',
        aprAmount: 5,
        aprMinPrice: 20,
        intervalPreset: 14,
        customInterval: '',
        updatePriceOnUpdate: true,
      },
    );
    expect(p.price_type).toBe('FIXED');
    expect(p.price).toBe(72); // 80 * 0.9 = 72
    expect(p.shipping_type).toBe('SHIPPING');
    expect(p.shipping_options).toEqual(allCarriersOf('S'));
    expect(p.auto_price_reduction).toEqual({ enabled: true, strategy: 'PERCENTAGE', amount: 5, min_price: 20, on_update: true });
    expect(p.republication_interval).toBe(14);
  });
});
