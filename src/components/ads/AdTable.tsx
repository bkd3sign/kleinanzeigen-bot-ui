'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { Badge, DropdownMenu, useToast, showConfirm } from '@/components/ui';
import { useAds, useUpdateAdByFile } from '@/hooks/useAds';
import { useAdStats } from '@/hooks/useAdStats';
import type { DropdownMenuItem } from '@/components/ui';
import { api } from '@/lib/api/client';
import { useCategoryName } from '@/hooks/useCategories';
import { useSort } from '@/hooks/useSort';
import type { SortDir } from '@/hooks/useSort';
import type { AdListItem } from '@/types/ad';
import type { Job } from '@/types/bot';
import { isExpired, isExpiringSoon, isReserved, getExpiryDate } from '@/lib/ads/status';
import { detectSizeGroup } from '@/lib/shipping';
import { getCurrentPrice, getAprError } from '@/lib/ads/pricing';
import type { AdStatsEntry } from '@/types/stats';
import { SaveAsTemplateModal } from './SaveAsTemplateModal';
import styles from './AdTable.module.scss';

export type AdSortKey = 'title' | 'price' | 'apr' | 'category' | 'shipping_type' | 'created_on' | 'updated_on' | 'status' | 'views' | 'watchlist' | 'expires_at' | 'republication_interval';

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
  Deaktivieren: ['M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94', 'M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19', 'M14.12 14.12a3 3 0 0 1-4.24-4.24', 'M1 1l22 22'],
  Aktivieren: ['M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8', 'M12 9a3 3 0 0 1 0 6 3 3 0 0 1 0-6z'],
};

function getStatusRank(ad: AdListItem): number {
  if (!ad.id && !ad.is_archived) return 0;        // Draft
  if (ad.active === false || ad.is_archived) return 1; // Inactive / archived
  if (isExpired(ad)) return 2;                     // Expired
  if (isExpiringSoon(ad)) return 3;                // Expiring soon
  if (ad.is_orphaned) return 4;                    // Orphaned
  if (ad.is_changed) return 5;                     // Changed
  return 6;                                        // Active
}

function getAprRank(ad: AdListItem): number {
  if (!ad.auto_price_reduction?.enabled) return 0;
  return ad.auto_price_reduction.min_price ?? 0;
}

const SHIPPING_SIZE_RANK: Record<string, number> = { S: 1, M: 2, L: 3, I: 4 };

function getShippingRank(ad: AdListItem): number {
  if (!ad.shipping_type || ad.shipping_type === 'NOT_APPLICABLE') return 0;
  if (ad.shipping_type === 'PICKUP') return 5;
  return SHIPPING_SIZE_RANK[shippingSizeLabel(ad)] ?? 4;
}

function shippingSizeLabel(ad: AdListItem): string {
  if (ad.shipping_type !== 'SHIPPING') return '';
  return detectSizeGroup(ad.shipping_options ?? []) ?? 'I';
}

function ShippingCell({ ad }: { ad: AdListItem }) {
  if (!ad.shipping_type || ad.shipping_type === 'NOT_APPLICABLE') {
    return <span className={styles.shippingEmpty}>–</span>;
  }
  const label = ad.shipping_type === 'SHIPPING' ? 'Versand' : 'Abholung';
  const size = shippingSizeLabel(ad);
  return (
    <span className={styles.shippingWrap}>
      {label}{size ? <span className={styles.sizeHint}>{size}</span> : null}
    </span>
  );
}

export function compareAds(a: AdListItem, b: AdListItem, key: AdSortKey): number {
  if (key === 'title') return (a.title ?? '').localeCompare(b.title ?? '', 'de');
  if (key === 'category') return (a.category ?? '').localeCompare(b.category ?? '', 'de');
  if (key === 'price') return (getCurrentPrice(a) ?? a.price ?? -1) - (getCurrentPrice(b) ?? b.price ?? -1);
  if (key === 'apr') return getAprRank(a) - getAprRank(b);
  if (key === 'shipping_type') return getShippingRank(a) - getShippingRank(b);
  if (key === 'created_on') return new Date(a.created_on ?? 0).getTime() - new Date(b.created_on ?? 0).getTime();
  if (key === 'updated_on') return new Date(a.updated_on ?? 0).getTime() - new Date(b.updated_on ?? 0).getTime();
  if (key === 'status') return getStatusRank(a) - getStatusRank(b);
  if (key === 'republication_interval') return (a.republication_interval ?? 0) - (b.republication_interval ?? 0);
  return 0;
}

