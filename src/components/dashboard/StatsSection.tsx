'use client';

import React, { useState, useCallback, useEffect, useMemo } from 'react';
import type { AdStatsEntry, AdStatsHistoryEntry } from '@/types/stats';
import { useSort } from '@/hooks/useSort';
import { Badge } from '@/components/ui';
import type { BadgeVariant } from '@/components/ui/Badge/Badge';
import { api } from '@/lib/api/client';
import styles from './StatsSection.module.scss';

interface StatsSectionProps {
  stats: Record<string, AdStatsEntry>;
  lastUpdated: string | null;
  adNames?: Record<string, string>;
}

interface HistoryResponse {
  history: Record<string, AdStatsHistoryEntry>;
}

interface StatsRow {
  adId: string;
  title: string;
  state: string;
  replies: number;
  views: number;
  watchlist: number;
  activated_at: string | null;
  expires_at: string | null;
}

type SortKey = 'title' | 'state' | 'replies' | 'views' | 'watchlist' | 'activated_at' | 'expires_at';

const HISTORY_DAYS = 14;

function parseDMY(date: string): number {
  const [d, m, y] = date.split('.').map(Number);
  return new Date(y, m - 1, d).getTime();
}

function compareDMY(a: string | null, b: string | null): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return parseDMY(a) - parseDMY(b);
}

const STATE_ORDER: Record<string, number> = { active: 0, paused: 1 };

const compareStatsFn = (a: StatsRow, b: StatsRow, key: SortKey): number => {
  switch (key) {
    case 'state':
      return (STATE_ORDER[a.state] ?? 2) - (STATE_ORDER[b.state] ?? 2);
    case 'replies':
      return a.replies - b.replies;
    case 'views':
      return a.views - b.views;
    case 'watchlist':
      return a.watchlist - b.watchlist;
    case 'activated_at':
      return compareDMY(a.activated_at, b.activated_at);
    case 'expires_at':
      return compareDMY(a.expires_at, b.expires_at);
    default:
      return a.title.localeCompare(b.title);
  }
};

function stateBadgeVariant(state: string): BadgeVariant {
  if (state === 'active') return 'success';
  if (state === 'paused') return 'muted';
  return 'warning';
}

function stateLabel(state: string): string {
  if (state === 'active') return 'Aktiv';
  if (state === 'paused') return 'Pausiert';
  return state;
}

function formatDate(isoString: string): string {
  return new Date(isoString).toLocaleDateString('de-DE', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
  });
}

