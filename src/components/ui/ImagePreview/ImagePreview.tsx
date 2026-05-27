'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import styles from './ImagePreview.module.scss';

interface ImagePreviewProps {
  src: string;
  onClose: () => void;
  images?: string[];
  initialIndex?: number;
}

export function ImagePreview({ src, onClose, images, initialIndex = 0 }: ImagePreviewProps) {
  const isGallery = images && images.length > 1;
  const [currentIndex, setCurrentIndex] = useState(initialIndex);
  const displaySrc = isGallery ? images[currentIndex] : src;
  const touchStartX = useRef<number | null>(null);

  const navigate = useCallback((dir: 'prev' | 'next') => {
    if (!isGallery) return;
    setCurrentIndex(i =>
      dir === 'next'
        ? (i + 1) % images.length
        : (i - 1 + images.length) % images.length,
    );
  }, [isGallery, images]);

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowLeft') navigate('prev');
      if (e.key === 'ArrowRight') navigate('next');
    }
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [onClose, navigate]);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
  }, []);

  const handleTouchEnd = useCallback((e: React.TouchEvent) => {
    if (touchStartX.current === null) return;
    const delta = e.changedTouches[0].clientX - touchStartX.current;
    touchStartX.current = null;
    if (Math.abs(delta) < 50) return;
    navigate(delta < 0 ? 'next' : 'prev');
  }, [navigate]);

  return createPortal(
    <div
      className={styles.overlay}
      role="dialog"
      aria-modal="true"
      onClick={onClose}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
    >
      <img
        src={displaySrc}
        alt=""
        className={styles.img}
        onClick={e => e.stopPropagation()}
      />

      {isGallery && (
        <button
          className={`${styles.navBtn} ${styles.navBtnPrev}`}
          onClick={e => { e.stopPropagation(); navigate('prev'); }}
          aria-label="Vorheriges Bild"
        >‹</button>
      )}

      {isGallery && (
        <button
          className={`${styles.navBtn} ${styles.navBtnNext}`}
          onClick={e => { e.stopPropagation(); navigate('next'); }}
          aria-label="Nächstes Bild"
        >›</button>
      )}

      {isGallery && (
        <div className={styles.counter} onClick={e => e.stopPropagation()}>
          {currentIndex + 1} / {images.length}
        </div>
      )}

      <button
        className={styles.close}
        onClick={e => { e.stopPropagation(); onClose(); }}
        aria-label="Schließen"
      >×</button>
    </div>,
    document.body,
  );
}