function parseDMY(dmy: string): number {
  const [d, m, y] = dmy.split('.').map(Number);
  return new Date(y, m - 1, d).getTime();
}

export interface StatsMap { ads: Record<string, AdStatsEntry> }

export function makeCompare(statsData: StatsMap | undefined) {
  return (a: AdListItem, b: AdListItem, key: AdSortKey): number => {
    const as = a.id ? statsData?.ads[String(a.id)] : undefined;
    const bs = b.id ? statsData?.ads[String(b.id)] : undefined;
    if (key === 'views') return (as?.views ?? -1) - (bs?.views ?? -1);
    if (key === 'watchlist') return (as?.watchlist ?? -1) - (bs?.watchlist ?? -1);
    if (key === 'expires_at') {
      const at = as?.expires_at ? parseDMY(as.expires_at) : (getExpiryDate(a)?.getTime() ?? 0);
      const bt = bs?.expires_at ? parseDMY(bs.expires_at) : (getExpiryDate(b)?.getTime() ?? 0);
      return at - bt;
    }
    return compareAds(a, b, key);
  };
}

export function AdTable({ ads, selectedFiles, onSelect, selectMode = false, sortKey: controlledKey, sortDir: controlledDir, onSortChange }: AdTableProps) {
  const router = useRouter();
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [shadowLeft, setShadowLeft] = useState(false);
  const [shadowRight, setShadowRight] = useState(false);
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [menuPos, setMenuPos] = useState<{ top?: number; bottom?: number; right: number; maxHeight?: number } | null>(null);
  const [templateAd, setTemplateAd] = useState<{ file: string; title: string } | null>(null);
  const catName = useCategoryName();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const refreshAds = useCallback(() => { queryClient.invalidateQueries({ queryKey: ['ads'] }); }, [queryClient]);
  const updateByFile = useUpdateAdByFile();

  const handleWrapperScroll = useCallback(() => {
    const el = wrapperRef.current;
    if (!el) return;
    setShadowLeft(el.scrollLeft > 0);
    setShadowRight(el.scrollLeft < el.scrollWidth - el.clientWidth - 1);
  }, []);

  useEffect(() => {
    handleWrapperScroll();
  }, [handleWrapperScroll]);

  // Internal sort state — used only when no controlled sort props are passed
  const { data: allAdsData } = useAds();
  const { data: statsData } = useAdStats();
  const compareFn = useMemo(() => makeCompare(statsData), [statsData]);

  const { sorted: sortedInternal, sortKey: internalKey, sortDir: internalDir, handleSort: handleSortInternal } =
    useSort<AdListItem, AdSortKey>(ads, 'title', compareFn);

  // If controlled from parent (for view-switch persistence), use parent state
  const isControlled = controlledKey !== undefined && controlledDir !== undefined && onSortChange !== undefined;

  const sortedAds = useMemo(() => {
    if (!isControlled) return sortedInternal;
    const copy = [...ads];
    copy.sort((a, b) => {
      const cmp = compareFn(a, b, controlledKey!);
      return controlledDir === 'asc' ? cmp : -cmp;
    });
    return copy;
  }, [ads, isControlled, controlledKey, controlledDir, compareFn, sortedInternal]);

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
    if (activeSortKey !== col) return null;
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
      { label: !ad.active ? 'Aktivieren' : 'Deaktivieren', icon: <Icon paths={!ad.active ? ICONS.Aktivieren : ICONS.Deaktivieren} />, onClick: () => {
        const newActive = !ad.active;
        updateByFile.mutate(
          { filename: ad.file, data: { active: newActive } },
          {
            onSuccess: () => toast('success', newActive ? 'Anzeige aktiviert' : 'Anzeige deaktiviert'),
            onError: (err) => toast('error', err instanceof Error ? err.message : 'Fehler beim Ändern des Status'),
          },
        );
      }},
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
    <div className={styles.outer}>
      <div ref={wrapperRef} className={styles.wrapper} onScroll={handleWrapperScroll}>
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
            <th className={`${styles.th} ${styles.thInterval} thSortable`} onClick={() => handleSort('republication_interval')}>
              Intervall {activeSortIcon('republication_interval')}
            </th>
            <th className={`${styles.th} ${styles.thCategory} thSortable`} onClick={() => handleSort('category')}>
              Kategorie {activeSortIcon('category')}
            </th>
            <th className={`${styles.th} ${styles.thStatus} thSortable`} onClick={() => handleSort('status')}>
              Status {activeSortIcon('status')}
            </th>
            <th className={`${styles.th} ${styles.thShipping} thSortable`} onClick={() => handleSort('shipping_type')}>
              Versandart {activeSortIcon('shipping_type')}
            </th>
            <th className={`${styles.th} ${styles.thViews} thSortable`} onClick={() => handleSort('views')}>
              Besucher {activeSortIcon('views')}
            </th>
            <th className={`${styles.th} ${styles.thWatchlist} thSortable`} onClick={() => handleSort('watchlist')}>
              Merkliste {activeSortIcon('watchlist')}
            </th>
            <th className={`${styles.th} ${styles.thCreated} thSortable`} onClick={() => handleSort('created_on')}>
              Erstellt {activeSortIcon('created_on')}
            </th>
            <th className={`${styles.th} ${styles.thUpdated} thSortable`} onClick={() => handleSort('updated_on')}>
              Aktualisiert {activeSortIcon('updated_on')}
            </th>
            <th className={`${styles.th} ${styles.thExpires} thSortable`} onClick={() => handleSort('expires_at')}>
              Endet {activeSortIcon('expires_at')}
            </th>
            <th className={`${styles.th} ${styles.thActions}`}>Aktion</th>
          </tr>
        </thead>
        <tbody>
          {sortedAds.map((ad, i) => {
            const isDraft = !ad.id && !ad.is_archived;
            const isSelected = selectedFiles.has(ad.file);
            const expiring = isExpiringSoon(ad);
            const expired = isExpired(ad);
            const imageUrl = ad.first_image && ad.file
              ? `/api/images/file?file=${encodeURIComponent(ad.file)}&name=${encodeURIComponent(ad.first_image)}`
              : null;
            const adStats = ad.id ? statsData?.ads[String(ad.id)] : undefined;

            const rowCls = [
              styles.row,
              'animRow',
              isSelected ? styles.rowSelected : '',
              isDraft ? styles.rowDraft : '',
              ad.active === false ? styles.rowInactive : '',
              expiring ? styles.rowExpiring : '',
              expired ? styles.rowExpired : '',
              ad.is_orphaned ? styles.rowOrphaned : '',
              ad.is_changed ? styles.rowChanged : '',
              isReserved(ad, adStats) ? styles.rowReserved : '',
            ].filter(Boolean).join(' ');

            return (
              <tr
                key={ad.file}
                className={rowCls}
                style={{ '--anim-delay': `${Math.min(i * 30, 450)}ms` } as React.CSSProperties}
                onClick={(e) => handleRowClick(ad, e)}
              >
                {/* Title + thumb */}
                <td className={`${styles.td} ${styles.tdTitle}${isSelected ? ` ${styles.tdStickySelected}` : ''}`}>
                  <div className={styles.titleWrap}>
                    <div className={styles.thumb}>
                      {imageUrl && <img src={imageUrl} alt="" loading="lazy" />}
                      {ad.images > 0 && (
                        <span className={styles.thumbCount}>{ad.images}</span>
                      )}
                    </div>
                    <div className={styles.titleText}>
                      <div className={styles.name} title={ad.title}>{ad.title || '(Ohne Titel)'}</div>
                      {(ad.shipping_type || adStats) && (
                        <div className={styles.mobileMeta}>
                          {ad.shipping_type === 'SHIPPING' && (() => {
                            const size = shippingSizeLabel(ad);
                            return (
                              <span className={styles.metaChip} title="Versand">
                                <span className="shippingIconWrap">
                                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>
                                  {size ? <span className="shippingIconSize">{size}</span> : null}
                                </span>
                              </span>
                            );
                          })()}
                          {ad.shipping_type === 'PICKUP' && (
                            <span className={styles.metaChip} title="Nur Abholung">
                              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
                            </span>
                          )}
                          {adStats && (
                            <>
                              <span className={styles.metaChip}>
                                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                                {adStats.views}
                              </span>
                              <span className={styles.metaChip}>
                                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>
                                {adStats.watchlist}
                              </span>
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </td>

                <td className={`${styles.td} ${styles.tdPrice}`}>{formatPrice(ad)}</td>

                <td className={`${styles.td} ${styles.tdApr}`}>
                  {ad.auto_price_reduction?.enabled ? (() => {
                    const aprErr = ad.price != null ? getAprError(ad.price, ad.auto_price_reduction!) : null;
                    const aprTitle = aprErr?.type === 'ineffective'
                      ? `Preisreduktion wirkungslos — die Reduktion ergibt nach Rundung auf ganze Euro keine Preisänderung`
                      : aprErr?.type === 'stuck'
                      ? `Preis steckt fest — ab ~${aprErr.stuckAt} € rundet die Reduktion auf 0, der Mindestpreis ${ad.auto_price_reduction!.min_price} € wird nie erreicht`
                      : undefined;
                    return (
                      <Badge variant={aprErr ? 'danger' : 'warning'} title={aprTitle}>
                        ↓{ad.auto_price_reduction!.min_price ?? '?'}€{aprErr ? ' ⚠' : ''}
                      </Badge>
                    );
                  })() : '–'}
                </td>

                <td className={`${styles.td} ${styles.tdInterval}`}>
                  {ad.republication_interval ? `${ad.republication_interval}d` : '–'}
                </td>

                <td className={`${styles.td} ${styles.tdCategory}`}>{ad.category ? catName(ad.category) : '–'}</td>

                <td className={`${styles.td} ${styles.tdStatus}`}>
                  {(() => {
                    const variant = isDraft ? 'muted'
                      : isReserved(ad, adStats) ? 'reserved'
                      : ad.active === false ? 'danger'
                      : expired ? 'danger'
                      : expiring ? 'warning'
                      : ad.is_orphaned ? 'warning'
                      : ad.is_changed ? 'info'
                      : 'success';
                    const label = isDraft ? 'Entwurf'
                      : isReserved(ad, adStats) ? 'Reserviert'
                      : ad.active === false ? 'Inaktiv'
                      : expired ? 'Abgelaufen'
                      : expiring ? 'Läuft bald ab'
                      : ad.is_orphaned ? 'Verwaist'
                      : ad.is_changed ? 'Geändert'
                      : 'Aktiv';
                    return <Badge variant={variant}>{label}</Badge>;
                  })()}
                </td>

                <td className={`${styles.td} ${styles.tdShipping}`}><ShippingCell ad={ad} /></td>

                <td className={`${styles.td} ${styles.tdViews}`}>{adStats?.views ?? 0}</td>
                <td className={`${styles.td} ${styles.tdWatchlist}`}>{adStats?.watchlist ?? 0}</td>

                <td className={`${styles.td} ${styles.tdCreated}`}>
                  {ad.created_on ? new Date(ad.created_on).toLocaleDateString('de-DE') : '–'}
                </td>

                <td className={`${styles.td} ${styles.tdUpdated}`}>
                  {ad.updated_on ? new Date(ad.updated_on).toLocaleDateString('de-DE') : '–'}
                </td>

                <td className={`${styles.td} ${styles.tdExpires}`}>
                  {adStats?.expires_at ?? (getExpiryDate(ad) ? `${getExpiryDate(ad)!.getDate()}.${getExpiryDate(ad)!.getMonth() + 1}.${getExpiryDate(ad)!.getFullYear()}` : '–')}
                </td>

                <td className={`${styles.td} ${styles.tdActions}${isSelected ? ` ${styles.tdStickySelected}` : ''}`}>
                  <button
                    className={styles.menuBtn}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (openMenu === ad.file) {
                        setOpenMenu(null);
                      } else {
                        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                        const spaceBelow = window.innerHeight - rect.bottom - 8;
                        const spaceAbove = rect.top - 8;
                        const flipUp = spaceBelow < 260 && spaceAbove > spaceBelow;
                        setMenuPos(flipUp
                          ? { bottom: window.innerHeight - rect.top + 4, right: window.innerWidth - rect.right, maxHeight: spaceAbove }
                          : { top: rect.bottom + 4, right: window.innerWidth - rect.right, maxHeight: spaceBelow },
                        );
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
      </div>
      {shadowLeft && <div className={styles.shadowLeftOverlay} aria-hidden="true" />}
      {shadowRight && <div className={styles.shadowRightOverlay} aria-hidden="true" />}
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
