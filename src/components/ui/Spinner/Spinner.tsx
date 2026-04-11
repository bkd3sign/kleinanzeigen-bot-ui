import type { ReactElement } from 'react';
import styles from './Spinner.module.scss';

export type SpinnerSize = 'sm' | 'md' | 'default' | 'lg';

interface SpinnerProps {
  size?: SpinnerSize;
  className?: string;
}

const sizeClass: Record<SpinnerSize, string> = {
  sm: styles.spinnerSm,
  md: styles.spinnerDefault,
  default: styles.spinnerDefault,
  lg: styles.spinnerLg,
};

export function Spinner({ size = 'default', className }: SpinnerProps): ReactElement {
  const classes = [styles.spinner, sizeClass[size], className]
    .filter(Boolean)
    .join(' ');

  return <span className={classes} role="status" aria-label="Loading" />;
}
