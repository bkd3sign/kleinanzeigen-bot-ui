'use client';

import { useMemo, useState, useEffect, useSyncExternalStore } from 'react';
import { useJobs } from '@/hooks/useJobs';
import { useAuth } from '@/hooks/useAuth';
import { Modal } from '@/components/ui';
import { MfaBanner } from './MfaBanner';
import { jobModalState } from '@/lib/bot/job-modal-state';

/**
 * Global overlay that auto-appears when a job owned by the current user requires MFA.
 * Mount once in AppShell — polls jobs and shows a modal on top of everything.
 */
const MFA_TIMEOUT_MS = 15 * 60 * 1000;

export function MfaOverlay() {
  const { data } = useJobs();
  const { user } = useAuth();
  const [dismissedJobId, setDismissedJobId] = useState<string | null>(null);

  const mfaJob = useMemo(() => {
    const now = Date.now();
    return data?.jobs.find((j) => {
      if (!j.mfa_required || j.user_id !== user?.id) return false;
      if (j.status === 'running') return true;
      if (j.status !== 'mfa_required') return false;
      // Auto-dismiss after 15 minutes
      const endTime = j.finished_at ? new Date(j.finished_at).getTime() : new Date(j.started_at).getTime();
      return now - endTime < MFA_TIMEOUT_MS;
    });
  }, [data?.jobs, user?.id]);

  // Reset dismissed state when MFA job changes or is resolved
  useEffect(() => {
    if (!mfaJob || mfaJob.job_id !== dismissedJobId) {
      setDismissedJobId(null);
    }
  }, [mfaJob, dismissedJobId]);

  // Suppress when a JobOutputModal is already open (it has its own MfaBanner)
  const jobModalOpen = useSyncExternalStore(jobModalState.subscribe, jobModalState.getSnapshot, () => false);

  if (!mfaJob || dismissedJobId === mfaJob.job_id || jobModalOpen) return null;

  return (
    <Modal
      open
      onClose={() => setDismissedJobId(mfaJob.job_id)}
      title="Verifizierung erforderlich"
    >
      <MfaBanner jobId={mfaJob.job_id} />
    </Modal>
  );
}
