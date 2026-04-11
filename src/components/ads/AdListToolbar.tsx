'use client';

import styles from './AdListToolbar.module.scss';

type ViewMode = 'grid' | 'table';

interface AdListToolbarProps {
  search: string;
  onSearchChange: (value: string) => void;
  view: ViewMode;
  onViewChange: (view: ViewMode) => void;
  selectMode: boolean;
  onToggleSelectMode: () => void;
  totalCount: number;
  filteredCount: number;
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
}: AdListToolbarProps) {
  // Count text: "20 Anzeigen" or "5 von 20" when filtered
  const countText =
    filteredCount !== totalCount
      ? `${filteredCount} von ${totalCount}`
      : `${totalCount} Anzeigen`;

  return (
    <div className={styles.toolbar}>
      {/* Search input (flex: 1) */}
      <input
        type="text"
        className={styles.search}
        placeholder="Anzeigen suchen…"
        value={search}
        onChange={(e) => onSearchChange(e.target.value)}
      />

      {/* Ad count between search and toggle */}
      <span className={styles.count}>{countText}</span>

      {/* View toggle: Grid | Table | Select */}
      <div className={styles.viewToggle}>
        <button
          className={`${styles.viewBtn} ${view === 'grid' && !selectMode ? styles.viewBtnActive : ''}`}
          onClick={() => onViewChange('grid')}
          title="Karten-Ansicht"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
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
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
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
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 11l3 3L22 4" />
            <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
          </svg>
        </button>
      </div>
    </div>
  );
}
