'use client';

import { useState, useCallback, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Modal, Button, Toggle, useToast, showConfirm } from '@/components/ui';
import { api } from '@/lib/api/client';
import { sizeDescOf } from '@/lib/shipping';
import { buildBulkEditPayload } from '@/lib/ads/buildBulkEditPayload';
import type { BulkPriceType, BulkShippingChoice, BulkIntervalPreset, BulkEditOptions } from '@/lib/ads/buildBulkEditPayload';
import type { AdListItem } from '@/types/ad';
import styles from './AdBulkEditModal.module.scss';

interface AdBulkEditModalProps {
  open: boolean;
  onClose: () => void;
  onClear?: () => void;
  selectedAds: AdListItem[];
}

type PanelId = 'preis' | 'versand' | 'apr' | 'intervall' | 'loeschen';

// Reusable option row (radio-style, click active to deselect)
function OptionItem({
  icon,
  title,
  desc,
  active,
  onClick,
}: {
  icon: React.ReactNode;
  title: string;
  desc?: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      className={[styles.optItem, active && styles.optItemActive].filter(Boolean).join(' ')}
      onClick={onClick}
    >
      <span className={styles.optItemIcon}>{icon}</span>
      <div className={styles.optItemText}>
        <div className={styles.optItemTitle}>{title}</div>
        {desc && <div className={styles.optItemDesc}>{desc}</div>}
      </div>
    </button>
  );
}

// Collapsible panel
function Panel({
  id,
  icon,
  title,
  desc,
  badge,
  isOpen,
  onToggle,
  danger,
  children,
}: {
  id: PanelId;
  icon: React.ReactNode;
  title: string;
  desc: string;
  badge?: string;
  isOpen: boolean;
  onToggle: (id: PanelId) => void;
  danger?: boolean;
  children: React.ReactNode;
}) {
  const panelCls = [
    styles.panel,
    danger && styles.panelDanger,
    isOpen && styles.panelOpen,
  ].filter(Boolean).join(' ');
  return (
    <div className={panelCls}>
      <button className={styles.panelHeader} onClick={() => onToggle(id)}>
        <span className={styles.panelIcon}>{icon}</span>
        <div className={styles.panelText}>
          <div className={styles.panelTitle}>{title}</div>
          <div className={styles.panelDesc}>{desc}</div>
        </div>
        {badge && <span className={styles.panelBadge}>{badge}</span>}
        <svg
          className={styles.panelChevron}
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      {isOpen && <div className={styles.panelBody}>{children}</div>}
    </div>
  );
}

const PRICE_ADJUSTMENTS = [-15, -10, -5, +5, +10, +15];

