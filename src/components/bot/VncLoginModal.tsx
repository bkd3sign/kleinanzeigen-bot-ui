'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Button } from '@/components/ui/Button/Button';
import { Input } from '@/components/ui/Input/Input';
import { Spinner } from '@/components/ui/Spinner/Spinner';
import { useToast } from '@/components/ui/Toast/ToastProvider';
import { api } from '@/lib/api/client';
import styles from './VncLoginModal.module.scss';

export interface VncLoginModalProps {
  open: boolean;
  onClose: () => void;
  /** null while the session is still starting — the modal shows a connecting state. */
  token: string | null;
}

// noVNC endpoint (token routes websockify to the workspace's Xvnc):
//   resize=remote   - Xvnc resizes its framebuffer to the iframe (no black bars/scroll)
//   reconnect=true  - retry on slow cold starts instead of a dead blank viewer
//   quality=3       - lighter JPEG for the manual-login view on poor connections
//   compression=9   - max zlib for the non-JPEG (static) rects; costs client CPU, saves bytes
//   path            - LAST: carries the ?token= for websockify
function buildBrowserUrl(token: string): string {
  return `/bot-browser/vnc.html?autoconnect=true&reconnect=true&reconnect_delay=2000&resize=remote&quality=3&compression=9&path=bot-browser/websockify?token=${token}`;
}

// Hide noVNC control-bar buttons that duplicate the modal's own controls (fullscreen, clipboard,
// disconnect) or expose settings with negligible effect on this tiny login view (quality/
// compression/depth). The keyboard toggle stays — the only way to type on touch devices.
export const VNC_HIDDEN_CONTROL_IDS = [
  'noVNC_view_drag_button',
  'noVNC_settings_button',
  'noVNC_power_button',
  'noVNC_fullscreen_button',
  'noVNC_clipboard_button',
  'noVNC_disconnect_button',
] as const;

const VNC_DECLUTTER_STYLE_ID = 'kab-vnc-declutter';

// Double-ID selectors (#noVNC_control_bar #<id>) outrank noVNC's own show rule
// `#noVNC_control_bar .noVNC_button` (specificity 2,0,0 > 1,1,0), so the buttons stay hidden
// even after noVNC re-evaluates control visibility on connect — no !important needed.
export function buildVncDeclutterCss(): string {
  return `${VNC_HIDDEN_CONTROL_IDS.map(id => `#noVNC_control_bar #${id}`).join(',')}{display:none}`;
}

// Same-origin: the noVNC iframe is served from our own host under /bot-browser/, so we can
// reach its document (the keydown listener in the modal already relies on this). Idempotent —
// the style id guards against re-injection on reconnect/reload.
function hideNoVncControls(doc: Document | null | undefined): void {
  if (!doc || doc.getElementById(VNC_DECLUTTER_STYLE_ID)) return;
  const style = doc.createElement('style');
  style.id = VNC_DECLUTTER_STYLE_ID;
  style.textContent = buildVncDeclutterCss();
  doc.head?.appendChild(style);
}

