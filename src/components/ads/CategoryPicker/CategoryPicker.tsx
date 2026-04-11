'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Input } from '@/components/ui';
import styles from './CategoryPicker.module.scss';

interface Category {
  id: string;
  name: string;
  group?: string;
}

interface CategoryPickerProps {
  value: string;
  onChange: (value: string) => void;
  label?: ReactNode;
  disabled?: boolean;
}

let categoriesCache: Category[] | null = null;

async function loadCategories(): Promise<Category[]> {
  if (categoriesCache) return categoriesCache;
  try {
    const res = await fetch('/data/category_attributes.json');
    const data = await res.json() as { categories: Record<string, { category_name: string; group: string }> };
    categoriesCache = Object.entries(data.categories).map(([id, entry]) => ({
      id,
      name: entry.category_name,
      group: entry.group,
    }));
    return categoriesCache;
  } catch {
    return [];
  }
}

export function CategoryPicker({
  value,
  onChange,
  label = 'Kategorie',
  disabled = false,
}: CategoryPickerProps) {
  const [categories, setCategories] = useState<Category[]>([]);
  const [search, setSearch] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const [highlightIndex, setHighlightIndex] = useState(-1);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    loadCategories().then(setCategories);
  }, []);

  // Resolve current value to display text
  const displayValue = useMemo(() => {
    if (!value) return '';
    const cat = categories.find((c) => c.id === value);
    if (!cat) return value;
    return `${cat.name}  (${cat.id})`;
  }, [value, categories]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    if (!q) return categories;
    return categories.filter((c) => c.name.toLowerCase().includes(q) || c.id.toLowerCase().includes(q));
  }, [categories, search]);

  const handleSelect = useCallback(
    (cat: Category) => {
      onChange(cat.id);
      setSearch('');
      setIsOpen(false);
      setHighlightIndex(-1);
    },
    [onChange],
  );

  const handleInputFocus = useCallback(async () => {
    if (categories.length === 0) {
      const cats = await loadCategories();
      setCategories(cats);
    }
    setIsOpen(true);
  }, [categories.length]);

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setSearch(e.target.value);
      // Clear selection when user types
      if (value) onChange('');
      if (!isOpen) setIsOpen(true);
      setHighlightIndex(-1);
    },
    [value, onChange, isOpen],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (!isOpen) {
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          setIsOpen(true);
          e.preventDefault();
        }
        if ((e.key === 'Backspace' || e.key === 'Delete') && value) {
          e.preventDefault();
          onChange('');
          setSearch('');
          setIsOpen(true);
        }
        return;
      }

      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          setHighlightIndex((prev) => Math.min(prev + 1, filtered.length - 1));
          break;
        case 'ArrowUp':
          e.preventDefault();
          setHighlightIndex((prev) => Math.max(prev - 1, 0));
          break;
        case 'Enter':
          e.preventDefault();
          if (highlightIndex >= 0 && highlightIndex < filtered.length) {
            handleSelect(filtered[highlightIndex]);
          }
          break;
        case 'Escape':
          e.preventDefault();
          setIsOpen(false);
          break;
      }
    },
    [isOpen, value, onChange, filtered, highlightIndex, handleSelect],
  );

  // Scroll highlighted item into view
  useEffect(() => {
    if (highlightIndex >= 0 && dropdownRef.current) {
      const items = dropdownRef.current.querySelectorAll('[data-index]');
      const target = items[highlightIndex];
      if (target) {
        target.scrollIntoView({ block: 'nearest' });
      }
    }
  }, [highlightIndex]);

  // Close on outside click
  useEffect(() => {
    if (!isOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [isOpen]);

  // Group categories so each group gets its own container for sticky headers
  const grouped = useMemo(() => {
    const groups: Array<{ group: string | null; items: Array<{ cat: Category; globalIndex: number }> }> = [];
    let currentGroup: string | null = null;

    filtered.forEach((cat, i) => {
      const g = cat.group ?? null;
      if (g !== currentGroup || groups.length === 0) {
        groups.push({ group: g, items: [] });
        currentGroup = g;
      }
      groups[groups.length - 1].items.push({ cat, globalIndex: i });
    });

    return groups;
  }, [filtered]);

  return (
    <div className={styles.wrapper} ref={wrapperRef}>
      <div className={styles.inputWrap}>
        <Input
          label={label}
          placeholder="Kategorie suchen…"
          value={isOpen ? search : displayValue}
          onChange={handleInputChange}
          onFocus={disabled ? undefined : handleInputFocus}
          onKeyDown={handleKeyDown}
          autoComplete="off"
          disabled={disabled}
        />
        <svg className={styles.chevron} width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </div>

      {isOpen && (
        <div className={styles.dropdown} ref={dropdownRef} role="listbox">
          {filtered.length === 0 ? (
            <div className={styles.empty}>Keine Kategorien gefunden.</div>
          ) : (
            grouped.map((group, gi) => (
              <div key={gi} className={styles.group}>
                {group.group && (
                  <div className={styles.groupLabel}>{group.group}</div>
                )}
                {group.items.map(({ cat, globalIndex: i }) => {
                  let itemClass = styles.item;
                  if (cat.id === value) itemClass = styles.itemSelected;
                  if (i === highlightIndex) {
                    itemClass = cat.id === value ? styles.itemSelectedHighlighted : styles.itemHighlighted;
                  }

                  return (
                    <button
                      key={cat.id}
                      type="button"
                      className={itemClass}
                      data-index={i}
                      role="option"
                      aria-selected={cat.id === value}
                      onMouseDown={(e) => {
                        e.preventDefault();
                        handleSelect(cat);
                      }}
                      onMouseEnter={() => setHighlightIndex(i)}
                    >
                      <span className={styles.itemName}>
                        {cat.name}
                      </span>
                      <span className={styles.itemId}>{cat.id}</span>
                    </button>
                  );
                })}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
