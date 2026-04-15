'use client';

import { useMemo, useState, useEffect, useCallback, useSyncExternalStore } from 'react';
import { useJobs } from '@/hooks/useJobs';
import { useAuth } from '@/hooks/useAuth';
import { useMessagingStatus, useSubmitMessagingMfa, usePrepareMessagingMfa, useResponderStatus } from '@/hooks/useMessages';
import { Modal } from '@/components/ui';
import { MfaBanner } from './MfaBanner';
import { MfaCodeInput } from './MfaCodeInput';
import { jobModalState } from '@/lib/bot/job-modal-state';

/**
 * Global overlay that auto-appears when:
 * 1. A bot job requires MFA (existing behavior)
 * 2. Messaging session requires MFA while KI mode is active (auto/review)
 *
 * Mount once in AppShell — covers both MFA types from any page.
 */
const MFA_TIMEOUT_MS = 15 * 60 * 1000;

export function MfaOverlay() {
  const { data } = useJobs();
  const { user } = useAuth();
  const [dismissedJobId, setDismissedJobId] = useState<string | null>(null);

  // --- Bot MFA ---
  const mfaJob = useMemo(() => {
    const now = Date.now();
    return data?.jobs.find((j) => {
      if (!j.mfa_required || j.user_id !== user?.id) return false;
      if (j.status === 'running') return true;
      if (j.status !== 'mfa_required') return false;
      const endTime = j.finished_at ? new Date(j.finished_at).getTime() : new Date(j.started_at).getTime();
      return now - endTime < MFA_TIMEOUT_MS;
    });
  }, [data?.jobs, user?.id]);

  useEffect(() => {
    if (!mfaJob || mfaJob.job_id !== dismissedJobId) {
      setDismissedJobId(null);
    }
  }, [mfaJob, dismissedJobId]);

  const jobModalOpen = useSyncExternalStore(jobModalState.subscribe, jobModalState.getSnapshot, () => false);
  const showBotMfa = !!mfaJob && dismissedJobId !== mfaJob.job_id && !jobModalOpen;

  // --- Messaging MFA (only when KI mode is active) ---
  const { data: msgStatus } = useMessagingStatus();
  const { data: responder } = useResponderStatus();
  const [dismissedMsgMfa, setDismissedMsgMfa] = useState(false);

  const kiActive = responder?.mode === 'auto' || responder?.mode === 'review';
  const showMsgMfa = !showBotMfa && kiActive && msgStatus?.status === 'awaiting_mfa' && !dismissedMsgMfa;

  useEffect(() => {
    if (msgStatus?.status !== 'awaiting_mfa') {
      setDismissedMsgMfa(false);
    }
  }, [msgStatus?.status]);

  if (showBotMfa) {
    return (
      <Modal open onClose={() => setDismissedJobId(mfaJob.job_id)} title="Verifizierung erforderlich">
        <MfaBanner jobId={mfaJob.job_id} />
      </Modal>
    );
  }

  if (showMsgMfa) {
    return (
      <Modal open onClose={() => setDismissedMsgMfa(true)} title="Nachrichten-Verifizierung">
        <MessagingMfaContent />
      </Modal>
    );
  }

  return null;
}

function MessagingMfaContent() {
  const mfa = useSubmitMessagingMfa();
  const prepare = usePrepareMessagingMfa();

  const handleSubmit = useCallback(async (code: string) => {
    mfa.mutate(code);
  }, [mfa]);

  const handlePrepare = useCallback(async () => {
    prepare.mutate();
  }, [prepare]);

  return (
    <MfaCodeInput
      title="Nachrichten-Verifizierung"
      description="Kleinanzeigen verlangt einen Bestätigungscode. KI-Antworten sind pausiert."
      onSubmit={handleSubmit}
      onPrepare={handlePrepare}
      submitPending={mfa.isPending}
      preparePending={prepare.isPending}
    />
  );
}
