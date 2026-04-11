'use client';

import { memo, useMemo } from 'react';
import type { AdListItem } from '@/types/ad';
import styles from './DistributionCharts.module.scss';

interface DistributionChartsProps {
  ads: AdListItem[];
}

const CHART_COLORS = [
  'var(--accent)',
  'var(--green)',
  'var(--red)',
  'var(--yellow)',
  'var(--orange)',
  '#8b5cf6',
  '#06b6d4',
  '#ec4899',
  '#14b8a6',
  '#f97316',
];

function countBy(
  arr: AdListItem[],
  fn: (item: AdListItem) => string,
): Array<[string, number]> {
  const counts: Record<string, number> = {};
  for (const item of arr) {
    const key = fn(item);
    counts[key] = (counts[key] || 0) + 1;
  }
  return Object.entries(counts).sort((a, b) => b[1] - a[1]);
}

interface MiniDistProps {
  title: string;
  entries: Array<[string, number]>;
  colors: string[];
}

function MiniDistribution({ title, entries, colors }: MiniDistProps) {
  if (entries.length === 0) return null;

  const total = entries.reduce((s, e) => s + e[1], 0);

  return (
    <div className={styles.miniDist}>
      <div className={styles.miniDistTitle}>{title}</div>
      <div className={styles.distBar}>
        {entries.map(([label, count], i) => (
          <div
            key={label}
            className={styles.distBarSeg}
            style={{
              width: `${(count / total) * 100}%`,
              background: colors[i % colors.length],
            }}
          />
        ))}
      </div>
      <div className={styles.legend}>
        {entries.map(([label, count], i) => (
          <div key={label} className={styles.legendItem}>
            <span
              className={styles.legendDot}
              style={{ background: colors[i % colors.length] }}
            />
            <span>
              {label} ({count})
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

const SHIPPING_COLORS = ['#f97316', '#fb923c', '#fdba74'];

const SHIPPING_LABELS: Record<string, string> = {
  SHIPPING: 'Versand',
  PICKUP: 'Abholung',
  NOT_APPLICABLE: 'Nicht relevant',
};

export const DistributionCharts = memo(function DistributionCharts({ ads }: DistributionChartsProps) {
  const typeEntries = useMemo(
    () =>
      countBy(ads, (a) => {
        const t = a.type || 'OFFER';
        return t === 'OFFER' ? 'Angebot' : t === 'WANTED' ? 'Gesuch' : t;
      }),
    [ads],
  );

  const shippingEntries = useMemo(
    () =>
      countBy(
        ads,
        (a) =>
          SHIPPING_LABELS[a.shipping_type || ''] ||
          a.shipping_type ||
          'Unbekannt',
      ),
    [ads],
  );

  return (
    <div className={styles.wrapper}>
      <MiniDistribution title="Typ-Verteilung" entries={typeEntries} colors={CHART_COLORS} />
      <MiniDistribution
        title="Versandart"
        entries={shippingEntries}
        colors={SHIPPING_COLORS}
      />
    </div>
  );
});
