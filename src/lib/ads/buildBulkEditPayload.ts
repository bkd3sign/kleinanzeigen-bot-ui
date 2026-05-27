import { allCarriersOf } from '@/lib/shipping';
import type { AdListItem } from '@/types/ad';

export type BulkPriceType = 'FIXED' | 'NEGOTIABLE' | 'GIVE_AWAY';
export type BulkShippingChoice = 'PICKUP' | 'S' | 'M' | 'L' | 'CUSTOM';
export type BulkIntervalPreset = 7 | 14 | 21 | 28 | 'CUSTOM';

export interface BulkEditOptions {
  priceType: BulkPriceType | null;
  /** Percentage adjustment applied to each ad's current price (e.g. -10 = -10%). */
  priceAdjust: number | null;
  /** Absolute price override — all selected ads get exactly this price. */
  absolutePrice: number | null;
  shippingChoice: BulkShippingChoice | null;
  customShippingCost: string;
  aprEnabled: boolean | null;
  aprStrategy: 'PERCENTAGE' | 'FIXED' | null;
  aprAmount: number | null;
  aprMinPrice: number | null;
  intervalPreset: BulkIntervalPreset | null;
  customInterval: string;
  updatePriceOnUpdate: boolean | null;
}

export function buildBulkEditPayload(
  ad: Pick<AdListItem, 'price' | 'auto_price_reduction'>,
  opts: BulkEditOptions,
): Record<string, unknown> {
  const {
    priceType,
    priceAdjust,
    absolutePrice,
    shippingChoice,
    customShippingCost,
    aprEnabled,
    aprStrategy,
    aprAmount,
    aprMinPrice,
    intervalPreset,
    customInterval,
    updatePriceOnUpdate,
  } = opts;

  const payload: Record<string, unknown> = {};

  if (priceType !== null) {
    payload.price_type = priceType;
    if (priceType === 'GIVE_AWAY') payload.price = 0;
  }

  // Absolute price takes precedence over percentage adjustment.
  // Both are skipped when GIVE_AWAY already fixes price at 0.
  if (priceType !== 'GIVE_AWAY') {
    if (absolutePrice !== null && absolutePrice >= 0) {
      payload.price = absolutePrice;
    } else if (priceAdjust !== null && ad.price != null && ad.price > 0) {
      payload.price = Math.max(0, Math.round(ad.price * (1 + priceAdjust / 100)));
    }
  }

  if (shippingChoice !== null) {
    if (shippingChoice === 'PICKUP') {
      payload.shipping_type = 'PICKUP';
      payload.shipping_options = [];
      payload.shipping_costs = null;
    } else if (shippingChoice === 'CUSTOM') {
      const cost = parseFloat(customShippingCost);
      if (!isNaN(cost) && cost > 0) {
        payload.shipping_type = 'SHIPPING';
        payload.shipping_costs = cost;
        payload.shipping_options = [];
      }
    } else {
      payload.shipping_type = 'SHIPPING';
      payload.shipping_options = allCarriersOf(shippingChoice);
      payload.shipping_costs = null;
    }
  }

  const hasAprChange = aprEnabled !== null || updatePriceOnUpdate !== null
    || aprStrategy !== null || aprAmount !== null || aprMinPrice !== null;
  if (hasAprChange) {
    const existing = ad.auto_price_reduction ?? { enabled: false };
    const merged = { ...existing };
    if (aprEnabled !== null) merged.enabled = aprEnabled;
    if (updatePriceOnUpdate !== null) merged.on_update = updatePriceOnUpdate;
    if (aprStrategy !== null) merged.strategy = aprStrategy;
    if (aprAmount !== null) merged.amount = aprAmount;
    if (aprMinPrice !== null) merged.min_price = aprMinPrice;
    payload.auto_price_reduction = merged;
  }

  if (intervalPreset !== null) {
    if (intervalPreset === 'CUSTOM') {
      const v = parseInt(customInterval, 10);
      if (!isNaN(v) && v > 0) payload.republication_interval = v;
    } else {
      payload.republication_interval = intervalPreset;
    }
  }

  return payload;
}
