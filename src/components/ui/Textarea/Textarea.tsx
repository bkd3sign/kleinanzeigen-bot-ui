import { forwardRef, useId, type TextareaHTMLAttributes, type ReactNode } from 'react';
import styles from './Textarea.module.scss';

interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: ReactNode;
  error?: string;
  hint?: string;
  required?: boolean;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ label, error, hint, required, className, id: externalId, ...rest }, ref) => {
    const internalId = useId();
    const textareaId = externalId ?? internalId;

    const labelClasses = [styles.formLabel, required && styles.formLabelRequired]
      .filter(Boolean)
      .join(' ');

    const textareaClasses = [
      styles.formTextarea,
      error && styles.formTextareaError,
      className,
    ]
      .filter(Boolean)
      .join(' ');

    return (
      <div className={styles.formGroup}>
        {label && (
          <label htmlFor={textareaId} className={labelClasses}>
            {label}
          </label>
        )}
        <textarea
          ref={ref}
          id={textareaId}
          className={textareaClasses}
          aria-invalid={!!error}
          aria-describedby={
            error ? `${textareaId}-error` : hint ? `${textareaId}-hint` : undefined
          }
          required={required}
          {...rest}
        />
        {error && (
          <span id={`${textareaId}-error`} className={styles.formError} role="alert">
            {error}
          </span>
        )}
        {hint && !error && (
          <span id={`${textareaId}-hint`} className={styles.formHint}>
            {hint}
          </span>
        )}
      </div>
    );
  },
);

Textarea.displayName = 'Textarea';
