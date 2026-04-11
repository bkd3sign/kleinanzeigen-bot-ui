'use client';

import { useCallback, useRef, useState } from 'react';
import { useTheme } from '@/hooks/useTheme';
import styles from './ThemeSwitcher.module.scss';

interface ThemeSwitcherProps {
  className?: string;
  iconClassName?: string;
}

export function ThemeSwitcher({ className, iconClassName }: ThemeSwitcherProps) {
  const { theme, setTheme } = useTheme();
  const [animating, setAnimating] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);

  const isDark = theme === 'dark' || theme === 'system';

  const toggle = useCallback(() => {
    const newTheme = isDark ? 'light' : 'dark';

    setAnimating(true);
    setTimeout(() => setAnimating(false), 500);

    // Calculate circle-reveal origin from button center
    const btn = buttonRef.current;
    if (
      btn &&
      typeof document.startViewTransition === 'function' &&
      !window.matchMedia('(prefers-reduced-motion: reduce)').matches
    ) {
      const rect = btn.getBoundingClientRect();
      const x = rect.left + rect.width / 2;
      const y = rect.top + rect.height / 2;
      const radius = Math.hypot(
        Math.max(x, window.innerWidth - x),
        Math.max(y, window.innerHeight - y)
      );

      // Set CSS custom properties for the clip-path animation
      document.documentElement.style.setProperty('--reveal-x', `${x}px`);
      document.documentElement.style.setProperty('--reveal-y', `${y}px`);
      document.documentElement.style.setProperty('--reveal-radius', `${radius}px`);

      document.startViewTransition(() => {
        setTheme(newTheme);
      });
    } else {
      // Fallback: instant switch when View Transitions API is unavailable
      setTheme(newTheme);
    }
  }, [isDark, setTheme]);

  return (
    <button
      ref={buttonRef}
      className={`${className || ''} ${animating ? styles.animating : ''}`}
      onClick={toggle}
      aria-label={isDark ? 'Heller Modus aktivieren' : 'Dunkler Modus aktivieren'}
      title={isDark ? 'Heller Modus' : 'Dunkler Modus'}
    >
      <span className={iconClassName}>
        {isDark ? (
          <svg viewBox="0 0 24 24" className={styles.icon}>
            <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" className={styles.icon}>
            <circle cx="12" cy="12" r="4" />
            <path d="M12 2v2" />
            <path d="M12 20v2" />
            <path d="m4.93 4.93 1.41 1.41" />
            <path d="m17.66 17.66 1.41 1.41" />
            <path d="M2 12h2" />
            <path d="M20 12h2" />
            <path d="m6.34 17.66-1.41 1.41" />
            <path d="m19.07 4.93-1.41 1.41" />
          </svg>
        )}
      </span>
      <span className={styles.label}>Theme</span>
    </button>
  );
}
