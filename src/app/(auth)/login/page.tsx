'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useAuth } from '@/hooks/useAuth';
import { api } from '@/lib/api/client';
import { loginSchema, type LoginInput } from '@/validation/schemas';
import { Button, Input } from '@/components/ui';
import type { AuthResponse } from '@/types/auth';
import styles from '../auth.module.scss';

export default function LoginPage() {
  const { login } = useAuth();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  // Redirect to /setup if no users exist yet
  useEffect(() => {
    fetch('/api/system/health')
      .then((r) => r.json())
      .then((data) => { if (data.setup_required) router.replace('/setup'); })
      .catch(() => {});
  }, [router]);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginInput>({
    resolver: zodResolver(loginSchema),
  });

  const onSubmit = useCallback(
    async (data: LoginInput) => {
      setError(null);
      try {
        const result = await api.post<AuthResponse>('/api/auth/login', data);
        login(result.token, result.user);
        router.push('/ads');
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Anmeldung fehlgeschlagen');
      }
    },
    [login, router],
  );

  return (
    <div className={styles.authPage}>
      <div className={styles.authCard}>
        <div className={styles.authLogo}>K</div>
        <h2 className={styles.authTitle}>Anmelden</h2>

        {error && <div className={styles.authError}>{error}</div>}

        <form onSubmit={handleSubmit(onSubmit)} className={styles.authForm}>
          <Input
            label="E-Mail"
            type="email"
            placeholder="name@beispiel.de"
            autoComplete="email"
            error={errors.email?.message}
            {...register('email')}
          />

          <Input
            label="Passwort"
            type="password"
            placeholder="Passwort"
            autoComplete="current-password"
            error={errors.password?.message}
            {...register('password')}
          />

          <Button
            type="submit"
            variant="primary"
            size="lg"
            loading={isSubmitting}
            disabled={isSubmitting}
            className={styles.authSubmitBtn}
          >
            {isSubmitting ? 'Wird angemeldet\u2026' : 'Anmelden'}
          </Button>
        </form>
      </div>
    </div>
  );
}
