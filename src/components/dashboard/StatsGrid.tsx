'use client';

import { memo, useMemo } from 'react';
import Link from 'next/link';
import type { AdListItem } from '@/types/ad';
import { isExpiringSoon } from '@/lib/ads/status';
import { getCurrentPrice } from '@/lib/ads/pricing';
import { useCountUp } from '@/hooks/useCountUp';
import styles from './StatsGrid.module.scss';

interface StatsGridProps {
  ads: AdListItem[];
}

interface StatItem {
  num?: number;                      // raw number for count-up animation
  num2?: number;                     // second number for "X / Y" format
  suffix?: string;                   // text appended after the counted number
  format?: (n: number) => string;    // custom formatter overrides suffix
  value: string;                     // fallback for non-numeric formats
  label: string;
  href?: string;
}

function StatCard({ stat, index }: { stat: StatItem; index: number }) {
  const count = useCountUp(stat.num ?? 0);
  const count2 = useCountUp(stat.num2 ?? 0);

  let displayValue: string;
  if (stat.num !== undefined && stat.format) {
    displayValue = stat.format(count);
  } else if (stat.num !== undefined && stat.num2 !== undefined) {
    displayValue = `${count} / ${count2}`;
  } else if (stat.num !== undefined) {
    displayValue = `${count}${stat.suffix ?? ''}`;
  } else {
    displayValue = stat.value;
  }

  const style = { '--anim-delay': `${index * 35}ms` } as React.CSSProperties;
  const inner = (
    <div className={styles.cardInfo}>
      <div className={styles.cardValue}>{displayValue}</div>
      <div className={styles.cardLabel}>{stat.label}</div>
    </div>
  );

  if (stat.href) {
    return (
      <Link href={stat.href} className={styles.cardClickable} style={style}>
        {inner}
      </Link>
    );
  }
  return (
    <div className={styles.card} style={style}>
      {inner}
    </div>
  );
}

export const StatsGrid = memo(function StatsGrid({ ads }: StatsGridProps) {
  const stats = useMemo((): StatItem[] => {
    const online = ads.filter((a) => !!a.id).length;
    const local = ads.filter((a) => !a.id).length;
    const getEffectivePrice = (a: AdListItem) => getCurrentPrice(a) ?? a.price ?? 0;
    const totalValue = ads.reduce((s, a) => s + getEffectivePrice(a), 0);

    const pricedAds = ads.filter((a) => a.price != null && a.price > 0);
    const avgPrice = pricedAds.length
      ? Math.round(pricedAds.reduce((s, a) => s + getEffectivePrice(a), 0) / pricedAds.length)
      : 0;

    const giveAway = ads.filter((a) => a.price_type === 'GIVE_AWAY').length;

    const intervals = ads
      .filter((a) => a.republication_interval)
      .map((a) => a.republication_interval!);
    const avgInterval = intervals.length
      ? Math.round(intervals.reduce((s, v) => s + v, 0) / intervals.length)
      : 0;

    const totalReposts = ads.reduce((s, a) => s + (a.repost_count ?? 0), 0);
    const totalPriceReductions = ads.reduce((s, a) => s + (a.price_reduction_count ?? 0), 0);

    const orphaned = ads.filter((a) => a.is_orphaned).length;
    const expiringSoon = ads.filter((a) => isExpiringSoon(a)).length;

    // Price at minimum
    const aprAds = ads.filter(
      (a) => a.auto_price_reduction && a.auto_price_reduction.enabled,
    );
    const atMin = aprAds.filter(
      (a) => {
        const effective = getEffectivePrice(a);
        return effective > 0 && effective <= (a.auto_price_reduction?.min_price ?? 0);
      },
    ).length;

    return [
      // Row 1: Anzeigen
      { num: online, value: String(online), label: 'Online', href: online ? '/ads?status=online' : undefined },
      { num: local, value: String(local), label: 'Vorbereitet', href: local ? '/ads?status=draft' : undefined },
      { num: giveAway, value: String(giveAway), label: 'Zu verschenken' },
      { num: expiringSoon, value: String(expiringSoon), label: 'Bald ablaufend', href: expiringSoon ? '/ads?status=expiring' : undefined },
      { num: orphaned, value: String(orphaned), label: 'Verwaist', href: orphaned ? '/ads?status=orphaned' : undefined },
      { num: totalReposts, value: String(totalReposts), label: 'Gesamt Reposts' },
      // Row 2: Prices & time periods
      { num: totalValue, format: (n) => `${n.toLocaleString('de-DE')} €`, value: `${totalValue.toLocaleString('de-DE')} €`, label: 'Verkaufswert', href: '/ads' },
      { num: avgPrice, suffix: ' €', value: `${avgPrice} €`, label: 'Ø Preis' },
      { num: totalPriceReductions, value: String(totalPriceReductions), label: 'Preissenkungen' },
      { num: atMin, num2: aprAds.length, value: `${atMin} / ${aprAds.length}`, label: 'Preis am Minimum' },
      { num: avgInterval, suffix: ' Tage', value: `${avgInterval} Tage`, label: 'Ø Republizierung' },
    ];
  }, [ads]);

  return (
    <div className={styles.grid}>
      {stats.map((stat, i) => (
        <StatCard key={stat.label} stat={stat} index={i} />
      ))}
    </div>
  );
});
