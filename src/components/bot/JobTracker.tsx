'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useJobs, useCancelJob, useRepeatJob, useResumeJob } from '@/hooks/useJobs';
import { useAuth } from '@/hooks/useAuth';
import { useSort } from '@/hooks/useSort';
import { useResponderStatus, useMessagingStatus } from '@/hooks/useMessages';
import { getResponderBadge, canLoadInbox, type ResponderMode } from '@/lib/messaging/responderBadge';
import { useVncLogin } from '@/hooks/useVncLogin';
import { useQuery } from '@tanstack/react-query';
import { Badge, Button, DropdownMenu, showConfirm, useToast } from '@/components/ui';
import type { DropdownMenuItem } from '@/components/ui';
import { JobOutputModal } from './JobOutputModal';
import { VncLoginModal } from './VncLoginModal';
import { jobStatusShortLabel } from '@/lib/bot/job-status';
import type { Job, JobStatus, Schedule } from '@/types/bot';
import { api } from '@/lib/api/client';
import styles from './JobTracker.module.scss';

type FilterValue = JobStatus | 'scheduled' | 'ki_messaging' | null;
type JobSortKey = 'job_id' | 'command' | 'status' | 'started_at' | 'duration';

interface FilterDef { label: string; value: FilterValue; view?: boolean }

const FILTERS: FilterDef[] = [
  { label: 'Alle', value: null },
  { label: 'Laufend', value: 'running' },
  { label: 'Wartend', value: 'queued' },
  { label: 'Abgeschlossen', value: 'completed' },
  { label: 'Mit Fehlern', value: 'completed_with_errors' },
  { label: 'Fehlgeschlagen', value: 'failed' },
  { label: 'MFA ausstehend', value: 'mfa_required' },
  { label: 'Login erforderlich', value: 'login_required' },
  { label: 'Wartet auf Anmeldung', value: 'waiting_for_user' },
  { label: 'Automatisierung', value: 'scheduled', view: true },
  { label: 'KI-Nutzung', value: 'ki_messaging', view: true },
];

