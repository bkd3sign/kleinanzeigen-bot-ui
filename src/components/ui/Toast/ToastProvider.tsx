'use client';

import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  useRef,
  type ReactNode,
  type ReactElement,
} from 'react';
import styles from './Toast.module.scss';

type ToastType = 'success' | 'error' | 'info';

interface ToastItem {
  id: number;
  type: ToastType;
  message: string;
  duration: number;
  visible: boolean;
  exiting: boolean;
}

interface ToastContextValue {
  toast: (type: ToastType, message: string, duration?: number) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const ANIMATION_DURATION = 300;
const DEFAULT_DURATION = 4000;

let nextId = 0;

function getIcon(type: ToastType): ReactElement {
  if (type === 'success') {
    return (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="20 6 9 17 4 12" />
      </svg>
    );
  }
  if (type === 'error') {
    return (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
      </svg>
    );
  }
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
    </svg>
  );
}

const typeClassMap: Record<ToastType, string> = {
  success: styles.toastSuccess,
  error: styles.toastError,
  info: styles.toastInfo,
};

const iconBadgeClassMap: Record<ToastType, string> = {
  success: styles.iconBadgeSuccess,
  error: styles.iconBadgeError,
  info: styles.iconBadgeInfo,
};

const progressClassMap: Record<ToastType, string> = {
  success: styles.progressSuccess,
  error: styles.progressError,
  info: styles.progressInfo,
};

interface ToastProviderProps {
  children: ReactNode;
}

export function ToastProvider({ children }: ToastProviderProps): ReactElement {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const timersRef = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());

  // Dismiss a single toast with exit animation
  const dismiss = useCallback((id: number) => {
    setToasts((prev) =>
      prev.map((t) => (t.id === id ? { ...t, exiting: true } : t)),
    );

    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, ANIMATION_DURATION);
  }, []);

  // Show a toast
  const showToast = useCallback(
    (type: ToastType, message: string, duration = DEFAULT_DURATION) => {
      const id = ++nextId;
      const item: ToastItem = { id, type, message, duration, visible: false, exiting: false };

      setToasts((prev) => [...prev, item]);

      // Make visible on next frame for slide-in animation
      requestAnimationFrame(() => {
        setToasts((prev) =>
          prev.map((t) => (t.id === id ? { ...t, visible: true } : t)),
        );
      });

      // Auto-dismiss
      const timer = setTimeout(() => {
        dismiss(id);
        timersRef.current.delete(id);
      }, duration);
      timersRef.current.set(id, timer);
    },
    [dismiss],
  );

  // Cleanup timers on unmount
  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      timers.forEach((timer) => clearTimeout(timer));
      timers.clear();
    };
  }, []);

  function handleDismiss(id: number): void {
    const timer = timersRef.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timersRef.current.delete(id);
    }
    dismiss(id);
  }

  const contextValue: ToastContextValue = { toast: showToast };

  return (
    <ToastContext.Provider value={contextValue}>
      {children}
      {toasts.length > 0 && (
        <div className={styles.container}>
          {toasts.map((t) => {
            const toastClasses = [
              styles.toast,
              typeClassMap[t.type],
              t.visible && styles.toastVisible,
              t.exiting && styles.toastExiting,
            ]
              .filter(Boolean)
              .join(' ');

            return (
              <div
                key={t.id}
                className={toastClasses}
                role="alert"
                style={{ '--toast-duration': `${t.duration}ms` } as React.CSSProperties}
              >
                <div className={`${styles.iconBadge} ${iconBadgeClassMap[t.type]}`} aria-hidden="true">
                  {getIcon(t.type)}
                </div>
                <span className={styles.message}>{t.message}</span>
                <button
                  type="button"
                  className={styles.closeBtn}
                  onClick={() => handleDismiss(t.id)}
                  aria-label="Dismiss"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                    <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
                {t.visible && !t.exiting && (
                  <div className={`${styles.progress} ${progressClassMap[t.type]}`} />
                )}
              </div>
            );
          })}
        </div>
      )}
    </ToastContext.Provider>
  );
}

/**
 * Hook to show toast notifications.
 * Must be used within a ToastProvider.
 */
export function useToast(): ToastContextValue {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return context;
}
