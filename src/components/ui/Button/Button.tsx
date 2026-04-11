import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import styles from './Button.module.scss';

export type ButtonVariant = 'default' | 'primary' | 'secondary' | 'danger' | 'warning' | 'ghost' | 'outline';
export type ButtonSize = 'default' | 'sm' | 'lg' | 'icon';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  children?: ReactNode;
}

const variantClass: Record<ButtonVariant, string | undefined> = {
  default: undefined,
  primary: styles.btnPrimary,
  secondary: styles.btnOutline,
  danger: styles.btnDanger,
  warning: styles.btnWarning,
  ghost: styles.btnGhost,
  outline: styles.btnOutline,
};

const sizeClass: Record<ButtonSize, string | undefined> = {
  default: undefined,
  sm: styles.btnSm,
  lg: styles.btnLg,
  icon: styles.btnIcon,
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      variant = 'default',
      size = 'default',
      loading = false,
      disabled,
      className,
      children,
      type = 'button',
      ...rest
    },
    ref,
  ) => {
    const classes = [
      styles.btn,
      variantClass[variant],
      sizeClass[size],
      className,
    ]
      .filter(Boolean)
      .join(' ');

    return (
      <button
        ref={ref}
        type={type}
        className={classes}
        disabled={disabled || loading}
        {...rest}
      >
        {loading && <span className={styles.spinner} aria-hidden="true" />}
        {children}
      </button>
    );
  },
);

Button.displayName = 'Button';
