'use client';

import { useCallback, useEffect } from 'react';
import { Toggle } from '@/components/ui';
import { InfoTip } from './InfoTip';
import { SHIPPING_SIZES, allCarriersOf, cheapestPriceOf, detectSizeGroup, type ShippingSizeId } from '@/lib/shipping';
import styles from './AdForm.module.scss';

export type ShippingMode = ShippingSizeId | 'INDIVIDUAL' | null;

/** Detect the initial shipping mode from existing form data. */
export function detectInitialMode(options: string[], costs: number | null | undefined): ShippingMode {
  const sizeGroup = detectSizeGroup(options);
  if (sizeGroup) return sizeGroup;
  if (costs != null && costs > 0) return 'INDIVIDUAL';
  return null;
}

interface ShippingPickerProps {
  selectedOptions: string[];
  onChange: (options: string[]) => void;
  sellDirectly: boolean;
  onSellDirectlyChange: (value: boolean) => void;
  shippingCosts: number | null | undefined;
  onShippingCostsChange: (value: number | null) => void;
  /** Controlled active mode — parent owns the state */
  activeMode: ShippingMode;
  onModeChange: (mode: ShippingMode) => void;
  /** Pre-select this size group on mount (used when AI sets shipping_size but no options yet) */
  defaultSizeGroup?: string;
}

export function ShippingPicker({
  selectedOptions,
  onChange,
  sellDirectly,
  onSellDirectlyChange,
  shippingCosts,
  onShippingCostsChange,
  activeMode,
  onModeChange,
  defaultSizeGroup,
}: ShippingPickerProps) {

  // When a defaultSizeGroup is provided but no options are selected yet, pre-select all on mount
  useEffect(() => {
    if (defaultSizeGroup && selectedOptions.length === 0) {
      const sizeId = defaultSizeGroup as ShippingSizeId;
      if (SHIPPING_SIZES.some((s) => s.id === sizeId)) {
        onChange(allCarriersOf(sizeId));
        onShippingCostsChange(cheapestPriceOf(sizeId));
      }
    }
    // Mount-only: sync initial shipping options from form state
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSizeClick = useCallback((sizeId: ShippingSizeId) => {
    if (activeMode === sizeId) {
      onModeChange(null);
      onChange([]);
      onShippingCostsChange(null);
    } else {
      onModeChange(sizeId);
      onChange(allCarriersOf(sizeId));
      onShippingCostsChange(cheapestPriceOf(sizeId));
    }
  }, [activeMode, onChange, onShippingCostsChange, onModeChange]);

  const handleIndividualClick = useCallback(() => {
    if (activeMode === 'INDIVIDUAL') {
      onModeChange(null);
      onShippingCostsChange(null);
    } else {
      onModeChange('INDIVIDUAL');
      onChange([]);
      onShippingCostsChange(null);
    }
  }, [activeMode, onChange, onShippingCostsChange, onModeChange]);

  const handleCarrierToggle = useCallback((carrierValue: string) => {
    const isSelected = selectedOptions.includes(carrierValue);
    if (isSelected) {
      onChange(selectedOptions.filter((o) => o !== carrierValue));
    } else {
      onChange([...selectedOptions, carrierValue]);
    }
  }, [selectedOptions, onChange]);

  const activeSize = activeMode !== 'INDIVIDUAL' && activeMode !== null
    ? SHIPPING_SIZES.find((s) => s.id === activeMode)
    : null;

  return (
    <div>
      <label className="formLabel">Versandoption wählen</label>

      {/* Size cards (S / M / L / Individuell) */}
      <div className={styles.shippingSizeCards}>
        {SHIPPING_SIZES.map((size) => (
          <button
            key={size.id}
            type="button"
            className={`${styles.shippingSizeCard} ${activeMode === size.id ? styles.shippingSizeCardActive : ''}`}
            onClick={() => handleSizeClick(size.id)}
          >
            <div className={styles.shippingSizeCardLabel}>{size.label}</div>
            <div className={styles.shippingSizeCardExample}>{size.example}</div>
          </button>
        ))}
        <button
          type="button"
          className={`${styles.shippingSizeCard} ${activeMode === 'INDIVIDUAL' ? styles.shippingSizeCardActive : ''}`}
          onClick={handleIndividualClick}
        >
          <div className={styles.shippingSizeCardLabel}>Individuell</div>
          <div className={styles.shippingSizeCardExample}>Eigener Versandpreis</div>
        </button>
      </div>

      {/* Carrier options for selected size */}
      {activeSize && (
        <div className={styles.carrierPanel}>
          <div className={styles.carrierPanelLabel}>Optionen mit Sendungsverfolgung</div>
          {activeSize.carriers.map((carrier) => {
            const isSelected = selectedOptions.includes(carrier.value);
            return (
              <label
                key={carrier.value}
                className={`${styles.carrierCard} ${isSelected ? styles.carrierCardSelected : ''}`}
              >
                <input
                  type="checkbox"
                  className={styles.carrierCheckbox}
                  checked={isSelected}
                  onChange={() => handleCarrierToggle(carrier.value)}
                />
                <span className={`${styles.carrierCheck} ${isSelected ? styles.carrierCheckActive : ''}`}>
                  {isSelected ? '✓' : ''}
                </span>
                <div className={styles.carrierInfo}>
                  <div className={styles.carrierName}>{carrier.name}</div>
                  <div className={styles.carrierDetail}>{carrier.detail}</div>
                  <div className={styles.carrierTracking}>{carrier.tracking}</div>
                </div>
                <div className={styles.carrierPrice}>{carrier.price}</div>
              </label>
            );
          })}
        </div>
      )}

      {/* Sell directly toggle */}
      <div style={{ marginTop: 'var(--space-4)' }}>
        <Toggle
          label={<>Direkt verkaufen <InfoTip text='Nur bei Versandart "Versand" möglich' /></>}
          checked={sellDirectly}
          onChange={onSellDirectlyChange}
        />
      </div>
    </div>
  );
}
