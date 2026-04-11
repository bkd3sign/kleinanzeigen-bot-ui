'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import Link from 'next/link';
import { ThemeSwitcher } from './ThemeSwitcher';
import { ProfileMenu } from './ProfileMenu';
import { CreateAdModal } from '@/components/ads/CreateAdModal';
import { Badge } from '@/components/ui/Badge/Badge';
import { useUnreadCount, useResponderStatus } from '@/hooks/useMessages';
import { useAiAvailable } from '@/hooks/useAiAvailable';
import styles from './Header.module.scss';

const PAGE_TITLES: Record<string, string> = {
  '/dashboard': 'Dashboard',
  '/ads': 'Anzeigen',
  '/ads/new': 'Neue Anzeige',
  '/ads/edit': 'Anzeige bearbeiten',
  '/ads/ai': 'KI-Anzeige',
  '/bot': 'Logs',
  '/jobs': 'Logs',
  '/logs': 'Logs',
  '/admin': 'Verwaltung',
  '/settings': 'Einstellungen',
  '/templates': 'Vorlagen',
  '/automation': 'Automatisierung',
  '/messages': 'Nachrichten',
};

/** Pages that show a back arrow linking to the parent page */
const BACK_LINKS: Record<string, string> = {
  '/ads/new': '/ads',
  '/ads/edit': '/ads',
  '/ads/ai': '/ads',
  '/settings': '/ads',
  '/templates/new': '/templates',
  '/templates/edit': '/templates',
  '/automation': '/dashboard',
};

export function Header() {
  const pathname = usePathname();
  const router = useRouter();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const actionsRef = useRef<HTMLDivElement>(null);
  const hamburgerRef = useRef<HTMLButtonElement>(null);

  const title = useMemo(() => {
    if (!pathname) return '';
    if (PAGE_TITLES[pathname]) return PAGE_TITLES[pathname];
    const prefix = Object.keys(PAGE_TITLES)
      .filter((key) => pathname.startsWith(key))
      .sort((a, b) => b.length - a.length)[0];
    return prefix ? PAGE_TITLES[prefix] : '';
  }, [pathname]);

  const backLink = useMemo(() => {
    if (!pathname) return null;
    if (BACK_LINKS[pathname]) return BACK_LINKS[pathname];
    const prefix = Object.keys(BACK_LINKS)
      .filter((key) => pathname.startsWith(key))
      .sort((a, b) => b.length - a.length)[0];
    return prefix ? BACK_LINKS[prefix] : null;
  }, [pathname]);

  // Close mobile menu on route change
  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  // Close mobile menu on outside click
  useEffect(() => {
    if (!mobileOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (
        actionsRef.current &&
        !actionsRef.current.contains(e.target as Node) &&
        hamburgerRef.current &&
        !hamburgerRef.current.contains(e.target as Node)
      ) {
        setMobileOpen(false);
      }
    };
    document.addEventListener('click', handleClick);
    return () => document.removeEventListener('click', handleClick);
  }, [mobileOpen]);

  const handleCreateAd = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      setMobileOpen(false);
      setCreateModalOpen(true);
    },
    [],
  );

  return (
    <header className={styles.header}>
      {/* Brand group: K icon + page title + optional back */}
      <div className={styles.headerBrandGroup}>
        <Link href="/" className={styles.headerBrand}>
          <div className={styles.brandIcon}>K</div>
          <h1 className={styles.headerTitle}>{title}</h1>
        </Link>
        {backLink && (
          <Link href={backLink} className={styles.headerBack}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </Link>
        )}
      </div>

      {/* Mobile hamburger */}
      <button
        ref={hamburgerRef}
        className={styles.headerHamburger}
        onClick={(e) => {
          e.stopPropagation();
          setMobileOpen((prev) => !prev);
        }}
        aria-label="Menu"
      >
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <line x1="3" y1="6" x2="21" y2="6" />
          <line x1="3" y1="12" x2="21" y2="12" />
          <line x1="3" y1="18" x2="21" y2="18" />
        </svg>
      </button>

      {/* Header actions */}
      <div
        ref={actionsRef}
        className={`${styles.headerActions} ${mobileOpen ? styles.headerActionsOpen : ''}`}
      >
        {/* Create ad button */}
        <a
          href="/ads/new"
          className={`${styles.headerDropdownBtn} ${styles.headerCreateAd}`}
          onClick={handleCreateAd}
        >
          <span className={styles.headerDropdownBtnIcon}>
            <svg viewBox="0 0 24 24">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
          </span>
          Anzeige erstellen
        </a>

        {/* Ads link */}
        <Link
          href="/ads"
          className={styles.headerDropdownBtn}
          onClick={() => setMobileOpen(false)}
        >
          <span className={styles.headerDropdownBtnIcon}>
            <svg viewBox="0 0 24 24">
              <rect x="2" y="3" width="20" height="14" rx="2" />
              <line x1="8" y1="21" x2="16" y2="21" />
              <line x1="12" y1="17" x2="12" y2="21" />
            </svg>
          </span>
          Anzeigen
        </Link>

        {/* Messages link with unread badge */}
        <MessagesLink onClose={() => setMobileOpen(false)} />

        {/* Dashboard link */}
        <Link
          href="/dashboard"
          className={styles.headerDropdownBtn}
          onClick={() => setMobileOpen(false)}
        >
          <span className={styles.headerDropdownBtnIcon}>
            <svg viewBox="0 0 24 24">
              <path d="M18 20V10" />
              <path d="M12 20V4" />
              <path d="M6 20v-6" />
            </svg>
          </span>
          Dashboard
        </Link>

        {/* Theme toggle */}
        <ThemeSwitcher className={styles.headerDropdownBtn} iconClassName={styles.headerDropdownBtnIcon} />

        {/* Profile dropdown */}
        <ProfileMenu />
      </div>

      {/* Create Ad Modal */}
      <CreateAdModal open={createModalOpen} onClose={() => setCreateModalOpen(false)} />
    </header>
  );
}

function MessagesLink({ onClose }: { onClose: () => void }) {
  const { data } = useUnreadCount();
  const { data: responder } = useResponderStatus();
  const { isAiAvailable } = useAiAvailable();
  const count = data?.numUnreadMessages ?? 0;
  const aiMode = isAiAvailable ? responder?.mode : undefined;

  return (
    <Link
      href="/messages"
      className={styles.headerDropdownBtn}
      onClick={onClose}
    >
      <span className={styles.headerDropdownBtnIcon}>
        <svg viewBox="0 0 24 24">
          <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
        </svg>
      </span>
      Nachrichten
      {aiMode && aiMode !== 'off' && (
        <Badge variant={aiMode === 'auto' ? 'success' : 'info'}>
          {aiMode === 'auto' ? 'Auto' : 'Review'}
        </Badge>
      )}
      {count > 0 && (
        <Badge variant="danger">{count}</Badge>
      )}
    </Link>
  );
}
