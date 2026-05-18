'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAds } from '@/hooks/useAds';
import { useAiAvailable } from '@/hooks/useAiAvailable';
import { AdGrid } from '@/components/ads/AdGrid';
import { AdTable, makeCompare } from '@/components/ads/AdTable';
import type { AdSortKey } from '@/components/ads/AdTable';
import { useAdStats } from '@/hooks/useAdStats';
import { AdListToolbar } from '@/components/ads/AdListToolbar';
import type { StatusCounts } from '@/components/ads/AdListToolbar';
import { AdBulkActions } from '@/components/ads/AdBulkActions';
import { QuickAiCreate, type QuickAiCreateHandle } from '@/components/ads/QuickAiCreate';
import { Confetti, Spinner } from '@/components/ui';
import { api } from '@/lib/api/client';
import type { AdListItem } from '@/types/ad';
import type { Job } from '@/types/bot';
import type { SortDir } from '@/hooks/useSort';
import { isExpiringSoon, isExpired, isReserved } from '@/lib/ads/status';
import type { StatsResponse } from '@/hooks/useAdStats';
import styles from './ads.module.scss';

type ViewMode = 'grid' | 'table';

function isOnlineOnKA(ad: AdListItem, statsData?: StatsResponse): boolean {
  const state = ad.id ? statsData?.ads[String(ad.id)]?.state : undefined;
  return state === 'active' || state === 'paused';
}

function filterByParams(ads: AdListItem[], status: string | null, category: string | null, statsData?: StatsResponse): AdListItem[] {
  let result = ads;

  if (status === null) {
    // Default view: hide inactive ads
    result = result.filter((a) => a.active !== false);
  } else if (status === 'all') {
    // no filter — show everything
  } else if (status === 'online') {
    result = result.filter((a) => isOnlineOnKA(a, statsData));
  } else if (status === 'draft') {
    result = result.filter((a) => !a.id);
  } else if (status === 'expiring') {
    result = result.filter((a) => isExpiringSoon(a));
  } else if (status === 'expired') {
    result = result.filter((a) => isExpired(a));
  } else if (status === 'changed') {
    result = result.filter((a) => a.is_changed);
  } else if (status === 'orphaned') {
    result = result.filter((a) => a.is_orphaned);
  } else if (status === 'reserved') {
    result = result.filter((a) => isReserved(a, a.id ? statsData?.ads[String(a.id)] : undefined));
  } else if (status === 'inactive') {
    result = result.filter((a) => a.active === false);
  }

  if (category) {
    result = result.filter((a) => a.category === category);
  }

  return result;
}