function formatDuration(startIso: string, endIso?: string): string {
  const start = new Date(startIso).getTime();
  const end = endIso ? new Date(endIso).getTime() : Date.now();
  const diffMs = end - start;
  if (diffMs < 0) return '–';
  const seconds = Math.floor(diffMs / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (minutes < 60) return `${minutes}m ${remainingSeconds}s`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return `${hours}h ${remainingMinutes}m`;
}

function durationMs(job: Job): number {
  const start = new Date(job.started_at).getTime();
  const end = job.finished_at ? new Date(job.finished_at).getTime() : Date.now();
  return end - start;
}

const STATUS_ORDER: Record<JobStatus, number> = { running: 0, waiting_for_user: 1, mfa_required: 2, login_required: 3, queued: 4, completed: 5, completed_with_errors: 6, failed: 7 };

function compareJobs(a: Job, b: Job, key: JobSortKey): number {
  if (key === 'job_id') return a.job_id.localeCompare(b.job_id);
  if (key === 'command') return a.command.localeCompare(b.command, 'de');
  if (key === 'status') return (STATUS_ORDER[a.status] ?? 9) - (STATUS_ORDER[b.status] ?? 9);
  if (key === 'started_at') return new Date(a.started_at).getTime() - new Date(b.started_at).getTime();
  if (key === 'duration') return durationMs(a) - durationMs(b);
  return 0;
}

function statusVariant(status: JobStatus): 'success' | 'danger' | 'running' | 'warning' {
  if (status === 'completed') return 'success';
  if (status === 'completed_with_errors') return 'warning';
  if (status === 'failed') return 'danger';
  if (status === 'mfa_required') return 'warning';
  if (status === 'login_required') return 'warning';
  if (status === 'waiting_for_user') return 'warning';
  if (status === 'queued') return 'warning';
  return 'running';
}

export function JobTracker() {
  const [filter, setFilter] = useState<FilterValue>(null);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const apiFilter = filter === 'scheduled' || filter === 'ki_messaging' ? undefined : (filter ?? undefined);
  const { data } = useJobs(apiFilter);
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const jobs = useMemo(() => data?.jobs ?? [], [data?.jobs]);

  useEffect(() => {
    if (filter !== 'scheduled') return;
    api.get<{ schedules: Schedule[] }>('/api/schedules?view=active')
      .then((d) => setSchedules(d.schedules))
      .catch(() => {});
  }, [filter]);

  const cancelJob = useCancelJob();
  const repeatJob = useRepeatJob();
  const resumeJob = useResumeJob();
  const { toast } = useToast();

  const handleClose = useCallback(() => setSelectedJobId(null), []);

  const handleCancel = useCallback(async (jobId: string, command: string) => {
    const confirmed = await showConfirm(
      'Job abbrechen',
      `Soll der Job „${command}" wirklich abgebrochen werden?`,
      'Abbrechen',
      'Zurück',
    );
    if (confirmed) {
      try {
        await cancelJob.mutateAsync(jobId);
        toast('success', 'Job abgebrochen');
      } catch {
        toast('error', 'Job konnte nicht abgebrochen werden');
      }
    }
  }, [cancelJob, toast]);

  const handleRepeat = useCallback(async (jobId: string, command: string) => {
    try {
      await repeatJob.mutateAsync(jobId);
      toast('success', `„${command}" erneut gestartet`);
    } catch {
      toast('error', 'Befehl konnte nicht wiederholt werden');
    }
  }, [repeatJob, toast]);

  const { sorted: sortedJobs, handleSort, sortIcon } = useSort<Job, JobSortKey>(jobs, 'started_at', compareJobs);

  // Once the manual login succeeds: a paused job (waiting_for_user) just needs to resume
  // (the bot is still running, attached to this browser); a finished login_required job
  // needs a fresh retry. Resume wins — repeating a paused job would orphan it.
  const handleVncSuccess = useCallback(() => {
    const waitingJob = jobs.find((j) => j.status === 'waiting_for_user');
    if (waitingJob) { resumeJob.mutate(waitingJob.job_id); return; }
    const loginJob = jobs.find((j) => j.status === 'login_required');
    if (loginJob) repeatJob.mutate(loginJob.job_id);
  }, [jobs, repeatJob, resumeJob]);

  const vnc = useVncLogin(handleVncSuccess);

  return (
    <div className={styles.wrapper}>
      {(vnc.mode === 'visible' || (vnc.mode === 'auto' && vnc.loginRequired)) && (
        <div className={`${styles.vncBar} scrollRowX`}>
          <span className={styles.vncBarLabel}>Chrome-Browser</span>
          <Badge variant={vnc.active ? 'success' : 'muted'}>
            {vnc.active ? 'aktiv' : 'aus'}
          </Badge>
          <Button size="sm" variant="secondary" loading={vnc.busy} disabled={vnc.busy || vnc.modalOpen} onClick={vnc.openWindow}>
            {vnc.active ? 'Ansehen' : 'Chrome öffnen'}
          </Button>
          {vnc.active && (
            <Button
              size="sm"
              variant="ghost"
              disabled={vnc.jobRunning}
              title={vnc.jobRunning ? 'Läuft gerade ein Job — zum Stoppen den Job abbrechen' : undefined}
              onClick={vnc.stop}
            >
              Beenden
            </Button>
          )}
        </div>
      )}

      <div className={`${styles.filters} scrollRowX`}>
        {FILTERS.map((f, i) => (
          <React.Fragment key={f.label}>
            {f.view && !FILTERS[i - 1]?.view && <span className={styles.filterSep} />}
            <button
              type="button"
              className={`${f.view ? styles.filterBtnView : styles.filterBtn} ${f.value === filter ? (f.view ? styles.filterBtnViewActive : styles.filterBtnActive) : ''}`}
              onClick={() => setFilter(f.value)}
            >
              {f.label}
            </button>
          </React.Fragment>
        ))}
      </div>

      {filter === 'scheduled' ? (
        schedules.length === 0 ? (
          <div className={styles.empty}>
            <div className={styles.emptyTitle}>Keine aktiven Zeitpläne</div>
            <div className={styles.emptyDesc}>
              Aktiviere Zeitpläne auf der Automatisierung-Seite.
            </div>
          </div>
        ) : (
          <div className={styles.tableWrapper}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th className={styles.th}>Name</th>
                  {isAdmin && <th className={`${styles.th} ${styles.hideMobile}`}>Benutzer</th>}
                  <th className={styles.th}>Befehl</th>
                  <th className={`${styles.th} ${styles.hideMobile}`}>Zeitplan</th>
                  <th className={styles.th}>Nächste Ausf.</th>
                  <th className={`${styles.th} ${styles.hideMobile}`}>Letzte Ausf.</th>
                  <th className={styles.th}>Ergebnis</th>
                </tr>
              </thead>
              <tbody>
                {schedules.map((s, i) => (
                  <tr key={s.id} className={`${styles.row} animRow`} style={{ '--anim-delay': `${i * 30}ms` } as React.CSSProperties}>
                    <td className={styles.td}>{s.name}</td>
                    {isAdmin && <td className={`${styles.tdMuted} ${styles.hideMobile}`}>{s.created_by === 'system' ? 'System' : s.created_by_label || s.created_by || '–'}</td>}
                    <td className={styles.tdMono}>{s.command}</td>
                    <td className={`${styles.td} ${styles.hideMobile}`}>{s.cron}</td>
                    <td className={styles.td}>
                      {s.next_run ? new Date(s.next_run).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '–'}
                    </td>
                    <td className={`${styles.tdMuted} ${styles.hideMobile}`}>
                      {s.last_run ? new Date(s.last_run).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '–'}
                    </td>
                    <td className={styles.td}>
                      {s.last_status ? (
                        <Badge variant={statusVariant(s.last_status)}>
                          {jobStatusShortLabel(s.last_status)}
                        </Badge>
                      ) : '–'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      ) : filter === 'ki_messaging' ? (
        <KiMessagingTable />
      ) : jobs.length === 0 ? (
        <div className={styles.empty}>
          <div className={styles.emptyIcon}>
            <svg viewBox="0 0 24 24" width="40" height="40" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
            </svg>
          </div>
          <div className={styles.emptyTitle}>Noch keine Aufträge ausgeführt</div>
          <div className={styles.emptyDesc}>
            Wähle oben einen Bot-Befehl aus, um loszulegen.
          </div>
        </div>
      ) : (
        <div className={styles.tableWrapper}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th className={`${styles.th} ${styles.hideMobile} thSortable`} onClick={() => handleSort('job_id')}>Job ID {sortIcon('job_id')}</th>
                {isAdmin && <th className={`${styles.th} ${styles.hideMobile}`}>Benutzer</th>}
                <th className={`${styles.th} thSortable`} onClick={() => handleSort('command')}>Befehl {sortIcon('command')}</th>
                <th className={`${styles.th} thSortable`} onClick={() => handleSort('status')}>Status {sortIcon('status')}</th>
                <th className={`${styles.th} ${styles.hideMobile} thSortable`} onClick={() => handleSort('started_at')}>Gestartet {sortIcon('started_at')}</th>
                <th className={`${styles.th} ${styles.hideMobile} thSortable`} onClick={() => handleSort('duration')}>Dauer {sortIcon('duration')}</th>
                <th className={`${styles.th} ${styles.thActions}`}>Aktion</th>
              </tr>
            </thead>
            <tbody>
              {sortedJobs.map((job, i) => (
                <tr
                  key={job.job_id}
                  className={`${styles.row} animRow`}
                  style={{ '--anim-delay': `${Math.min(i * 30, 450)}ms` } as React.CSSProperties}
                  onClick={() => setSelectedJobId(job.job_id)}
                >
                  <td className={styles.tdMono}>{job.job_id}</td>
                  {isAdmin && <td className={styles.tdMuted}>{job.user_label || job.user_id || '–'}</td>}
                  <td className={styles.td}>{job.command}</td>
                  <td className={styles.td}>
                    <Badge variant={statusVariant(job.status)}>
                      {jobStatusShortLabel(job.status, job.queue_position, job.retry_at)}
                    </Badge>
                  </td>
                  <td className={styles.tdMuted}>
                    {new Date(job.started_at).toLocaleString('de-DE')}
                  </td>
                  <td className={styles.tdMono}>
                    {formatDuration(job.started_at, job.finished_at)}
                  </td>
                  <td className={`${styles.td} ${styles.tdActions}`}>
                    <JobActionMenu
                      job={job}
                      onRepeat={handleRepeat}
                      onCancel={handleCancel}
                      showOpenChrome={vnc.mode === 'visible' && job.status === 'running'}
                      onOpenChrome={vnc.openWindow}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {selectedJobId && (
        <JobOutputModal jobId={selectedJobId} onClose={handleClose} />
      )}

      {vnc.modalOpen && (
        <VncLoginModal open={vnc.modalOpen} token={vnc.token} onClose={vnc.close} />
      )}
    </div>
  );
}

function JobActionMenu({
  job,
  onRepeat,
  onCancel,
  showOpenChrome,
  onOpenChrome,
}: {
  job: Job;
  onRepeat: (jobId: string, command: string) => void;
  onCancel: (jobId: string, command: string) => void;
  showOpenChrome: boolean;
  onOpenChrome: () => void;
}) {
  const [menuPos, setMenuPos] = useState<{ top: number; right: number } | null>(null);

  const items: DropdownMenuItem[] = [
    ...(job.status !== 'running' && job.status !== 'queued' ? [{
      label: 'Wiederholen',
      icon: (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="1 4 1 10 7 10" /><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
        </svg>
      ),
      onClick: () => onRepeat(job.job_id, job.command),
    }] : []),
    // Visible mode only: open the attached Chrome to watch the bot live.
    ...(showOpenChrome ? [{
      label: 'Chrome öffnen',
      icon: (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="2" y="3" width="20" height="14" rx="2" /><line x1="8" y1="21" x2="16" y2="21" /><line x1="12" y1="17" x2="12" y2="21" />
        </svg>
      ),
      onClick: () => onOpenChrome(),
    }] : []),
    ...(job.status === 'running' || job.status === 'queued' || job.status === 'waiting_for_user' ? [{
      label: 'Abbrechen',
      icon: (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" /><line x1="15" y1="9" x2="9" y2="15" /><line x1="9" y1="9" x2="15" y2="15" />
        </svg>
      ),
      onClick: () => onCancel(job.job_id, job.command),
      danger: true,
    }] : []),
  ];

  if (items.length === 0) return null;

  return (
    <div style={{ position: 'relative', display: 'inline-block' }}>
      <button
        className={styles.menuBtn}
        onClick={(e) => {
          e.stopPropagation();
          const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
          setMenuPos(menuPos ? null : { top: rect.bottom + 4, right: window.innerWidth - rect.right });
        }}
      >⋮</button>
      {menuPos && (
        <DropdownMenu items={items} pos={menuPos} onClose={() => setMenuPos(null)} />
      )}
    </div>
  );
}

interface AdminUserMessaging {
  id: string;
  display_name: string;
  email: string;
  messaging: { sessionStatus: string; mode: string; running: boolean; lastPoll: number; sentCount: number; oooSentCount: number; pendingCount: number };
  aiAdGen: { adGenerations: number; adImageAnalyses: number };
}

function KiMessagingTable() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const { data: responder } = useResponderStatus();
  const { data: session } = useMessagingStatus();
  const { data: adminData } = useQuery<{ users: AdminUserMessaging[] }>({
    queryKey: ['admin-messaging'],
    queryFn: () => api.get('/api/admin/messaging'),
    refetchInterval: 15000,
    enabled: isAdmin,
  });

  // Single-user fallback when not admin
  const users: AdminUserMessaging[] = isAdmin && adminData?.users
    ? adminData.users
    : [{
        id: user?.id ?? '',
        display_name: user?.display_name ?? user?.email ?? '',
        email: user?.email ?? '',
        messaging: {
          sessionStatus: session?.status ?? 'not_started',
          mode: responder?.mode ?? 'off',
          running: responder?.running ?? false,
          lastPoll: responder?.lastPoll ?? 0,
          sentCount: responder?.sentCount ?? 0,
          oooSentCount: responder?.oooSentCount ?? 0,
          pendingCount: responder?.pendingCount ?? 0,
        },
        aiAdGen: responder?.aiAdGen ?? { adGenerations: 0, adImageAnalyses: 0 },
      }];

  // Show loading while admin data is being fetched
  if (isAdmin && !adminData) {
    return <div style={{ padding: 'var(--space-4)', textAlign: 'center', color: 'var(--text-muted)' }}>Lade KI-Status...</div>;
  }

  if (users.every(u => u.messaging.mode === 'off')) {
    return (
      <div className={styles.empty}>
        <div className={styles.emptyIcon}>
          <svg viewBox="0 0 24 24" width="40" height="40" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
          </svg>
        </div>
        <div className={styles.emptyTitle}>KI-Nutzung ist deaktiviert</div>
        <div className={styles.emptyDesc}>Aktiviere den KI-Modus unter Einstellungen → KI-Nachrichten.</div>
      </div>
    );
  }

  return (
    <div className={styles.tableWrapper}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th className={styles.th}>Benutzer</th>
            <th className={styles.th}>KI-Modus</th>
            <th className={styles.th}>Nachrichten</th>
            <th className={`${styles.th} ${styles.hideMobile}`}>Letzter Poll</th>
            <th className={styles.th}>Ausstehend</th>
            <th className={styles.th}>OOO-Antworten</th>
            <th className={styles.th}>KI-Antworten</th>
            <th className={styles.th}>KI-Anzeigen</th>
            <th className={styles.th}>KI-Bilder</th>
          </tr>
        </thead>
        <tbody>
          {users.map((u, i) => {
            const modeBadge = getResponderBadge(u.messaging.mode as ResponderMode, true, canLoadInbox(u.messaging.sessionStatus));
            return (
            <tr key={u.id} className={`${styles.row} animRow`} style={{ '--anim-delay': `${i * 30}ms` } as React.CSSProperties}>
              <td className={styles.tdMuted}>{u.email || u.id}</td>
              <td className={styles.td}>
                {modeBadge ? (
                  <Badge variant={modeBadge.variant}>{modeBadge.short}</Badge>
                ) : (
                  <Badge variant="muted">Aus</Badge>
                )}
              </td>
              <td className={styles.td}>
                <Badge variant={
                  u.messaging.sessionStatus === 'ready' ? 'success'
                  : u.messaging.sessionStatus === 'error' ? 'danger'
                  : u.messaging.sessionStatus === 'awaiting_mfa' ? 'warning'
                  : u.messaging.sessionStatus === 'browserless' ? 'info'
                  : (u.messaging.mode === 'off' || u.messaging.sessionStatus === 'not_started') ? 'muted'
                  : 'warning'
                }>
                  {u.messaging.sessionStatus === 'ready' ? (u.messaging.running ? 'Aktiv' : 'Bereit')
                  : u.messaging.sessionStatus === 'error' ? 'Fehler'
                  : u.messaging.sessionStatus === 'awaiting_mfa' ? 'MFA'
                  : u.messaging.sessionStatus === 'browserless' ? 'Bot läuft'
                  : u.messaging.sessionStatus === 'starting' || u.messaging.sessionStatus === 'logging_in' ? 'Startet'
                  : 'Aus'}
                </Badge>
              </td>
              <td className={`${styles.td} ${styles.hideMobile}`} style={{ whiteSpace: 'nowrap' }}>
                {u.messaging.lastPoll ? `vor ${Math.round((Date.now() - u.messaging.lastPoll) / 1000)}s` : '–'}
              </td>
              <td className={styles.td}>{u.messaging.mode === 'off' ? '–' : u.messaging.pendingCount > 0 ? (
                  <Badge variant="warning">{u.messaging.pendingCount}</Badge>
                ) : 0}
              </td>
              <td className={styles.td}>{u.messaging.oooSentCount}</td>
              <td className={styles.td}>{u.messaging.mode === 'off' ? '–' : u.messaging.sentCount}</td>
              <td className={styles.td}>{u.aiAdGen.adGenerations}</td>
              <td className={styles.td}>{u.aiAdGen.adImageAnalyses}</td>
            </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
