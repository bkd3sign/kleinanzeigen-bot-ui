'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { api } from '@/lib/api/client';
import { useToast } from '@/components/ui';
import { Input } from '@/components/ui';
import styles from './LogViewer.module.scss';

const POLL_INTERVAL_MS = 1000;

export function LogViewer() {
  const { toast } = useToast();
  const [lines, setLines] = useState<string[]>([]);
  const [search, setSearch] = useState('');
  const [autoScroll, setAutoScroll] = useState(true);
  const [isLive, setIsLive] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);
  const fullBodyRef = useRef<HTMLDivElement>(null);

  const fetchLogs = useCallback(async (silent = false): Promise<void> => {
    try {
      const data = await api.get<{ output?: string; logs?: string }>('/api/logs?lines=200');
      const logText = data.output ?? data.logs ?? '';
      const parsed = typeof logText === 'string' ? logText.split('\n').filter(Boolean) : [];
      setLines(parsed);
      if (!silent && parsed.length === 0) {
        toast('info', 'Keine Logdateien gefunden');
      }
    } catch {
      if (!silent) toast('error', 'Logs konnten nicht geladen werden');
    }
  }, [toast]);

  // Initial load
  useEffect(() => {
    fetchLogs(true);
  }, [fetchLogs]);

  // Live polling
  useEffect(() => {
    if (!isLive) return;
    const id = setInterval(() => fetchLogs(true), POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [isLive, fetchLogs]);

  // Auto-scroll — both inline and fullscreen body
  useEffect(() => {
    if (!autoScroll) return;
    if (bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
    if (fullBodyRef.current) fullBodyRef.current.scrollTop = fullBodyRef.current.scrollHeight;
  }, [lines, autoScroll]);

  // Scroll to bottom when fullscreen opens
  useEffect(() => {
    if (isFullscreen && fullBodyRef.current) {
      fullBodyRef.current.scrollTop = fullBodyRef.current.scrollHeight;
    }
  }, [isFullscreen]);

  // ESC closes fullscreen
  useEffect(() => {
    if (!isFullscreen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setIsFullscreen(false); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [isFullscreen]);

  const handleScroll = useCallback((ref: React.RefObject<HTMLDivElement | null>) => {
    if (!ref.current) return;
    const { scrollHeight, scrollTop, clientHeight } = ref.current;
    const isAtBottom = scrollHeight - scrollTop - clientHeight < 50;
    if (!isAtBottom && autoScroll) setAutoScroll(false);
  }, [autoScroll]);

  const filteredLines = useMemo(() => {
    if (!search) return lines;
    const q = search.toLowerCase().normalize('NFC');
    return lines.filter((l) => l.toLowerCase().normalize('NFC').includes(q));
  }, [lines, search]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchLogs(false);
    setTimeout(() => setRefreshing(false), 600);
  }, [fetchLogs]);

  const handleToggleLive = useCallback(() => {
    const next = !isLive;
    setIsLive(next);
    if (next) fetchLogs(true);
  }, [isLive, fetchLogs]);

  const handleToggleAutoScroll = useCallback((ref: React.RefObject<HTMLDivElement | null>) => {
    const next = !autoScroll;
    setAutoScroll(next);
    if (next && ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [autoScroll]);

  const logContent = (ref: React.RefObject<HTMLDivElement | null>, extraClass?: string) => (
    <div
      className={`${styles.terminalBody} ${extraClass ?? ''}`}
      ref={ref}
      onScroll={() => handleScroll(ref)}
    >
      {filteredLines.length === 0 ? (
        <div className={styles.empty}>
          {search ? 'Keine Treffer gefunden' : 'Keine Logs vorhanden'}
        </div>
      ) : (
        filteredLines.map((line, i) => (
          <div key={i} className={styles.line}>
            {search ? <HighlightedLine text={line} query={search} /> : line}
          </div>
        ))
      )}
    </div>
  );

  const toolbar = (ref: React.RefObject<HTMLDivElement | null>, fullscreen: boolean) => (
    <div className={`${styles.toolbar} ${fullscreen ? styles.toolbarFullscreen : ''}`}>
      <div className={styles.toolbarLeft}>
        <Input
          placeholder="Logs suchen…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>
      <div className={styles.toolbarRight}>
        <button
          type="button"
          className={`toggleBtn ${autoScroll ? styles.toggleBtnActive : ''}`}
          onClick={() => handleToggleAutoScroll(ref)}
        >
          ↓ Auto-Scroll
        </button>
        <button
          type="button"
          className={`toggleBtn ${isLive ? styles.toggleBtnActive : ''}`}
          onClick={handleToggleLive}
        >
          ● Live
        </button>
        <button
          type="button"
          className={`toggleBtn ${refreshing ? styles.toggleBtnActive : ''}`}
          onClick={handleRefresh}
        >
          ↻ Refresh
        </button>
        {fullscreen ? (
          <button
            type="button"
            className="toggleBtn toggleBtnClose"
            onClick={() => setIsFullscreen(false)}
          >
            ✕ Schließen
          </button>
        ) : (
          <button
            type="button"
            className="toggleBtn"
            onClick={() => setIsFullscreen(true)}
            title="Vollbild"
          >
            ⛶
          </button>
        )}
      </div>
    </div>
  );

  return (
    <>
      <div className={styles.wrapper}>
        {toolbar(bodyRef, false)}
        <div className={styles.terminal}>
          {logContent(bodyRef)}
        </div>
      </div>

      {isFullscreen && typeof document !== 'undefined' && createPortal(
        <div className={styles.overlay} role="dialog" aria-modal="true">
          <div className={styles.overlayInner}>
            {toolbar(fullBodyRef, true)}
            <div className={styles.overlayBody}>
              {logContent(fullBodyRef)}
            </div>
            <div className={styles.overlayEsc}>ESC zum Schließen</div>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}

function HighlightedLine({ text, query }: { text: string; query: string }) {
  const parts: React.ReactNode[] = [];
  const lowerText = text.toLowerCase();
  const lowerQuery = query.toLowerCase();
  let lastIndex = 0;
  let matchIndex = lowerText.indexOf(lowerQuery);

  while (matchIndex !== -1) {
    if (matchIndex > lastIndex) {
      parts.push(text.slice(lastIndex, matchIndex));
    }
    parts.push(
      <mark key={matchIndex} className={styles.highlight}>
        {text.slice(matchIndex, matchIndex + query.length)}
      </mark>,
    );
    lastIndex = matchIndex + query.length;
    matchIndex = lowerText.indexOf(lowerQuery, lastIndex);
  }

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  return <>{parts}</>;
}
