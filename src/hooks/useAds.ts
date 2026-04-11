'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api/client';
import type { AdListItem, Ad, AdCreate, AdUpdate } from '@/types/ad';

interface AdsResponse {
  ads: AdListItem[];
  total: number;
}

export function useAds() {
  return useQuery<AdsResponse>({
    queryKey: ['ads'],
    queryFn: () => api.get('/api/ads'),
    staleTime: 30000,
  });
}

export function useAd(adId: number | null) {
  return useQuery<Ad>({
    queryKey: ['ad', adId],
    queryFn: () => api.get(`/api/ads/${adId}`),
    enabled: adId !== null,
  });
}

export function useAdByFile(filename: string | null) {
  return useQuery<Ad>({
    queryKey: ['ad-file', filename],
    queryFn: () => api.get(`/api/ads/by-file/${filename!.split('/').map(encodeURIComponent).join('/')}`),
    enabled: !!filename,
    staleTime: 30000,
  });
}

export function useCreateAd() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: AdCreate) => api.post('/api/ads', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ads'] });
    },
  });
}

export function useUpdateAd() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ adId, data }: { adId: number; data: AdUpdate }) =>
      api.put(`/api/ads/${adId}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ads'] });
    },
  });
}

export function useUpdateAdByFile() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ filename, data }: { filename: string; data: AdUpdate }) =>
      api.put(`/api/ads/by-file/${filename.split('/').map(encodeURIComponent).join('/')}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ads'] });
    },
  });
}

export function useDeleteAd() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ adId, remote = false }: { adId: number; remote?: boolean }) =>
      api.delete(`/api/ads/${adId}?remote=${remote}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ads'] });
    },
  });
}

export function useDeleteAdByFile() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (filename: string) => api.delete(`/api/ads/by-file/${filename.split('/').map(encodeURIComponent).join('/')}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ads'] });
    },
  });
}

export function useDuplicateAd() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (filename: string) => api.post(`/api/ads/duplicate/${filename.split('/').map(encodeURIComponent).join('/')}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ads'] });
    },
  });
}

export function useGenerateAd() {
  return useMutation({
    mutationFn: (data: { prompt: string; images?: string[] }) =>
      api.post<{ ad: Record<string, unknown> }>('/api/ads/generate', data),
  });
}
