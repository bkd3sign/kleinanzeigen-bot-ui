'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DropdownMenu } from '@/components/ui';
import type { DropdownMenuItem } from '@/components/ui';
import styles from './AdListToolbar.module.scss';

type ViewMode = 'grid' | 'table';

export interface StatusCounts {
  active: number;
  all: number;
  online: number;
  draft: number;
  reserved: number;
  inactive: number;
  expired: number;
  orphaned: number;
  expiring: number;
  changed: number;
}

type FilterOption = {
  value: string | null;
  label: string;
  icon: React.ReactNode;
  countKey: keyof StatusCounts;
  separator?: true;
};

const svgProps = {
  width: 14,
  height: 14,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
};

const FILTER_OPTIONS: FilterOption[] = [
  {
    value: null, label: 'Aktiv', countKey: 'active',
    icon: <svg {...svgProps}><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" /></svg>,
  },
  {
    value: 'all', label: 'Alle Anzeigen', countKey: 'all',
    icon: <svg {...svgProps}><line x1="8" y1="6" x2="21" y2="6" /><line x1="8" y1="12" x2="21" y2="12" /><line x1="8" y1="18" x2="21" y2="18" /><line x1="3" y1="6" x2="3.01" y2="6" /><line x1="3" y1="12" x2="3.01" y2="12" /><line x1="3" y1="18" x2="3.01" y2="18" /></svg>,
  },
  {
    value: 'online', label: 'Online', countKey: 'online', separator: true,
    icon: <svg {...svgProps}><circle cx="12" cy="12" r="10" /><line x1="2" y1="12" x2="22" y2="12" /><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" /></svg>,
  },
  {
    value: 'draft', label: 'Entwürfe', countKey: 'draft',
    icon: <svg {...svgProps}><path d="M12 20h9" /><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" /></svg>,
  },
  {
    value: 'reserved', label: 'Reserviert', countKey: 'reserved',
    icon: <svg {...svgProps}><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" /></svg>,
  },
  {
    value: 'inactive', label: 'Inaktiv', countKey: 'inactive', separator: true,
    icon: <svg {...svgProps}><circle cx="12" cy="12" r="10" /><line x1="4.93" y1="4.93" x2="19.07" y2="19.07" /></svg>,
  },
  {
    value: 'expired', label: 'Abgelaufen', countKey: 'expired',
    icon: <svg {...svgProps}><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>,
  },
  {
    value: 'orphaned', label: 'Verwaist', countKey: 'orphaned',
    icon: <svg {...svgProps}><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" /><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" /><line x1="2" y1="2" x2="22" y2="22" /></svg>,
  },
  {
    value: 'expiring', label: 'Bald auslaufen', countKey: 'expiring', separator: true,
    icon: <svg {...svgProps}><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" /></svg>,
  },
  {
    value: 'changed', label: 'Geändert', countKey: 'changed',
    icon: <svg {...svgProps}><polyline points="23 4 23 10 17 10" /><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" /></svg>,
  },
];



interface AdListToolbarProps {
  search: string;
  onSearchChange: (value: string) => void;
  view: ViewMode;
  onViewChange: (view: ViewMode) => void;
  selectMode: boolean;
  onToggleSelectMode: () => void;
  totalCount: number;
  filteredCount: number;
  statusFilter: string | null;
  onStatusChange: (status: string | null) => void;
  statusCounts: StatusCounts;
}

