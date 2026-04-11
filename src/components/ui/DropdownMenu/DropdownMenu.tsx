'use client';

import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import styles from './DropdownMenu.module.scss';

export interface DropdownMenuItem {
  label: string;
  icon?: React.ReactNode;
  onClick: () => void;
  danger?: boolean;
  separator?: boolean; // render a separator line before this item
}

interface DropdownMenuProps {
  items: DropdownMenuItem[];
  pos: { top: number; right: number };
  onClose: () => void;
}

export function DropdownMenu({ items, pos, onClose }: DropdownMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener('click', close, true);
    return () => document.removeEventListener('click', close, true);
  }, [onClose]);

  // Close on Escape
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return createPortal(
    <div
      ref={menuRef}
      className={styles.menu}
      style={{ position: 'fixed', top: pos.top, right: pos.right, left: 'auto', zIndex: 'var(--z-modal)' as unknown as number }}
    >
      {items.map((item, i) => (
        <div key={i}>
          {item.separator && <div className={styles.separator} />}
          <button
            type="button"
            className={`${styles.item}${item.danger ? ` ${styles.itemDanger}` : ''}`}
            onClick={(e) => { e.stopPropagation(); onClose(); item.onClick(); }}
          >
            {item.icon}
            {item.label}
          </button>
        </div>
      ))}
    </div>,
    document.body,
  );
}
