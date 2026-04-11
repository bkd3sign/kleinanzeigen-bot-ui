import { useId, type ChangeEvent, type ReactElement, type ReactNode } from 'react';
import styles from './Toggle.module.scss';

interface ToggleProps {
  label?: ReactNode;
  checked?: boolean;
  onChange?: (checked: boolean) => void;
  disabled?: boolean;
  id?: string;
}

export function Toggle({
  label,
  checked = false,
  onChange,
  disabled = false,
  id: externalId,
}: ToggleProps): ReactElement {
  const internalId = useId();
  const toggleId = externalId ?? internalId;

  function handleChange(e: ChangeEvent<HTMLInputElement>): void {
    onChange?.(e.target.checked);
  }

  const wrapperClasses = [styles.toggle, disabled && styles.toggleDisabled]
    .filter(Boolean)
    .join(' ');

  const trackClasses = [styles.toggleTrack, checked && styles.toggleTrackChecked]
    .filter(Boolean)
    .join(' ');

  const thumbClasses = [styles.toggleThumb, checked && styles.toggleThumbChecked]
    .filter(Boolean)
    .join(' ');

  return (
    <label htmlFor={toggleId} className={wrapperClasses}>
      {label && <span className={styles.toggleLabel}>{label}</span>}
      <input
        id={toggleId}
        type="checkbox"
        className={styles.toggleInput}
        checked={checked}
        onChange={handleChange}
        disabled={disabled}
        role="switch"
        aria-checked={checked}
      />
      <span className={trackClasses}>
        <span className={thumbClasses} />
      </span>
    </label>
  );
}
