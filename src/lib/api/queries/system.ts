import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api/client';
import type { SetupData, ConfigUpdate } from '@/types/bot';
import type { AuthResponse } from '@/types/auth';

interface HealthResponse {
  status: string;
  setup_required: boolean;
  config_ready: boolean;
  running_jobs: number;
  user?: { email: string; role: string; display_name: string };
  auto_migrated?: boolean;
  ai_configured?: boolean;
}

interface CategoriesResponse {
  categories: { id: string; name: string }[];
}

interface ConfigResponse {
  ad_defaults: Record<string, unknown>;
  publishing: Record<string, unknown>;
  timeouts: Record<string, unknown>;
  download: Record<string, unknown>;
  update_check: Record<string, unknown>;
  login: { username: string; password: string };
}

export function useHealth() {
  return useQuery<HealthResponse>({
    queryKey: ['health'],
    queryFn: () => api.get('/api/system/health'),
    retry: false,
  });
}

export function useCategories() {
  return useQuery<CategoriesResponse>({
    queryKey: ['categories'],
    queryFn: () => api.get('/api/system/categories'),
    staleTime: Infinity,
  });
}

export function useConfig() {
  return useQuery<ConfigResponse>({
    queryKey: ['config'],
    queryFn: () => api.get('/api/system/config'),
  });
}

export function useConfigDefaults() {
  return useQuery<{ ad_defaults: Record<string, unknown> }>({
    queryKey: ['config', 'defaults'],
    queryFn: () => api.get('/api/system/config/defaults'),
  });
}

export function useUpdateConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: ConfigUpdate) => api.put('/api/system/config', data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['config'] }),
  });
}

export function useSetup() {
  return useMutation({
    mutationFn: (data: SetupData) =>
      api.post<AuthResponse & { status: string }>('/api/system/setup', data),
  });
}
