'use client';

import { useEffect, useState, useCallback } from 'react';

let cache: Map<string, string> | null = null;
let loadPromise: Promise<Map<string, string>> | null = null;

async function loadMap(): Promise<Map<string, string>> {
  if (cache) return cache;
  if (loadPromise) return loadPromise;
  loadPromise = fetch('/data/category_attributes.json')
    .then((res) => res.json())
    .then((data: { categories: Record<string, { category_name: string }> }) => {
      const map = new Map<string, string>();
      for (const [id, entry] of Object.entries(data.categories)) {
        map.set(id, entry.category_name);
      }
      cache = map;
      return map;
    })
    .catch(() => new Map<string, string>());
  return loadPromise;
}

/**
 * Hook that returns a function to resolve category IDs to names.
 * Falls back to the raw ID if not found.
 */
export function useCategoryName(): (id: string | undefined | null) => string {
  const [map, setMap] = useState<Map<string, string>>(cache ?? new Map());

  useEffect(() => {
    if (cache) {
      setMap(cache);
      return;
    }
    loadMap().then(setMap);
  }, []);

  return useCallback(
    (id: string | undefined | null): string => {
      if (!id) return '';
      const full = map.get(id) ?? id;
      const last = full.split(' > ').pop();
      return last ?? full;
    },
    [map],
  );
}
