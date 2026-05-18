'use client';

import { useEffect, useState, useMemo } from 'react';
import { useAds } from '@/hooks/useAds';
import { StatsGrid } from '@/components/dashboard/StatsGrid';
import { HealthIndicators } from '@/components/dashboard/HealthIndicators';
import { ScheduleCalendar } from '@/components/dashboard/ScheduleCalendar';
import { PerformanceMetrics } from '@/components/dashboard/PerformanceMetrics';
import { PriceChart } from '@/components/dashboard/PriceChart';
import { CategoryBars } from '@/components/dashboard/CategoryBars';
import { DistributionCharts } from '@/components/dashboard/DistributionCharts';
import { StatsSection } from '@/components/dashboard/StatsSection';
import { Spinner } from '@/components/ui';
import { api } from '@/lib/api/client';
import type { AdStatsEntry } from '@/types/stats';
import styles from './page.module.scss';

interface StatsResponse {
  last_updated: string | null;
  ads: Record<string, AdStatsEntry>;
}

export default function DashboardPage() {
  const { data: adsData, isLoading: adsLoading } = useAds();
  const ads = useMemo(() => adsData?.ads ?? [], [adsData]);

  const adNames = useMemo<Record<string, string>>(() => {
    const map: Record<string, string> = {};
    for (const ad of ads) {
      if (ad.id != null) map[String(ad.id)] = ad.title;
    }
    return map;
  }, [ads]);

  const [statsData, setStatsData] = useState<StatsResponse>({ last_updated: null, ads: {} });

  useEffect(() => {
    api.get<StatsResponse>('/api/stats')
      .then(setStatsData)
      .catch(() => {});
  }, []);

  if (adsLoading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: 'var(--space-10)' }}>
        <Spinner size="lg" />
      </div>
    );
  }

  return (
    <div className={`${styles.dashboard} animStagger`}>
      <StatsGrid ads={ads} />
      <HealthIndicators ads={ads} />
      <ScheduleCalendar ads={ads} />
      <PerformanceMetrics ads={ads} />
      <PriceChart ads={ads} />
      <CategoryBars ads={ads} />
      <DistributionCharts ads={ads} />
      <StatsSection stats={statsData.ads} lastUpdated={statsData.last_updated} adNames={adNames} />
    </div>
  );
}
