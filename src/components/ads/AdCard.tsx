'use client';

import { useCallback, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api/client';
import { useAds, useUpdateAdByFile } from '@/hooks/useAds';
import { useAdStats } from '@/hooks/useAdStats';
import { Badge, DropdownMenu, useToast, showConfirm } from '@/components/ui';
import { useCategoryName } from '@/hooks/useCategories';
import type { AdListItem } from '@/types/ad';
import { isExpired, isExpiringSoon, getExpiryDaysLeft, getExpiryDate, isReserved } from '@/lib/ads/status';
import { getCurrentPrice, getAprError } from '@/lib/ads/pricing';
import { detectSizeGroup } from '@/lib/shipping';
import { SaveAsTemplateModal } from './SaveAsTemplateModal';
import styles from './AdCard.module.scss';

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

interface AdCardProps {
  ad: AdListItem;
  selected?: boolean;
  onSelect?: (file: string) => void;
  selectMode?: boolean;
  style?: React.CSSProperties;
}

function formatDMY(dmy: string): string {
  const [d, m, y] = dmy.split('.').map(Number);
  return `${d}.${m}.${y}`;
}

function formatPrice(ad: AdListItem): React.ReactNode {
  if (ad.price_type === 'GIVE_AWAY') return 'Zu verschenken';
  if (ad.price == null) return null;

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

export function AdCard({ ad, selected = false, onSelect, selectMode = false, style }: AdCardProps) {
  const router = useRouter();
  const [menuPos, setMenuPos] = useState<{ top?: number; bottom?: number; right: number; maxHeight?: number } | null>(null);
  const [templateModalOpen, setTemplateModalOpen] = useState(false);
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data: allAdsData } = useAds();
  const { data: statsData } = useAdStats();
  const catName = useCategoryName();
  const adStats = ad.id ? statsData?.ads[String(ad.id)] : undefined;
  const refreshAds = useCallback(() => { queryClient.invalidateQueries({ queryKey: ['ads'] }); }, [queryClient]);
  const updateByFile = useUpdateAdByFile();

  const handleToggleActive = useCallback(() => {
    const newActive = !ad.active;
    updateByFile.mutate(
      { filename: ad.file, data: { active: newActive } },
      {
        onSuccess: () => toast('success', newActive ? 'Anzeige aktiviert' : 'Anzeige deaktiviert'),
        onError: (err) => toast('error', err instanceof Error ? err.message : 'Fehler beim Ändern des Status'),
      },
    );
  }, [ad.file, ad.active, updateByFile, toast]);

  const encFile = ad.file.split('/').map(encodeURIComponent).join('/');

  const handleRemove = useCallback(() => {
    api.delete(`/api/ads/by-file/${encFile}`)
      .then(() => { refreshAds(); toast('success', 'Anzeige entfernt'); })
      .catch((err) => toast('error', err instanceof Error ? err.message : 'Fehler beim Entfernen'));
  }, [encFile, refreshAds, toast]);

  const handleDuplicate = useCallback(() => {
    api.post(`/api/ads/duplicate/${encFile}`)
      .then(() => { refreshAds(); toast('success', 'Anzeige dupliziert'); })
      .catch((err) => toast('error', err instanceof Error ? err.message : 'Fehler beim Duplizieren'));
  }, [encFile, refreshAds, toast]);

  const isDraft = !ad.id && !ad.is_archived;
  const expiring = isExpiringSoon(ad);
  const expired = isExpired(ad);

  const imageUrl = ad.first_image && ad.file
    ? `/api/images/file?file=${encodeURIComponent(ad.file)}&name=${encodeURIComponent(ad.first_image)}`
    : null;

  const handleClick = useCallback(() => {
    if (selectMode) {
      onSelect?.(ad.file);
    } else {
      router.push(`/ads/edit?file=${encodeURIComponent(ad.file)}`);
    }
  }, [router, ad.file, selectMode, onSelect]);



  const handleMenuClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    if (menuPos) { setMenuPos(null); return; }
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom - 8;
    const spaceAbove = rect.top - 8;
    const flipUp = spaceBelow < 260 && spaceAbove > spaceBelow;
    setMenuPos(flipUp
      ? { bottom: window.innerHeight - rect.top + 4, right: window.innerWidth - rect.right, maxHeight: spaceAbove }
      : { top: rect.bottom + 4, right: window.innerWidth - rect.right, maxHeight: spaceBelow },
    );
  }, [menuPos]);

  // Build card class names
  const cardClasses = [
    styles.card,
    selected ? styles.cardSelected : '',
    isDraft ? styles.cardDraft : '',
    ad.active === false ? styles.cardInactive : '',
    expiring ? styles.cardExpiring : '',
    expired ? styles.cardExpired : '',
    ad.is_orphaned ? styles.cardOrphaned : '',
    ad.is_changed ? styles.cardChanged : '',
  ].filter(Boolean).join(' ');

  // Status badge
  const statusVariant = isDraft ? 'muted'
    : isReserved(ad, adStats) ? 'reserved'
    : ad.active === false ? 'danger'
    : expired ? 'danger'
    : expiring ? 'warning'
    : ad.is_orphaned ? 'warning'
    : ad.is_changed ? 'info'
    : 'success' as const;
  const statusText = isDraft ? 'Entwurf'
    : isReserved(ad, adStats) ? 'Reserviert'
    : ad.active === false ? 'Inaktiv'
    : expired ? 'Abgelaufen'
    : expiring ? 'Läuft bald ab'
    : ad.is_orphaned ? 'Verwaist'
    : ad.is_changed ? 'Geändert'
    : 'Aktiv';

  // Price display
  const priceDisplay = formatPrice(ad);

  // Expiry date: from live stats API, or calculated (updated_on/created_on + 60d)
  const calculatedExpiry = getExpiryDate(ad);
  const expiresDisplay = adStats?.expires_at
    ? formatDMY(adStats.expires_at)
    : calculatedExpiry
      ? `${calculatedExpiry.getDate()}.${calculatedExpiry.getMonth() + 1}.${calculatedExpiry.getFullYear()}`
      : null;


  return (<>
    <div className={cardClasses} style={style} onClick={handleClick}>
      {/* Menu button — direct child of card so it anchors to card on mobile */}
      <button
        className={styles.cardMenu}
        onClick={handleMenuClick}
        title="Aktionen"
      >
        ⋮
      </button>

      {/* Dropdown rendered via portal to escape overflow:hidden */}
      {menuPos && (
        <DropdownMenu
          pos={menuPos}
          onClose={() => setMenuPos(null)}
          items={[
            { label: 'Bearbeiten', icon: <Icon paths={ICONS.Bearbeiten} />, onClick: () => router.push(`/ads/edit?file=${encodeURIComponent(ad.file)}`) },
            { label: !ad.active ? 'Aktivieren' : 'Deaktivieren', icon: <Icon paths={!ad.active ? ICONS.Aktivieren : ICONS.Deaktivieren} />, onClick: handleToggleActive },
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
              api.post('/api/bot/publish', { ads: ad.id ? String(ad.id) : 'new' }).then(refreshAds).catch((err) => toast('error', err instanceof Error ? err.message : 'Fehler beim Veröffentlichen'));
            } },
            ...(ad.id ? [
              { label: 'Aktualisieren', icon: <Icon paths={ICONS.Aktualisieren} />, onClick: () => { api.post('/api/bot/update', { ads: String(ad.id) }).then(refreshAds).catch((err) => toast('error', err instanceof Error ? err.message : 'Fehler beim Aktualisieren')); } },
              ...((expiring || expired) ? [{ label: 'Verlängern', icon: <Icon paths={ICONS.Verlängern} />, onClick: () => { api.post('/api/bot/extend', { ads: String(ad.id) }).then(refreshAds).catch((err) => toast('error', err instanceof Error ? err.message : 'Fehler beim Verlängern')); } }] : []),
            ] : []),
            { label: 'Duplizieren', icon: <Icon paths={ICONS.Duplizieren} />, onClick: handleDuplicate },
            { label: 'Als Vorlage speichern', icon: <Icon paths={ICONS.Vorlage} />, onClick: () => setTemplateModalOpen(true) },
            { label: 'Entfernen', icon: <Icon paths={ICONS.Löschen} />, danger: true, separator: true, onClick: handleRemove },
            ...(ad.id ? [{ label: 'Löschen (Live)', icon: <Icon paths={ICONS.Löschen} />, danger: true, onClick: () => { api.post('/api/bot/delete', { ads: String(ad.id) }).then(refreshAds).catch(() => {}); } }] : []),
          ]}
        />
      )}

      {/* Image area with status overlay */}
      <div className={styles.cardImage}>
        {imageUrl ? (
          <img
            src={imageUrl}
            alt={ad.title || ''}
            className={styles.cardImageImg}
            loading="lazy"
          />
        ) : (
          <div className={styles.cardImagePlaceholder}>
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
              <circle cx="8.5" cy="8.5" r="1.5" />
              <polyline points="21 15 16 10 5 21" />
            </svg>
          </div>
        )}

        {/* Image count badge (bottom-right) */}
        {ad.images > 0 && (
          <span className={styles.cardImageCount}>
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
            {ad.images}
          </span>
        )}

        {/* Status badge (top-left) */}
        <div className={styles.cardStatusWrap}>
          <Badge variant={statusVariant}>{statusText}</Badge>
          {ad.auto_price_reduction?.enabled && (() => {
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
          })()}
        </div>

      </div>

      {/* Card body */}
      <div className={styles.cardBody}>

        {/* Mobile-only: end date above title */}
        {expiresDisplay && (
          <span className={styles.cardDateMobile} title="Endet am">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/><line x1="4" y1="4" x2="20" y2="22"/></svg>
            {expiresDisplay}
          </span>
        )}

        <div className={styles.cardTitle} title={ad.title || ''}>
          {ad.title || '(Ohne Titel)'}
        </div>

        {priceDisplay && (
          <div className={styles.cardPrice}>{priceDisplay}</div>
        )}

        {/* Expiry countdown (only when not yet expired — badge already shows "Abgelaufen") */}
        {expiring && !expired && ad.created_on && (
          <div className={styles.cardExpiry}>
            Noch {getExpiryDaysLeft(ad)} Tag{getExpiryDaysLeft(ad) !== 1 ? 'e' : ''} bis Ablauf
          </div>
        )}

        {/* Info row: shipping, images, views, watchlist + date */}
        {(ad.shipping_type || adStats || expiresDisplay) && (
          <div className={styles.cardInfo}>
            <span className={styles.cardInfoChips}>
              {ad.shipping_type === 'SHIPPING' && (() => {
                const size = detectSizeGroup(ad.shipping_options ?? []) ?? 'I';
                return (
                  <span className={styles.cardInfoChip} title="Versand">
                    <span className="shippingIconWrap">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>
                      <span className="shippingIconSize">{size}</span>
                    </span>
                  </span>
                );
              })()}
              {ad.shipping_type === 'PICKUP' && (
                <span className={styles.cardInfoChip} title="Nur Abholung">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
                </span>
              )}
              {adStats && (
                <span className={styles.cardInfoStatsGroup}>
                  <span className={styles.cardInfoChip}>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                    {adStats.views}
                  </span>
                  <span className={styles.cardInfoChip}>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>
                    {adStats.watchlist}
                  </span>
                </span>
              )}
              {ad.category && (
                <span className={styles.cardInfoCategoryWrap}>
                  <span aria-hidden="true">·</span>
                  <span className={styles.cardInfoCategory}>{catName(ad.category)}</span>
                </span>
              )}
            </span>
            {expiresDisplay && (
              <span className={styles.cardInfoDate} title="Endet am">
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/><line x1="4" y1="4" x2="20" y2="22"/></svg>
                {expiresDisplay}
              </span>
            )}
          </div>
        )}
      </div>

    </div>

    <SaveAsTemplateModal
      open={templateModalOpen}
      onClose={() => setTemplateModalOpen(false)}
      adFile={ad.file}
      adTitle={ad.title || ''}
    />
  </>
  );
}