export default function AdsPage() {
  const { data, isLoading } = useAds();
  const { data: statsData } = useAdStats();
  const { isAiAvailable } = useAiAvailable();
  const router = useRouter();
  const searchParams = useSearchParams();
  const statusFilter = searchParams.get('status');
  const categoryFilter = searchParams.get('category');
  const [search, setSearch] = useState('');
  const [tableSortKey, setTableSortKey] = useState<AdSortKey>('title');
  const [tableSortDir, setTableSortDir] = useState<SortDir>('asc');
  const compareFn = useMemo(() => makeCompare(statsData), [statsData]);

  const handleTableSortChange = useCallback((key: AdSortKey, dir: SortDir) => {
    setTableSortKey(key);
    setTableSortDir(dir);
  }, []);

  const handleStatusChange = useCallback((status: string | null) => {
    const params = new URLSearchParams(searchParams.toString());
    if (status === null) {
      params.delete('status');
    } else {
      params.set('status', status);
    }
    router.replace(`?${params.toString()}`);
  }, [router, searchParams]);
  const [view, setView] = useState<ViewMode>(() => {
    if (typeof window !== 'undefined') {
      return (localStorage.getItem('adListView') as ViewMode) || 'grid';
    }
    return 'grid';
  });
  const [selectMode, setSelectMode] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());
  const [downloading, setDownloading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const dragCounter = useRef(0);
  const quickAiRef = useRef<QuickAiCreateHandle>(null);

  const [showConfetti, setShowConfetti] = useState(false);

  // Fire welcome confetti once when arriving on the empty ads screen after setup/register
  useEffect(() => {
    if (isLoading) return;
    const flag = localStorage.getItem('welcomeConfetti');
    if (flag) {
      localStorage.removeItem('welcomeConfetti');
      setShowConfetti(true);
    }
  }, [isLoading]);

  const allAds = useMemo(() => data?.ads ?? [], [data?.ads]);

  const statusCounts = useMemo<StatusCounts>(() => ({
    active: allAds.filter((a) => a.active !== false).length,
    all: allAds.length,
    online: allAds.filter((a) => isOnlineOnKA(a, statsData)).length,
    draft: allAds.filter((a) => !a.id).length,
    reserved: allAds.filter((a) => isReserved(a, a.id ? statsData?.ads[String(a.id)] : undefined)).length,
    inactive: allAds.filter((a) => a.active === false).length,
    expired: allAds.filter((a) => isExpired(a)).length,
    orphaned: allAds.filter((a) => a.is_orphaned).length,
    expiring: allAds.filter((a) => isExpiringSoon(a)).length,
    changed: allAds.filter((a) => a.is_changed).length,
  }), [allAds, statsData]);

  // Status + category filter (before search/sort) — base for filteredAds
  const statusFilteredAds = useMemo(
    () => filterByParams(allAds, statusFilter, categoryFilter, statsData),
    [allAds, statusFilter, categoryFilter, statsData],
  );

  const filteredAds = useMemo(() => {
    const query = search.toLowerCase();
    let filtered = query
      ? statusFilteredAds.filter(
          (a) =>
            a.title?.toLowerCase().includes(query) ||
            a.category?.toLowerCase().includes(query),
        )
      : statusFilteredAds;
    const copy = [...filtered];
    copy.sort((a, b) => {
      const cmp = compareFn(a, b, tableSortKey);
      return tableSortDir === 'asc' ? cmp : -cmp;
    });
    return copy;
  }, [statusFilteredAds, search, tableSortKey, tableSortDir, compareFn]);

  const handleSelect = useCallback((file: string) => {
    setSelectedFiles((prev) => {
      const next = new Set(prev);
      if (next.has(file)) next.delete(file);
      else next.add(file);
      return next;
    });
  }, []);

  const clearSelection = useCallback(() => {
    setSelectedFiles(new Set());
    setSelectMode(false);
  }, []);

  const handleViewChange = useCallback((v: ViewMode) => {
    setView(v);
    localStorage.setItem('adListView', v);
  }, []);

  const handleToggleSelectMode = useCallback(() => {
    setSelectMode((prev) => {
      if (prev) setSelectedFiles(new Set());
      return !prev;
    });
  }, []);

  const handleGlobalDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    dragCounter.current++;
    if (e.dataTransfer.types.includes('Files')) setDragOver(true);
  }, []);

  const handleGlobalDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    dragCounter.current--;
    if (dragCounter.current === 0) setDragOver(false);
  }, []);

  const handleGlobalDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  }, []);

  const handleGlobalDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    dragCounter.current = 0;
    setDragOver(false);
    // Skip addFiles when drop landed inside QuickAiCreate — it handles files itself
    const insideQuickAi = !!(e.target as HTMLElement).closest('[data-quickai]');
    if (!insideQuickAi) {
      const files = Array.from(e.dataTransfer.files).filter((f) => f.type.startsWith('image/'));
      if (files.length > 0 && quickAiRef.current) {
        quickAiRef.current.addFiles(files);
      }
    }
  }, []);

  const handleDownloadAll = useCallback(async () => {
    setDownloading(true);
    try {
      await api.post<Job>('/api/bot/download', { ads: 'all' });
    } catch {
      // handled by toast
    } finally {
      setDownloading(false);
    }
  }, []);

  if (isLoading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: 'var(--space-10)' }}>
        <Spinner size="lg" />
      </div>
    );
  }

  return (
    <>
    {showConfetti && <Confetti />}
    <div
      className="animStagger"
      onDragEnter={handleGlobalDragEnter}
      onDragLeave={handleGlobalDragLeave}
      onDragOver={handleGlobalDragOver}
      onDrop={handleGlobalDrop}
    >
      {dragOver && (
        <div className={styles.dropOverlay}>
          <div className={styles.dropOverlayContent}>
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
              <circle cx="8.5" cy="8.5" r="1.5" />
              <polyline points="21 15 16 10 5 21" />
            </svg>
            <span>Bilder hier ablegen</span>
          </div>
        </div>
      )}
      <QuickAiCreate ref={quickAiRef} />

      {allAds.length === 0 ? (
        /* Empty state matching legacy design exactly */
        <div className={styles.emptyState}>
          {/* Monitor SVG icon */}
          <div className={styles.emptyIcon}>
            <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
              <line x1="8" y1="21" x2="16" y2="21" />
              <line x1="12" y1="17" x2="12" y2="21" />
            </svg>
          </div>
          <h3 className={styles.emptyTitle}>Noch keine Anzeigen</h3>
          <p className={styles.emptyMessage}>Starte mit einer der folgenden Optionen:</p>

          <div className={styles.emptyActions}>
            {/* AI create — only when API key is configured */}
            {isAiAvailable && (
              <button className={styles.actionCard} onClick={() => router.push('/ads/ai')}>
                <div className={styles.actionIcon}>
                  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
                  </svg>
                </div>
                <div className={styles.actionTitle}>Mit KI erstellen</div>
                <div className={styles.actionDesc}>KI füllt alle Felder aus</div>
              </button>
            )}

            {/* Download all */}
            <button
              className={styles.actionCard}
              onClick={handleDownloadAll}
              disabled={downloading}
            >
              <div className={styles.actionIcon}>
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="7 10 12 15 17 10" />
                  <line x1="12" y1="15" x2="12" y2="3" />
                </svg>
              </div>
              <div className={styles.actionTitle}>Alle herunterladen</div>
              <div className={styles.actionDesc}>Bestehende Anzeigen importieren</div>
            </button>

            {/* Manual create */}
            <button className={styles.actionCard} onClick={() => router.push('/ads/new')}>
              <div className={styles.actionIcon}>
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                  <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                </svg>
              </div>
              <div className={styles.actionTitle}>Manuell erstellen</div>
              <div className={styles.actionDesc}>Alle Felder selbst ausfüllen</div>
            </button>
          </div>
        </div>
      ) : (
        <>
          <AdListToolbar
            search={search}
            onSearchChange={setSearch}
            view={view}
            onViewChange={handleViewChange}
            selectMode={selectMode}
            onToggleSelectMode={handleToggleSelectMode}
            totalCount={allAds.length}
            filteredCount={filteredAds.length}
            statusFilter={statusFilter}
            onStatusChange={handleStatusChange}
            statusCounts={statusCounts}
          />
          {filteredAds.length === 0 && search ? (
            <div className={styles.emptyState}>
              <div className={styles.emptyIcon}>
                <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="11" cy="11" r="8" />
                  <line x1="21" y1="21" x2="16.65" y2="16.65" />
                </svg>
              </div>
              <h3 className={styles.emptyTitle}>Keine Ergebnisse</h3>
              <p className={styles.emptyMessage}>Keine Anzeigen gefunden für {'„'}{search}{'“'}</p>
            </div>
          ) : view === 'grid' ? (
            <AdGrid ads={filteredAds} selectedFiles={selectedFiles} onSelect={handleSelect} selectMode={selectMode} />
          ) : (
            <AdTable
              ads={filteredAds}
              selectedFiles={selectedFiles}
              onSelect={handleSelect}
              selectMode={selectMode}
              sortKey={tableSortKey}
              sortDir={tableSortDir}
              onSortChange={handleTableSortChange}
            />
          )}
          {selectMode && selectedFiles.size > 0 && (
            <AdBulkActions selectedFiles={selectedFiles} ads={allAds} onClear={clearSelection} />
          )}
        </>
      )}
    </div>
    </>
  );
}
