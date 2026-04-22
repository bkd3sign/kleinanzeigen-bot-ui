'use client';

import { useState, useCallback } from 'react';
import { api } from '@/lib/api/client';
import { useToast } from '@/components/ui';
import { useQueryClient } from '@tanstack/react-query';
import { MfaCodeInput } from './MfaCodeInput';

interface MfaBannerProps {
  jobId: string;
}

export function MfaBanner({ jobId }: MfaBannerProps) {
  const [preparePending, setPreparePending] = useState(false);
  const [submitPending, setSubmitPending] = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const handlePrepare = useCallback(async () => {
    setPreparePending(true);
    try {
      await api.post('/api/bot/mfa/prepare', { job_id: jobId });
      toast('success', 'Login gestartet — neuer Code wird gesendet.');
    } catch (err) {
      toast('error', err instanceof Error ? err.message : 'Login fehlgeschlagen');
    } finally {
      setPreparePending(false);
    }
  }, [jobId, toast]);

  const handleSubmit = useCallback(async (code: string) => {
    setSubmitPending(true);
    try {
      await api.post('/api/bot/mfa/submit', { job_id: jobId, code });
      toast('success', 'MFA erfolgreich');
      queryClient.invalidateQueries({ queryKey: ['jobs'] });
      queryClient.invalidateQueries({ queryKey: ['job', jobId] });
    } catch (err) {
      toast('error', err instanceof Error ? err.message : 'MFA fehlgeschlagen — versuche „Neuen Code anfordern"');
      setSubmitPending(false);
    }
  }, [jobId, toast, queryClient]);

  return (
    <MfaCodeInput
      title="Verifizierung erforderlich"
      description="Gib den Code aus der SMS/E-Mail ein."
      onSubmit={handleSubmit}
      onPrepare={handlePrepare}
      submitPending={submitPending}
      preparePending={preparePending}
    />
  );
}
