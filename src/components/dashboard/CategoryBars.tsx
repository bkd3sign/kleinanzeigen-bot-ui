'use client';

import { useMemo, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useCategoryName } from '@/hooks/useCategories';
import type { AdListItem } from '@/types/ad';
import styles from './CategoryBars.module.scss';

interface CategoryBarsProps {
  ads: AdListItem[];
}

export function CategoryBars({ ads }: CategoryBarsProps) {
  const router = useRouter();
  const barsRef = useRef<HTMLDivElement[]>([]);
  const catName = useCategoryName();

  const sorted = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const ad of ads) {
      const cat = ad.category || 'Unbekannt';
      counts[cat] = (counts[cat] || 0) + 1;
    }
    return Object.entries(counts).sort((a, b) => b[1] - a[1]);
  }, [ads]);

  const maxCount = sorted.length > 0 ? sorted[0][1] : 1;

  // Animate bars after mount
  useEffect(() => {
    requestAnimationFrame(() => {
      barsRef.current.forEach((bar, i) => {
        if (!bar) return;
        const pct = (sorted[i][1] / maxCount) * 100;
        setTimeout(() => {
          bar.style.width = `${pct}%`;
        }, i * 60);
      });
    });
  }, [sorted, maxCount]);

  if (sorted.length === 0) return null;

  return (
    <div className={styles.section}>
      <div className={styles.sectionTitle}>Kategorieverteilung</div>
      <div className={styles.list}>
        {sorted.map(([cat, count], i) => (
          <div
            key={cat}
            className={styles.row}
            onClick={() => router.push(`/ads?category=${encodeURIComponent(cat)}`)}
          >
            <span className={styles.rowLabel} title={catName(cat)}>
              {catName(cat)}
            </span>
            <div className={styles.barWrap}>
              <div
                ref={(el) => {
                  if (el) barsRef.current[i] = el;
                }}
                className={styles.bar}
                style={{ width: '0%' }}
              />
            </div>
            <span className={styles.count}>{count}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
