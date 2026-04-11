'use client';

import { useHealth } from '@/lib/api/queries/system';

/**
 * Check whether AI features are available (OpenRouter API key configured).
 * Shares the TanStack Query cache with useHealth() — no extra network call.
 */
export function useAiAvailable() {
  const { data, isLoading } = useHealth();

  return {
    isAiAvailable: data?.ai_configured ?? false,
    isLoading,
  };
}
