import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api/client';
import type { Job, PublishOptions, DownloadOptions, UpdateOptions, ExtendOptions, DeleteOptions } from '@/types/bot';

export function usePublish() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (opts?: PublishOptions) => api.post<Job>('/api/bot/publish', opts),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['jobs'] }),
  });
}

export function useVerify() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (verbose?: boolean) => api.post<Job>('/api/bot/verify', { verbose: verbose ?? false }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['jobs'] }),
  });
}

export function useBotDelete() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (opts?: DeleteOptions) => api.post<Job>('/api/bot/delete', opts),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['jobs'] }),
  });
}

export function useBotUpdate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (opts?: UpdateOptions) => api.post<Job>('/api/bot/update', opts),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['jobs'] }),
  });
}

export function useDownload() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (opts?: DownloadOptions) => api.post<Job>('/api/bot/download', opts),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['jobs'] }),
  });
}

export function useExtend() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (opts?: ExtendOptions) => api.post<Job>('/api/bot/extend', opts),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['jobs'] }),
  });
}

export function useUpdateCheck() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<Job>('/api/bot/update-check'),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['jobs'] }),
  });
}

export function useUpdateContentHash() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<Job>('/api/bot/update-content-hash'),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['jobs'] }),
  });
}

export function useCreateConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<Job>('/api/bot/create-config'),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['jobs'] }),
  });
}

export function useDiagnose() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<Job>('/api/bot/diagnose'),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['jobs'] }),
  });
}

export function useBotVersion() {
  return useMutation({
    mutationFn: () => api.get<{ output: string }>('/api/bot/version'),
  });
}
