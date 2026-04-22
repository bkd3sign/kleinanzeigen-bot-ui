import type { AdListItem, AutoPriceReduction } from '@/types/ad';
import { getNextRepubDate } from './status';

const DAY_MS = 86400000;

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

// --- Shared repost projection ---

export type DelayReason = 'first_publish' | 'repost_delay' | 'day_delay' | null;

export interface RepostProjection {
  date: Date;
  repostNumber: number;
  price: number;
  reducedBy: number | null;
  isPast: boolean;
  isMissed: boolean;
  isDelayed: boolean;
  delayReason: DelayReason;
  /** repost_count value the bot sees BEFORE this publish */
  botRepostCount: number;
  isFinal: boolean;
}

/** Apply one reduction step and return the new price (rounded). */
function applyReduction(price: number, strategy: string, amount: number, minPrice: number): number {
  let next: number;
  if (strategy === 'PERCENTAGE') {
    next = price - (price * amount / 100);
  } else {
    next = price - amount;
  }
  next = Math.round(next);
  if (next < minPrice) next = minPrice;
  return next;
}

/**
 * Check whether a repost is still in the delay phase.
 *
 * Bot logic: repost_count is incremented AFTER publish, so the price reduction
 * check sees the OLD value. This means the first publish (repost_count=0) always
 * skips reduction, even with delay_reposts=0. The bot checks:
 *   `total_reposts <= delay_reposts` where total_reposts = repost_count before publish.
 *
 * In the GUI, absoluteRepost is 1-indexed (repost #1, #2, ...),
 * so the equivalent is: `absoluteRepost <= delayReposts + 1`.
 */
function getDelayReason(
  absoluteRepost: number,
  repostDate: Date,
  delayReposts: number,
  delayDays: number,
  previousPublishDate: Date,
): DelayReason {
  // Bot: total_reposts (=absoluteRepost-1) <= delay_reposts → absoluteRepost <= delay_reposts + 1
  // The first repost is always implicitly delayed (bot sees repost_count=0)
  if (absoluteRepost === 1 && delayReposts === 0) return 'first_publish';
  if (absoluteRepost <= delayReposts + 1) return 'repost_delay';
  // Bot: elapsed_days = (now - updated_on).days, checks elapsed_days >= delay_days.
  // updated_on = timestamp of the PREVIOUS publish, not creation.
  if (delayDays > 0) {
    // Bot uses Python's timedelta.days which truncates (floor), not round
    const daysSincePrevious = Math.floor((repostDate.getTime() - previousPublishDate.getTime()) / DAY_MS);
    if (daysSincePrevious < delayDays) return 'day_delay';
  }
  return null;
}

/**
 * Project all reposts (past + future) for an ad with consistent dates.
 *
 * Past reposts: dates estimated from created_on + n * interval.
 * Future reposts: anchored to getNextRepubDate() (= updated_on + interval),
 *   then + n * interval from there.
 *
 * This is the single source of truth used by timeline preview,
 * dashboard calendar, and price chart.
 */
