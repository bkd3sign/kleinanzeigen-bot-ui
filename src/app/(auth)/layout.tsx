'use client';

/**
 * Auth layout: no sidebar or header. Renders a minimal full-page wrapper
 * matching the legacy .authPage centered layout.
 */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
