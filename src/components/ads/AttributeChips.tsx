'use client';

import { useEffect, useMemo, useState } from 'react';
import { getLabel, HIDDEN_ATTR_SUFFIXES } from '@/lib/ads/category-attributes';
import { loadAttributeData, buildAttrDisplayMap } from '@/lib/ads/category-attributes-client';
import styles from './AttributeChips.module.scss';

interface Props {
  attrs: Record<string, unknown>;
  categoryId?: string;
  plainAttrs?: string[];
}

export function AttributeChips({ attrs, categoryId, plainAttrs }: Props) {
  const [displayMap, setDisplayMap] = useState<Record<string, Record<string, string>>>({});

  useEffect(() => {
    if (!categoryId) return;
    loadAttributeData()
      .then((data) => setDisplayMap(buildAttrDisplayMap(categoryId, data)))
      .catch(() => {});
  }, [categoryId]);

  const entries = Object.entries(attrs).filter(
    ([k, v]) => v != null && v !== '' && !HIDDEN_ATTR_SUFFIXES.some((s) => k.endsWith(s)),
  );

  const filledKeys = useMemo(
    () =>
      new Set(
        Object.keys(attrs).filter(
          (k) => attrs[k] != null && attrs[k] !== '' && !HIDDEN_ATTR_SUFFIXES.some((s) => k.endsWith(s)),
        ),
      ),
    [attrs],
  );

  const missingKeys = useMemo(
    () =>
      Object.keys(displayMap).filter(
        (k) => !filledKeys.has(k) && !HIDDEN_ATTR_SUFFIXES.some((s) => k.endsWith(s)),
      ),
    [displayMap, filledKeys],
  );

  if (!entries.length && !plainAttrs?.length && !missingKeys.length) return null;

  return (
    <div className={styles.root}>
      {plainAttrs?.map((label) => {
        const colonIdx = label.indexOf(': ');
        if (colonIdx !== -1) {
          const prefix = label.slice(0, colonIdx);
          const value = label.slice(colonIdx + 2);
          return (
            <span key={label} className={styles.chip}>
              <span className={styles.chipLabel}>{prefix}:</span>
              {value}
            </span>
          );
        }
        return (
          <span key={label} className={styles.chip}>
            {label}
          </span>
        );
      })}
      {entries.map(([k, v]) => {
        const rawVal = String(v);
        if (rawVal === 'true' || rawVal === 'false') {
          const isTrue = rawVal === 'true';
          return (
            <span key={k} className={styles.chip}>
              <span className={styles.chipLabel}>{getLabel(k)}</span>
              {isTrue ? (
                <svg className={styles.chipBoolTrue} width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="1.5 6.5 4.5 9.5 10.5 2.5" />
                </svg>
              ) : (
                <svg className={styles.chipBoolFalse} width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="2" y1="2" x2="10" y2="10" />
                  <line x1="10" y1="2" x2="2" y2="10" />
                </svg>
              )}
            </span>
          );
        }
        const displayVal = displayMap[k]?.[rawVal] ?? rawVal;
        return (
          <span key={k} className={styles.chip}>
            <span className={styles.chipLabel}>{getLabel(k)}:</span>
            {displayVal}
          </span>
        );
      })}
      {missingKeys.map((k) => (
        <span key={`missing-${k}`} className={`${styles.chip} ${styles.chipMissing}`}>
          <span className={`${styles.chipLabel} ${styles.chipLabelMissing}`}>{getLabel(k)}:</span>
          –
        </span>
      ))}
    </div>
  );
}