export function AdBulkEditModal({ open, onClose, onClear, selectedAds }: AdBulkEditModalProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [openPanels, setOpenPanels] = useState<Set<PanelId>>(new Set());
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const publishedAds = selectedAds.filter((a) => !!a.id);

  // Preis
  const [priceType, setPriceType] = useState<BulkPriceType | null>(null);
  const [priceAdjust, setPriceAdjust] = useState<number | null>(null);
  const [absolutePrice, setAbsolutePrice] = useState<number | null>(null);
  const [absolutePriceInput, setAbsolutePriceInput] = useState('');

  // Versand
  const [shippingChoice, setShippingChoice] = useState<BulkShippingChoice | null>(null);
  const [customShippingCost, setCustomShippingCost] = useState('');

  // APR
  const [aprEnabled, setAprEnabled] = useState<boolean | null>(null);
  const [aprStrategy, setAprStrategy] = useState<'PERCENTAGE' | 'FIXED' | null>(null);
  const [aprAmountInput, setAprAmountInput] = useState('');
  const [aprAmount, setAprAmount] = useState<number | null>(null);
  const [aprMinPriceInput, setAprMinPriceInput] = useState('');
  const [aprMinPrice, setAprMinPrice] = useState<number | null>(null);

  // Intervall
  const [intervalPreset, setIntervalPreset] = useState<BulkIntervalPreset | null>(null);
  const [customInterval, setCustomInterval] = useState('');

  // Preisanpassung beim Update
  const [updatePriceOnUpdate, setUpdatePriceOnUpdate] = useState<boolean | null>(null);

  useEffect(() => {
    if (!open) {
      setOpenPanels(new Set());
      setPriceType(null);
      setPriceAdjust(null);
      setAbsolutePrice(null);
      setAbsolutePriceInput('');
      setShippingChoice(null);
      setCustomShippingCost('');
      setAprEnabled(null);
      setAprStrategy(null);
      setAprAmountInput('');
      setAprAmount(null);
      setAprMinPriceInput('');
      setAprMinPrice(null);
      setIntervalPreset(null);
      setCustomInterval('');
      setUpdatePriceOnUpdate(null);
    } else {
      const allAprEnabled = selectedAds.length > 0 &&
        selectedAds.every((a) => a.auto_price_reduction?.enabled === true);
      if (allAprEnabled) setAprEnabled(true);
      const allOnUpdate = selectedAds.length > 0 &&
        selectedAds.every((a) => a.auto_price_reduction?.on_update === true);
      if (allOnUpdate) setUpdatePriceOnUpdate(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]); // selectedAds intentionally excluded — init runs only when modal opens

  const togglePanel = useCallback((id: PanelId) => {
    setOpenPanels((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }, []);

  const hasAnyChange =
    priceType !== null ||
    priceAdjust !== null ||
    absolutePrice !== null ||
    shippingChoice !== null ||
    aprEnabled !== null ||
    aprStrategy !== null ||
    aprAmount !== null ||
    aprMinPrice !== null ||
    intervalPreset !== null ||
    updatePriceOnUpdate !== null;

  const customShippingInvalid =
    shippingChoice === 'CUSTOM' &&
    (customShippingCost.trim() === '' || isNaN(parseFloat(customShippingCost)) || parseFloat(customShippingCost) <= 0);

  const customIntervalInvalid =
    intervalPreset === 'CUSTOM' &&
    (customInterval.trim() === '' || isNaN(parseInt(customInterval, 10)) || parseInt(customInterval, 10) <= 0);

  const absolutePriceInvalid =
    absolutePriceInput.trim() !== '' &&
    (isNaN(parseFloat(absolutePriceInput)) || parseFloat(absolutePriceInput) < 0);

  const aprAmountInvalid =
    aprAmountInput.trim() !== '' &&
    (isNaN(parseFloat(aprAmountInput)) || parseFloat(aprAmountInput) <= 0);

  const aprMinPriceInvalid =
    aprMinPriceInput.trim() !== '' &&
    (isNaN(parseFloat(aprMinPriceInput)) || parseFloat(aprMinPriceInput) < 0);

  const canSubmit = hasAnyChange && !customShippingInvalid && !customIntervalInvalid
    && !absolutePriceInvalid && !aprAmountInvalid && !aprMinPriceInvalid;

  const handleApply = useCallback(async () => {
    if (!canSubmit) return;

    const opts: BulkEditOptions = { priceType, priceAdjust, absolutePrice, shippingChoice, customShippingCost, aprEnabled, aprStrategy, aprAmount, aprMinPrice, intervalPreset, customInterval, updatePriceOnUpdate };

    setIsSubmitting(true);
    try {
      const results = await Promise.allSettled(
        selectedAds.map((ad) => {
          const payload = buildBulkEditPayload(ad, opts);
          if (Object.keys(payload).length === 0) return Promise.resolve();
          return api.put(
            `/api/ads/by-file/${ad.file.split('/').map(encodeURIComponent).join('/')}`,
            payload,
          );
        }),
      );

      queryClient.invalidateQueries({ queryKey: ['ads'] });

      const failed = results.filter((r) => r.status === 'rejected').length;
      const saved = results.length - failed;

      if (failed === 0) {
        toast('success', `${saved} Anzeige${saved > 1 ? 'n' : ''} aktualisiert`);
        onClose();
      } else if (saved > 0) {
        toast('info', `${saved} von ${results.length} gespeichert – ${failed} Fehler`);
        onClose();
      } else {
        toast('error', 'Keine Anzeige konnte gespeichert werden');
      }
    } finally {
      setIsSubmitting(false);
    }
  }, [canSubmit, selectedAds, priceType, priceAdjust, absolutePrice, shippingChoice, customShippingCost, aprEnabled, aprStrategy, aprAmount, aprMinPrice, intervalPreset, customInterval, updatePriceOnUpdate, queryClient, toast, onClose]);

  const handleDeleteLive = useCallback(async () => {
    if (publishedAds.length === 0) return;
    const confirmed = await showConfirm(
      `${publishedAds.length} Anzeige${publishedAds.length !== 1 ? 'n' : ''} live löschen`,
      `Möchtest du ${publishedAds.length} Anzeige${publishedAds.length !== 1 ? 'n' : ''} dauerhaft auf Kleinanzeigen löschen? Diese Aktion kann nicht rückgängig gemacht werden.`,
      'Jetzt löschen',
      'Abbrechen',
    );
    if (!confirmed) return;
    setIsDeleting(true);
    try {
      const ids = publishedAds.map((a) => String(a.id)).join(',');
      await api.post('/api/bot/delete', { ads: ids });
      queryClient.invalidateQueries({ queryKey: ['ads'] });
      toast('success', `${publishedAds.length} Anzeige${publishedAds.length !== 1 ? 'n' : ''} gelöscht`);
      onClose();
      onClear?.();
    } catch (err) {
      toast('error', err instanceof Error ? err.message : 'Fehler beim Löschen');
    } finally {
      setIsDeleting(false);
    }
  }, [publishedAds, queryClient, toast, onClose, onClear]);

  const count = selectedAds.length;

  const priceBadge =
    priceType !== null || priceAdjust !== null || absolutePrice !== null
      ? [
          priceType === 'FIXED' ? 'Festpreis' : priceType === 'NEGOTIABLE' ? 'VB' : priceType === 'GIVE_AWAY' ? 'Gratis' : null,
          priceAdjust !== null ? `${priceAdjust > 0 ? '+' : ''}${priceAdjust}%` : null,
          absolutePrice !== null
            ? `${absolutePrice.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`
            : null,
        ]
          .filter(Boolean)
          .join(' · ')
      : undefined;

  const shippingBadge =
    shippingChoice !== null
      ? shippingChoice === 'CUSTOM'
        ? customShippingCost && parseFloat(customShippingCost) > 0
          ? `Individuell · ${parseFloat(customShippingCost).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`
          : 'Individuell'
        : ({ PICKUP: 'Abholung', S: 'Klein', M: 'Mittel', L: 'Groß' } as Record<string, string>)[shippingChoice]
      : undefined;

  const aprBadge =
    aprEnabled !== null || updatePriceOnUpdate !== null || aprStrategy !== null || aprAmount !== null || aprMinPrice !== null
      ? [
          aprEnabled !== null
            ? `${updatePriceOnUpdate === true ? '↻ ' : ''}${aprEnabled ? 'Aktiv' : 'Aus'}`
            : updatePriceOnUpdate !== null ? (updatePriceOnUpdate ? '↻' : '↻ Aus') : null,
          aprAmount !== null
            ? aprStrategy === 'PERCENTAGE'
              ? `${aprAmount}%`
              : aprStrategy === 'FIXED'
                ? `${aprAmount}€`
                : String(aprAmount)
            : aprStrategy !== null
              ? aprStrategy === 'PERCENTAGE' ? '%' : '€'
              : null,
          aprMinPrice !== null ? `↓ ${aprMinPrice}€` : null,
        ]
          .filter(Boolean)
          .join(' · ')
      : undefined;

  const intervalBadge =
    intervalPreset !== null
      ? intervalPreset === 'CUSTOM'
        ? parseInt(customInterval, 10) > 0
          ? `${customInterval} Tage`
          : 'Individuell'
        : `${intervalPreset} Tage`
      : undefined;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`${count} Anzeige${count > 1 ? 'n' : ''} bearbeiten`}
      footer={
        <>
          <Button variant="outline" size="sm" onClick={onClose} disabled={isSubmitting}>
            Abbrechen
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={handleApply}
            disabled={isSubmitting || !canSubmit}
          >
            {isSubmitting
              ? 'Wird gespeichert…'
              : `${count} Anzeige${count > 1 ? 'n' : ''} speichern`}
          </Button>
        </>
      }
    >
      <div className={styles.grid}>
        {/* Preis */}
        <Panel
          id="preis"
          isOpen={openPanels.has('preis')}
          onToggle={togglePanel}
          badge={priceBadge}
          icon={
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="1" x2="12" y2="23" />
              <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
            </svg>
          }
          title="Preis & Preistyp"
          desc="Festpreis, Anpassung oder Preistyp setzen"
        >
          {priceType !== 'GIVE_AWAY' && (
            <div>
              <div className={styles.sectionLabel}>Preisanpassung</div>
              <div className={styles.inputWrap} style={{ marginTop: 'var(--space-2)' }}>
                <label className={styles.inputLabel}>Preis (€)</label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  className={styles.customInput}
                  placeholder="z.B. 5.00"
                  value={absolutePriceInput}
                  onChange={(e) => {
                    const raw = e.target.value;
                    setAbsolutePriceInput(raw);
                    setPriceAdjust(null);
                    const parsed = parseFloat(raw);
                    setAbsolutePrice(!raw.trim() || isNaN(parsed) || parsed < 0 ? null : parsed);
                  }}
                />
              </div>
              <div className={styles.pillRow} style={{ marginTop: 'var(--space-2)' }}>
                {PRICE_ADJUSTMENTS.map((pct) => (
                  <Button
                    key={pct}
                    variant={priceAdjust === pct && absolutePrice === null ? 'primary' : 'outline'}
                    size="sm"
                    onClick={() => {
                      setAbsolutePriceInput('');
                      setAbsolutePrice(null);
                      setPriceAdjust((v) => (v === pct && absolutePrice === null ? null : pct));
                    }}
                  >
                    {pct > 0 ? `+${pct}%` : `${pct}%`}
                  </Button>
                ))}
              </div>
            </div>
          )}
          <div>
            <div className={styles.sectionLabel}>Preistyp</div>
            <div className={styles.optList} style={{ marginTop: 'var(--space-2)' }}>
              <OptionItem
                active={priceType === 'FIXED'}
                onClick={() => setPriceType((v) => (v === 'FIXED' ? null : 'FIXED'))}
                icon={
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="3" width="18" height="18" rx="2" />
                    <path d="M3 9h18" />
                  </svg>
                }
                title="Festpreis"
                desc="Kein Verhandlungsspielraum"
              />
              <OptionItem
                active={priceType === 'NEGOTIABLE'}
                onClick={() => setPriceType((v) => (v === 'NEGOTIABLE' ? null : 'NEGOTIABLE'))}
                icon={
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                  </svg>
                }
                title="Verhandlungsbasis"
                desc="Preis ist verhandelbar"
              />
              <OptionItem
                active={priceType === 'GIVE_AWAY'}
                onClick={() => {
                  const next = priceType === 'GIVE_AWAY' ? null : 'GIVE_AWAY';
                  if (next === 'GIVE_AWAY') {
                    setAbsolutePriceInput('');
                    setAbsolutePrice(null);
                    setPriceAdjust(null);
                  }
                  setPriceType(next);
                }}
                icon={
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 12 20 22 4 22 4 12" />
                    <rect x="2" y="7" width="20" height="5" />
                    <line x1="12" y1="22" x2="12" y2="7" />
                    <path d="M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7z" />
                    <path d="M12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z" />
                  </svg>
                }
                title="Zu verschenken"
                desc="Preis wird auf 0 € gesetzt"
              />
            </div>
          </div>
        </Panel>

        {/* Versandart & Preis */}
        <Panel
          id="versand"
          isOpen={openPanels.has('versand')}
          onToggle={togglePanel}
          badge={shippingBadge}
          icon={
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="1" y="3" width="15" height="13" />
              <polygon points="16 8 20 8 23 11 23 16 16 16 16 8" />
              <circle cx="5.5" cy="18.5" r="2.5" />
              <circle cx="18.5" cy="18.5" r="2.5" />
            </svg>
          }
          title="Versandart & Preis"
          desc="Abholung, Paketgröße oder eigene Kosten"
        >
          <div className={styles.optList}>
            <OptionItem
              active={shippingChoice === 'PICKUP'}
              onClick={() => setShippingChoice((v) => (v === 'PICKUP' ? null : 'PICKUP'))}
              icon={
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
                  <polyline points="9 22 9 12 15 12 15 22" />
                </svg>
              }
              title="Nur Abholung"
              desc="Kein Versand, nur persönliche Übergabe"
            />
            <OptionItem
              active={shippingChoice === 'S'}
              onClick={() => setShippingChoice((v) => (v === 'S' ? null : 'S'))}
              icon={
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="2" y="4" width="20" height="16" rx="2" />
                  <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
                </svg>
              }
              title="Klein (S)"
              desc={sizeDescOf('S')}
            />
            <OptionItem
              active={shippingChoice === 'M'}
              onClick={() => setShippingChoice((v) => (v === 'M' ? null : 'M'))}
              icon={
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M16.5 9.4 7.55 4.24" />
                  <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
                  <path d="M3.27 6.96 12 12.01l8.73-5.05" />
                  <line x1="12" y1="22.08" x2="12" y2="12" />
                </svg>
              }
              title="Mittel (M)"
              desc={sizeDescOf('M')}
            />
            <OptionItem
              active={shippingChoice === 'L'}
              onClick={() => setShippingChoice((v) => (v === 'L' ? null : 'L'))}
              icon={
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="2" y="7" width="20" height="14" rx="2" />
                  <path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2" />
                  <line x1="12" y1="12" x2="12" y2="17" />
                  <line x1="9.5" y1="14.5" x2="14.5" y2="14.5" />
                </svg>
              }
              title="Groß (L)"
              desc={sizeDescOf('L')}
            />
            <OptionItem
              active={shippingChoice === 'CUSTOM'}
              onClick={() => setShippingChoice((v) => (v === 'CUSTOM' ? null : 'CUSTOM'))}
              icon={
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="12" y1="1" x2="12" y2="23" />
                  <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
                </svg>
              }
              title="Individuell"
              desc="Eigener Versandpreis"
            />
          </div>
          {shippingChoice === 'CUSTOM' && (
            <div className={styles.inputWrap}>
              <label className={styles.inputLabel}>Versandkosten (€)</label>
              <input
                type="number"
                min="0"
                step="0.01"
                className={styles.customInput}
                placeholder="z.B. 5.99"
                value={customShippingCost}
                onChange={(e) => setCustomShippingCost(e.target.value)}
              />
            </div>
          )}
        </Panel>

        {/* APR */}
        <Panel
          id="apr"
          isOpen={openPanels.has('apr')}
          onToggle={togglePanel}
          badge={aprBadge}
          icon={
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="22 7 13.5 15.5 8.5 10.5 2 17" />
              <polyline points="16 7 22 7 22 13" />
            </svg>
          }
          title="Preisreduktion"
          desc="Preisanpassung konfigurieren"
        >
          <div
            role="button"
            tabIndex={0}
            className={[styles.optItem, aprEnabled === true && styles.optItemActive].filter(Boolean).join(' ')}
            onClick={() => {
              const next = aprEnabled === true ? false : true;
              setAprEnabled(next);
              if (next === false) {
                setUpdatePriceOnUpdate(null);
                setAprStrategy(null);
                setAprAmountInput('');
                setAprAmount(null);
                setAprMinPriceInput('');
                setAprMinPrice(null);
              }
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                const next = aprEnabled === true ? false : true;
                setAprEnabled(next);
                if (next === false) {
                  setUpdatePriceOnUpdate(null);
                  setAprStrategy(null);
                  setAprAmountInput('');
                  setAprAmount(null);
                  setAprMinPriceInput('');
                  setAprMinPrice(null);
                }
              }
            }}
          >
            <span className={styles.optItemIcon}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="22 7 13.5 15.5 8.5 10.5 2 17" />
                <polyline points="16 7 22 7 22 13" />
              </svg>
            </span>
            <div className={styles.optItemText}>
              <div className={styles.optItemTitle}>APR aktivieren</div>
              <div className={styles.optItemDesc}>Bestehende APR-Einstellungen bleiben erhalten</div>
            </div>
            <span onClick={(e) => e.stopPropagation()}>
              <Toggle
                checked={aprEnabled === true}
                onChange={(checked) => {
                  setAprEnabled(checked);
                  if (!checked) {
                    setUpdatePriceOnUpdate(null);
                    setAprStrategy(null);
                    setAprAmountInput('');
                    setAprAmount(null);
                    setAprMinPriceInput('');
                    setAprMinPrice(null);
                  }
                }}
              />
            </span>
          </div>
          {aprEnabled === true && (
          <>
            <div>
              <div className={styles.sectionLabel}>Strategie</div>
              <div className={styles.aprStrategyRow}>
                <Button
                  variant={aprStrategy === 'PERCENTAGE' ? 'primary' : 'outline'}
                  size="sm"
                  onClick={() => setAprStrategy((v) => (v === 'PERCENTAGE' ? null : 'PERCENTAGE'))}
                >
                  % Prozent
                </Button>
                <Button
                  variant={aprStrategy === 'FIXED' ? 'primary' : 'outline'}
                  size="sm"
                  onClick={() => setAprStrategy((v) => (v === 'FIXED' ? null : 'FIXED'))}
                >
                  € Betrag
                </Button>
              </div>
            </div>
            <div className={styles.aprAmountRow}>
              <div className={styles.inputWrap}>
                <label className={styles.inputLabel}>
                  Reduktion{aprStrategy === 'PERCENTAGE' ? ' (%)' : aprStrategy === 'FIXED' ? ' (€)' : ''}
                </label>
                <input
                  type="number"
                  min="0.01"
                  step="0.01"
                  className={styles.customInput}
                  placeholder="z.B. 5"
                  value={aprAmountInput}
                  onChange={(e) => {
                    const raw = e.target.value;
                    setAprAmountInput(raw);
                    const parsed = parseFloat(raw);
                    setAprAmount(!raw.trim() || isNaN(parsed) || parsed <= 0 ? null : parsed);
                  }}
                />
              </div>
              <div className={styles.inputWrap}>
                <label className={styles.inputLabel}>Mindestpreis (€)</label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  className={styles.customInput}
                  placeholder="z.B. 20.00"
                  value={aprMinPriceInput}
                  onChange={(e) => {
                    const raw = e.target.value;
                    setAprMinPriceInput(raw);
                    const parsed = parseFloat(raw);
                    setAprMinPrice(!raw.trim() || isNaN(parsed) || parsed < 0 ? null : parsed);
                  }}
                />
              </div>
            </div>
          </>
          )}
          {aprEnabled === true && (
          <div
            role="button"
            tabIndex={0}
            className={[styles.optItem, updatePriceOnUpdate === true && styles.optItemActive].filter(Boolean).join(' ')}
            onClick={() => setUpdatePriceOnUpdate((v) => (v === true ? false : true))}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                setUpdatePriceOnUpdate((v) => (v === true ? false : true));
              }
            }}
          >
            <span className={styles.optItemIcon}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 2v6h-6" />
                <path d="M3 12a9 9 0 0 1 15-6.7L21 8" />
                <path d="M3 22v-6h6" />
                <path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
              </svg>
            </span>
            <div className={styles.optItemText}>
              <div className={styles.optItemTitle}>Preisanpassung beim Update</div>
              <div className={styles.optItemDesc}>Preis wird bei jedem Update angepasst</div>
            </div>
            <span onClick={(e) => e.stopPropagation()}>
              <Toggle
                checked={updatePriceOnUpdate === true}
                onChange={(checked) => setUpdatePriceOnUpdate(checked)}
              />
            </span>
          </div>
          )}
        </Panel>

        {/* Intervall */}
        <Panel
          id="intervall"
          isOpen={openPanels.has('intervall')}
          onToggle={togglePanel}
          badge={intervalBadge}
          icon={
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <polyline points="12 6 12 12 16 14" />
            </svg>
          }
          title="Republication-Intervall"
          desc="Automatisches Intervall in Tagen"
        >
          <div className={styles.optList}>
            <OptionItem
              active={intervalPreset === 7}
              onClick={() => setIntervalPreset((v) => (v === 7 ? null : 7))}
              icon={
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
                </svg>
              }
              title="7 Tage"
              desc="Wöchentlich · empfohlen für aktive Verkäufer"
            />
            <OptionItem
              active={intervalPreset === 14}
              onClick={() => setIntervalPreset((v) => (v === 14 ? null : 14))}
              icon={
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="23 4 23 10 17 10" />
                  <polyline points="1 20 1 14 7 14" />
                  <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
                </svg>
              }
              title="14 Tage"
              desc="Zweiwöchentlich · ausgewogener Rhythmus"
            />
            <OptionItem
              active={intervalPreset === 21}
              onClick={() => setIntervalPreset((v) => (v === 21 ? null : 21))}
              icon={
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                  <line x1="16" y1="2" x2="16" y2="6" />
                  <line x1="8" y1="2" x2="8" y2="6" />
                  <line x1="3" y1="10" x2="21" y2="10" />
                </svg>
              }
              title="21 Tage"
              desc="Alle drei Wochen · moderater Rhythmus"
            />
            <OptionItem
              active={intervalPreset === 28}
              onClick={() => setIntervalPreset((v) => (v === 28 ? null : 28))}
              icon={
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                  <line x1="16" y1="2" x2="16" y2="6" />
                  <line x1="8" y1="2" x2="8" y2="6" />
                  <line x1="3" y1="10" x2="21" y2="10" />
                  <path d="M8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01M16 18h.01" strokeWidth="2.5" strokeLinecap="round" />
                </svg>
              }
              title="28 Tage"
              desc="Monatlich · für wenig Aktivität geeignet"
            />
            <OptionItem
              active={intervalPreset === 'CUSTOM'}
              onClick={() => setIntervalPreset((v) => (v === 'CUSTOM' ? null : 'CUSTOM'))}
              icon={
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="4" y1="21" x2="4" y2="14" />
                  <line x1="4" y1="10" x2="4" y2="3" />
                  <line x1="12" y1="21" x2="12" y2="12" />
                  <line x1="12" y1="8" x2="12" y2="3" />
                  <line x1="20" y1="21" x2="20" y2="16" />
                  <line x1="20" y1="12" x2="20" y2="3" />
                  <line x1="1" y1="14" x2="7" y2="14" />
                  <line x1="9" y1="8" x2="15" y2="8" />
                  <line x1="17" y1="16" x2="23" y2="16" />
                </svg>
              }
              title="Individuell"
              desc="Eigenes Intervall in Tagen festlegen"
            />
          </div>
          {intervalPreset === 'CUSTOM' && (
            <div className={styles.inputWrap}>
              <label className={styles.inputLabel}>Intervall in Tagen</label>
              <input
                type="number"
                min="1"
                step="1"
                className={styles.customInput}
                placeholder="z.B. 10"
                value={customInterval}
                onChange={(e) => setCustomInterval(e.target.value)}
              />
            </div>
          )}
        </Panel>

        {/* Danger Zone */}
        <Panel
          id="loeschen"
          isOpen={openPanels.has('loeschen')}
          onToggle={togglePanel}
          danger
          icon={
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="3 6 5 6 21 6" />
              <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
              <path d="M10 11v6M14 11v6" />
              <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
            </svg>
          }
          title="Danger Zone"
          desc="Anzeigen dauerhaft auf Kleinanzeigen löschen"
        >
          {publishedAds.length > 0 ? (
            <>
              <p className={styles.dangerZoneDesc}>
                {publishedAds.length} Anzeige{publishedAds.length !== 1 ? 'n' : ''} mit Kleinanzeigen-ID werden unwiderruflich gelöscht.
              </p>
              <Button variant="danger" size="sm" onClick={handleDeleteLive} disabled={isDeleting}>
                {isDeleting ? 'Wird gelöscht…' : `${publishedAds.length} Anzeigen bei Kleinanzeigen löschen`}
              </Button>
            </>
          ) : (
            <p className={styles.dangerZoneDesc}>
              Keine veröffentlichten Anzeigen in der Auswahl.
            </p>
          )}
        </Panel>

      </div>
    </Modal>
  );
}
