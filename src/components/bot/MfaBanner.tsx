'use client';

import { useState, useCallback } from 'react';
import { api } from '@/lib/api/client';
import { useToast } from '@/components/ui';
import { useQueryClient } from '@tanstack/react-query';
import styles from './MfaBanner.module.scss';

interface MfaBannerProps {
  jobId: string;
}

type MfaStep = 'idle' | 'preparing' | 'waiting_code' | 'submitting';

export function MfaBanner({ jobId }: MfaBannerProps) {
  const [code, setCode] = useState('');
  const [step, setStep] = useState<MfaStep>('idle');
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Step 1: Start login flow → triggers new SMS
  const handlePrepare = useCallback(async () => {
    setStep('preparing');
    try {
      await api.post('/api/bot/mfa/prepare', { job_id: jobId });
      setStep('waiting_code');
      toast('success', 'Login gestartet — neue SMS wird verschickt');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Login-Vorbereitung fehlgeschlagen';
      toast('error', msg);
      setStep('idle');
    }
  }, [jobId, toast]);

  // Step 2: Submit the new SMS code
  const handleSubmitCode = useCallback(async () => {
    if (!code.match(/^\d{4,8}$/)) {
      toast('error', 'Bitte gültigen Code eingeben (4–8 Ziffern)');
      return;
    }

    setStep('submitting');
    try {
      await api.post('/api/bot/mfa/submit', { job_id: jobId, code });
      toast('success', 'MFA erfolgreich — Befehl wird wiederholt');
      queryClient.invalidateQueries({ queryKey: ['jobs'] });
      queryClient.invalidateQueries({ queryKey: ['job', jobId] });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'MFA fehlgeschlagen';
      toast('error', msg);
      setStep('waiting_code');
    }
  }, [code, jobId, toast, queryClient]);

  return (
    <div className={styles.banner}>
      <div className={styles.icon}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z" />
        </svg>
      </div>
      <div className={styles.content}>
        <div className={styles.title}>SMS-Verifizierung erforderlich</div>

        {step === 'idle' && (
          <>
            <div className={styles.desc}>
              Kleinanzeigen verlangt eine SMS-Bestätigung. Klicke den Button um einen neuen Login zu starten — du erhältst dann eine neue SMS.
            </div>
            <div className={styles.form}>
              <button className={styles.btn} onClick={handlePrepare}>
                Login starten
              </button>
            </div>
          </>
        )}

        {step === 'preparing' && (
          <div className={styles.desc}>
            Login wird gestartet… Warte auf MFA-Seite…
          </div>
        )}

        {(step === 'waiting_code' || step === 'submitting') && (
          <>
            <div className={styles.desc}>
              Eine <strong>neue SMS</strong> wurde ausgelöst. Gib den Code ein:
            </div>
            <div className={styles.form}>
              <input
                className={styles.input}
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={8}
                placeholder="123456"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                onKeyDown={(e) => e.key === 'Enter' && handleSubmitCode()}
                disabled={step === 'submitting'}
                autoFocus
              />
              <button
                className={styles.btn}
                onClick={handleSubmitCode}
                disabled={step === 'submitting' || code.length < 4}
              >
                {step === 'submitting' ? 'Wird geprüft…' : 'Code bestätigen'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
