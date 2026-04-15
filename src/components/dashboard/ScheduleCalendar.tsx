'use client';

import { memo, useMemo } from 'react';
import Link from 'next/link';
import type { AdListItem } from '@/types/ad';
import { getNextRepubDate, getExpiryDate } from '@/lib/ads/status';
import { projectReposts } from '@/lib/ads/pricing';
import styles from './ScheduleCalendar.module.scss';

interface ScheduleCalendarProps {
  ads: AdListItem[];
}

const DAY_NAMES = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
const DAY_MS = 86400000;

function isSameDay(d1: Date, d2: Date): boolean {
  return (
    d1.getFullYear() === d2.getFullYear() &&
    d1.getMonth() === d2.getMonth() &&
    d1.getDate() === d2.getDate()
  );
}

interface RepubItem {
  ad: AdListItem;
  type: 'repub';
  priceChange?: string | null;
}

interface ExpiryItem {
  ad: AdListItem;
  type: 'expiry';
}

type DayItem = RepubItem | ExpiryItem;

interface DayBucket {
  date: Date;
  items: DayItem[];
}

/** Build a price-change label for a repost date if a reduction will apply. */
function getPriceChangeForDate(ad: AdListItem, repostDate: Date): string | null {
  const projections = projectReposts(ad, 10);
  if (projections.length === 0) return null;

  for (const step of projections) {
    if (step.isPast) continue;
    if (isSameDay(step.date, repostDate) && step.reducedBy != null) {
      // Find previous price
      const prevPrice = step.price + step.reducedBy;
      return `${prevPrice} € → ${step.price} €`;
    }
  }
  return null;
}

export const ScheduleCalendar = memo(function ScheduleCalendar({ ads }: ScheduleCalendarProps) {
  const days = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const buckets: DayBucket[] = [];
    for (let d = 0; d < 7; d++) {
      buckets.push({
        date: new Date(today.getTime() + d * DAY_MS),
        items: [],
      });
    }

    const windowEnd = new Date(today.getTime() + 7 * DAY_MS);

    // Assign ALL republication dates within the 7-day window
    for (const ad of ads) {
      if (ad.active === false || !ad.republication_interval) continue;
      const first = getNextRepubDate(ad);
      if (!first) continue;
      const intervalMs = ad.republication_interval * DAY_MS;
      let repub = first;
      while (repub <= windowEnd) {
        for (const day of buckets) {
          if (isSameDay(repub, day.date)) {
            const priceChange = getPriceChangeForDate(ad, day.date);
            day.items.push({ ad, type: 'repub', priceChange });
            break;
          }
        }
        repub = new Date(repub.getTime() + intervalMs);
      }
    }

    // Assign expiring ads (60-day platform lifetime via shared getExpiryDate)
    for (const ad of ads) {
      if (!ad.id) continue;
      const expiry = getExpiryDate(ad);
      if (!expiry) continue;
      const expiryDay = new Date(expiry);
      expiryDay.setHours(0, 0, 0, 0);
      for (const day of buckets) {
        if (isSameDay(expiryDay, day.date)) {
          day.items.push({ ad, type: 'expiry' });
          break;
        }
      }
    }

    return buckets;
  }, [ads]);

  const today = new Date();

  return (
    <div className={styles.section}>
      <div className={styles.sectionTitle}>Kalender (nächste 7 Tage)</div>
      <div className={styles.schedule}>
        {days.map((day) => {
          const isToday = isSameDay(day.date, today);
          return (
            <div
              key={day.date.toISOString()}
              className={`${styles.day}${isToday ? ` ${styles.dayToday}` : ''}`}
            >
              <div className={styles.dayLabel}>{DAY_NAMES[day.date.getDay()]}</div>
              <div className={styles.dayDate}>
                {day.date.toLocaleDateString('de-DE', {
                  day: '2-digit',
                  month: '2-digit',
                })}
              </div>
              {day.items.map((item) => {
                const { ad, type } = item;
                const priceChange = type === 'repub' ? item.priceChange : null;
                return (
                  <Link
                    key={`${type}-${ad.file}`}
                    href={`/ads/edit?file=${encodeURIComponent(ad.file)}`}
                    className={`${styles.chip} ${type === 'expiry' ? styles.chipExpiry : styles.chipRepub}`}
                    title={
                      type === 'expiry'
                        ? `Ablauf: ${ad.title || ''}`
                        : `Republizierung: ${ad.title || ''}${priceChange ? ` (${priceChange})` : ''}`
                    }
                  >
                    {type === 'expiry'
                      ? `Abl: ${ad.title || 'Unbenannt'}`
                      : <>Rep: {ad.title || 'Unbenannt'}{priceChange && <span className={styles.chipPrice}> ({priceChange})</span>}</>
                    }
                  </Link>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
});
