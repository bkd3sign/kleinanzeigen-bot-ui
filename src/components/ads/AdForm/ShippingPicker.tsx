'use client';

import { useCallback, useEffect } from 'react';
import { Toggle } from '@/components/ui';
import { CarrierCard } from '@/components/shared/CarrierCard';
import { ShippingSizeCards } from '@/components/shared/ShippingSizeCards';
import { InfoTip } from './InfoTip';
import { SHIPPING_SIZES, allCarriersOf, detectSizeGroup, type ShippingSizeId } from '@/lib/shipping';
import styles from './AdForm.module.scss';

export type ShippingMode = ShippingSizeId | null;

interface ShippingPickerProps {
  selectedOptions: string[];
  onChange: (options: string[]) => void;
  sellDirectly: boolean;
  onSellDirectlyChange: (value: boolean) => void;
  /** Disable the direct-buy toggle when the current ad does not meet the bot's constraints */
  sellDirectlyDisabled: boolean;
  /** Reason shown below the toggle when direct-buy is not available */
  sellDirectlyHint: string;
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
  sellDirectlyDisabled,
  sellDirectlyHint,
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
      }
    }
    // Mount-only: sync initial shipping options from form state
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSizeClick = useCallback((sizeId: ShippingSizeId) => {
    if (activeMode === sizeId) {
      onModeChange(null);
      onChange([]);
    } else {
      onModeChange(sizeId);
      onChange(allCarriersOf(sizeId));
    }
  }, [activeMode, onChange, onModeChange]);

  const handleCarrierToggle = useCallback((carrierValue: string) => {
    const isSelected = selectedOptions.includes(carrierValue);
    if (isSelected) {
      onChange(selectedOptions.filter((o) => o !== carrierValue));
    } else {
      onChange([...selectedOptions, carrierValue]);
    }
  }, [selectedOptions, onChange]);

  const activeSize = activeMode !== null ? SHIPPING_SIZES.find((s) => s.id === activeMode) : null;

  return (
    <div>
      <label className="formLabel">Versandoption wählen</label>

      {/* Size cards (S / M / L) */}
      <ShippingSizeCards
        options={SHIPPING_SIZES.map((s) => ({ id: s.id, label: s.label, example: s.example }))}
        activeId={activeMode}
        onSelect={(id) => handleSizeClick(id as ShippingSizeId)}
      />

      {/* Carrier options for selected size */}
      {activeSize && (
        <div className={styles.carrierPanel}>
          <div className={styles.carrierPanelLabel}>Optionen mit Sendungsverfolgung</div>
          {activeSize.carriers.map((carrier) => (
            <CarrierCard
              key={carrier.value}
              name={carrier.name}
              detail={carrier.detail}
              tracking={carrier.tracking}
              price={carrier.price}
              checked={selectedOptions.includes(carrier.value)}
              onToggle={() => handleCarrierToggle(carrier.value)}
            />
          ))}
        </div>
      )}

      {/* Sell directly toggle */}
      <div className={styles.sellDirectlyRow}>
        <Toggle
          label={<>Direkt verkaufen <InfoTip text="Käufer können den Artikel ohne vorherige Nachricht direkt kaufen und bezahlen." /></>}
          checked={sellDirectly}
          onChange={onSellDirectlyChange}
          disabled={sellDirectlyDisabled}
        />
        {sellDirectlyDisabled && sellDirectlyHint && (
          <p className={styles.sellDirectlyHint}>Tipp: {sellDirectlyHint}</p>
        )}
      </div>
    </div>
  );
}
