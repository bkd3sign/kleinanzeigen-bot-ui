import type { ReactNode, ReactElement } from 'react';
import styles from './Badge.module.scss';

export type BadgeVariant = 'default' | 'primary' | 'success' | 'danger' | 'warning' | 'muted' | 'info' | 'running' | 'reserved';

interface BadgeProps {
  variant?: BadgeVariant;
  children: ReactNode;
  className?: string;
  title?: string;
}

const variantClass: Record<BadgeVariant, string | undefined> = {
  default: undefined,
  primary: styles.badgeInfo,
  success: styles.badgeSuccess,
  danger: styles.badgeDanger,
  warning: styles.badgeWarning,
  muted: styles.badgeMuted,
  info: styles.badgeInfo,
  running: styles.badgeRunning,
  reserved: styles.badgeReserved,
};

export function Badge({
  variant = 'default',
  children,
  className,
  title,
}: BadgeProps): ReactElement {
  const classes = [styles.badge, variantClass[variant], className]
    .filter(Boolean)
    .join(' ');

  return <span className={classes} title={title}>{children}</span>;
}
