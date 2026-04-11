'use client';

import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import styles from './ImagePreview.module.scss';

interface ImagePreviewProps {
  src: string;
  onClose: () => void;
}

/**
 * Fullscreen image preview modal with ESC support.
 * Rendered as a portal to document.body.
 */
export function ImagePreview({ src, onClose }: ImagePreviewProps) {
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [onClose]);

  return createPortal(
    <div className={styles.overlay} onClick={onClose}>
      <img src={src} alt="" className={styles.img} />
      <button
        className={styles.close}
        onClick={(e) => { e.stopPropagation(); onClose(); }}
      >×</button>
    </div>,
    document.body,
  );
}
