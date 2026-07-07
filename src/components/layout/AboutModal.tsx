// src/components/layout/AboutModal.tsx
'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api/client';
import { Modal, Button, useToast } from '@/components/ui';
import { JobOutputModal } from '@/components/bot/JobOutputModal';
import type { Job } from '@/types/bot';
import type { CompatibilityResult } from '@/lib/bot/compatibility';
import type { GuiUpdateResult } from '@/lib/update-check/pill-state';
import styles from './AboutModal.module.scss';

interface Props {
  open: boolean;
  onClose: () => void;
}

export function AboutModal({ open, onClose }: Props) {
  const { toast } = useToast();

  const [botVersion, setBotVersion] = useState<string | null>(null);
  const [botUpdateResult, setBotUpdateResult] = useState<string | null>(null);
  const [guiUpdateResult, setGuiUpdateResult] = useState<GuiUpdateResult | null>(null);
  const [checkingAll, setCheckingAll] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const [compatResult, setCompatResult] = useState<CompatibilityResult | null>(null);
  const [checkingCompat, setCheckingCompat] = useState(false);
  const [updatingBot, setUpdatingBot] = useState(false);
  const [updateDone, setUpdateDone] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setBotVersion(null);
    setBotUpdateResult(null);
    setGuiUpdateResult(null);
    setCompatResult(null);
    setUpdateDone(null);
    api.get<{ output?: string }>('/api/bot/version')
      .then((r) => setBotVersion(r.output || JSON.stringify(r)))
      .catch(() => setBotVersion('Nicht verfügbar'));
  }, [open]);

  const checkBotUpdate = useCallback(async () => {
    try {
      const job = await api.post<Job>('/api/bot/update-check', { verbose: true });
      for (let i = 0; i < 30; i++) {
        await new Promise<void>((r) => setTimeout(r, 2000));
        try {
          const j = await api.get<Job>(`/api/jobs/${job.job_id}`);
          if (j.status !== 'running') {
            const output = j.output || '';
            const match = output.match(/neue Version.*?verfügbar:\s*(\S+)/i)
              || output.match(/new version.*?available:\s*(\S+)/i);
            if (match) {
              setBotUpdateResult(`update:${match[1]}:${j.job_id}`);
            } else {
              setBotUpdateResult(
                output.includes('aktuell') || output.includes('up to date') ? 'ok'
                : j.status === 'completed' ? 'ok'
                : 'error'
              );
            }
            break;
          }
        } catch { break; }
      }
    } catch {
      setBotUpdateResult('error');
    }
  }, []);

  const checkGuiUpdate = useCallback(async () => {
    try {
      const result = await api.get<GuiUpdateResult>('/api/system/gui-version-check');
      setGuiUpdateResult(result);
    } catch {
      // Silently ignore — GitHub may be unreachable
    }
  }, []);

  const handleCheckAll = useCallback(async () => {
    if (checkingAll) return;
    setCheckingAll(true);
    setBotUpdateResult(null);
    setGuiUpdateResult(null);
    setCompatResult(null);
    setUpdateDone(null);
    await Promise.all([checkBotUpdate(), checkGuiUpdate()]);
    setCheckingAll(false);
  }, [checkingAll, checkBotUpdate, checkGuiUpdate]);

  const handleCheckCompat = useCallback(async () => {
    setCheckingCompat(true);
    setCompatResult(null);
    try {
      const version = botUpdateResult!.split(':')[1];
      const result = await api.get<CompatibilityResult>(
        `/api/system/compatibility?mode=upstream&version=${encodeURIComponent(version)}`
      );
      setCompatResult(result);
    } catch {
      toast('error', 'Kompatibilitätsprüfung fehlgeschlagen');
    } finally {
      setCheckingCompat(false);
    }
  }, [botUpdateResult, toast]);

  const handleUpdateBot = useCallback(async () => {
    setUpdatingBot(true);
    try {
      const job = await api.post<Job>('/api/bot/update-bot', { channel: 'latest' });
      for (let i = 0; i < 60; i++) {
        await new Promise<void>((r) => setTimeout(r, 1000));
        try {
          const j = await api.get<Job>(`/api/jobs/${job.job_id}`);
          if (j.status !== 'running') {
            if (j.status === 'completed') {
              const match = j.output?.match(/Bot aktualisiert:.*?→\s*(\S+)/);
              const newVersion = match?.[1] || 'aktualisiert';
              setUpdateDone(newVersion);
              setBotVersion(newVersion);
              toast('success', `Bot aktualisiert auf ${newVersion}`);
            } else {
              toast('error', 'Bot-Update fehlgeschlagen — siehe Job-Verlauf');
            }
            onClose();
            setJobId(job.job_id);
            break;
          }
        } catch { break; }
      }
    } catch {
      toast('error', 'Bot-Update konnte nicht gestartet werden');
    } finally {
      setUpdatingBot(false);
    }
  }, [onClose, toast]);

  const isBotUpdate = botUpdateResult?.startsWith('update:');
  const botUpdateVersion = isBotUpdate ? botUpdateResult!.split(':')[1] : null;
  const botUpdateJobId = isBotUpdate ? botUpdateResult!.split(':')[2] : null;
  const canUpdateBot = compatResult !== null &&
    (compatResult.overallStatus !== 'error' ||
      (compatResult.commands.length === 0 && compatResult.flags.length === 0));

  const compatHasIssues = compatResult !== null && (
    compatResult.commands.some((c) => c.status !== 'ok') ||
    compatResult.flags.some((f) => f.status !== 'ok') ||
    (compatResult.schemas?.some((s) => s.status !== 'ok') ?? false)
  );

  const compatTitleClass = compatResult?.overallStatus === 'ok'
    ? styles.compatTitleOk
    : compatResult?.overallStatus === 'warning'
    ? styles.compatTitleWarning
    : styles.compatTitleError;

  const compatBlockClass = compatResult?.overallStatus === 'ok'
    ? styles.compatOk
    : compatResult?.overallStatus === 'warning'
    ? styles.compatWarning
    : styles.compatError;

  return (
    <>
      <Modal open={open} onClose={onClose} title="Über Kleinanzeigen Bot UI">
        <div className={styles.body}>
          {/* Header */}
          <div className={styles.header}>
            <div className={styles.headerIcon}>K</div>
            <div>
              <div className={styles.headerTitle}>Kleinanzeigen Bot UI</div>
              <div className={styles.headerSubtitle}>Web-Interface für kleinanzeigen-bot</div>
            </div>
          </div>

          {/* Version block */}
          <div className={styles.versionBlock}>
            <div className={styles.versionText}>
              <span>Bot: {botVersion ?? 'Wird geladen…'}</span>
              <span>GUI: v{process.env.NEXT_PUBLIC_APP_VERSION}</span>
            </div>
            {isBotUpdate && !updateDone && compatResult === null ? (
              <Button
                variant="outline"
                size="sm"
                loading={checkingCompat}
                disabled={checkingCompat}
                onClick={handleCheckCompat}
              >
                Kompatibilität prüfen
              </Button>
            ) : isBotUpdate && !updateDone && canUpdateBot ? (
              <Button
                variant="primary"
                size="sm"
                loading={updatingBot}
                disabled={updatingBot}
                onClick={handleUpdateBot}
              >
                Bot aktualisieren
              </Button>
            ) : (
              <Button
                variant="outline"
                size="sm"
                loading={checkingAll}
                disabled={checkingAll}
                onClick={handleCheckAll}
              >
                Prüfen
              </Button>
            )}
          </div>

          {/* Bot update result */}
          {isBotUpdate && !updateDone && (
            <div className={`${styles.resultRow} ${styles.resultUpdate}`}>
              <span>
                Bot-Update:{' '}
                <a
                  href="https://github.com/Second-Hand-Friends/kleinanzeigen-bot/releases"
                  target="_blank"
                  rel="noopener noreferrer"
                  className={styles.resultLink}
                >
                  {botUpdateVersion}
                </a>
              </span>
              <button
                className={styles.detailsBtn}
                onClick={() => { onClose(); setJobId(botUpdateJobId!); }}
              >
                Details
              </button>
            </div>
          )}
          {botUpdateResult === 'ok' && (
            <div className={`${styles.resultRow} ${styles.resultNeutral}`}>
              Bot bereits aktuell
            </div>
          )}
          {updateDone && (
            <div className={`${styles.resultRow} ${styles.resultSuccess}`}>
              Bot erfolgreich aktualisiert auf {updateDone}
            </div>
          )}

          {/* Compat result */}
          {compatResult && !updateDone && (
            <div className={`${styles.compatBlock} ${compatBlockClass}`}>
              <div className={`${styles.compatTitle} ${compatTitleClass} ${compatHasIssues ? styles.compatTitleWithItems : ''}`}>
                {compatResult.summary}
              </div>
              {compatHasIssues && (
                <div>
                  {compatResult.commands.filter((c) => c.status !== 'ok').map((c) => (
                    <div key={c.command} className={styles.compatItem}>
                      {c.status === 'warning' ? '⚠️' : '❌'} <strong>{c.command}</strong> — {c.message}
                    </div>
                  ))}
                  {compatResult.flags.filter((f) => f.status !== 'ok').map((f) => (
                    <div key={`${f.command}-${f.flag}`} className={styles.compatItem}>
                      {f.status === 'warning' ? '⚠️' : '❌'} <strong>{f.command} {f.flag}</strong> — {f.message}
                    </div>
                  ))}
                  {compatResult.schemas?.filter((s) => s.status !== 'ok').map((s) => (
                    <div key={`${s.schema}-${s.field}`}>
                      <div className={styles.compatItem}>
                        {s.status === 'warning' ? '⚠️' : '❌'} <strong>{s.schema}.schema: {s.field}</strong> — {s.message}
                      </div>
                      {s.detail && (
                        <div className={styles.compatItemDetail}>
                          {s.detail.type && <span>Typ: <code>{s.detail.type}</code></span>}
                          {s.detail.enum && <span> | Werte: <code>{s.detail.enum.join(', ')}</code></span>}
                          {s.detail.default !== undefined && <span> | Default: <code>{JSON.stringify(s.detail.default)}</code></span>}
                        </div>
                      )}
                    </div>
                  ))}
                  {compatResult.overallStatus === 'error' &&
                    (compatResult.commands.length > 0 || compatResult.flags.length > 0 || (compatResult.schemas?.length ?? 0) > 0) && (
                    <div className={styles.compatNoUpdate}>
                      Update nicht empfohlen — GUI muss zuerst angepasst werden.
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* GUI update result */}
          {guiUpdateResult !== null && (
            guiUpdateResult.upToDate ? (
              <div className={`${styles.resultRow} ${styles.resultNeutral}`}>
                GUI bereits aktuell
              </div>
            ) : (
              <div className={`${styles.resultRow} ${styles.resultUpdate}`}>
                <span>
                  GUI-Update:{' '}
                  <a
                    href={guiUpdateResult.releaseUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={styles.resultLink}
                  >
                    v{guiUpdateResult.latestVersion}
                  </a>
                </span>
                <a
                  href={guiUpdateResult.releaseUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={styles.detailsBtn}
                >
                  Details
                </a>
              </div>
            )
          )}

          {/* Footer */}
          <div className={styles.footer}>
            Powered by{' '}
            <a
              href="https://github.com/Second-Hand-Friends/kleinanzeigen-bot"
              target="_blank"
              rel="noopener noreferrer"
            >
              kleinanzeigen-bot
            </a>
            {' · '}
            <a
              href="https://github.com/bkd3sign/kleinanzeigen-bot-ui"
              target="_blank"
              rel="noopener noreferrer"
            >
              UI by BKD3sign
            </a>
          </div>
        </div>
      </Modal>

      {jobId && <JobOutputModal jobId={jobId} onClose={() => setJobId(null)} />}
    </>
  );
}
