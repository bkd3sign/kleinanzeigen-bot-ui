import type { AdListItem } from '@/types/ad';

const DAY_MS = 86400000;

// Kleinanzeigen.de removes ads after 60 days
const AD_LIFETIME_DAYS = 60;

// Show "expiring soon" warning 7 days before the 60-day limit
const EXPIRY_WARNING_DAYS = 7;

/**
 * Calculate the next republication date for an ad.
 * Uses updated_on (last publish/update) as base, falls back to created_on.
 *
 * Bot logic: `if ad_age.days <= interval: SKIP` — the ad is only published
 * when `ad_age.days > interval`, i.e. at least `interval + 1` full days.
 * So the earliest next publish is `base + (interval + 1) days`.
 */
export function getNextRepubDate(ad: AdListItem): Date | null {
  const baseDate = ad.updated_on || ad.created_on;
  if (!baseDate || !ad.republication_interval) return null;
  const base = new Date(baseDate);
  if (isNaN(base.getTime())) return null;
  return new Date(base.getTime() + (ad.republication_interval + 1) * DAY_MS);
}

/**
 * Calculate the platform expiry date (60 days after last publish/update).
 * This is when kleinanzeigen.de automatically removes the ad.
 */
export function getExpiryDate(ad: AdListItem): Date | null {
  const baseDate = ad.updated_on || ad.created_on;
  if (!baseDate) return null;
  const base = new Date(baseDate);
  if (isNaN(base.getTime())) return null;
  return new Date(base.getTime() + AD_LIFETIME_DAYS * DAY_MS);
}

/** True when the ad is past its 60-day platform lifetime. */
export function isExpired(ad: AdListItem): boolean {
  if (!ad.id) return false;
  const expiry = getExpiryDate(ad);
  if (!expiry) return false;
  return expiry.getTime() <= Date.now();
}

/** True when the ad is within EXPIRY_WARNING_DAYS of the 60-day platform limit. */
export function isExpiringSoon(ad: AdListItem): boolean {
  if (!ad.id) return false;
  const expiry = getExpiryDate(ad);
  if (!expiry) return false;
  const remaining = expiry.getTime() - Date.now();
  return remaining > 0 && remaining <= EXPIRY_WARNING_DAYS * DAY_MS;
}

/** True when the ad title contains "reserviert" (case-insensitive). */
export function isReserved(ad: AdListItem): boolean {
  return (ad.title ?? '').toLowerCase().includes('reserviert');
}

/** Days remaining until the 60-day platform expiry (negative = overdue). */
export function getExpiryDaysLeft(ad: AdListItem): number {
  const expiry = getExpiryDate(ad);
  if (!expiry) return 0;
  return Math.ceil((expiry.getTime() - Date.now()) / DAY_MS);
}
