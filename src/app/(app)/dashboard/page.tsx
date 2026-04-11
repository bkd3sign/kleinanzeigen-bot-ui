'use client';

import { useAds } from '@/hooks/useAds';
import { StatsGrid } from '@/components/dashboard/StatsGrid';
import { HealthIndicators } from '@/components/dashboard/HealthIndicators';
import { ScheduleCalendar } from '@/components/dashboard/ScheduleCalendar';
import { PerformanceMetrics } from '@/components/dashboard/PerformanceMetrics';
import { PriceChart } from '@/components/dashboard/PriceChart';
import { CategoryBars } from '@/components/dashboard/CategoryBars';
import { DistributionCharts } from '@/components/dashboard/DistributionCharts';
import { Spinner } from '@/components/ui';
import styles from './page.module.scss';

export default function DashboardPage() {
  const { data: adsData, isLoading: adsLoading } = useAds();
  const ads = adsData?.ads ?? [];

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
    </div>
  );
}
