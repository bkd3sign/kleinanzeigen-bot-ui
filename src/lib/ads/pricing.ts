import type { AutoPriceReduction } from '@/types/ad';

interface PricedAd {
  price?: number;
  auto_price_reduction?: AutoPriceReduction;
  price_reduction_count: number;
}

/**
 * Calculate the current reduced price after N reductions.
 * Returns null if no reduction is active or no price is set.
 * Uses ROUND_HALF_UP (kaufmännisch) per bot convention.
 */
export function getCurrentPrice(ad: PricedAd): number | null {
  const apr = ad.auto_price_reduction;
  if (!apr?.enabled || !apr.strategy || !apr.amount || ad.price == null) return null;
  if (!ad.price_reduction_count || ad.price_reduction_count <= 0) return null;

  const minPrice = apr.min_price ?? 0;
  let price = ad.price;

  for (let i = 0; i < ad.price_reduction_count; i++) {
    if (apr.strategy === 'PERCENTAGE') {
      price = price * (1 - apr.amount / 100);
    } else {
      price = price - apr.amount;
    }
    price = Math.round(price);
    if (price <= minPrice) {
      price = minPrice;
      break;
    }
  }

  return price;
}
