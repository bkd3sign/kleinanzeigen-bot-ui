import type { ReactNode } from 'react';
import styles from './Section.module.scss';

/**
 * Collapsible settings section with a title, description and chevron toggle.
 * Shared between the Account and Settings pages.
 */
export function Section({
  title,
  desc,
  open,
  onToggle,
  children,
}: {
  title: string;
  desc?: string;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <div className={styles.section}>
      <button type="button" className={styles.sectionHeader} onClick={onToggle}>
        <div className={styles.sectionTitleCol}>
          <span className={styles.sectionTitle}>{title}</span>
          {desc && <span className={styles.sectionDesc}>{desc}</span>}
        </div>
        <span className={`${styles.sectionChevron} ${!open ? styles.sectionChevronCollapsed : ''}`}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="6 9 12 15 18 9" /></svg>
        </span>
      </button>
      <div className={`${styles.sectionBodyWrap} ${!open ? styles.sectionBodyWrapCollapsed : ''}`}>
        <div className={styles.sectionBody}>{children}</div>
      </div>
    </div>
  );
}
