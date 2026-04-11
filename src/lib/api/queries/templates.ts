import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api/client';
import type { Template, TemplateCreate, TemplateUpdate } from '@/types/template';

interface TemplatesResponse {
  templates: Template[];
  total: number;
}

export function useTemplates() {
  return useQuery<TemplatesResponse>({
    queryKey: ['templates'],
    queryFn: () => api.get('/api/templates'),
  });
}

export function useTemplate(slug: string | null) {
  return useQuery<Template>({
    queryKey: ['template', slug],
    queryFn: () => api.get(`/api/templates/${slug}`),
    enabled: !!slug,
  });
}

export function useCreateTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: TemplateCreate) => api.post('/api/templates', data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['templates'] }),
  });
}

export function useUpdateTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ slug, data }: { slug: string; data: TemplateUpdate }) =>
      api.put(`/api/templates/${slug}`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['templates'] }),
  });
}

export function useDeleteTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (slug: string) => api.delete(`/api/templates/${slug}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['templates'] }),
  });
}

export function useCreateAdFromTemplate() {
  return useMutation({
    mutationFn: (slug: string) =>
      api.post<{ ad_data: Record<string, unknown>; locked_fields: string[] }>(
        `/api/ads/from-template/${slug}`
      ),
  });
}
