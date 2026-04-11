'use client';

import { Suspense, useCallback, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useAuth } from '@/hooks/useAuth';
import { api } from '@/lib/api/client';
import { registerSchema, type RegisterInput } from '@/validation/schemas';
import { Button, Input } from '@/components/ui';
import type { AuthResponse } from '@/types/auth';
import Link from 'next/link';
import styles from '../auth.module.scss';

export default function RegisterPage() {
  return (
    <Suspense>
      <RegisterForm />
    </Suspense>
  );
}

function RegisterForm() {
  const { login } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const inviteToken = searchParams.get('token') ?? '';
  const [error, setError] = useState<string | null>(null);

  const {
    register: registerField,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<RegisterInput>({
    resolver: zodResolver(registerSchema),
    defaultValues: {
      invite_token: inviteToken,
    },
  });

  const onSubmit = useCallback(
    async (data: RegisterInput) => {
      setError(null);
      try {
        const result = await api.post<AuthResponse>('/api/auth/register', data);
        login(result.token, result.user);
        localStorage.setItem('welcomeConfetti', '1');
        setTimeout(() => router.push('/ads'), 300);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Registrierung fehlgeschlagen');
      }
    },
    [login, router],
  );

  // No invite token: show message with link back to login
  if (!inviteToken) {
    return (
      <div className={styles.authPage}>
        <div className={styles.authCard}>
          <div className={styles.authLogo}>K</div>
          <h2 className={styles.authTitle}>Registrieren</h2>
          <p className={styles.authMessage}>
            Du benötigst einen Einladungslink, um ein Konto zu erstellen.
          </p>
          <Link href="/login" className={styles.authLink}>
            Zur Anmeldung
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.authPage}>
      <div className={styles.authCard}>
        <div className={styles.authLogo}>K</div>
        <h2 className={styles.authTitle}>Registrieren</h2>

        {error && <div className={styles.authError}>{error}</div>}

        <form onSubmit={handleSubmit(onSubmit)} className={styles.authForm}>
          <Input
            label="Kleinanzeigen E-Mail"
            type="email"
            placeholder="name@beispiel.de"
            autoComplete="email"
            error={errors.email?.message}
            {...registerField('email')}
          />

          <Input
            label="Kleinanzeigen Passwort"
            type="password"
            placeholder="Dein Kleinanzeigen-Passwort"
            autoComplete="new-password"
            error={errors.password?.message}
            {...registerField('password')}
          />

          <input type="hidden" {...registerField('invite_token')} />

          <Button
            type="submit"
            variant="primary"
            size="lg"
            loading={isSubmitting}
            disabled={isSubmitting}
            className={styles.authSubmitBtn}
          >
            {isSubmitting ? 'Wird erstellt\u2026' : 'Registrieren'}
          </Button>
        </form>
      </div>
    </div>
  );
}
