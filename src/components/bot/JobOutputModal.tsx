'use client';

import { useRef, useEffect } from 'react';
import { useJob } from '@/hooks/useJobs';
import { useAuth } from '@/hooks/useAuth';
import { Modal, Badge, Spinner } from '@/components/ui';
import { MfaBanner } from './MfaBanner';
import { jobModalState } from '@/lib/bot/job-modal-state';
import styles from './JobOutputModal.module.scss';

interface JobOutputModalProps {
  jobId: string;
  onClose: () => void;
}

function statusVariant(status: string): 'success' | 'danger' | 'running' | 'warning' {
  if (status === 'completed') return 'success';
  if (status === 'completed_with_errors') return 'warning';
  if (status === 'failed') return 'danger';
  if (status === 'mfa_required') return 'warning';
  if (status === 'running') return 'running';
  return 'warning';
}

export function JobOutputModal({ jobId, onClose }: JobOutputModalProps) {
  const { data: job, isLoading } = useJob(jobId);
  const { user } = useAuth();
  const preRef = useRef<HTMLPreElement>(null);
  const isAdmin = user?.role === 'admin';

  // Signal to MfaOverlay that a job modal is open
  useEffect(() => {
    jobModalState.setOpen(true);
    return () => { jobModalState.setOpen(false); };
  }, []);

  // Auto-scroll output to bottom while running
  useEffect(() => {
    if (!preRef.current || !job) return;
    const el = preRef.current;
    const wasAtBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 30;
    if (wasAtBottom) {
      el.scrollTop = el.scrollHeight;
    }
  }, [job?.output, job]);

  return (
    <Modal open onClose={onClose} title={`Job ${jobId}`} wide>
      {isLoading || !job ? (
        <div className={styles.loading}>
          <Spinner size="md" />
        </div>
      ) : (
        <div className={styles.content}>
          {/* Metadata grid */}
          <div className={styles.meta}>
            <span className={styles.metaLabel}>Befehl</span>
            <span className={styles.metaValue}>{job.command}</span>

            <span className={styles.metaLabel}>Status</span>
            <span className={styles.metaValue}>
              <Badge variant={statusVariant(job.status)}>
                {job.status === 'mfa_required' ? 'MFA erforderlich' : job.status === 'completed_with_errors' ? 'Mit Fehlern' : job.status}
              </Badge>
            </span>

            <span className={styles.metaLabel}>Gestartet</span>
            <span className={styles.metaValue}>{job.started_at}</span>

            {job.finished_at && (
              <>
                <span className={styles.metaLabel}>Beendet</span>
                <span className={styles.metaValue}>{job.finished_at}</span>
              </>
            )}

            {job.started_at && job.finished_at && (
              <>
                <span className={styles.metaLabel}>Dauer</span>
                <span className={styles.metaValue}>
                  {(() => {
                    const ms = new Date(job.finished_at).getTime() - new Date(job.started_at).getTime();
                    if (ms < 1000) return `${ms}ms`;
                    const s = Math.round(ms / 1000);
                    if (s < 60) return `${s}s`;
                    const m = Math.floor(s / 60);
                    return `${m}m ${s % 60}s`;
                  })()}
                </span>
              </>
            )}

            {isAdmin && job.user_id && (
              <>
                <span className={styles.metaLabel}>Benutzer</span>
                <span className={styles.metaValue}>{job.user_id}</span>
              </>
            )}

            {job.exit_code != null && (
              <>
                <span className={styles.metaLabel}>Exit Code</span>
                <span className={styles.metaValue}>{job.exit_code}</span>
              </>
            )}
          </div>

          {/* MFA Banner */}
          {job.mfa_required && (
            <MfaBanner jobId={job.job_id} />
          )}

          {/* Output */}
          <pre ref={preRef} className={styles.output}>
            {job.output || '(Keine Ausgabe)'}
          </pre>
        </div>
      )}
    </Modal>
  );
}
