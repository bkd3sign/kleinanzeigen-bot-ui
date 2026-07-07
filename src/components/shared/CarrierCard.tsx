'use client';

import styles from './CarrierCard.module.scss';

interface CarrierCardProps {
  name: string;
  detail: string;
  tracking: string;
  price: string;
  checked: boolean;
  onToggle: () => void;
}

/**
 * Selectable shipping-carrier card (checkbox + name/detail/tracking/price).
 * Shared between the ad form's ShippingPicker and the global settings exclusion
 * picker — `checked` means "selected" or "excluded" depending on context.
 */
export function CarrierCard({ name, detail, tracking, price, checked, onToggle }: CarrierCardProps) {
  return (
    <label className={`${styles.carrierCard} ${checked ? styles.carrierCardSelected : ''}`}>
      <input
        type="checkbox"
        className={styles.carrierCheckbox}
        checked={checked}
        onChange={onToggle}
      />
      <span className={`${styles.carrierCheck} ${checked ? styles.carrierCheckActive : ''}`}>
        {checked ? '✓' : ''}
      </span>
      <div className={styles.carrierInfo}>
        <div className={styles.carrierName}>{name}</div>
        <div className={styles.carrierDetail}>{detail}</div>
        <div className={styles.carrierTracking}>{tracking}</div>
      </div>
      <div className={styles.carrierPrice}>{price}</div>
    </label>
  );
}
