'use client';

import { useCallback } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { profileUpdateSchema } from '@/validation/schemas';
import { useAuth } from '@/hooks/useAuth';
import { api } from '@/lib/api/client';
import { Input, Button, useToast } from '@/components/ui';
import styles from './ProfileForm.module.scss';

interface ProfileFormValues {
  display_name?: string;
  password?: string;
}

export function ProfileForm() {
  const { user, updateUser } = useAuth();
  const { toast } = useToast();

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
    reset,
  } = useForm<ProfileFormValues>({
    resolver: zodResolver(profileUpdateSchema),
    defaultValues: {
      display_name: user?.display_name ?? '',
      password: '',
    },
  });

  const onSubmit = useCallback(
    async (data: ProfileFormValues) => {
      const payload: Record<string, string> = {};
      if (data.display_name) payload.display_name = data.display_name;
      if (data.password) payload.password = data.password;

      await api.put('/api/auth/profile', payload);
      if (data.display_name) {
        updateUser({ display_name: data.display_name });
      }
      reset({ display_name: data.display_name, password: '' });
      toast('success', 'Profil gespeichert');
    },
    [updateUser, reset, toast],
  );

  return (
    <div className={styles.wrapper}>
      <div className={styles.sectionHeader}>
        <div>
          <span>Profil</span>
          <div className={styles.sectionDesc}>
            Anzeigename und Passwort verwalten.
          </div>
        </div>
      </div>
      <form className={styles.form} onSubmit={handleSubmit(onSubmit)}>
        <div className={styles.row}>
          <Input
            label="Anzeigename"
            placeholder="Dein Name"
            error={errors.display_name?.message}
            {...register('display_name')}
          />
          <Input
            label="Neues Passwort"
            type="password"
            placeholder="Leer lassen um beizubehalten"
            error={errors.password?.message}
            {...register('password')}
          />
        </div>
        <div className={styles.footer}>
          <Button type="submit" variant="primary" size="lg" loading={isSubmitting}>
            Speichern
          </Button>
        </div>
      </form>
    </div>
  );
}
