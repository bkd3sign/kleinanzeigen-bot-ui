'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api/client';
import type { Job } from '@/types/bot';

interface JobsResponse {
  jobs: Job[];
  total: number;
}

export function useJobs(status?: string) {
  const params = new URLSearchParams();
  if (status) params.set('status', status);
  params.set('limit', '10');

  return useQuery<JobsResponse>({
    queryKey: ['jobs', status],
    queryFn: () => api.get(`/api/jobs?${params}`),
    refetchInterval: (query) => {
      // Poll faster when jobs are running, slower otherwise
      const jobs = query.state.data?.jobs ?? [];
      const hasActive = jobs.some((j) => j.status === 'running' || j.status === 'queued');
      return hasActive ? 3000 : 15000;
    },
  });
}

export function useCancelJob() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (jobId: string) => api.post(`/api/jobs/${jobId}/cancel`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['jobs'] });
    },
  });
}

export function useRepeatJob() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (jobId: string) => api.post<Job>(`/api/jobs/${jobId}/repeat`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['jobs'] });
    },
  });
}

export function useJob(jobId: string | null) {
  return useQuery<Job>({
    queryKey: ['job', jobId],
    queryFn: () => api.get(`/api/jobs/${jobId}`),
    enabled: !!jobId,
    refetchInterval: (query) => {
      const data = query.state.data;
      if (!data) return 2000;
      if (data.status === 'running' || data.status === 'queued') return 2000;
      // Poll a few more times after completion to catch post-job sync logs
      const finishedAt = data.finished_at ? new Date(data.finished_at).getTime() : 0;
      if (finishedAt && Date.now() - finishedAt < 5000) return 1000;
      return false;
    },
  });
}
