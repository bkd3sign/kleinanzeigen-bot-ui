'use client';

import { useCallback, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api/client';
import { useAds } from '@/hooks/useAds';
import { DropdownMenu, useToast, showConfirm } from '@/components/ui';
import type { DropdownMenuItem } from '@/components/ui';
import { useCategoryName } from '@/hooks/useCategories';
import type { AdListItem } from '@/types/ad';
import { isExpired, isExpiringSoon, getExpiryDaysLeft } from '@/lib/ads/status';
import { getCurrentPrice } from '@/lib/ads/pricing';
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
};

interface AdCardProps {
  ad: AdListItem;
  selected?: boolean;
  onSelect?: (file: string) => void;
  selectMode?: boolean;
  style?: React.CSSProperties;
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
  const [menuPos, setMenuPos] = useState<{ top: number; right: number } | null>(null);
  const [templateModalOpen, setTemplateModalOpen] = useState(false);
  const catName = useCategoryName();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data: allAdsData } = useAds();
  const refreshAds = useCallback(() => { queryClient.invalidateQueries({ queryKey: ['ads'] }); }, [queryClient]);
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

  const isDraft = !ad.id;
  const expiring = isExpiringSoon(ad);
  const expired = isExpired(ad);

  const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null;
  const imageUrl = ad.first_image && ad.file && token
    ? `/api/images/file?file=${encodeURIComponent(ad.file)}&name=${encodeURIComponent(ad.first_image)}&token=${encodeURIComponent(token)}`
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
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setMenuPos(menuPos ? null : { top: rect.bottom + 4, right: window.innerWidth - rect.right });
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
  ].filter(Boolean).join(' ');

  // Status badge
  let statusClass = '';
  let statusText = '';
  if (isDraft) {
    statusClass = styles.cardStatusDraft;
    statusText = 'Entwurf';
  } else if (ad.active === false) {
    statusClass = styles.cardStatusInactive;
    statusText = 'Inaktiv';
  } else if (expired) {
    statusClass = styles.cardStatusExpired;
    statusText = 'Abgelaufen';
  } else if (expiring) {
    statusClass = styles.cardStatusExpiring;
    statusText = 'Läuft bald ab';
  } else if (ad.is_orphaned) {
    statusClass = styles.cardStatusOrphaned;
    statusText = 'Verwaist';
  } else if (ad.is_changed) {
    statusClass = styles.cardStatusChanged;
    statusText = 'Geändert';
  } else {
    statusClass = styles.cardStatusActive;
    statusText = 'Aktiv';
  }

  // Price display
  const priceDisplay = formatPrice(ad);

  // Meta line: shipping, images, category
  const metaParts: string[] = [];
  if (ad.shipping_type) metaParts.push(ad.shipping_type);
  if (ad.images > 0) metaParts.push(`${ad.images} Bilder`);
  if (ad.category) metaParts.push(catName(ad.category));

  return (<>
    <div className={cardClasses} style={style} onClick={handleClick}>
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

        {/* Status badge (top-left) */}
        <div className={styles.cardStatusWrap}>
          <span className={`${styles.cardStatus} ${statusClass}`}>
            {statusText}
          </span>
          {ad.auto_price_reduction?.enabled && (
            <span className={`${styles.cardStatus} ${styles.cardStatusPriceReduction}`}>
              ↓{ad.auto_price_reduction.min_price ?? '?'}€
            </span>
          )}
        </div>

        {/* Menu button (top-right) */}
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
      </div>

      {/* Card body */}
      <div className={styles.cardBody}>
        {ad.created_on && (
          <div className={styles.cardDate}>
            {new Date(ad.created_on).toLocaleDateString('de-DE')}
          </div>
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

        {/* Meta line */}
        {metaParts.length > 0 && (
          <div className={styles.cardMeta}>
            {metaParts.join(' \u00B7 ')}
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
