'use client';

import { memo, useMemo, useEffect, useRef } from 'react';
import Link from 'next/link';
import type { AdListItem } from '@/types/ad';
import styles from './PerformanceMetrics.module.scss';

interface PerformanceMetricsProps {
  ads: AdListItem[];
}

export const PerformanceMetrics = memo(function PerformanceMetrics({ ads }: PerformanceMetricsProps) {
  const barsRef = useRef<HTMLDivElement[]>([]);

  const adsWithReposts = useMemo(
    () =>
      ads
        .filter((a) => (a.repost_count || 0) > 0 || (a.price_reduction_count || 0) > 0)
        .sort((a, b) => (b.repost_count || 0) - (a.repost_count || 0))
        .slice(0, 10),
    [ads],
  );

  const maxRepost = useMemo(
    () => Math.max(...adsWithReposts.map((a) => a.repost_count || 0), 1),
    [adsWithReposts],
  );

  // Time on market for online ads
  const onlineAds = useMemo(
    () =>
      ads
        .filter((a) => a.id && a.created_on)
        .map((a) => ({
          title: a.title,
          file: a.file,
          price: a.price,
          price_reduction_count: a.price_reduction_count,
          auto_price_reduction: a.auto_price_reduction,
          daysOnMarket: Math.round(
            (Date.now() - new Date(a.created_on!).getTime()) / 86400000,
          ),
        }))
        .sort((a, b) => b.daysOnMarket - a.daysOnMarket)
        .slice(0, 5),
    [ads],
  );

  const maxDays = useMemo(
    () => Math.max(...onlineAds.map((a) => a.daysOnMarket), 1),
    [onlineAds],
  );

  const durationBarsRef = useRef<HTMLDivElement[]>([]);

  // Animate bars on mount
  useEffect(() => {
    requestAnimationFrame(() => {
      barsRef.current.forEach((bar, i) => {
        if (!bar || !adsWithReposts[i]) return;
        const pct = ((adsWithReposts[i].repost_count || 0) / maxRepost) * 100;
        setTimeout(() => {
          bar.style.width = `${pct}%`;
        }, i * 60);
      });
    });
  }, [adsWithReposts, maxRepost]);

  // Animate duration bars
  useEffect(() => {
    requestAnimationFrame(() => {
      durationBarsRef.current.forEach((bar, i) => {
        if (!bar || !onlineAds[i]) return;
        const pct = (onlineAds[i].daysOnMarket / maxDays) * 100;
        setTimeout(() => {
          bar.style.width = `${pct}%`;
        }, i * 60);
      });
    });
  }, [onlineAds, maxDays]);

  if (adsWithReposts.length === 0) return null;

  return (
    <div className={styles.section}>
      <div className={styles.sectionTitle}>Anzeigen-Performance</div>
      <div className={styles.perfList}>
        {adsWithReposts.map((ad, i) => (
          <div key={ad.file} className={styles.perfRow}>
            <div className={styles.perfLabel} title={ad.title || ''}>
              <Link
                href={`/ads/edit?file=${encodeURIComponent(ad.file || '')}`}
                className={styles.perfLabelLink}
              >
                {ad.title || '(Ohne Titel)'}
              </Link>
            </div>
            <div className={styles.perfBar}>
              <div
                ref={(el) => {
                  if (el) barsRef.current[i] = el;
                }}
                className={styles.perfBarInner}
                style={{ width: '0%' }}
              />
            </div>
            <div className={styles.perfStats}>
              <span>{ad.repost_count || 0} Reposts</span>
              {ad.price_reduction_count > 0 && (
                <span className={styles.perfStatsPriceReduction}>
                  {ad.price_reduction_count} Preissenkungen
                </span>
              )}
            </div>
          </div>
        ))}
      </div>

      {onlineAds.length > 0 && (
        <>
          <div className={styles.sectionTitleSub}>Längste Laufzeit</div>
          <div className={styles.perfList}>
            {onlineAds.map((ad, i) => {
              let originalPrice: number | null = null;
              if (
                ad.price &&
                ad.price_reduction_count > 0 &&
                ad.auto_price_reduction
              ) {
                const apr = ad.auto_price_reduction;
                if (apr.strategy === 'PERCENTAGE') {
                  originalPrice = Math.round(
                    ad.price /
                      Math.pow(
                        1 - (apr.amount || 0) / 100,
                        ad.price_reduction_count,
                      ),
                  );
                } else {
                  originalPrice =
                    ad.price + (apr.amount || 0) * ad.price_reduction_count;
                }
              }

              return (
                <div key={ad.file} className={styles.perfRow}>
                  <div className={styles.perfLabel} title={ad.title || ''}>
                    <Link
                      href={`/ads/edit?file=${encodeURIComponent(ad.file || '')}`}
                      className={styles.perfLabelLink}
                    >
                      {ad.title || '(Ohne Titel)'}
                    </Link>
                  </div>
                  <div className={styles.perfBar}>
                    <div
                      ref={(el) => {
                        if (el) durationBarsRef.current[i] = el;
                      }}
                      className={styles.perfBarDuration}
                      style={{ width: '0%' }}
                    />
                  </div>
                  <div className={styles.perfStats}>
                    <span>{ad.daysOnMarket} Tage</span>
                    {originalPrice !== null && (
                      <span className={styles.perfStatsPriceReduction}>
                        {originalPrice} € → {ad.price} €
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
});
