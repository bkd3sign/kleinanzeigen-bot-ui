'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLogStream } from '@/hooks/useLogStream';
import { api } from '@/lib/api/client';
import { useToast } from '@/components/ui';
import { Input, Button } from '@/components/ui';
import styles from './LogViewer.module.scss';

export function LogViewer() {
  const { lines: liveLines, isConnected, connect, disconnect } = useLogStream();
  const { toast } = useToast();
  const [staticLines, setStaticLines] = useState<string[]>([]);
  const [search, setSearch] = useState('');
  const [autoScroll, setAutoScroll] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);

  // Merge: static logs + any new live lines appended
  const allLines = useMemo(() => {
    if (!isConnected || liveLines.length === 0) return staticLines;
    return [...staticLines, ...liveLines];
  }, [staticLines, liveLines, isConnected]);

  // Load initial logs
  useEffect(() => {
    const loadLogs = async () => {
      try {
        const data = await api.get<{ output?: string; logs?: string }>('/api/logs?lines=200');
        const logText = data.output ?? data.logs ?? '';
        const parsed = typeof logText === 'string' ? logText.split('\n') : [];
        setStaticLines(parsed);
      } catch {
        // Ignore
      }
    };
    loadLogs();
  }, []);

  // Auto-scroll
  useEffect(() => {
    if (autoScroll && bodyRef.current) {
      bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
    }
  }, [allLines, autoScroll]);

  const handleScroll = useCallback(() => {
    if (!bodyRef.current) return;
    const { scrollHeight, scrollTop, clientHeight } = bodyRef.current;
    const isAtBottom = scrollHeight - scrollTop - clientHeight < 50;
    if (!isAtBottom && autoScroll) {
      setAutoScroll(false);
    }
  }, [autoScroll]);

  const filteredLines = useMemo(() => {
    if (!search) return allLines;
    const q = search.toLowerCase().normalize('NFC');
    return allLines.filter((l) => l.toLowerCase().normalize('NFC').includes(q));
  }, [allLines, search]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const data = await api.get<{ output?: string; logs?: string }>('/api/logs?lines=200');
      const logText = data.output ?? data.logs ?? '';
      const parsed = typeof logText === 'string' ? logText.split('\n').filter(Boolean) : [];
      setStaticLines(parsed);
      if (parsed.length === 0) {
        toast('info', 'Keine Logdateien gefunden');
      }
    } catch {
      toast('error', 'Logs konnten nicht geladen werden');
    } finally {
      setTimeout(() => setRefreshing(false), 600);
    }
  }, [toast]);

  return (
    <div className={styles.wrapper}>
      <div className={styles.toolbar}>
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
            className={`${styles.toggleBtn} ${autoScroll ? styles.toggleBtnActive : ''}`}
            onClick={() => {
              setAutoScroll(!autoScroll);
              if (!autoScroll && bodyRef.current) {
                bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
              }
            }}
          >
            ↓ Auto-Scroll
          </button>
          <button
            type="button"
            className={`${styles.toggleBtn} ${isConnected ? styles.toggleBtnActive : ''}`}
            onClick={isConnected ? disconnect : connect}
          >
            ● Live
          </button>
          <button
            type="button"
            className={`${styles.toggleBtn} ${refreshing ? styles.toggleBtnActive : ''}`}
            onClick={handleRefresh}
          >
            ↻ Refresh
          </button>
        </div>
      </div>

      <div className={styles.terminal}>
        <div className={styles.terminalBody} ref={bodyRef} onScroll={handleScroll}>
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
      </div>
    </div>
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
