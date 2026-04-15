'use client';

import { useState, useRef, useCallback, useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import styles from './AdForm.module.scss';

/**
 * Small (i) info icon with portal-based tooltip on hover/click.
 * Uses position: fixed via portal to avoid overflow clipping and z-index issues.
 * Clamps to viewport edges so text is never cut off on mobile.
 */
export function InfoTip({ text }: { text: string }) {
  const [show, setShow] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const iconRef = useRef<HTMLSpanElement>(null);
  const tipRef = useRef<HTMLSpanElement>(null);

  const updatePos = useCallback(() => {
    if (!iconRef.current) return;
    const rect = iconRef.current.getBoundingClientRect();
    setPos({
      top: rect.top - 6,
      left: rect.left + rect.width / 2,
    });
  }, []);

  // Clamp tooltip to viewport after render
  useEffect(() => {
    if (!show || !tipRef.current || !pos) return;
    const tip = tipRef.current;
    const tipRect = tip.getBoundingClientRect();
    const pad = 8;

    let adjustedLeft = pos.left;
    if (tipRect.left < pad) {
      adjustedLeft = pos.left + (pad - tipRect.left);
    } else if (tipRect.right > window.innerWidth - pad) {
      adjustedLeft = pos.left - (tipRect.right - window.innerWidth + pad);
    }

    if (adjustedLeft !== pos.left) {
      setPos(prev => prev ? { ...prev, left: adjustedLeft } : prev);
    }
  }, [show, pos]);

  const open = () => { updatePos(); setShow(true); };
  const close = () => setShow(false);

  return (
    <span
      ref={iconRef}
      className={styles.infoTip}
      onClick={(e) => { e.preventDefault(); e.stopPropagation(); show ? close() : open(); }}
      onMouseEnter={open}
      onMouseLeave={close}
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" />
        <line x1="12" y1="16" x2="12" y2="12" />
        <line x1="12" y1="8" x2="12.01" y2="8" />
      </svg>
      {show && pos && createPortal(
        <span
          ref={tipRef}
          className={styles.infoTipText}
          style={{ top: pos.top, left: pos.left }}
        >
          {text}
        </span>,
        document.body,
      )}
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
