'use client';

import { useState, useRef, useEffect, type ReactNode } from 'react';
import styles from './AdForm.module.scss';

/**
 * Small (i) info icon with tooltip on hover/click.
 * Matches the legacy data-tooltip pattern.
 */
export function InfoTip({ text }: { text: string }) {
  const [show, setShow] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!show) return;
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setShow(false);
      }
    };
    document.addEventListener('click', close, true);
    return () => document.removeEventListener('click', close, true);
  }, [show]);

  return (
    <span
      ref={ref}
      className={styles.infoTip}
      onClick={(e) => { e.preventDefault(); e.stopPropagation(); setShow(!show); }}
      onMouseEnter={() => setShow(true)}
      onMouseLeave={() => setShow(false)}
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" />
        <line x1="12" y1="16" x2="12" y2="12" />
        <line x1="12" y1="8" x2="12.01" y2="8" />
      </svg>
      {show && <span className={styles.infoTipText}>{text}</span>}
    </span>
  );
}

/**
 * Small badge shown next to field labels when the field is locked by a template.
 */
export function LockedBadge() {
  return (
    <span className={styles.lockedFieldBadge}>
      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
        <path d="M7 11V7a5 5 0 0 1 10 0v4" />
      </svg>
      gesperrt
    </span>
  );
}

/**
 * Helper to wrap a label with a LockedBadge if locked.
 */
export function withLocked(label: ReactNode, locked?: boolean): ReactNode {
  if (!locked) return label;
  return <>{label} <LockedBadge /></>;
}
