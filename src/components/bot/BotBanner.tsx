import type { ReactNode } from 'react';
import styles from './BotBanner.module.scss';

// Default warning icon — lock shape matches the MFA use-case; triangle suits login-required
const DefaultIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
    <line x1="12" y1="9" x2="12" y2="13" />
    <line x1="12" y1="17" x2="12.01" y2="17" />
  </svg>
);

interface BotBannerProps {
  /** Custom icon to replace the default warning triangle */
  icon?: ReactNode;
  /** Bold heading line */
  title: ReactNode;
  /** Smaller description below the title */
  description?: ReactNode;
  /** Action area (buttons, inputs) rendered below the description */
  children?: ReactNode;
}

/**
 * Presentational warning-banner shell shared by MfaCodeInput and the
 * login-required banner in JobOutputModal. Handles layout only — all
 * behavior lives in the caller.
 */
export function BotBanner({ icon, title, description, children }: BotBannerProps) {
  return (
    <div className={styles.banner}>
      <div className={styles.icon}>
        {icon ?? <DefaultIcon />}
      </div>
      <div className={styles.content}>
        <div className={styles.title}>{title}</div>
        {description && <div className={styles.desc}>{description}</div>}
        {children}
      </div>
    </div>
  );
}
