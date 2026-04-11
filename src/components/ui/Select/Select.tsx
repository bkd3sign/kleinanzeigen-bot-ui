import { forwardRef, useId, type SelectHTMLAttributes, type ReactNode } from 'react';
import styles from './Select.module.scss';

interface SelectOption {
  value: string;
  label: string;
}

interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'children'> {
  label?: ReactNode;
  error?: string;
  hint?: string;
  required?: boolean;
  options: SelectOption[];
  placeholder?: string;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  (
    { label, error, hint, required, options, placeholder, className, id: externalId, ...rest },
    ref,
  ) => {
    const internalId = useId();
    const selectId = externalId ?? internalId;

    const labelClasses = [styles.formLabel, required && styles.formLabelRequired]
      .filter(Boolean)
      .join(' ');

    const selectClasses = [styles.formSelect, error && styles.formSelectError, className]
      .filter(Boolean)
      .join(' ');

    return (
      <div className={styles.formGroup}>
        {label && (
          <label htmlFor={selectId} className={labelClasses}>
            {label}
          </label>
        )}
        <select
          ref={ref}
          id={selectId}
          className={selectClasses}
          aria-invalid={!!error}
          aria-describedby={error ? `${selectId}-error` : hint ? `${selectId}-hint` : undefined}
          required={required}
          {...rest}
        >
          {placeholder && (
            <option value="" disabled>
              {placeholder}
            </option>
          )}
          {options.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        {error && (
          <span id={`${selectId}-error`} className={styles.formError} role="alert">
            {error}
          </span>
        )}
        {hint && !error && (
          <span id={`${selectId}-hint`} className={styles.formHint}>
            {hint}
          </span>
        )}
      </div>
    );
  },
);

Select.displayName = 'Select';
