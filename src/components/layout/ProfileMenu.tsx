'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/hooks/useAuth';
import { api } from '@/lib/api/client';
import { Modal, Button, useToast } from '@/components/ui';
import { DownloadModal } from '@/components/bot/DownloadModal';
import { BotCommandsModal } from '@/components/bot/BotCommandsModal';
import { JobOutputModal } from '@/components/bot/JobOutputModal';
import type { Job } from '@/types/bot';
import type { CompatibilityResult } from '@/lib/bot/compatibility';
import styles from './ProfileMenu.module.scss';

export function ProfileMenu() {
  const { user, logout } = useAuth();
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const isAdmin = user?.role === 'admin';
  const { toast } = useToast();

  const handleVerify = useCallback(async () => {
    setIsOpen(false);
    try {
      await api.post<Job>('/api/bot/verify', { verbose: true });
      toast('success', 'Anzeigen werden geprüft…');
    } catch {
      toast('error', 'Fehler beim Starten');
    }
  }, [toast]);

  const [aboutOpen, setAboutOpen] = useState(false);
  const [downloadOpen, setDownloadOpen] = useState(false);
  const [botCmdsOpen, setBotCmdsOpen] = useState(false);
  const [botVersion, setBotVersion] = useState<string | null>(null);
  const [updateResult, setUpdateResult] = useState<string | null>(null);
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [aboutJobId, setAboutJobId] = useState<string | null>(null);
  const [compatResult, setCompatResult] = useState<CompatibilityResult | null>(null);
  const [checkingCompat, setCheckingCompat] = useState(false);
  const [updatingBot, setUpdatingBot] = useState(false);
  const [updateDone, setUpdateDone] = useState<string | null>(null);

  const handleAbout = useCallback(async () => {
    setIsOpen(false);
    setBotVersion(null);
    setUpdateResult(null);
    setCompatResult(null);
    setUpdateDone(null);
    setAboutOpen(true);
    try {
      const result = await api.get<{ output?: string }>('/api/bot/version');
      setBotVersion(result.output || JSON.stringify(result));
    } catch {
      setBotVersion('Nicht verfügbar');
    }
  }, []);

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
    router.push('/login');
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

          {/* Profile / Settings */}
          <Link
            href="/settings"
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
                    <circle cx="12" cy="12" r="3" />
                    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
                  </svg>
                </span>
                Logs
              </Link>
            </>
          )}

          {/* About (admin only) */}
          {isAdmin && (
            <button
              className={styles.menuItem}
              onClick={handleAbout}
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

    <Modal open={aboutOpen} onClose={() => setAboutOpen(false)} title="Über Kleinanzeigen Bot UI">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
          <div style={{
            width: 40, height: 40, borderRadius: 'var(--radius-lg)',
            background: 'var(--accent)', color: 'var(--accent-text)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 'var(--font-size-base)', fontWeight: 'var(--font-bold)',
          }}>K</div>
          <div>
            <div style={{ fontWeight: 'var(--font-semibold)', color: 'var(--text-primary)' }}>
              Kleinanzeigen Bot UI
            </div>
            <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-muted)' }}>
              Web-Interface für kleinanzeigen-bot
            </div>
          </div>
        </div>
        <div style={{
          padding: 'var(--space-3)', background: 'var(--bg-tertiary)',
          borderRadius: 'var(--radius-md)', fontFamily: 'var(--font-mono)',
          fontSize: 'var(--font-size-sm)', color: 'var(--text-secondary)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <span>Bot: {botVersion ?? 'Wird geladen…'} · GUI: v{process.env.NEXT_PUBLIC_APP_VERSION}</span>
          {updateResult?.startsWith('update:') ? (
            compatResult && (compatResult.overallStatus !== 'error' || (compatResult.commands.length === 0 && compatResult.flags.length === 0)) && !updateDone ? (
              <Button
                variant="primary"
                size="sm"
                loading={updatingBot}
                disabled={updatingBot}
                onClick={async () => {
                  setUpdatingBot(true);
                  try {
                    const job = await api.post<Job>('/api/bot/update-bot', { channel: 'latest' });
                    // Poll job status
                    for (let i = 0; i < 60; i++) {
                      await new Promise((r) => setTimeout(r, 1000));
                      try {
                        const j = await api.get<Job>(`/api/jobs/${job.job_id}`);
                        if (j.status !== 'running') {
                          if (j.status === 'completed') {
                            // Extract new version from output
                            const versionMatch = j.output?.match(/Bot aktualisiert:.*?→\s*(\S+)/);
                            const newVersion = versionMatch?.[1] || 'aktualisiert';
                            setUpdateDone(newVersion);
                            setBotVersion(newVersion);
                            toast('success', `Bot aktualisiert auf ${newVersion}`);
                          } else {
                            toast('error', 'Bot-Update fehlgeschlagen — siehe Job-Verlauf');
                          }
                          // Open job output modal for details
                          setAboutOpen(false);
                          setAboutJobId(job.job_id);
                          break;
                        }
                      } catch { break; }
                    }
                  } catch {
                    toast('error', 'Bot-Update konnte nicht gestartet werden');
                  } finally {
                    setUpdatingBot(false);
                  }
                }}
              >
                Bot aktualisieren
              </Button>
            ) : updateDone ? (
              <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-success)', fontWeight: 'var(--font-semibold)' }}>
                Aktualisiert
              </span>
            ) : (
              <Button
                variant="outline"
                size="sm"
                loading={checkingCompat}
                disabled={checkingCompat}
                onClick={async () => {
                  setCheckingCompat(true);
                  setCompatResult(null);
                  try {
                    const newVersion = updateResult!.split(':')[1];
                    const result = await api.get<CompatibilityResult>(
                      `/api/system/compatibility?mode=upstream&version=${encodeURIComponent(newVersion)}`
                    );
                    setCompatResult(result);
                  } catch {
                    toast('error', 'Kompatibilitätsprüfung fehlgeschlagen');
                  } finally {
                    setCheckingCompat(false);
                  }
                }}
              >
                Kompatibilität prüfen
              </Button>
            )
          ) : (
            <Button
              variant="outline"
              size="sm"
              loading={checkingUpdate}
              disabled={checkingUpdate}
              onClick={async () => {
                if (checkingUpdate) return;
                setCheckingUpdate(true);
                setUpdateResult(null);
                try {
                  const job = await api.post<Job>('/api/bot/update-check', { verbose: true });
                  for (let i = 0; i < 30; i++) {
                    await new Promise((r) => setTimeout(r, 2000));
                    try {
                      const j = await api.get<Job>(`/api/jobs/${job.job_id}`);
                      if (j.status !== 'running') {
                        const output = j.output || '';
                        const match = output.match(/neue Version.*?verfügbar:\s*(\S+)/i) || output.match(/new version.*?available:\s*(\S+)/i);
                        if (match) {
                          setUpdateResult(`update:${match[1]}:${j.job_id}`);
                        } else if (output.includes('aktuell') || output.includes('up to date')) {
                          setUpdateResult('Bereits aktuell');
                        } else {
                          setUpdateResult(j.status === 'completed' ? 'Bereits aktuell' : 'Prüfung fehlgeschlagen');
                        }
                        break;
                      }
                    } catch { break; }
                  }
                } catch {
                  setUpdateResult('Fehler beim Starten');
                } finally {
                  setCheckingUpdate(false);
                }
              }}
            >
              Update prüfen
            </Button>
          )}
        </div>
        {updateResult && (() => {
          const isUpdate = updateResult.startsWith('update:');
          if (isUpdate) {
            const parts = updateResult.split(':');
            const version = parts[1];
            const jobId = parts[2];
            return (
              <div style={{
                padding: 'var(--space-2) var(--space-3)',
                background: 'var(--accent-muted)',
                borderRadius: 'var(--radius-md)',
                fontSize: 'var(--font-size-sm)',
                color: 'var(--accent)',
                display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-2)',
              }}>
                <span>
                  Update verfügbar:{' '}
                  <a
                    href={`https://github.com/Second-Hand-Friends/kleinanzeigen-bot/releases`}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ color: 'var(--accent)', fontWeight: 'var(--font-semibold)', textDecoration: 'underline' }}
                  >
                    {version}
                  </a>
                </span>
                <button
                  onClick={() => { setAboutOpen(false); setAboutJobId(jobId); }}
                  style={{
                    background: 'none', border: 'none', color: 'var(--accent)',
                    fontSize: 'var(--font-size-xs)', cursor: 'pointer', fontFamily: 'inherit',
                    textDecoration: 'underline', whiteSpace: 'nowrap',
                  }}
                >
                  Details
                </button>
              </div>
            );
          }
          return (
            <div style={{
              padding: 'var(--space-2) var(--space-3)',
              background: 'var(--bg-tertiary)',
              borderRadius: 'var(--radius-md)',
              fontSize: 'var(--font-size-sm)',
              color: 'var(--text-secondary)',
            }}>
              {updateResult}
            </div>
          );
        })()}
        {/* Update success message */}
        {updateDone && (
          <div style={{
            padding: 'var(--space-3)',
            background: 'var(--green-muted)',
            borderRadius: 'var(--radius-md)',
            fontSize: 'var(--font-size-sm)',
            color: 'var(--text-success)',
            fontWeight: 'var(--font-semibold)',
          }}>
            Bot erfolgreich aktualisiert auf {updateDone}
          </div>
        )}
        {/* Compatibility result — shown after checking new version */}
        {compatResult && !updateDone && (
          <div style={{
            padding: 'var(--space-3)',
            background: compatResult.overallStatus === 'ok' ? 'var(--green-muted)'
              : compatResult.overallStatus === 'warning' ? 'var(--yellow-muted)'
              : 'var(--red-muted)',
            borderRadius: 'var(--radius-md)',
            fontSize: 'var(--font-size-sm)',
          }}>
            <div style={{
              fontWeight: 'var(--font-semibold)',
              color: compatResult.overallStatus === 'ok' ? 'var(--text-success)'
                : compatResult.overallStatus === 'warning' ? 'var(--text-warning)'
                : 'var(--text-danger)',
              marginBottom: compatResult.commands.some(c => c.status !== 'ok') || compatResult.flags.some(f => f.status !== 'ok') ? 'var(--space-2)' : '0',
            }}>
              {compatResult.summary}
            </div>
            {(compatResult.commands.some(c => c.status !== 'ok') || compatResult.flags.some(f => f.status !== 'ok') || compatResult.schemas?.some(s => s.status !== 'ok')) && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
                {compatResult.commands
                  .filter(c => c.status !== 'ok')
                  .map(c => (
                    <div key={c.command} style={{ color: 'var(--text-secondary)', fontSize: 'var(--font-size-xs)' }}>
                      {c.status === 'warning' ? '⚠️' : '❌'} <strong>{c.command}</strong> — {c.message}
                    </div>
                  ))}
                {compatResult.flags
                  .filter(f => f.status !== 'ok')
                  .map(f => (
                    <div key={`${f.command}-${f.flag}`} style={{ color: 'var(--text-secondary)', fontSize: 'var(--font-size-xs)' }}>
                      {f.status === 'warning' ? '⚠️' : '❌'} <strong>{f.command} {f.flag}</strong> — {f.message}
                    </div>
                  ))}
                {compatResult.schemas?.filter(s => s.status !== 'ok')
                  .map(s => (
                    <div key={`${s.schema}-${s.field}`} style={{ color: 'var(--text-secondary)', fontSize: 'var(--font-size-xs)' }}>
                      <div>{s.status === 'warning' ? '⚠️' : '❌'} <strong>{s.schema}.schema: {s.field}</strong> — {s.message}</div>
                      {s.detail && (
                        <div style={{ marginLeft: 'var(--space-5)', color: 'var(--text-muted)', fontSize: 'var(--font-size-xs)' }}>
                          {s.detail.type && <span>Typ: <code>{s.detail.type}</code></span>}
                          {s.detail.enum && <span> | Werte: <code>{s.detail.enum.join(', ')}</code></span>}
                          {s.detail.default !== undefined && <span> | Default: <code>{JSON.stringify(s.detail.default)}</code></span>}
                        </div>
                      )}
                    </div>
                  ))}
              </div>
            )}
            {compatResult.overallStatus === 'error' && (compatResult.commands.length > 0 || compatResult.flags.length > 0 || (compatResult.schemas?.length ?? 0) > 0) && (
              <div style={{ marginTop: 'var(--space-2)', fontSize: 'var(--font-size-xs)', color: 'var(--text-danger)' }}>
                Update nicht empfohlen — GUI muss zuerst angepasst werden.
              </div>
            )}
          </div>
        )}
        <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)', textAlign: 'center' }}>
          Powered by{' '}
          <a href="https://github.com/Second-Hand-Friends/kleinanzeigen-bot" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent)' }}>kleinanzeigen-bot</a>
          {' · '}
          <a href="https://github.com/bkd3sign/kleinanzeigen-bot-ui" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent)' }}>UI by BKD3sign</a>
        </div>
      </div>
    </Modal>

    <DownloadModal open={downloadOpen} onClose={() => setDownloadOpen(false)} />
    <BotCommandsModal open={botCmdsOpen} onClose={() => setBotCmdsOpen(false)} />
    {aboutJobId && <JobOutputModal jobId={aboutJobId} onClose={() => setAboutJobId(null)} />}
    </>
  );
}
