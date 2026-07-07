import { useMutation, useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api/client';
import type { SetupData } from '@/types/bot';
import type { AuthResponse } from '@/types/auth';
import type { AiModelOption } from '@/app/api/system/ai-models/route';

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

export function useConfigDefaults() {
  return useQuery<{ ad_defaults: Record<string, unknown> }>({
    queryKey: ['config', 'defaults'],
    queryFn: () => api.get('/api/system/config/defaults'),
  });
}

export function useAiModels(enabled = true) {
  return useQuery<{ models: AiModelOption[]; error?: string }>({
    queryKey: ['ai-models'],
    queryFn: () => api.get('/api/system/ai-models'),
    staleTime: 60 * 60 * 1000, // models change rarely
    retry: false,
    enabled,
  });
}

export function useSetup() {
  return useMutation({
    mutationFn: (data: SetupData) =>
      api.post<AuthResponse & { status: string }>('/api/system/setup', data),
  });
}
