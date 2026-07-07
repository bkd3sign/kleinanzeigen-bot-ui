import type { AdListItem } from '@/types/ad';
import type { AdStatsEntry } from '@/types/stats';
import type { BadgeVariant } from '@/components/ui';

const DAY_MS = 86400000;

// Kleinanzeigen.de removes ads after 60 days
const AD_LIFETIME_DAYS = 60;

// Show "expiring soon" warning 7 days before the 60-day limit
const EXPIRY_WARNING_DAYS = 7;

/**
 * Calculate the next republication date for an ad.
 * Uses updated_on (last publish/update) as base, falls back to created_on.
 *
 * Bot logic (since fix #1099, kleinanzeigen-bot latest release): `if ad_age.days
 * < interval: SKIP` — the ad becomes due exactly when `ad_age.days >= interval`.
 * So the earliest next publish is `base + interval days`.
 */
export function getNextRepubDate(ad: AdListItem): Date | null {
  const baseDate = ad.updated_on || ad.created_on;
  if (!baseDate || !ad.republication_interval) return null;
  const base = new Date(baseDate);
  if (isNaN(base.getTime())) return null;
  return new Date(base.getTime() + ad.republication_interval * DAY_MS);
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

/** True when the ad is reserved: KA state is "paused", or title contains "reserviert". */
export function isReserved(ad: AdListItem, adStats?: AdStatsEntry): boolean {
  return adStats?.state === 'paused' || (ad.title ?? '').toLowerCase().includes('reserviert');
}

/** Days remaining until the 60-day platform expiry (negative = overdue). */
export function getExpiryDaysLeft(ad: AdListItem): number {
  const expiry = getExpiryDate(ad);
  if (!expiry) return 0;
  return Math.ceil((expiry.getTime() - Date.now()) / DAY_MS);
}

export type AdStatusLabel =
  | 'Entwurf' | 'Reserviert' | 'Inaktiv' | 'Abgelaufen'
  | 'Läuft bald ab' | 'Verwaist' | 'Geändert' | 'Aktiv';

/**
 * Resolve the visible status label for an ad. Precedence order must stay in
 * sync with badge rendering — sorting and rendering use this single source.
 */
export function getStatusLabel(ad: AdListItem, adStats?: AdStatsEntry): AdStatusLabel {
  if (!ad.id && !ad.is_archived) return 'Entwurf';
  if (isReserved(ad, adStats)) return 'Reserviert';
  // "Verwaist" (gone from KA) is checked before "Inaktiv": an orphaned ad is
  // typically also active:false locally, but being gone from the platform is
  // the more meaningful state — and it mirrors liveDeleteAvailability(), which
  // hides the delete action for orphaned ads.
  if (ad.is_orphaned) return 'Verwaist';
  if (ad.active === false || ad.is_archived) return 'Inaktiv';
  if (isExpired(ad)) return 'Abgelaufen';
  if (isExpiringSoon(ad)) return 'Läuft bald ab';
  if (ad.is_changed) return 'Geändert';
  return 'Aktiv';
}

// Single source for the badge colour of each status label — both AdTable and
// AdCard derive the variant from here instead of re-deriving it inline (keeps
// label and colour in sync, per the status-consistency invariant).
const STATUS_VARIANTS: Record<AdStatusLabel, BadgeVariant> = {
  Entwurf: 'muted',
  Reserviert: 'reserved',
  Verwaist: 'warning',
  Inaktiv: 'danger',
  Abgelaufen: 'danger',
  'Läuft bald ab': 'warning',
  Geändert: 'info',
  Aktiv: 'success',
};

export function getStatusVariant(label: AdStatusLabel): BadgeVariant {
  return STATUS_VARIANTS[label];
}

export type LiveDeleteAvailability = 'hidden' | 'blocked' | 'normal';

/**
 * Decide how the live "Inserat löschen" action behaves for an ad. The bot
 * skips ads with `active: false` on delete (reserved ads are auto-flagged
 * inactive by the KA online-sync), and there is nothing to delete once an ad
 * is gone from KA.
 *
 * Decisions use raw fields, NOT getStatusLabel — the label resolves "Inaktiv"
 * before "Verwaist", so an orphaned-and-inactive ad would otherwise look
 * deletable when it is actually gone.
 *
 * - 'hidden':  no entry — draft without id, or orphaned (gone from KA)
 * - 'blocked': online but bot-blocked (`active === false`, e.g. reserved) —
 *              needs activation first → offer "activate & delete"
 * - 'normal':  active listing → delete directly
 */
export function liveDeleteAvailability(ad: AdListItem): LiveDeleteAvailability {
  if (!ad.id) return 'hidden';
  if (ad.is_orphaned) return 'hidden';
  if (ad.active === false) return 'blocked';
  return 'normal';
}
