'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import type { AdListItem } from '@/types/ad';
import { Badge } from '@/components/ui';
import styles from './HealthIndicators.module.scss';

interface HealthIndicatorsProps {
  ads: AdListItem[];
}

interface Warning {
  label: string;
  ads: AdListItem[];
}

export function HealthIndicators({ ads }: HealthIndicatorsProps) {
  const warnings = useMemo(() => {
    const result: Warning[] = [];

    // No images
    const noImages = ads.filter((a) => a.images === 0);
    if (noImages.length) {
      result.push({ label: 'Keine Bilder', ads: noImages });
    }

    // Inactive
    const inactive = ads.filter((a) => a.active === false);
    if (inactive.length) {
      result.push({ label: 'Inaktive Anzeigen', ads: inactive });
    }

    // At minimum price
    const atMin = ads.filter(
      (a) =>
        a.auto_price_reduction?.enabled &&
        a.price !== null &&
        a.price !== undefined &&
        a.price <= (a.auto_price_reduction.min_price ?? 0),
    );
    if (atMin.length) {
      result.push({ label: 'Preis am Minimum', ads: atMin });
    }

    // No description
    const noDesc = ads.filter((a) => a.has_description === false);
    if (noDesc.length) {
      result.push({ label: 'Keine Beschreibung', ads: noDesc });
    }

    return result;
  }, [ads]);

  return (
    <div className={styles.section}>
      <div className={styles.sectionTitle}>Gesundheitscheck</div>
      {warnings.length === 0 ? (
        <div className={styles.allOk}>Alles in Ordnung</div>
      ) : (
        <table className={styles.table}>
          <thead>
            <tr>
              <th className={styles.tableHeader}>Problem</th>
              <th className={styles.tableHeader}>Anzeige</th>
            </tr>
          </thead>
          <tbody>
            {warnings.flatMap((w) =>
              w.ads.map((ad) => (
                <tr key={`${w.label}-${ad.file}`} className={styles.tableRow}>
                  <td className={styles.tableCell}>
                    <Badge variant="warning">{w.label}</Badge>
                  </td>
                  <td className={styles.tableCell}>
                    <Link
                      href={`/ads/edit?file=${encodeURIComponent(ad.file)}`}
                      className={styles.healthLink}
                    >
                      {ad.title || ad.file}
                    </Link>
                  </td>
                </tr>
              )),
            )}
          </tbody>
        </table>
      )}
    </div>
  );
}
