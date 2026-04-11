'use client';

import { useAuth } from '@/hooks/useAuth';
import { UserList } from '@/components/admin/UserList';
import { InviteManager } from '@/components/admin/InviteManager';
import { EmptyState } from '@/components/ui';
import styles from './page.module.scss';

export default function AdminPage() {
  const { user } = useAuth();

  if (user?.role !== 'admin') {
    return (
      <EmptyState
        title="Kein Zugriff"
        message="Diese Seite ist nur für Administratoren zugänglich."
      />
    );
  }

  return (
    <div className={styles.adminPage}>
      <InviteManager />
      <UserList />
    </div>
  );
}
