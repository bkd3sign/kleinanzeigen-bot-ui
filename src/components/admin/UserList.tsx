'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api/client';
import { useAuth } from '@/hooks/useAuth';
import { useSort } from '@/hooks/useSort';
import { Badge, DropdownMenu, showConfirm, useToast } from '@/components/ui';
import type { DropdownMenuItem } from '@/components/ui';
import type { User } from '@/types/auth';
import styles from './UserList.module.scss';

type SortKey = 'name' | 'email' | 'role';

function compareUsers(a: User, b: User, key: SortKey): number {
  if (key === 'name') return (a.display_name || a.email).localeCompare(b.display_name || b.email, 'de');
  if (key === 'email') return a.email.localeCompare(b.email, 'de');
  if (key === 'role') return (a.role === 'admin' ? 1 : 0) - (b.role === 'admin' ? 1 : 0);
  return 0;
}

export function UserList() {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();
  const { user: currentUser } = useAuth();

  const loadUsers = useCallback(async () => {
    try {
      const data = await api.get<{ users: User[] }>('/api/admin/users');
      setUsers(data.users ?? []);
    } catch {
      // Error handled by toast
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadUsers();
  }, [loadUsers]);

  const handleRoleChange = useCallback(
    async (userId: string, newRole: 'admin' | 'user') => {
      try {
        await api.put(`/api/admin/users/${userId}`, { role: newRole });
        toast('success', 'Rolle geändert');
        loadUsers();
      } catch {
        // Error handled by toast
      }
    },
    [loadUsers, toast],
  );

  const handleDelete = useCallback(
    async (user: User) => {
      const confirmed = await showConfirm(
        'Benutzer löschen',
        `Soll "${user.display_name || user.email}" wirklich gelöscht werden? Alle Anzeigen und Daten werden entfernt.`,
        'Löschen',
      );
      if (confirmed) {
        try {
          await api.delete(`/api/admin/users/${user.id}`);
          toast('success', 'Benutzer gelöscht');
          loadUsers();
        } catch {
          // Error handled by toast
        }
      }
    },
    [loadUsers, toast],
  );

  const handleReset = useCallback(
    async (target: User) => {
      try {
        const result = await api.post<{ token: string }>(`/api/admin/users/${target.id}/reset`);
        const url = `${window.location.origin}/reset-password?token=${result.token}`;
        await navigator.clipboard.writeText(url);
        toast('success', 'Reset-Link kopiert');
      } catch (err) {
        toast('error', (err as Error).message);
      }
    },
    [toast],
  );

  const ownerId = users[0]?.id;
  const { sorted: sortedUsers, handleSort, sortIcon } = useSort<User, SortKey>(users, 'name', compareUsers);

  if (loading) {
    return (
      <div className={styles.loading}>Lade Benutzer...</div>
    );
  }

  if (users.length === 0) {
    return <div className={styles.empty}>Keine Benutzer</div>;
  }

  return (
    <div className={styles.tableWrapper}>
      <table className={styles.table}>
        <colgroup>
          <col style={{ width: '32%' }} />
          <col style={{ width: '38%' }} />
          <col style={{ width: '25%' }} />
          <col style={{ width: '5%' }} />
        </colgroup>
        <thead>
          <tr>
            <th className={`${styles.th} thSortable`} onClick={() => handleSort('name')}>Name {sortIcon('name')}</th>
            <th className={`${styles.th} thSortable`} onClick={() => handleSort('email')}>E-Mail {sortIcon('email')}</th>
            <th className={`${styles.th} thSortable`} onClick={() => handleSort('role')}>Rolle {sortIcon('role')}</th>
            <th className={styles.thActions}>Aktion</th>
          </tr>
        </thead>
        <tbody>
          {sortedUsers.map((user, i) => {
            const isOwner = user.id === ownerId;
            const isSelf = user.id === currentUser?.id;
            return (
              <tr key={user.id} className={`${styles.row} animRow`} style={{ '--anim-delay': `${i * 30}ms` } as React.CSSProperties}>
                <td className={styles.tdName}>
                  {user.display_name || user.email.split('@')[0]}
                </td>
                <td className={styles.td}>{user.email}</td>
                <td className={styles.td}>
                  <Badge variant={user.role === 'admin' ? 'success' : 'muted'}>
                    {isOwner ? 'Owner' : user.role === 'admin' ? 'Admin' : 'Benutzer'}
                  </Badge>
                </td>
                <td className={styles.tdActions}>
                  {!isOwner && !isSelf && (
                    <ActionMenu
                      user={user}
                      onRoleChange={handleRoleChange}
                      onDelete={handleDelete}
                      onReset={handleReset}
                    />
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

    </div>
  );
}

// Context menu for user actions
function ActionMenu({
  user,
  onRoleChange,
  onDelete,
  onReset,
}: {
  user: User;
  onRoleChange: (userId: string, role: 'admin' | 'user') => void;
  onDelete: (user: User) => void;
  onReset: (user: User) => void;
}) {
  const [menuPos, setMenuPos] = useState<{ top: number; right: number } | null>(null);

  const items: DropdownMenuItem[] = [
    {
      label: user.role === 'admin' ? 'Zum Benutzer machen' : 'Zum Admin machen',
      icon: (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" />
          <path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" />
        </svg>
      ),
      onClick: () => onRoleChange(user.id, user.role === 'admin' ? 'user' : 'admin'),
    },
    {
      label: 'Passwort zurücksetzen',
      icon: (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="11" width="18" height="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" />
        </svg>
      ),
      onClick: () => onReset(user),
    },
    {
      label: 'Benutzer entfernen',
      icon: (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 6h18" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
        </svg>
      ),
      onClick: () => onDelete(user),
      danger: true,
      separator: true,
    },
  ];

  return (
    <div className={styles.actionWrapper}>
      <button
        type="button"
        className={styles.actionBtn}
        onClick={(e) => {
          e.stopPropagation();
          const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
          setMenuPos(menuPos ? null : { top: rect.bottom + 4, right: window.innerWidth - rect.right });
        }}
        title="Aktionen"
      >
        ⋮
      </button>
      {menuPos && (
        <DropdownMenu items={items} pos={menuPos} onClose={() => setMenuPos(null)} />
      )}
    </div>
  );
}
