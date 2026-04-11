'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useFormContext } from 'react-hook-form';
import { Select, Toggle, Input, Button } from '@/components/ui';
import { InfoTip } from './InfoTip';
import type { AdCreateInput } from '@/validation/schemas';
import { resolveAttributes, getLabel, shortKey } from '@/lib/ads/category-attributes';
import type { ResolvedAttribute } from '@/lib/ads/category-attributes';
import styles from './AdForm.module.scss';

interface AttributeOption {
  value: string;
  text: string;
}

interface SharedAttributeDef {
  options?: AttributeOption[];
  type?: string;
  text?: string;
}

interface InlineAttributeDef extends SharedAttributeDef {
  attribute_key: string;
}

interface CategoryEntry {
  attributes: InlineAttributeDef[];
  shared: string[];
}

interface AttributeData {
  categories: Record<string, CategoryEntry>;
  shared_attributes: Record<string, SharedAttributeDef>;
}

type AttrValues = Record<string, string>;

// Module-level cache to avoid re-fetching
let attrDataCache: AttributeData | null = null;

async function loadAttributeData(): Promise<AttributeData> {
  if (attrDataCache) return attrDataCache;
  const res = await fetch('/data/category_attributes.json');
  attrDataCache = await res.json() as AttributeData;
  return attrDataCache;
}

// -- CategoryAttributesPicker --

interface CategoryAttributesPickerProps {
  category: string;
  values: AttrValues;
  onChange: (values: AttrValues) => void;
}

function isEmpty(val: string | undefined): boolean {
  return val === undefined || val === null || val === '';
}


