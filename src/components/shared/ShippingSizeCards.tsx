'use client';

import styles from './ShippingSizeCards.module.scss';

export interface SizeCardOption {
  id: string;
  label: string;
  example: string;
}

interface ShippingSizeCardsProps {
  options: SizeCardOption[];
  activeId: string | null;
  onSelect: (id: string) => void;
}

/**
 * Row of selectable shipping-size cards (S / M / L, optionally "Individuell").
 * Shared between the ad form's ShippingPicker and the global settings exclusion
 * picker so both look identical.
 */
export function ShippingSizeCards({ options, activeId, onSelect }: ShippingSizeCardsProps) {
  return (
    <div
      className={styles.shippingSizeCards}
      style={{ '--size-card-cols': options.length } as React.CSSProperties}
    >
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          className={`${styles.shippingSizeCard} ${activeId === o.id ? styles.shippingSizeCardActive : ''}`}
          onClick={() => onSelect(o.id)}
        >
          <div className={styles.shippingSizeCardLabel}>{o.label}</div>
          <div className={styles.shippingSizeCardExample}>{o.example}</div>
        </button>
      ))}
    </div>
  );
}
