'use client';

import { useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { Badge, DropdownMenu, useToast, showConfirm } from '@/components/ui';
import { useAds } from '@/hooks/useAds';
import type { DropdownMenuItem } from '@/components/ui';
import { api } from '@/lib/api/client';
import { useCategoryName } from '@/hooks/useCategories';
import { useSort } from '@/hooks/useSort';
import type { SortDir } from '@/hooks/useSort';
import type { AdListItem } from '@/types/ad';
import type { Job } from '@/types/bot';
import { isExpired, isExpiringSoon } from '@/lib/ads/status';
import { getCurrentPrice } from '@/lib/ads/pricing';
import { useState } from 'react';
import { SaveAsTemplateModal } from './SaveAsTemplateModal';
import styles from './AdTable.module.scss';

export type AdSortKey = 'title' | 'price' | 'apr' | 'category' | 'created_on' | 'updated_on' | 'status';

interface AdTableProps {
  ads: AdListItem[];
  selectedFiles: Set<string>;
  onSelect: (file: string) => void;
  selectMode?: boolean;
  sortKey?: AdSortKey;
  sortDir?: SortDir;
  onSortChange?: (key: AdSortKey, dir: SortDir) => void;
}

function formatPrice(ad: AdListItem): React.ReactNode {
  if (ad.price_type === 'GIVE_AWAY') return 'Zu verschenken';
  if (ad.price == null) return '–';

  const suffix = ad.price_type === 'NEGOTIABLE' ? ' VB' : '';
  const reduced = getCurrentPrice(ad);

  if (reduced != null && reduced < ad.price) {
    return (
      <span className={styles.priceReduced}>
        <span>{reduced} €{suffix}</span>
        <span className={styles.priceOriginal}>{ad.price} €{suffix}</span>
      </span>
    );
  }

  return `${ad.price} €${suffix}`;
}

// SVG icon helper for action menu items
function Icon({ paths }: { paths: string[] }) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      {paths.map((d, i) => <path key={i} d={d} />)}
    </svg>
  );
}