function AdStatsHistory({ adId }: { adId: string }) {
  const [history, setHistory] = useState<Array<[string, AdStatsHistoryEntry]> | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    api.get<HistoryResponse>(`/api/stats/${adId}`)
      .then((data) => {
        const cutoff = Date.now() - HISTORY_DAYS * 24 * 60 * 60 * 1000;
        const entries = Object.entries(data.history ?? {})
          .filter(([date]) => new Date(date).getTime() >= cutoff)
          .sort(([a], [b]) => b.localeCompare(a));
        setHistory(entries);
      })
      .catch(() => setHistory([]))
      .finally(() => setLoading(false));
  }, [adId]);

  if (loading) return <div className={styles.noData}>Lädt…</div>;
  if (!history || history.length === 0) {
    return (
      <div className={styles.noData}>
        Keine Verlaufsdaten für die letzten {HISTORY_DAYS} Tage
      </div>
    );
  }

  return (
    <div className={styles.historyScroll}>
      <table className={styles.historyTable}>
        <colgroup>
          <col className={styles.colTitle} />
          <col className={styles.colStatus} />
          <col className={styles.colNum} />
          <col className={styles.colNum} />
          <col className={styles.colNum} />
          <col className={styles.colDate} />
          <col className={styles.colDate} />
        </colgroup>
        <thead>
          <tr>
            <th colSpan={2} className={styles.historyHeader}>Datum</th>
            <th className={styles.historyHeaderNum}>Nachr.</th>
            <th className={styles.historyHeaderNum}>Aufrufe</th>
            <th className={styles.historyHeaderNum}>Merkliste</th>
            <th className={styles.historyHeader}></th>
            <th className={styles.historyHeaderRight}>Endet am</th>
          </tr>
        </thead>
        <tbody>
          {history.map(([date, entry]) => (
            <tr key={date} className={styles.historyRow}>
              <td colSpan={2} className={styles.historyCell}>{new Date(date).toLocaleDateString('de-DE')}</td>
              <td className={styles.historyCellNum}>{entry.replies}</td>
              <td className={styles.historyCellNum}>{entry.views}</td>
              <td className={styles.historyCellNum}>{entry.watchlist}</td>
              <td className={styles.historyCell}></td>
              <td className={styles.historyCellRight}>{entry.expires_at ?? '–'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function StatsSection({ stats, lastUpdated, adNames }: StatsSectionProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const rows = useMemo<StatsRow[]>(() =>
    Object.entries(stats).map(([adId, s]) => ({
      adId,
      title: adNames?.[adId] ?? adId,
      state: s.state || 'unknown',
      replies: s.replies ?? 0,
      views: s.views,
      watchlist: s.watchlist,
      activated_at: s.activated_at,
      expires_at: s.expires_at,
    })),
    [stats, adNames],
  );

  const { sorted, handleSort, sortIcon } = useSort<StatsRow, SortKey>(rows, 'title', compareStatsFn);

  const toggle = useCallback((adId: string) => {
    setExpandedId(prev => (prev === adId ? null : adId));
  }, []);

  if (rows.length === 0) {
    return (
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Anzeigen auf Kleinanzeigen</h2>
        <p className={styles.empty}>
          Daten werden nach dem nächsten Bot-Lauf verfügbar.
        </p>
      </section>
    );
  }

  return (
    <section className={styles.section}>
      <h2 className={styles.sectionTitle}>
        Anzeigen auf Kleinanzeigen
        {lastUpdated && (
          <span className={styles.titleMeta}>Stand: {formatDate(lastUpdated)}</span>
        )}
      </h2>
      <div className={styles.tableWrapper}>
        <table className={styles.table}>
          <colgroup>
            <col className={styles.colTitle} />
            <col className={styles.colStatus} />
            <col className={styles.colNum} />
            <col className={styles.colNum} />
            <col className={styles.colNum} />
            <col className={styles.colDate} />
            <col className={styles.colDate} />
          </colgroup>
          <thead>
            <tr>
              <th
                className={`${styles.tableHeader} thSortable`}
                onClick={() => handleSort('title')}
              >
                Anzeige {sortIcon('title')}
              </th>
              <th
                className={`${styles.tableHeader} thSortable`}
                onClick={() => handleSort('state')}
              >
                Status {sortIcon('state')}
              </th>
              <th
                className={`${styles.tableHeaderNum} thSortable`}
                onClick={() => handleSort('replies')}
              >
                Nachr. {sortIcon('replies')}
              </th>
              <th
                className={`${styles.tableHeaderNum} thSortable`}
                onClick={() => handleSort('views')}
              >
                Aufrufe {sortIcon('views')}
              </th>
              <th
                className={`${styles.tableHeaderNum} thSortable`}
                onClick={() => handleSort('watchlist')}
              >
                Merkliste {sortIcon('watchlist')}
              </th>
              <th
                className={`${styles.tableHeader} thSortable`}
                onClick={() => handleSort('activated_at')}
              >
                Aktiviert {sortIcon('activated_at')}
              </th>
              <th
                className={`${styles.tableHeader} thSortable`}
                onClick={() => handleSort('expires_at')}
              >
                Endet am {sortIcon('expires_at')}
              </th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((row) => (
              <React.Fragment key={row.adId}>
                <tr className={styles.tableRow} onClick={() => toggle(row.adId)}>
                  <td className={styles.tableCellTitle} title={row.title}>{row.title}</td>
                  <td className={styles.tableCell}>
                    <Badge variant={stateBadgeVariant(row.state)}>
                      {stateLabel(row.state)}
                    </Badge>
                  </td>
                  <td className={styles.tableCellNum}>{row.replies}</td>
                  <td className={styles.tableCellNum}>{row.views}</td>
                  <td className={styles.tableCellNum}>{row.watchlist}</td>
                  <td className={styles.tableCell}>{row.activated_at ?? '–'}</td>
                  <td className={styles.tableCell}>{row.expires_at ?? '–'}</td>
                </tr>
                {expandedId === row.adId && (
                  <tr className={styles.historyExpandRow}>
                    <td colSpan={7} className={styles.historyExpandCell}>
                      <AdStatsHistory adId={row.adId} />
                    </td>
                  </tr>
                )}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