export function VncLoginModal({ open, onClose, token }: VncLoginModalProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const { toast } = useToast();
  const [pasteText, setPasteText] = useState('');
  const [pasting, setPasting] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);

  // Elapsed seconds in the connecting state: gives visible progress and a realistic
  // expectation (a cold Xvnc+Chromium boot on a small VM can take a bit). Reset once the
  // token arrives (connected) or the modal closes.
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!open || token) { setElapsed(0); return; }
    const startedAt = Date.now();
    const id = setInterval(() => setElapsed(Math.floor((Date.now() - startedAt) / 1000)), 1000);
    return () => clearInterval(id);
  }, [open, token]);

  // Forward text to the remote browser's focused field via CDP (server-side).
  const sendPaste = useCallback(async (raw: string): Promise<void> => {
    const value = raw.trim();
    if (!value || pasting) return;
    setPasting(true);
    try {
      await api.put('/api/bot/vnc', { text: value });
      setPasteText('');
      toast('success', 'In das fokussierte Feld eingefügt.');
    } catch (e) {
      toast('error', e instanceof Error ? e.message : 'Einfügen fehlgeschlagen.');
    } finally {
      setPasting(false);
    }
  }, [pasting, toast]);

  // Stable refs so the key-handling effect never needs to re-run on each change.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const sendPasteRef = useRef(sendPaste);
  sendPasteRef.current = sendPaste;
  const toastRef = useRef(toast);
  toastRef.current = toast;
  const fullscreenRef = useRef(fullscreen);
  fullscreenRef.current = fullscreen;

  // Lock background scroll while open (mirrors the shared Modal behaviour).
  useEffect(() => {
    if (!open) return;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = ''; };
  }, [open]);

  // Key handling. Escape exits fullscreen first (else closes). Cmd/Ctrl+V reads the OS
  // clipboard and types it into the remote field via CDP (noVNC cannot relay the host
  // clipboard, so we intercept before it forwards Meta+V).
  //  - iframe listener: focus inside the embedded browser.
  //  - document listener: focus in the modal (paste field etc.).
  useEffect(() => {
    if (!open) return;

    function escape(): void {
      if (fullscreenRef.current) setFullscreen(false);
      else onCloseRef.current();
    }

    function onIframeKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') { escape(); return; }
      if ((e.key === 'v' || e.key === 'V') && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        e.stopPropagation();
        navigator.clipboard.readText()
          .then(text => sendPasteRef.current(text))
          .catch(() => toastRef.current('error', 'Zwischenablage nicht lesbar — nutze das Einfügen-Feld unten.'));
      }
    }

    function onDocKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') { e.preventDefault(); escape(); }
    }

    const iframe = iframeRef.current;
    function attach(): void {
      try {
        iframe?.contentWindow?.addEventListener('keydown', onIframeKey, true);
        hideNoVncControls(iframe?.contentDocument);
      } catch { /* cross-origin guard */ }
    }
    iframe?.addEventListener('load', attach);
    attach();
    document.addEventListener('keydown', onDocKey, true);

    return () => {
      iframe?.removeEventListener('load', attach);
      try { iframe?.contentWindow?.removeEventListener('keydown', onIframeKey, true); } catch { /* ignore */ }
      document.removeEventListener('keydown', onDocKey, true);
    };
    // token is a dep so the listeners re-attach when the iframe mounts after the
    // optimistic connecting state (the iframe only renders once token is set).
  }, [open, token]);

  if (!open || typeof document === 'undefined') return null;

  return createPortal(
    <div className={styles.overlay} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={`${styles.window} ${fullscreen ? styles.windowFullscreen : ''}`}>
        <div className={styles.header}>
          <span className={styles.title}>Bei Kleinanzeigen anmelden</span>
          <div className={styles.headerBtns}>
            {fullscreen ? (
              <button type="button" className="toggleBtn toggleBtnClose" onClick={() => { setFullscreen(false); onClose(); }}>
                ✕ Schließen
              </button>
            ) : (
              <>
                <button type="button" className="toggleBtn" onClick={() => setFullscreen(true)} title="Vollbild">
                  ⛶
                </button>
                <button type="button" className="modalCloseBtn" onClick={onClose} aria-label="Close">
                  ×
                </button>
              </>
            )}
          </div>
        </div>

        {token ? (
          <>
            <p className={styles.hint}>
              Einmal manuell anmelden. Wird’s geblockt: kurz warten oder neu laden.
            </p>

            <iframe
              ref={iframeRef}
              src={buildBrowserUrl(token)}
              className={`${styles.frameArea} ${styles.frame}`}
              title="Kleinanzeigen-Browser"
              allow="clipboard-read; clipboard-write"
            />

            <form
              className={styles.pasteRow}
              onSubmit={(e) => { e.preventDefault(); void sendPaste(pasteText); }}
            >
              <Input
                type="password"
                value={pasteText}
                onChange={(e) => setPasteText(e.target.value)}
                placeholder="Cmd+V im Browser — oder hier einfügen"
                autoComplete="off"
                aria-label="Text in das fokussierte Feld einfügen"
              />
              <Button type="submit" variant="primary" disabled={pasting || !pasteText.trim()}>
                {pasting ? 'Wird eingefügt…' : 'Einfügen'}
              </Button>
            </form>
          </>
        ) : (
          <div className={`${styles.frameArea} ${styles.connecting}`}>
            <Spinner size="lg" />
            <p className={styles.connectingTitle}>Browser wird gestartet…</p>
            <p className={styles.hint}>
              {elapsed < 8
                ? 'Chromium startet und verbindet sich — meist nur ein paar Sekunden.'
                : elapsed < 30
                  ? 'Erster Start nach längerer Pause dauert etwas länger — bitte kurz warten.'
                  : 'Der Start dauert länger als üblich — noch einen Moment Geduld, das Fenster verbindet automatisch.'}
            </p>
            {elapsed >= 3 && <p className={styles.connectingElapsed}>{elapsed}s</p>}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