export function AdListToolbar({
  search,
  onSearchChange,
  view,
  onViewChange,
  selectMode,
  onToggleSelectMode,
  totalCount,
  filteredCount,
  statusFilter,
  onStatusChange,
  statusCounts,
}: AdListToolbarProps) {
  const [filterOpen, setFilterOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const filterBtnRef = useRef<HTMLButtonElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [dropdownPos, setDropdownPos] = useState<{ top?: number; bottom?: number; right: number; maxHeight?: number }>({ right: 0 });

  const openSearch = useCallback(() => {
    setSearchOpen(true);
    requestAnimationFrame(() => searchInputRef.current?.focus());
  }, []);

  const closeSearch = useCallback(() => {
    setSearchOpen(false);
    onSearchChange('');
  }, [onSearchChange]);

  // Close search overlay on Escape
  useEffect(() => {
    if (!searchOpen) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') closeSearch(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [searchOpen, closeSearch]);

  const countText =
    filteredCount !== totalCount
      ? `${filteredCount} von ${totalCount}`
      : `${totalCount} Anzeigen`;

  const currentLabel = FILTER_OPTIONS.find((o) => o.value === statusFilter)?.label ?? 'Aktiv';
  const isFiltered = statusFilter !== null;

  const openFilter = useCallback(() => {
    if (!filterBtnRef.current) return;
    const rect = filterBtnRef.current.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom - 8;
    const spaceAbove = rect.top - 8;
    const right = window.innerWidth - rect.right;

    if (spaceBelow >= 160 || spaceBelow >= spaceAbove) {
      setDropdownPos({ top: rect.bottom + 4, right, maxHeight: spaceBelow });
    } else {
      setDropdownPos({ bottom: window.innerHeight - rect.top + 4, right, maxHeight: spaceAbove });
    }
    setFilterOpen(true);
  }, []);

  const filterItems = useMemo<DropdownMenuItem[]>(() =>
    FILTER_OPTIONS.map((opt) => ({
      label: (
        <span className={styles.filterItemLabel}>
          <span>{opt.label}</span>
          <span className={styles.filterCount}>{statusCounts[opt.countKey]}</span>
        </span>
      ),
      separator: opt.separator,
      icon: opt.icon,
      onClick: () => onStatusChange(opt.value),
    })),
    [onStatusChange, statusCounts],
  );

  return (
    <div className={styles.toolbar}>
      {/* Mobile search icon button — shown when search overlay is closed */}
      <button
        className={`${styles.searchBtn} ${search ? styles.viewBtnActive : ''}`}
        onClick={openSearch}
        aria-label="Suchen"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flexShrink: 0 }}>
          <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
      </button>

      {/* Search input — always visible on desktop, overlay on mobile */}
      <div className={`${styles.searchWrap} ${searchOpen ? styles.searchWrapOpen : ''}`}>
        <input
          ref={searchInputRef}
          type="text"
          className={styles.search}
          placeholder="Anzeigen suchen…"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
        />
        <button className={styles.searchClose} onClick={closeSearch} aria-label="Suche schließen">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      <span className={styles.count}>{countText}</span>

      {/* View toggle: Filter | Grid | Table | Select */}
      <div className={styles.viewToggle}>
        <button
          ref={filterBtnRef}
          className={`${styles.viewBtn} ${isFiltered ? styles.viewBtnActive : ''}`}
          onClick={openFilter}
          title={`Filter: ${currentLabel}`}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
          </svg>
          <span className={styles.filterLabel}>{currentLabel}</span>
        </button>

        {filterOpen && (
          <DropdownMenu
            items={filterItems}
            pos={dropdownPos}
            onClose={() => setFilterOpen(false)}
          />
        )}
        <button
          className={`${styles.viewBtn} ${view === 'grid' && !selectMode ? styles.viewBtnActive : ''}`}
          onClick={() => onViewChange('grid')}
          title="Karten-Ansicht"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M3 3h7v7H3z" />
            <path d="M14 3h7v7h-7z" />
            <path d="M3 14h7v7H3z" />
            <path d="M14 14h7v7h-7z" />
          </svg>
        </button>
        <button
          className={`${styles.viewBtn} ${view === 'table' && !selectMode ? styles.viewBtnActive : ''}`}
          onClick={() => onViewChange('table')}
          title="Tabellen-Ansicht"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M3 6h18" />
            <path d="M3 12h18" />
            <path d="M3 18h18" />
          </svg>
        </button>
        <button
          className={`${styles.viewBtn} ${selectMode ? styles.viewBtnActive : ''}`}
          onClick={onToggleSelectMode}
          title="Auswählen"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M9 11l3 3L22 4" />
            <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
          </svg>
        </button>
      </div>
    </div>
  );
}