const ICONS: Record<string, string[]> = {
  Bearbeiten: ['M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7', 'M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z'],
  Veröffentlichen: ['M22 2L11 13', 'M22 2l-7 20-4-9-9-4 20-7z'],
  Aktualisieren: ['M23 4v6h-6', 'M1 20v-6h6', 'M3.51 9a9 9 0 0 1 14.85-3.36L23 10', 'M20.49 15a9 9 0 0 1-14.85 3.36L1 14'],
  Verlängern: ['M12 2v10l4.5 4.5', 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z'],
  Duplizieren: ['M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2', 'M9 2h6v4H9z'],
  Vorlage: ['M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z', 'M17 21v-8H7v8', 'M7 3v5h8'],
  Löschen: ['M3 6h18', 'M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2'],
};

function getStatusRank(ad: AdListItem): number {
  if (!ad.id) return 0;                    // Draft
  if (ad.active === false) return 1;       // Inactive
  if (isExpired(ad)) return 2;             // Expired
  if (isExpiringSoon(ad)) return 3;        // Expiring soon
  if (ad.is_orphaned) return 4;            // Orphaned
  if (ad.is_changed) return 5;             // Changed
  return 6;                                // Active
}

function getAprRank(ad: AdListItem): number {
  if (!ad.auto_price_reduction?.enabled) return 0;
  return ad.auto_price_reduction.min_price ?? 0;
}

export function compareAds(a: AdListItem, b: AdListItem, key: AdSortKey): number {
  if (key === 'title') return (a.title ?? '').localeCompare(b.title ?? '', 'de');
  if (key === 'category') return (a.category ?? '').localeCompare(b.category ?? '', 'de');
  if (key === 'price') return (getCurrentPrice(a) ?? a.price ?? -1) - (getCurrentPrice(b) ?? b.price ?? -1);
  if (key === 'apr') return getAprRank(a) - getAprRank(b);
  if (key === 'created_on') return new Date(a.created_on ?? 0).getTime() - new Date(b.created_on ?? 0).getTime();
  if (key === 'updated_on') return new Date(a.updated_on ?? 0).getTime() - new Date(b.updated_on ?? 0).getTime();
  if (key === 'status') return getStatusRank(a) - getStatusRank(b);
  return 0;
}

export function AdTable({ ads, selectedFiles, onSelect, selectMode = false, sortKey: controlledKey, sortDir: controlledDir, onSortChange }: AdTableProps) {
  const router = useRouter();
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [menuPos, setMenuPos] = useState<{ top: number; right: number } | null>(null);
  const [templateAd, setTemplateAd] = useState<{ file: string; title: string } | null>(null);
  const catName = useCategoryName();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const refreshAds = useCallback(() => { queryClient.invalidateQueries({ queryKey: ['ads'] }); }, [queryClient]);

  // Internal sort state — used only when no controlled sort props are passed
  const { data: allAdsData } = useAds();

  const { sorted: sortedInternal, sortKey: internalKey, sortDir: internalDir, handleSort: handleSortInternal, sortIcon } =
    useSort<AdListItem, AdSortKey>(ads, 'title', compareAds);

  // If controlled from parent (for view-switch persistence), use parent state
  const isControlled = controlledKey !== undefined && controlledDir !== undefined && onSortChange !== undefined;

  const sortedAds = useMemo(() => {
    if (!isControlled) return sortedInternal;
    const copy = [...ads];
    copy.sort((a, b) => {
      const cmp = compareAds(a, b, controlledKey!);
      return controlledDir === 'asc' ? cmp : -cmp;
    });
    return copy;
  }, [ads, isControlled, controlledKey, controlledDir, sortedInternal]);

  const handleSort = useCallback((key: AdSortKey) => {
    if (isControlled) {
      const newDir: SortDir = controlledKey === key && controlledDir === 'asc' ? 'desc' : 'asc';
      onSortChange!(key, newDir);
    } else {
      handleSortInternal(key);
    }
  }, [isControlled, controlledKey, controlledDir, onSortChange, handleSortInternal]);

  const activeSortKey = isControlled ? controlledKey! : internalKey;
  const activeSortDir = isControlled ? controlledDir! : internalDir;

  const activeSortIcon = useCallback((col: AdSortKey) => {
    if (activeSortKey !== col) return <span className="sortIcon">↕</span>;
    return <span className="sortIconActive">{activeSortDir === 'asc' ? '↑' : '↓'}</span>;
  }, [activeSortKey, activeSortDir]);

  const handleRowClick = useCallback(
    (ad: AdListItem, e: React.MouseEvent) => {
      if ((e.target as HTMLElement).closest(`.${styles.menuBtn}`)) return;
      if (selectMode) {
        onSelect(ad.file);
      } else {
        router.push(`/ads/edit?file=${encodeURIComponent(ad.file)}`);
      }
    },
    [router, selectMode, onSelect],
  );

  function buildMenuItems(ad: AdListItem): DropdownMenuItem[] {
    const encFile = ad.file.split('/').map(encodeURIComponent).join('/');
    const items: DropdownMenuItem[] = [
      { label: 'Bearbeiten', icon: <Icon paths={ICONS.Bearbeiten} />, onClick: () => router.push(`/ads/edit?file=${encodeURIComponent(ad.file)}`) },
      { label: ad.id ? 'Erneut veröffentlichen' : 'Veröffentlichen', icon: <Icon paths={ICONS.Veröffentlichen} />, onClick: async () => {
        if (!ad.id) {
          const allDrafts = (allAdsData?.ads ?? []).filter(a => !a.id);
          const ok = await showConfirm(
            'Alle neuen Anzeigen veröffentlichen',
            'Wichtig: Da „' + (ad.title || 'diese Anzeige') + '" noch keine Kleinanzeigen-ID hat, werden alle neuen Anzeigen in deinem Workspace veröffentlicht – nicht nur diese eine.',
            'Alle neuen veröffentlichen',
            'Abbrechen',
            allDrafts.length > 1 ? allDrafts.map(a => a.title || '(Ohne Titel)') : undefined,
          );
          if (!ok) return;
        }
        api.post<Job>('/api/bot/publish', { ads: ad.id ? String(ad.id) : 'new' }).then(refreshAds)
          .catch((err) => toast('error', err instanceof Error ? err.message : 'Fehler beim Veröffentlichen'));
      }},
    ];
    if (ad.id) {
      items.push({ label: 'Aktualisieren', icon: <Icon paths={ICONS.Aktualisieren} />, onClick: () => {
        api.post<Job>('/api/bot/update', { ads: String(ad.id) }).then(refreshAds)
          .catch((err) => toast('error', err instanceof Error ? err.message : 'Fehler beim Aktualisieren'));
      }});
      if (isExpiringSoon(ad) || isExpired(ad)) {
        items.push({ label: 'Verlängern', icon: <Icon paths={ICONS.Verlängern} />, onClick: () => {
          api.post<Job>('/api/bot/extend', { ads: String(ad.id) }).then(refreshAds)
            .catch((err) => toast('error', err instanceof Error ? err.message : 'Fehler beim Verlängern'));
        }});
      }
    }
    items.push({ label: 'Duplizieren', icon: <Icon paths={ICONS.Duplizieren} />, onClick: () => {
      api.post(`/api/ads/duplicate/${encFile}`)
        .then(() => { refreshAds(); toast('success', 'Anzeige dupliziert'); })
        .catch((err) => toast('error', err instanceof Error ? err.message : 'Fehler beim Duplizieren'));
    }});
    items.push({ label: 'Als Vorlage speichern', icon: <Icon paths={ICONS.Vorlage} />, onClick: () => {
      setTemplateAd({ file: ad.file, title: ad.title || '' });
    }});
    items.push({ label: 'Entfernen', icon: <Icon paths={ICONS.Löschen} />, danger: true, separator: true, onClick: () => {
      api.delete(`/api/ads/by-file/${encFile}`)
        .then(() => { refreshAds(); toast('success', 'Anzeige entfernt'); })
        .catch((err) => toast('error', err instanceof Error ? err.message : 'Fehler beim Entfernen'));
    }});
    if (ad.id) {
      items.push({ label: 'Löschen (Live)', icon: <Icon paths={ICONS.Löschen} />, danger: true, onClick: () => {
        api.post<Job>('/api/bot/delete', { ads: String(ad.id) }).then(refreshAds)
          .catch((err) => toast('error', err instanceof Error ? err.message : 'Fehler beim Löschen'));
      }});
    }
    return items;
  }

  return (
    <div className={styles.wrapper}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th className={`${styles.th} ${styles.thTitle} thSortable`} onClick={() => handleSort('title')}>
              Anzeige {activeSortIcon('title')}
            </th>
            <th className={`${styles.th} ${styles.thPrice} thSortable`} onClick={() => handleSort('price')}>
              Preis {activeSortIcon('price')}
            </th>
            <th className={`${styles.th} ${styles.thApr} thSortable`} onClick={() => handleSort('apr')}>
              APR {activeSortIcon('apr')}
            </th>
            <th className={`${styles.th} ${styles.thCategory} thSortable`} onClick={() => handleSort('category')}>
              Kategorie {activeSortIcon('category')}
            </th>
            <th className={`${styles.th} ${styles.thCreated} thSortable`} onClick={() => handleSort('created_on')}>
              Erstellt {activeSortIcon('created_on')}
            </th>
            <th className={`${styles.th} ${styles.thUpdated} thSortable`} onClick={() => handleSort('updated_on')}>
              Aktualisiert {activeSortIcon('updated_on')}
            </th>
            <th className={`${styles.th} ${styles.thStatus} thSortable`} onClick={() => handleSort('status')}>
              Status {activeSortIcon('status')}
            </th>
            <th className={`${styles.th} ${styles.thActions}`}>Aktion</th>
          </tr>
        </thead>
        <tbody>
          {sortedAds.map((ad, i) => {
            const isDraft = !ad.id;
            const isSelected = selectedFiles.has(ad.file);
            const expiring = isExpiringSoon(ad);
            const expired = isExpired(ad);
            const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null;
            const imageUrl = ad.first_image && ad.file && token
              ? `/api/images/file?file=${encodeURIComponent(ad.file)}&name=${encodeURIComponent(ad.first_image)}&token=${encodeURIComponent(token)}`
              : null;
            const meta = [ad.shipping_type, ad.images > 0 ? `${ad.images} Bilder` : ''].filter(Boolean).join(' · ');

            const rowCls = [
              styles.row,
              'animRow',
              isSelected ? styles.rowSelected : '',
              isDraft ? styles.rowDraft : '',
              ad.active === false ? styles.rowInactive : '',
              expiring ? styles.rowExpiring : '',
              expired ? styles.rowExpired : '',
              ad.is_orphaned ? styles.rowOrphaned : '',
            ].filter(Boolean).join(' ');

            return (
              <tr
                key={ad.file}
                className={rowCls}
                style={{ '--anim-delay': `${Math.min(i * 30, 450)}ms` } as React.CSSProperties}
                onClick={(e) => handleRowClick(ad, e)}
              >
                {/* Title + thumb */}
                <td className={`${styles.td} ${styles.tdTitle}`}>
                  <div className={styles.titleWrap}>
                    <div className={styles.thumb}>
                      {imageUrl && <img src={imageUrl} alt="" loading="lazy" />}
                    </div>
                    <div className={styles.titleText}>
                      <div className={styles.name} title={ad.title}>{ad.title || '(Ohne Titel)'}</div>
                      {meta && <div className={styles.meta}>{meta}</div>}
                    </div>
                  </div>
                </td>

                <td className={`${styles.td} ${styles.tdPrice}`}>{formatPrice(ad)}</td>

                <td className={`${styles.td} ${styles.tdApr}`}>
                  {ad.auto_price_reduction?.enabled ? (
                    <Badge variant="warning">↓{ad.auto_price_reduction.min_price ?? '?'}€</Badge>
                  ) : '–'}
                </td>

                <td className={`${styles.td} ${styles.tdCategory}`}>{ad.category ? catName(ad.category) : '–'}</td>

                <td className={`${styles.td} ${styles.tdCreated}`}>
                  {ad.created_on ? new Date(ad.created_on).toLocaleDateString('de-DE') : '–'}
                </td>

                <td className={`${styles.td} ${styles.tdUpdated}`}>
                  {ad.updated_on ? new Date(ad.updated_on).toLocaleDateString('de-DE') : '–'}
                </td>

                <td className={`${styles.td} ${styles.tdStatus}`}>
                  {(() => {
                    const variant = isDraft ? 'muted'
                      : ad.active === false ? 'danger'
                      : expired ? 'danger'
                      : expiring ? 'warning'
                      : ad.is_orphaned ? 'warning'
                      : ad.is_changed ? 'info'
                      : 'success';
                    const label = isDraft ? 'Entwurf'
                      : ad.active === false ? 'Inaktiv'
                      : expired ? 'Abgelaufen'
                      : expiring ? 'Läuft bald ab'
                      : ad.is_orphaned ? 'Verwaist'
                      : ad.is_changed ? 'Geändert'
                      : 'Aktiv';
                    return <>
                      <span className={styles.statusBadge}><Badge variant={variant}>{label}</Badge></span>
                      <span className={`${styles.statusDot} ${styles[`dot_${variant}`]}`} title={label} />
                    </>;
                  })()}
                </td>

                <td className={`${styles.td} ${styles.tdActions}`}>
                  <button
                    className={styles.menuBtn}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (openMenu === ad.file) {
                        setOpenMenu(null);
                      } else {
                        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                        setMenuPos({ top: rect.bottom + 4, right: window.innerWidth - rect.right });
                        setOpenMenu(ad.file);
                      }
                    }}
                    title="Aktionen"
                  >⋮</button>

                  {openMenu === ad.file && menuPos && (
                    <DropdownMenu
                      items={buildMenuItems(ad)}
                      pos={menuPos}
                      onClose={() => setOpenMenu(null)}
                    />
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {templateAd && (
        <SaveAsTemplateModal
          open={!!templateAd}
          onClose={() => setTemplateAd(null)}
          adFile={templateAd.file}
          adTitle={templateAd.title}
        />
      )}
    </div>
  );
}
