'use client';

import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { useJobs, useCancelJob } from '@/hooks/useJobs';
import { useAuth } from '@/hooks/useAuth';
import { JobOutputModal } from './JobOutputModal';
import { Badge, showConfirm, useToast } from '@/components/ui';
import Link from 'next/link';
import styles from './JobPill.module.scss';

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString('de-DE', {
    day: '2-digit', month: '2-digit',
    hour: '2-digit', minute: '2-digit',
  });
}

export function JobPill() {
  const { data } = useJobs();
  const { user } = useAuth();
  const [expanded, setExpanded] = useState(false);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [dismissedJobId, setDismissedJobId] = useState<string | null>(() => {
    if (typeof window !== 'undefined') return sessionStorage.getItem('job-pill-dismissed');
    return null;
  });
  const wrapperRef = useRef<HTMLDivElement>(null);
  const cancelJob = useCancelJob();
  const { toast } = useToast();

  const handleCancel = useCallback(async (jobId: string, command: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const confirmed = await showConfirm(
      'Job abbrechen',
      `Soll der Job \u201E${command}\u201C wirklich abgebrochen werden?`,
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

  // Close panel on outside click
  useEffect(() => {
    if (!expanded) return;
    const handleClick = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setExpanded(false);
      }
    };
    document.addEventListener('click', handleClick);
    return () => document.removeEventListener('click', handleClick);
  }, [expanded]);

  const recentJobs = useMemo(() => {
    if (!data?.jobs) return [];
    const now = Date.now();
    const thirtyMinAgo = now - 1800000;
    const mfaTimeout = now - 15 * 60 * 1000;
    return data.jobs
      .filter((j) => {
        if (j.status === 'running') return true;
        // MFA jobs: only show for 15 minutes after completion
        if (j.status === 'mfa_required') {
          const endTime = j.finished_at ? new Date(j.finished_at).getTime() : new Date(j.started_at).getTime();
          return endTime > mfaTimeout;
        }
        return new Date(j.started_at).getTime() > thirtyMinAgo;
      })
      .slice(0, 5);
  }, [data?.jobs]);

  const running = useMemo(() => recentJobs.filter((j) => j.status === 'running').length, [recentJobs]);
  const failed = useMemo(() => recentJobs.filter((j) => j.status === 'failed').length, [recentJobs]);
  const withErrors = useMemo(() => recentJobs.filter((j) => j.status === 'completed_with_errors').length, [recentJobs]);
  const mfaRequired = useMemo(() => recentJobs.filter((j) => j.status === 'mfa_required').length, [recentJobs]);
  const completed = useMemo(() => recentJobs.filter((j) => j.status === 'completed').length, [recentJobs]);

  // Check if pill should be hidden (all current jobs were dismissed)
  const newestJobId = recentJobs[0]?.job_id ?? null;
  const isDismissed = dismissedJobId !== null && newestJobId === dismissedJobId;

  if (recentJobs.length === 0 || isDismissed) return null;

  const isAdmin = user?.role === 'admin';

  // Dot class
  const dotClass = running > 0
    ? styles.dot
    : mfaRequired > 0
      ? `${styles.dot} ${styles.dotWarning}`
      : failed > 0
        ? `${styles.dot} ${styles.dotFailed}`
        : withErrors > 0
          ? `${styles.dot} ${styles.dotWarning}`
          : `${styles.dot} ${styles.dotDone}`;

  // Pill text
  const pillText = running > 0
    ? `${running} Job${running > 1 ? 's' : ''} laufen`
    : mfaRequired > 0
      ? 'mfa required'
      : failed > 0
        ? `${failed} fehlgeschlagen`
        : withErrors > 0
          ? `${withErrors} mit Fehlern`
          : `${completed} abgeschlossen`;

  return (
    <>
      <div className={styles.tracker} ref={wrapperRef}>
        {/* Panel */}
        {expanded && (
          <div className={styles.panel}>
            <div className={styles.panelHeader}>
              <span className={styles.panelTitle}>Jobs</span>
              <button
                className={styles.panelClose}
                onClick={(e) => {
                  e.stopPropagation();
                  setExpanded(false);
                  if (newestJobId) {
                    setDismissedJobId(newestJobId);
                    sessionStorage.setItem('job-pill-dismissed', newestJobId);
                  }
                }}
              >×</button>
            </div>
            <div className={styles.panelList}>
              {recentJobs.map((job) => (
                <div
                  key={job.job_id}
                  className={styles.item}
                  onClick={() => { setSelectedJobId(job.job_id); setExpanded(false); }}
                >
                  <div className={styles.itemBadge}>
                    <Badge
                      variant={
                        job.status === 'completed' ? 'success'
                        : job.status === 'completed_with_errors' ? 'warning'
                        : job.status === 'failed' ? 'danger'
                        : job.status === 'mfa_required' ? 'warning'
                        : job.status === 'running' ? 'running'
                        : 'warning'
                      }
                    >
                      {job.status === 'mfa_required' ? 'MFA' : job.status === 'completed_with_errors' ? 'with errors' : job.status}
                    </Badge>
                  </div>
                  <div className={styles.itemInfo}>
                    <div className={styles.itemCmd}>{job.command}</div>
                    <div className={styles.itemTime}>
                      {isAdmin && job.user_id ? `${job.user_id} · ` : ''}
                      {formatTime(job.started_at)}
                    </div>
                  </div>
                  {job.status === 'running' && (
                    <button
                      className={styles.cancelBtn}
                      onClick={(e) => handleCancel(job.job_id, job.command, e)}
                    >×</button>
                  )}
                </div>
              ))}
            </div>
            {isAdmin && (
              <div className={styles.panelFooter}>
                <Link href="/logs" className={styles.footerLink} onClick={() => setExpanded(false)}>
                  Alle anzeigen →
                </Link>
              </div>
            )}
          </div>
        )}

        {/* Pill */}
        <button className={`${styles.pill}${running > 0 ? ` ${styles.pillRunning}` : ''}`} onClick={() => setExpanded(!expanded)}>
          <span className={dotClass} />
          <span>{pillText}</span>
        </button>
      </div>

      {selectedJobId && (
        <JobOutputModal jobId={selectedJobId} onClose={() => setSelectedJobId(null)} />
      )}
    </>
  );
}