export function CategoryAttributesPicker({ category, values, onChange }: CategoryAttributesPickerProps) {
  const [data, setData] = useState<AttributeData | null>(null);
  const { setError, clearErrors, formState: { submitCount } } = useFormContext<AdCreateInput>();
  const wasSubmitted = submitCount > 0;

  useEffect(() => {
    loadAttributeData().then(setData).catch(() => {});
  }, []);

  const attrs = useMemo(() => {
    if (!data || !category) return [];
    const entry = data.categories[category];
    if (!entry) return [];
    return resolveAttributes(entry, data.shared_attributes, category);
  }, [data, category]);

  // Always store with short key so saved YAML and loaded YAML use the same format
  const handleChange = useCallback((key: string, val: string | number | boolean) => {
    onChange({ ...values, [shortKey(key)]: String(val) });
  }, [values, onChange]);

  // Look up value by full key or short key (handles both newly set and YAML-loaded values)
  const getVal = useCallback((key: string) => {
    return values[key] ?? values[shortKey(key)];
  }, [values]);

  const nonBoolAttrs = useMemo(() => attrs.filter((a) => a.type !== 'boolean'), [attrs]);
  const boolAttrs = useMemo(() => attrs.filter((a) => a.type === 'boolean'), [attrs]);

  // Validate required attrs and sync with form error state
  useEffect(() => {
    if (nonBoolAttrs.length === 0) { clearErrors('special_attributes'); return; }
    const hasMissing = nonBoolAttrs.some((attr) => {
      if (attr.type === 'month-year') return isEmpty(getVal(attr.key) as string) || isEmpty(getVal(attr.yearKey!) as string);
      return isEmpty(getVal(attr.key) as string);
    });
    if (hasMissing) {
      setError('special_attributes', { type: 'required', message: 'Bitte alle Merkmale ausfüllen' });
    } else {
      clearErrors('special_attributes');
    }
  }, [getVal, nonBoolAttrs, setError, clearErrors]);

  if (!data || attrs.length === 0) {
    return <KvEditor entries={values} onChange={onChange} />;
  }

  return (
    <div>
      <label className="formLabel">
        Merkmale <InfoTip text="Kategorie-spezifische Attribute für die Anzeige auf Kleinanzeigen" />
      </label>
      <div className={styles.attrGrid}>
        {nonBoolAttrs.map((attr) => {
          if (attr.type === 'select' && attr.options) {
            return (
              <Select
                key={attr.key}
                label={attr.label}
                required
                options={[
                  { value: '', label: 'Bitte wählen' },
                  ...attr.options.map((o) => ({ value: o.value, label: o.text })),
                ]}
                value={String(getVal(attr.key) ?? '')}
                onChange={(e) => handleChange(attr.key, e.target.value)}
                error={wasSubmitted && isEmpty(getVal(attr.key) as string) ? 'Pflichtfeld' : undefined}
              />
            );
          }
          if (attr.type === 'month-year') {
            return (
              <div key={attr.key} style={{ gridColumn: '1 / -1' }}>
                <label className="formLabel">{attr.label} <span style={{ color: 'var(--red)' }}>*</span></label>
                <div className={styles.row}>
                  <Select
                    label={getLabel(attr.key)}
                    required
                    options={[
                      { value: '', label: 'Bitte wählen' },
                      ...(attr.options ?? []).map((o) => ({ value: o.value, label: o.text })),
                    ]}
                    value={String(getVal(attr.key) ?? '')}
                    onChange={(e) => handleChange(attr.key, e.target.value)}
                    error={wasSubmitted && isEmpty(getVal(attr.key) as string) ? 'Pflichtfeld' : undefined}
                  />
                  <Select
                    label={getLabel(attr.yearKey!)}
                    required
                    options={[
                      { value: '', label: 'Bitte wählen' },
                      ...(attr.yearOptions ?? []).map((o) => ({ value: o.value, label: o.text })),
                    ]}
                    value={String(getVal(attr.yearKey!) ?? '')}
                    onChange={(e) => handleChange(attr.yearKey!, e.target.value)}
                    error={wasSubmitted && isEmpty(getVal(attr.yearKey!) as string) ? 'Pflichtfeld' : undefined}
                  />
                </div>
              </div>
            );
          }
          return (
            <Input
              key={attr.key}
              label={attr.label}
              required
              type="number"
              value={String(getVal(attr.key) ?? '')}
              onChange={(e) => handleChange(attr.key, e.target.value)}
              error={wasSubmitted && isEmpty(getVal(attr.key) as string) ? 'Pflichtfeld' : undefined}
            />
          );
        })}
      </div>

      {boolAttrs.length > 0 && (
        <div className={styles.attrBoolSection}>
          <label className="formLabel">Ausstattung</label>
          <div className={styles.attrBoolGrid}>
            {boolAttrs.map((attr) => (
              <Toggle
                key={attr.key}
                label={attr.label}
                checked={!!getVal(attr.key)}
                onChange={(val) => handleChange(attr.key, val)}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// -- KvEditor fallback for categories without defined attributes --

interface KvEditorProps {
  entries: AttrValues;
  onChange: (entries: AttrValues) => void;
}

function KvEditor({ entries, onChange }: KvEditorProps) {
  const [newKey, setNewKey] = useState('');
  const [newValue, setNewValue] = useState('');

  const handleAdd = useCallback(() => {
    const key = newKey.trim();
    if (!key) return;
    onChange({ ...entries, [key]: newValue });
    setNewKey('');
    setNewValue('');
  }, [entries, newKey, newValue, onChange]);

  const handleRemove = useCallback((key: string) => {
    const next = { ...entries };
    delete next[key];
    onChange(next);
  }, [entries, onChange]);

  return (
    <div>
      <label className="formLabel">Merkmale <InfoTip text='Key-Value Paare, z.B. "farbe": "schwarz"' /></label>

      <div className={styles.kvRows}>
        {Object.entries(entries).map(([key, value]) => (
          <div key={key} className={styles.kvRow}>
            <input className={styles.kvInput} value={key} disabled placeholder="Attribut" />
            <input className={styles.kvInput} value={String(value)} disabled placeholder="Wert" />
            <button type="button" className={styles.kvRemove} onClick={() => handleRemove(key)} aria-label="Entfernen">×</button>
          </div>
        ))}
        <div className={styles.kvRow}>
          <input
            className={styles.kvInput}
            placeholder="Attribut"
            value={newKey}
            onChange={(e) => setNewKey(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleAdd(); } }}
          />
          <input
            className={styles.kvInput}
            placeholder="Wert"
            value={newValue}
            onChange={(e) => setNewValue(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleAdd(); } }}
          />
          <button type="button" className={styles.kvRemoveDisabled} disabled aria-hidden="true">×</button>
        </div>
      </div>

      <Button type="button" variant="ghost" size="sm" onClick={handleAdd}>
        + Hinzufügen
      </Button>
    </div>
  );
}
