'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/hooks/useAuth';
import { api } from '@/lib/api/client';
import { useToast } from '@/components/ui';
import { DownloadModal } from '@/components/bot/DownloadModal';
import { BotCommandsModal } from '@/components/bot/BotCommandsModal';
import { useAboutModal } from '@/contexts/AboutModalContext';
import type { Job } from '@/types/bot';
import styles from './ProfileMenu.module.scss';

export function ProfileMenu() {
  const { user, logout } = useAuth();
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const isAdmin = user?.role === 'admin';
  const { toast } = useToast();
  const { openAbout } = useAboutModal();

  const handleVerify = useCallback(async () => {
    setIsOpen(false);
    try {
      await api.post<Job>('/api/bot/verify', { verbose: true });
      toast('success', 'Anzeigen werden geprüft…');
    } catch {
      toast('error', 'Fehler beim Starten');
    }
  }, [toast]);

  const [downloadOpen, setDownloadOpen] = useState(false);
  const [botCmdsOpen, setBotCmdsOpen] = useState(false);

  const handleDownload = useCallback(() => {
    setIsOpen(false);
    setDownloadOpen(true);
  }, []);
  const [contactName, setContactName] = useState<string | null>(null);

  useEffect(() => {
    api.get<{ ad_defaults?: { contact?: { name?: string } } }>('/api/system/config')
      .then((data) => {
        const name = data.ad_defaults?.contact?.name;
        if (name) setContactName(name);
      })
      .catch(() => {});
  }, []);

  const displayName = contactName || user?.display_name || user?.email || '';

  const handleLogout = useCallback(() => {
    setIsOpen(false);
    logout();
    router.replace('/login');
  }, [logout, router]);

  // Close on outside click
  useEffect(() => {
    if (!isOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('click', handleClick);
    return () => document.removeEventListener('click', handleClick);
  }, [isOpen]);

  // Close on Escape
  useEffect(() => {
    if (!isOpen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsOpen(false);
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [isOpen]);

  return (<>
    <div className={styles.dropdown} ref={dropdownRef}>
      <button
        className={styles.trigger}
        onClick={(e) => {
          e.stopPropagation();
          setIsOpen((prev) => !prev);
        }}
        title="Profil"
      >
        <span className={styles.triggerIcon}>
          <svg viewBox="0 0 24 24">
            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
            <circle cx="12" cy="7" r="4" />
          </svg>
        </span>
        {displayName && (
          <span className={styles.profileName}>{displayName}</span>
        )}
        <span className={styles.chevron}>
          <svg viewBox="0 0 24 24">
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </span>
      </button>

      {isOpen && (
        <div className={styles.menu}>
          {/* Verify ads */}
          <button
            className={styles.menuItem}
            onClick={handleVerify}
          >
            <span className={styles.menuItemIcon}>
              <svg viewBox="0 0 24 24">
                <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                <polyline points="22 4 12 14.01 9 11.01" />
              </svg>
            </span>
            Anzeigen prüfen
          </button>

          {/* Live Backup */}
          <button
            className={styles.menuItem}
            onClick={handleDownload}
          >
            <span className={styles.menuItemIcon}>
              <svg viewBox="0 0 24 24">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
            </span>
            Live Backup
          </button>

          {/* Account — personal settings (per workspace) */}
          <Link
            href="/account"
            className={styles.menuItemLink}
            onClick={() => setIsOpen(false)}
          >
            <span className={styles.menuItemIcon}>
              <svg viewBox="0 0 24 24">
                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                <circle cx="12" cy="7" r="4" />
              </svg>
            </span>
            Profil
          </Link>

          {/* Automation — visible to all users */}
          <Link
            href="/automation"
            className={styles.menuItemLink}
            onClick={() => setIsOpen(false)}
          >
            <span className={styles.menuItemIcon}>
              <svg viewBox="0 0 24 24">
                <circle cx="12" cy="12" r="10" />
                <polyline points="12 6 12 12 16 14" />
              </svg>
            </span>
            Automatisierung
          </Link>

          {/* Admin-only items */}
          {isAdmin && (
            <>
              <div className={styles.separator} />

              {/* Bot commands */}
              <button
                className={styles.menuItem}
                onClick={() => {
                  setIsOpen(false);
                  setBotCmdsOpen(true);
                }}
              >
                <span className={styles.menuItemIcon}>
                  <svg viewBox="0 0 24 24">
                    <polyline points="4 17 10 11 4 5" />
                    <line x1="12" y1="19" x2="20" y2="19" />
                  </svg>
                </span>
                Bot-Befehle
              </button>

              {/* Admin / Verwaltung */}
              <button
                className={styles.menuItem}
                onClick={() => {
                  setIsOpen(false);
                  router.push('/admin');
                }}
              >
                <span className={styles.menuItemIcon}>
                  <svg viewBox="0 0 24 24">
                    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                    <circle cx="9" cy="7" r="4" />
                    <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                    <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                  </svg>
                </span>
                Verwaltung
              </button>

              {/* Logs */}
              <Link
                href="/logs"
                className={styles.menuItemLink}
                onClick={() => setIsOpen(false)}
              >
                <span className={styles.menuItemIcon}>
                  <svg viewBox="0 0 24 24">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                    <polyline points="14 2 14 8 20 8" />
                    <line x1="8" y1="13" x2="16" y2="13" />
                    <line x1="8" y1="17" x2="16" y2="17" />
                    <line x1="8" y1="9" x2="10" y2="9" />
                  </svg>
                </span>
                Logs
              </Link>

              {/* Global bot settings (affect every workspace) */}
              <Link
                href="/settings"
                className={styles.menuItemLink}
                onClick={() => setIsOpen(false)}
              >
                <span className={styles.menuItemIcon}>
                  <svg viewBox="0 0 24 24">
                    <circle cx="12" cy="12" r="3" />
                    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
                  </svg>
                </span>
                Einstellungen
              </Link>
            </>
          )}

          {/* About (admin only) */}
          {isAdmin && (
            <button
              className={styles.menuItem}
              onClick={() => { setIsOpen(false); openAbout(); }}
            >
              <span className={styles.menuItemIcon}>
                <svg viewBox="0 0 24 24">
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" y1="16" x2="12" y2="12" />
                  <line x1="12" y1="8" x2="12.01" y2="8" />
                </svg>
              </span>
              Über
            </button>
          )}

          {/* Logout */}
          <button
            className={styles.menuItem}
            onClick={handleLogout}
          >
            <span className={styles.menuItemIcon}>
              <svg viewBox="0 0 24 24">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                <polyline points="16 17 21 12 16 7" />
                <line x1="21" y1="12" x2="9" y2="12" />
              </svg>
            </span>
            Abmelden
          </button>
        </div>
      )}
    </div>

    <DownloadModal open={downloadOpen} onClose={() => setDownloadOpen(false)} />
    <BotCommandsModal open={botCmdsOpen} onClose={() => setBotCmdsOpen(false)} />
    </>
  );
}
