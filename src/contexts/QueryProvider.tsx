'use client';

import { QueryClient, QueryClientProvider, focusManager } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { tryRefreshToken } from '@/lib/api/client';
import { isTokenNearExpiry } from '@/lib/auth/token-utils';

export function QueryProvider({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            retry: 1,
          },
        },
      })
  );

  // Intercept tab-focus events: refresh the access token before TanStack Query
  // fires refetchOnWindowFocus queries. Uses shared tryRefreshToken (deduped with
  // client.ts) so concurrent refresh attempts from AuthContext are merged into one.
  useEffect(() => {
    const cleanup = focusManager.setEventListener((handleFocus) => {
      const onFocus = async (event: Event) => {
        if (event.type === 'visibilitychange' && document.hidden) return;

        const token = localStorage.getItem('token');
        if (token && isTokenNearExpiry(token)) {
          await tryRefreshToken();
        }

        handleFocus();
      };

      window.addEventListener('visibilitychange', onFocus as EventListener, false);
      window.addEventListener('focus', onFocus as EventListener, false);

      return () => {
        window.removeEventListener('visibilitychange', onFocus as EventListener);
        window.removeEventListener('focus', onFocus as EventListener);
      };
    });

    return cleanup ?? undefined;
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      {children}
    </QueryClientProvider>
  );
}