export function projectReposts(ad: AdListItem, maxFutureSteps = 500): RepostProjection[] {
  const apr = ad.auto_price_reduction;
  if (!apr?.enabled || !apr.strategy || !apr.amount || ad.price == null) return [];

  const interval = Math.max(ad.republication_interval ?? 7, 1);
  const minPrice = apr.min_price ?? 0;
  const delayReposts = apr.delay_reposts ?? 0;
  const delayDays = apr.delay_days ?? 0;
  const repostCount = ad.repost_count ?? 0;

  const createdOn = ad.created_on ? new Date(ad.created_on) : null;
  const validCreatedOn = createdOn && !isNaN(createdOn.getTime()) ? createdOn : null;

  const now = new Date();
  now.setHours(0, 0, 0, 0);

  const results: RepostProjection[] = [];

  // Anchor for future dates: getNextRepubDate uses updated_on + interval
  const nextRepubDate = getNextRepubDate(ad);

  // --- Past reposts (estimated from created_on) ---
  // Use actual price_reduction_count to determine how many reductions really happened.
  // The bot tracks this — we must not guess more reductions than actually occurred.
  const actualReductionCount = ad.price_reduction_count ?? 0;
  let price = Math.round(ad.price);
  let pastReductionsApplied = 0;

  // Track the previous publish date for delay_days calculation (bot uses updated_on)
  let prevPublishDate = validCreatedOn ?? now;

  for (let r = 1; r <= repostCount; r++) {
    const date = validCreatedOn
      ? new Date(validCreatedOn.getTime() + r * interval * DAY_MS)
      : new Date(now.getTime() - (repostCount - r + 1) * interval * DAY_MS);

    const delayReason = getDelayReason(r, date, delayReposts, delayDays, prevPublishDate);

    let reducedBy: number | null = null;
    if (!delayReason && pastReductionsApplied < actualReductionCount) {
      const newPrice = applyReduction(price, apr.strategy!, apr.amount!, minPrice);
      if (newPrice < price) {
        reducedBy = price - newPrice;
        price = newPrice;
        pastReductionsApplied++;
      }
    }

    results.push({
      date,
      repostNumber: r,
      price,
      reducedBy,
      isPast: true,
      isMissed: false,
      isDelayed: !!delayReason,
      delayReason,
      botRepostCount: r - 1,
      isFinal: price <= minPrice,
    });

    // Bot sets updated_on after each publish → next check uses this date
    prevPublishDate = date;
  }

  // --- Missed intervals (expected reposts that never happened) ---
  // Calculate expected repost dates from creation at interval spacing until today
  if (validCreatedOn) {
    const startOffset = repostCount > 0 ? (repostCount + 1) : 1;
    let missedDate = new Date(validCreatedOn.getTime() + startOffset * interval * DAY_MS);
    while (missedDate.getTime() < now.getTime()) {
      results.push({
        date: missedDate,
        repostNumber: -1,
        price,
        reducedBy: null,
        isPast: true,
        isMissed: true,
        delayReason: null,
        botRepostCount: -1,
        isDelayed: false,
        isFinal: false,
      });
      missedDate = new Date(missedDate.getTime() + interval * DAY_MS);
    }
  }

  // --- Future reposts (anchored to nextRepubDate, fast-forwarded to today if overdue) ---
  if (!nextRepubDate) return results;
  if (price <= minPrice && repostCount > 0) return results;

  // Reset prevPublishDate to the actual updated_on (not the estimated past repost date).
  // getNextRepubDate uses updated_on + interval, so the "previous publish" is updated_on.
  const updatedOn = ad.updated_on ? new Date(ad.updated_on) : null;
  const validUpdatedOn = updatedOn && !isNaN(updatedOn.getTime()) ? updatedOn : null;
  if (validUpdatedOn) {
    prevPublishDate = validUpdatedOn;
  }

  // Fast-forward nextRepubDate to the first date >= today
  // Bot publishes when ad_age.days > interval, so actual spacing is interval + 1
  let futureAnchor = nextRepubDate;
  const actualIntervalMs = (interval + 1) * DAY_MS;
  while (futureAnchor.getTime() < now.getTime()) {
    futureAnchor = new Date(futureAnchor.getTime() + actualIntervalMs);
  }

  for (let i = 0; i < maxFutureSteps; i++) {
    const r = repostCount + 1 + i;
    const date = new Date(futureAnchor.getTime() + i * actualIntervalMs);

    const delayReason = getDelayReason(r, date, delayReposts, delayDays, prevPublishDate);

    let reducedBy: number | null = null;
    if (!delayReason) {
      const newPrice = applyReduction(price, apr.strategy!, apr.amount!, minPrice);
      if (newPrice < price) {
        reducedBy = price - newPrice;
        price = newPrice;
      }
      // When newPrice >= price (rounding causes no change), bot still increments
      // price_reduction_count (reason: "no_visible_change") and keeps republishing.
      // UI truncates these stuck steps for display — see PricePreview.
    }

    // Bot sets updated_on after each publish
    prevPublishDate = date;

    const isFinal = price <= minPrice;
    results.push({
      date,
      repostNumber: r,
      price,
      reducedBy,
      isPast: false,
      delayReason,
      botRepostCount: r - 1,
      isMissed: false,
      isDelayed: !!delayReason,
      isFinal,
    });

    if (isFinal) break;
  }

  return results;
}
