'use client';

import type { AdListItem } from '@/types/ad';
import { AdCard } from './AdCard';
import styles from './AdGrid.module.scss';

interface AdGridProps {
  ads: AdListItem[];
  selectedFiles: Set<string>;
  onSelect: (file: string) => void;
  selectMode?: boolean;
}

export function AdGrid({ ads, selectedFiles, onSelect, selectMode = false }: AdGridProps) {
  return (
    <div className={styles.grid}>
      {ads.map((ad, i) => (
        <AdCard
          key={ad.file}
          ad={ad}
          selected={selectedFiles.has(ad.file)}
          onSelect={onSelect}
          selectMode={selectMode}
          style={{ '--anim-delay': `${Math.min(i * 50, 400)}ms` } as React.CSSProperties}
        />
      ))}
    </div>
  );
}
