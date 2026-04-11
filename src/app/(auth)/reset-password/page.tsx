'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { api } from '@/lib/api/client';
import { Button, Input, Spinner } from '@/components/ui';
import styles from '../auth.module.scss';

export default function ResetPasswordPage() {
  return (
    <Suspense>
      <ResetPasswordForm />
    </Suspense>
  );
}

function ResetPasswordForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get('token');

  const [validating, setValidating] = useState(true);
  const [valid, setValid] = useState(false);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Validate token on mount
  useEffect(() => {
    if (!token) {
      router.replace('/');
      return;
    }
    api.post<{ valid: boolean }>('/api/auth/validate-reset', { token })
      .then((res) => {
        if (!res.valid) router.replace('/');
        else setValid(true);
      })
      .catch(() => router.replace('/'))
      .finally(() => setValidating(false));
  }, [token, router]);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setError('');

      if (password.length < 6) {
        setError('Passwort muss mindestens 6 Zeichen lang sein');
        return;
      }

      if (password !== confirmPassword) {
        setError('Passwörter stimmen nicht überein');
        return;
      }

      setSubmitting(true);
      try {
        await api.post('/api/auth/reset-password', { token, password });
        setSuccess(true);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Passwort konnte nicht zurückgesetzt werden');
      } finally {
        setSubmitting(false);
      }
    },
    [token, password, confirmPassword],
  );

  if (!token || validating || !valid) {
    return (
      <div className={styles.authPage}>
        <Spinner size="lg" />
      </div>
    );
  }

  if (success) {
    return (
      <div className={styles.authPage}>
        <div className={styles.authCard}>
          <div className={styles.authLogo}>K</div>
          <h2 className={styles.authTitle}>Passwort geändert</h2>
          <p className={styles.authMessage}>
            Dein Passwort wurde erfolgreich zurückgesetzt.
          </p>
          <Button
            variant="primary"
            size="lg"
            className={styles.authSubmitBtn}
            onClick={() => router.push('/login')}
          >
            Zur Anmeldung
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.authPage}>
      <div className={styles.authCard}>
        <div className={styles.authLogo}>K</div>
        <h2 className={styles.authTitle}>Neues Passwort</h2>

        {error && <div className={styles.authError}>{error}</div>}

        <form className={styles.authForm} onSubmit={handleSubmit}>
          <Input
            label="Neues Passwort"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Mindestens 6 Zeichen"
            autoComplete="new-password"
            required
            autoFocus
          />

          <Input
            label="Passwort bestätigen"
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            placeholder="Passwort wiederholen"
            autoComplete="new-password"
            required
          />

          <Button
            type="submit"
            variant="primary"
            size="lg"
            loading={submitting}
            disabled={submitting}
            className={styles.authSubmitBtn}
          >
            {submitting ? 'Wird gespeichert…' : 'Passwort speichern'}
          </Button>
        </form>
      </div>
    </div>
  );
}
