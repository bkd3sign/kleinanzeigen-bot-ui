import { forwardRef, useId, type InputHTMLAttributes, type ReactNode } from 'react';
import styles from './Input.module.scss';

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: ReactNode;
  error?: string;
  hint?: string;
  required?: boolean;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, hint, required, className, id: externalId, ...rest }, ref) => {
    const internalId = useId();
    const inputId = externalId ?? internalId;

    const labelClasses = [styles.formLabel, required && styles.formLabelRequired]
      .filter(Boolean)
      .join(' ');

    const inputClasses = [styles.formInput, error && styles.formInputError, className]
      .filter(Boolean)
      .join(' ');

    return (
      <div className={styles.formGroup}>
        {label && (
          <label htmlFor={inputId} className={labelClasses}>
            {label}
          </label>
        )}
        <input
          ref={ref}
          id={inputId}
          className={inputClasses}
          aria-invalid={!!error}
          aria-describedby={error ? `${inputId}-error` : hint ? `${inputId}-hint` : undefined}
          required={required}
          {...rest}
        />
        {error && (
          <span id={`${inputId}-error`} className={styles.formError} role="alert">
            {error}
          </span>
        )}
        {hint && !error && (
          <span id={`${inputId}-hint`} className={styles.formHint}>
            {hint}
          </span>
        )}
      </div>
    );
  },
);

Input.displayName = 'Input';
