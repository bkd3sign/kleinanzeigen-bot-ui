import React, { useCallback, useMemo, useRef, useState } from 'react';

export type SortDir = 'asc' | 'desc';

/**
 * Generic sort hook for table columns.
 * compareFn receives (a, b, sortKey) and should return a number like Array.sort.
 */
export function useSort<T, K extends string>(
  items: T[],
  defaultKey: K,
  compareFn: (a: T, b: T, key: K) => number,
) {
  const [sortKey, setSortKey] = useState<K>(defaultKey);
  const [sortDir, setSortDir] = useState<SortDir>('asc');

  // Stable ref so the useMemo below doesn't re-run when compareFn identity changes
  const compareFnRef = useRef(compareFn);
  compareFnRef.current = compareFn;

  const handleSort = useCallback((key: K) => {
    setSortDir((prev) => sortKey === key && prev === 'asc' ? 'desc' : 'asc');
    setSortKey(key);
  }, [sortKey]);

  const sorted = useMemo(() => {
    const copy = [...items];
    copy.sort((a, b) => {
      const cmp = compareFnRef.current(a, b, sortKey);
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return copy;
  }, [items, sortKey, sortDir]);

  // Returns a sort indicator icon element using global CSS classes (sortIcon / sortIconActive)
  const sortIcon = useCallback((col: K): React.ReactElement => {
    if (sortKey !== col) {
      return React.createElement('span', { className: 'sortIcon' }, '↕');
    }
    return React.createElement('span', { className: 'sortIconActive' }, sortDir === 'asc' ? '↑' : '↓');
  }, [sortKey, sortDir]);

  return { sorted, sortKey, sortDir, handleSort, sortIcon };
}
