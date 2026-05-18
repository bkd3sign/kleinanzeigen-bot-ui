'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api/client';
import type { AdStatsEntry } from '@/types/stats';

export interface StatsResponse {
  last_updated: string | null;
  ads: Record<string, AdStatsEntry>;
}

export function useAdStats() {
  return useQuery<StatsResponse>({
    queryKey: ['ad-stats'],
    queryFn: () => api.get('/api/stats'),
    staleTime: 60_000,
  });
}
