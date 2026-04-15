'use client';

import { useState, useCallback } from 'react';
import { useToast } from '@/components/ui';
import styles from './MfaBanner.module.scss';

interface MfaCodeInputProps {
  title: string;
  description: string;
  onSubmit: (code: string) => Promise<void>;
  onPrepare: () => Promise<void>;
  submitPending: boolean;
  preparePending: boolean;
}

/**
 * Shared MFA code input — same UI for bot MFA, messaging MFA modal, and /messages inline.
 * Shows: code input + submit button + "Neuen Code anfordern" link.
 */
export function MfaCodeInput({ title, description, onSubmit, onPrepare, submitPending, preparePending }: MfaCodeInputProps) {
  const [code, setCode] = useState('');
  const { toast } = useToast();

  const handleSubmit = useCallback(() => {
    if (!code.match(/^\d{4,8}$/)) {
      toast('error', 'Bitte gültigen Code eingeben (4–8 Ziffern)');
      return;
    }
    onSubmit(code.trim());
  }, [code, onSubmit, toast]);

  const handlePrepare = useCallback(() => {
    onPrepare();
  }, [onPrepare]);

  return (
    <div className={styles.banner}>
      <div className={styles.icon}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
          <path d="M7 11V7a5 5 0 0110 0v4" />
        </svg>
      </div>
      <div className={styles.content}>
        <div className={styles.title}>{title}</div>
        <div className={styles.desc}>{description}</div>
        <div className={styles.form}>
          <input
            className={styles.input}
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={8}
            placeholder="000000"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
            onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
            disabled={submitPending}
            autoFocus
          />
          <button
            className={styles.btn}
            onClick={handleSubmit}
            disabled={submitPending || code.length < 4}
          >
            {submitPending ? 'Wird geprüft…' : 'Code bestätigen'}
          </button>
        </div>
        <div className={styles.desc} style={{ marginTop: 'var(--space-2)' }}>
          Code abgelaufen?{' '}
          <button
            onClick={handlePrepare}
            disabled={preparePending}
            style={{ background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer', padding: 0, font: 'inherit', textDecoration: 'underline' }}
          >
            {preparePending ? 'Wird neu gestartet…' : 'Neuen Code anfordern'}
          </button>
        </div>
      </div>
    </div>
  );
}
