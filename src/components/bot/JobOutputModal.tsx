'use client';

import { useRef, useEffect, useCallback } from 'react';
import { useJob, useCancelJob, useRepeatJob, useResumeJob } from '@/hooks/useJobs';
import { useAuth } from '@/hooks/useAuth';
import { useVncLogin } from '@/hooks/useVncLogin';
import { Modal, Badge, Spinner, Button } from '@/components/ui';
import { BotBanner } from './BotBanner';
import { MfaBanner } from './MfaBanner';
import { VncLoginModal } from './VncLoginModal';
import { jobModalState } from '@/lib/bot/job-modal-state';
import { jobStatusLabel } from '@/lib/bot/job-status';
import { toLocalISO } from '@/lib/format-date';
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
  if (status === 'login_required') return 'warning';
  if (status === 'running') return 'running';
  return 'warning';
}

export function JobOutputModal({ jobId, onClose }: JobOutputModalProps) {
  const { data: job, isLoading } = useJob(jobId);
  const { user } = useAuth();
  const cancelJob = useCancelJob();
  const repeatJob = useRepeatJob();
  const resumeJob = useResumeJob();
  const preRef = useRef<HTMLPreElement>(null);
  const isAdmin = user?.role === 'admin';
  const isRunning = job?.status === 'running' || job?.status === 'queued' || job?.status === 'waiting_for_user';
  const isFinished = job?.status === 'completed' || job?.status === 'completed_with_errors' || job?.status === 'failed' || job?.status === 'login_required';

  // On detected login: a paused job (waiting_for_user) resumes in place (bot still running,
  // keep the modal open to watch it continue); a finished login_required job gets a fresh
  // retry (which runs visible and may pause again for confirmation).
  const handleVncSuccess = useCallback(() => {
    if (job?.status === 'waiting_for_user') {
      resumeJob.mutate(jobId);
      return;
    }
    repeatJob.mutate(jobId);
    onClose();
  }, [jobId, job?.status, onClose, repeatJob, resumeJob]);
  const vnc = useVncLogin(handleVncSuccess);

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
                {jobStatusLabel(job.status, job.queue_position, job.retry_at)}
              </Badge>
            </span>

            <span className={styles.metaLabel}>Gestartet</span>
            <span className={styles.metaValue}>{toLocalISO(job.started_at)}</span>

            {job.finished_at && (
              <>
                <span className={styles.metaLabel}>Beendet</span>
                <span className={styles.metaValue}>{toLocalISO(job.finished_at)}</span>
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
                <span className={styles.metaValue}>{job.user_label || job.user_id}</span>
              </>
            )}

            {job.exit_code != null && (
              <>
                <span className={styles.metaLabel}>Exit Code</span>
                <span className={styles.metaValue}>{job.exit_code}</span>
              </>
            )}

            {isRunning && (
              <>
                <span className={styles.metaLabel}>Aktion</span>
                <span className={styles.metaValue}>
                  <button
                    className={styles.metaLink}
                    disabled={cancelJob.isPending}
                    onClick={() => cancelJob.mutate(jobId)}
                  >
                    {cancelJob.isPending ? 'Wird abgebrochen…' : 'Abbrechen'}
                  </button>
                  {vnc.mode === 'visible' && job.status !== 'waiting_for_user' && (
                    <>
                      {' · '}
                      <button className={styles.metaLink} disabled={vnc.busy || vnc.modalOpen} onClick={vnc.openWindow}>
                        {vnc.busy ? 'Wird gestartet…' : 'Ansehen'}
                      </button>
                    </>
                  )}
                </span>
              </>
            )}
            {isFinished && (
              <>
                <span className={styles.metaLabel}>Aktion</span>
                <span className={styles.metaValue}>
                  <button
                    className={styles.metaLink}
                    disabled={repeatJob.isPending}
                    onClick={() => { repeatJob.mutate(jobId); onClose(); }}
                  >
                    {repeatJob.isPending ? 'Wird gestartet…' : 'Wiederholen'}
                  </button>
                </span>
              </>
            )}
          </div>

          {/* MFA Banner */}
          {job.mfa_required && (
            <MfaBanner jobId={job.job_id} />
          )}

          {/* Login-required banner — shown when login failed and a human must log in via VNC.
              Hidden in strict headless mode, which offers no VNC fallback. */}
          {job.status === 'login_required' && !job.mfa_required && vnc.mode !== 'headless' && (
            <BotBanner
              title="Login erforderlich"
              description="Bitte einmal manuell anmelden — danach kann der Bot diese Session verwenden."
            >
              <Button
                variant="primary"
                size="sm"
                disabled={vnc.busy || vnc.modalOpen}
                onClick={vnc.start}
              >
                {vnc.busy ? 'Wird gestartet…' : 'Chrome öffnen'}
              </Button>
            </BotBanner>
          )}

          {/* Waiting-for-user banner — the bot paused at a login/CAPTCHA wall and waits in the
              VNC browser. Open Chrome to sign in / solve it, then confirm to let the bot continue. */}
          {job.status === 'waiting_for_user' && (
            <BotBanner
              title="Anmeldung erforderlich"
              description="Der Bot wartet. Bitte im Chrome-Browser anmelden bzw. die Sicherheitsabfrage lösen, dann bestätigen."
            >
              <Button variant="secondary" size="sm" disabled={vnc.busy || vnc.modalOpen} onClick={vnc.openWindow}>
                Chrome öffnen
              </Button>
              <Button
                variant="primary"
                size="sm"
                disabled={resumeJob.isPending}
                onClick={() => resumeJob.mutate(jobId)}
              >
                {resumeJob.isPending ? 'Wird fortgesetzt…' : 'Login fertig — weiter'}
              </Button>
            </BotBanner>
          )}

          {/* VNC login modal — portal rendered while the window is open; shows a
              connecting state until the session token is available. */}
          {vnc.modalOpen && (
            <VncLoginModal open={vnc.modalOpen} token={vnc.token} onClose={vnc.close} />
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
