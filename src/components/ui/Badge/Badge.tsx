import type { ReactNode, ReactElement } from 'react';
import styles from './Badge.module.scss';

export type BadgeVariant = 'default' | 'primary' | 'success' | 'danger' | 'warning' | 'muted' | 'info' | 'running';

interface BadgeProps {
  variant?: BadgeVariant;
  children: ReactNode;
  className?: string;
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
};

export function Badge({
  variant = 'default',
  children,
  className,
}: BadgeProps): ReactElement {
  const classes = [styles.badge, variantClass[variant], className]
    .filter(Boolean)
    .join(' ');

  return <span className={classes}>{children}</span>;
}
