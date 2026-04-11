'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api/client';
import { useSort } from '@/hooks/useSort';
import { Button, DropdownMenu, useToast } from '@/components/ui';
import type { DropdownMenuItem } from '@/components/ui';
import type { Invite } from '@/types/auth';
import styles from './InviteManager.module.scss';

type InviteSortKey = 'created' | 'expires';

function compareInvites(a: Invite, b: Invite, key: InviteSortKey): number {
  if (key === 'created') return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
  return new Date(a.expires_at).getTime() - new Date(b.expires_at).getTime();
}

export function InviteManager() {
  const [invites, setInvites] = useState<Invite[]>([]);
  const [showInvites, setShowInvites] = useState(false);
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const { toast } = useToast();

  const loadInvites = useCallback(async () => {
    try {
      const data = await api.get<{ invites: Invite[] }>('/api/admin/invites');
      setInvites(data.invites ?? []);
    } catch {
      // Ignore
    }
  }, []);

  useEffect(() => {
    loadInvites();
  }, [loadInvites]);

  const handleCreate = useCallback(async () => {
    setCreating(true);
    try {
      const result = await api.post<{ token: string }>('/api/admin/invites');
      const url = `${window.location.origin}/register?token=${result.token}`;
      setInviteUrl(url);
      loadInvites();
    } catch {
      // Error handled by toast
    } finally {
      setCreating(false);
    }
  }, [loadInvites]);

  const handleCopy = useCallback(async () => {
    if (inviteUrl) {
      await navigator.clipboard.writeText(inviteUrl);
      toast('success', 'Link kopiert');
    }
  }, [inviteUrl, toast]);

  const handleRevoke = useCallback(
    async (tokenHash: string) => {
      try {
        await api.delete(`/api/admin/invites/${tokenHash}`);
        toast('success', 'Einladung widerrufen');
        loadInvites();
      } catch {
        // Error handled by toast
      }
    },
    [loadInvites, toast],
  );

  const { sorted: sortedInvites, handleSort, sortIcon } = useSort<Invite, InviteSortKey>(invites, 'expires', compareInvites);

  return (
    <div className={styles.wrapper}>
      {/* Header row */}
      <div className={styles.header}>
        <div>
          <h2 className={styles.title}>Benutzer</h2>
          <p className={styles.subtitle}>Verwalte die Benutzer deiner Organisation</p>
        </div>
        <div className={styles.headerActions}>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setShowInvites(!showInvites);
              if (!showInvites) loadInvites();
            }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="2" y="4" width="20" height="16" rx="2" />
              <path d="M22 7l-10 5L2 7" />
            </svg>
            {' '}Einladungen
          </Button>
          <Button variant="primary" size="sm" onClick={handleCreate} loading={creating}>
            + Benutzer einladen
          </Button>
        </div>
      </div>

      {/* Invite link result */}
      {inviteUrl && (
        <div className={styles.inviteResult}>
          <div className={styles.inviteLabel}>
            Einladungslink erstellt (gültig für 7 Tage) — dieser Link wird nur einmal angezeigt:
          </div>
          <div className={styles.inviteLinkRow}>
            <input
              type="text"
              className={styles.inviteLinkInput}
              value={inviteUrl}
              readOnly
              onClick={(e) => (e.target as HTMLInputElement).select()}
            />
            <Button variant="outline" size="sm" onClick={handleCopy}>
              Kopieren
            </Button>
          </div>
        </div>
      )}

      {/* Active invites list */}
      {showInvites && (
        <div className={styles.inviteArea}>
          {invites.length === 0 ? (
            <div className={styles.empty}>Keine aktiven Einladungen</div>
          ) : (
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
                    <th className={styles.th}>Erstellt von</th>
                    <th className={`${styles.th} thSortable`} onClick={() => handleSort('created')}>Erstellt am {sortIcon('created')}</th>
                    <th className={`${styles.th} thSortable`} onClick={() => handleSort('expires')}>Gültig bis {sortIcon('expires')}</th>
                    <th className={`${styles.th} ${styles.thActions}`} />
                  </tr>
                </thead>
                <tbody>
                  {sortedInvites.map((invite, i) => (
                    <tr key={invite.token_hash} className={`${styles.row} animRow`} style={{ '--anim-delay': `${i * 30}ms` } as React.CSSProperties}>
                      <td className={styles.td}>
                        {invite.created_by}
                      </td>
                      <td className={styles.td}>
                        {new Date(invite.created_at).toLocaleDateString('de-DE')}
                      </td>
                      <td className={styles.td}>
                        {new Date(invite.expires_at).toLocaleDateString('de-DE')}
                      </td>
                      <td className={`${styles.td} ${styles.tdActions}`}>
                        <InviteActionMenu onRevoke={() => handleRevoke(invite.token_hash)} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function InviteActionMenu({
  onRevoke,
}: {
  onRevoke: () => void;
}) {
  const [menuPos, setMenuPos] = useState<{ top: number; right: number } | null>(null);

  const items: DropdownMenuItem[] = [
    {
      label: 'Widerrufen',
      icon: (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" /><line x1="15" y1="9" x2="9" y2="15" /><line x1="9" y1="9" x2="15" y2="15" />
        </svg>
      ),
      onClick: onRevoke,
      danger: true,
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
