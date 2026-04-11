'use client';

import { useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';
import { Header } from './Header';
import { JobPill } from '@/components/bot/JobPill';
import styles from './AppShell.module.scss';

interface AppShellProps {
  children: React.ReactNode;
}

export function AppShell({ children }: AppShellProps) {
  const pathname = usePathname();
  const mainRef = useRef<HTMLElement>(null);
  const prevPath = useRef(pathname);

  // Re-trigger entrance animation on navigation without remounting
  useEffect(() => {
    if (pathname !== prevPath.current && mainRef.current) {
      prevPath.current = pathname;
      const el = mainRef.current;
      el.classList.remove('animPageEnter');
      // Force reflow so removing + re-adding the class restarts the animation
      void el.offsetWidth;
      el.classList.add('animPageEnter');
    }
  }, [pathname]);

  return (
    <div className={styles.app}>
      <div className={styles.mainWrapper}>
        <Header />
        <main ref={mainRef} className={`${styles.main} animPageEnter`}>{children}</main>
      </div>
      <JobPill />
    </div>
  );
}
