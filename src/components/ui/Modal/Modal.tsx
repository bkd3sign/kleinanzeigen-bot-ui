'use client';

import {
  useEffect,
  useRef,
  useCallback,
  type ReactNode,
  type ReactElement,
  type MouseEvent,
} from 'react';
import { createPortal } from 'react-dom';
import styles from './Modal.module.scss';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}

export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  wide = false,
}: ModalProps): ReactElement | null {
  const contentRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  // Handle Escape key
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    },
    [onClose],
  );

  // Focus trap
  useEffect(() => {
    if (!open) return;

    previousFocusRef.current = document.activeElement as HTMLElement;
    document.addEventListener('keydown', handleKeyDown);
    document.body.style.overflow = 'hidden';

    // Focus the close button on open
    const firstFocusable = contentRef.current?.querySelector<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
    );
    firstFocusable?.focus();

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = '';
      previousFocusRef.current?.focus();
    };
  }, [open, handleKeyDown]);

  // Trap focus within modal
  useEffect(() => {
    if (!open) return;

    function handleTab(e: KeyboardEvent): void {
      if (e.key !== 'Tab' || !contentRef.current) return;

      const focusable = contentRef.current.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      );
      if (focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }

    document.addEventListener('keydown', handleTab);
    return () => document.removeEventListener('keydown', handleTab);
  }, [open]);

  function handleOverlayClick(e: MouseEvent): void {
    if (e.target === e.currentTarget) onClose();
  }

  if (!open) return null;

  const contentClasses = [styles.content, wide && styles.contentWide]
    .filter(Boolean)
    .join(' ');

  return createPortal(
    <div className={styles.modal} role="dialog" aria-modal="true" aria-label={title}>
      <div className={styles.overlay} onClick={handleOverlayClick} />
      <div ref={contentRef} className={contentClasses}>
        <div className={styles.header}>
          <h2 className={styles.title}>{title}</h2>
          <button
            type="button"
            className={styles.closeBtn}
            onClick={onClose}
            aria-label="Close"
          >
            ×
          </button>
        </div>
        <div className={styles.body}>{children}</div>
        {footer && <div className={styles.footer}>{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

/**
 * Show a confirmation dialog imperatively.
 * Returns a promise that resolves to true (confirm) or false (cancel).
 */
export function showConfirm(
  title: string,
  message: string,
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  bullets?: string[],
): Promise<boolean> {
  return new Promise((resolve) => {
    const container = document.createElement('div');
    document.body.appendChild(container);

    function cleanup(result: boolean): void {
      resolve(result);
      container.remove();
    }

    // Render a minimal confirm using raw DOM (avoids requiring React root)
    const overlay = document.createElement('div');
    overlay.style.cssText = `
      position: fixed; inset: 0; z-index: var(--z-modal);
      display: flex; align-items: center; justify-content: center;
    `;

    const bg = document.createElement('div');
    bg.style.cssText = `
      position: absolute; inset: 0;
      background-color: var(--bg-overlay);
    `;
    bg.addEventListener('click', () => cleanup(false));
    overlay.appendChild(bg);

    const content = document.createElement('div');
    content.className = styles.content;

    const header = document.createElement('div');
    header.className = styles.header;
    const h2 = document.createElement('h2');
    h2.className = styles.title;
    h2.textContent = title;
    header.appendChild(h2);
    content.appendChild(header);

    const body = document.createElement('div');
    body.className = styles.body;
    const p = document.createElement('p');
    p.className = styles.confirmMessage;
    // Support bold text between „..." quotes
    const parts = message.split(/(\u201E[^\u201C]+\u201C)/);
    for (const part of parts) {
      if (part.startsWith('\u201E') && part.endsWith('\u201C')) {
        const strong = document.createElement('strong');
        strong.textContent = part;
        p.appendChild(strong);
      } else {
        p.appendChild(document.createTextNode(part));
      }
    }
    body.appendChild(p);
    if (bullets && bullets.length > 0) {
      const ul = document.createElement('ul');
      ul.style.cssText = 'margin: var(--space-2) 0 0 var(--space-4); list-style: disc; display: flex; flex-direction: column; gap: var(--space-1);';
      for (const bullet of bullets) {
        const li = document.createElement('li');
        li.textContent = bullet;
        li.style.cssText = 'font-size: var(--font-size-sm); color: var(--text-secondary);';
        ul.appendChild(li);
      }
      body.appendChild(ul);
    }
    content.appendChild(body);

    const footer = document.createElement('div');
    footer.className = styles.footer;

    const cancelBtn = document.createElement('button');
    cancelBtn.textContent = cancelText;
    cancelBtn.style.cssText = `
      display: inline-flex; align-items: center; justify-content: center;
      gap: var(--space-2); padding: var(--space-1-5) var(--space-3);
      font-size: var(--font-size-xs); font-weight: var(--font-semibold);
      border-radius: var(--radius-md); border: 1px solid var(--border-color);
      background-color: var(--bg-tertiary); color: var(--text-primary);
      cursor: pointer; font-family: inherit;
    `;
    cancelBtn.addEventListener('click', () => cleanup(false));

    const confirmBtn = document.createElement('button');
    confirmBtn.textContent = confirmText;
    confirmBtn.style.cssText = `
      display: inline-flex; align-items: center; justify-content: center;
      gap: var(--space-2); padding: var(--space-1-5) var(--space-3);
      font-size: var(--font-size-xs); font-weight: var(--font-semibold);
      border-radius: var(--radius-md); border: 1px solid var(--accent);
      background-color: var(--accent); color: var(--accent-text);
      cursor: pointer; font-family: inherit;
    `;
    confirmBtn.addEventListener('click', () => cleanup(true));

    footer.appendChild(cancelBtn);
    footer.appendChild(confirmBtn);
    content.appendChild(footer);
    overlay.appendChild(content);
    container.appendChild(overlay);

    // Handle Escape key
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') {
        document.removeEventListener('keydown', onKey);
        cleanup(false);
      }
    }
    document.addEventListener('keydown', onKey);

    confirmBtn.focus();
  });
}
