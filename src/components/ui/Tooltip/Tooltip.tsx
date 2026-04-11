'use client';

import { useState, useRef, useEffect, useCallback, type ReactNode, type ReactElement } from 'react';
import styles from './Tooltip.module.scss';

type TooltipPosition = 'top' | 'bottom' | 'left' | 'right';

interface TooltipProps {
  content: string;
  children: ReactNode;
  position?: TooltipPosition;
}

const positionClass: Record<TooltipPosition, string> = {
  top: styles.tooltipTop,
  bottom: styles.tooltipBottom,
  left: styles.tooltipLeft,
  right: styles.tooltipRight,
};

export function Tooltip({
  content,
  children,
  position = 'top',
}: TooltipProps): ReactElement {
  const [visible, setVisible] = useState(false);
  const [clampedPosition, setClampedPosition] = useState(position);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);

  // Viewport clamping: adjust position if tooltip overflows
  const clampToViewport = useCallback(() => {
    if (!wrapperRef.current || !tooltipRef.current) return;

    const wrapperRect = wrapperRef.current.getBoundingClientRect();
    const tooltipRect = tooltipRef.current.getBoundingClientRect();
    let preferred = position;

    if (preferred === 'top' && wrapperRect.top - tooltipRect.height - 8 < 0) {
      preferred = 'bottom';
    } else if (
      preferred === 'bottom' &&
      wrapperRect.bottom + tooltipRect.height + 8 > window.innerHeight
    ) {
      preferred = 'top';
    } else if (preferred === 'left' && wrapperRect.left - tooltipRect.width - 8 < 0) {
      preferred = 'right';
    } else if (
      preferred === 'right' &&
      wrapperRect.right + tooltipRect.width + 8 > window.innerWidth
    ) {
      preferred = 'left';
    }

    setClampedPosition(preferred);
  }, [position]);

  useEffect(() => {
    if (visible) clampToViewport();
  }, [visible, clampToViewport]);

  const tooltipClasses = [
    styles.tooltip,
    positionClass[clampedPosition],
    visible && styles.tooltipVisible,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div
      ref={wrapperRef}
      className={styles.wrapper}
      onMouseEnter={() => setVisible(true)}
      onMouseLeave={() => setVisible(false)}
      onFocus={() => setVisible(true)}
      onBlur={() => setVisible(false)}
    >
      {children}
      <div ref={tooltipRef} className={tooltipClasses} role="tooltip">
        {content}
      </div>
    </div>
  );
}
