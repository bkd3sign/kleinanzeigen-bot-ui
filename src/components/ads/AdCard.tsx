'use client';

import { useCallback, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAdStats } from '@/hooks/useAdStats';
import { useAdMenuBuilder } from '@/hooks/useAdMenuBuilder';
import { Badge, DropdownMenu } from '@/components/ui';
import { useCategoryName } from '@/hooks/useCategories';
import type { AdListItem } from '@/types/ad';
import { isExpired, isExpiringSoon, getExpiryDaysLeft, getExpiryDate, getStatusLabel, getStatusVariant } from '@/lib/ads/status';
import { getCurrentPrice, getAprError, getAprErrorTitle } from '@/lib/ads/pricing';
import { detectSizeGroup } from '@/lib/shipping';
import { SaveAsTemplateModal } from './SaveAsTemplateModal';
import styles from './AdCard.module.scss';

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
  const { data: statsData } = useAdStats();
  const catName = useCategoryName();
  const adStats = ad.id ? statsData?.ads[String(ad.id)] : undefined;
  const handleSaveAsTemplate = useCallback(() => setTemplateModalOpen(true), []);
  const buildMenuItems = useAdMenuBuilder({ onSaveAsTemplate: handleSaveAsTemplate });

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

  // Status badge — label + colour from the single source in status.ts
  const statusText = getStatusLabel(ad, adStats);
  const statusVariant = getStatusVariant(statusText);

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
          items={buildMenuItems(ad)}
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
            const aprTitle = aprErr ? getAprErrorTitle(aprErr, ad.auto_price_reduction!.min_price) : undefined;
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
