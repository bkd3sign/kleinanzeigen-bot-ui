'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/useAuth';
import { AppShell } from '@/components/layout/AppShell';
import { Spinner } from '@/components/ui';
import { MfaOverlay } from '@/components/bot/MfaOverlay';

/**
 * App layout: wraps authenticated pages with AppShell (header-only, no sidebar).
 * Redirects to /setup if no users exist, otherwise to /login if unauthenticated.
 */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, token, isLoading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!isLoading && !token) {
      // Double-check localStorage — token may have been set by login()
      // but React state hasn't propagated yet
      if (localStorage.getItem('token')) return;

      fetch('/api/system/health')
        .then((r) => r.json())
        .then((data) => {
          router.replace(data.setup_required ? '/setup' : '/login');
        })
        .catch(() => router.replace('/login'));
    }
  }, [isLoading, token, router]);

  if (isLoading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh' }}>
        <Spinner size="lg" />
      </div>
    );
  }

  // Allow render if token exists in state OR localStorage (covers login race condition)
  if (!token && !user && !localStorage.getItem('token')) {
    return null;
  }

  return (
    <AppShell>
      {children}
      <MfaOverlay />
    </AppShell>
  );
}
