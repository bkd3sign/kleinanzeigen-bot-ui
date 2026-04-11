'use client';

import { useState, useCallback, useEffect } from 'react';
import { Modal } from '@/components/ui/Modal/Modal';
import { Input } from '@/components/ui/Input/Input';
import { Textarea } from '@/components/ui/Textarea/Textarea';
import { Button } from '@/components/ui/Button/Button';
import { useToast } from '@/components/ui';
import { api } from '@/lib/api/client';
import type { Ad } from '@/types/ad';
import styles from './SaveAsTemplateModal.module.scss';

// Fields that can be locked in a template
const LOCKABLE_FIELDS: { key: string; label: string }[] = [
  { key: 'category', label: 'Kategorie' },
  { key: 'price_type', label: 'Preistyp' },
  { key: 'shipping_type', label: 'Versandart' },
  { key: 'type', label: 'Angebotstyp' },
  { key: 'contact', label: 'Kontaktdaten' },
  { key: 'republication_interval', label: 'Republizierungsintervall' },
  { key: 'description_prefix', label: 'Beschreibungs-Prefix' },
  { key: 'description_suffix', label: 'Beschreibungs-Suffix' },
];

// Bot-managed fields to strip from template data
const BOT_MANAGED_FIELDS = [
  'id', 'created_on', 'updated_on', 'content_hash',
  'repost_count', 'price_reduction_count', 'file',
];

interface SaveAsTemplateModalProps {
  open: boolean;
  onClose: () => void;
  adFile: string;
  adTitle: string;
}

export function SaveAsTemplateModal({ open, onClose, adFile, adTitle }: SaveAsTemplateModalProps) {
  const { toast } = useToast();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [lockedFields, setLockedFields] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);
  const [adData, setAdData] = useState<Record<string, unknown> | null>(null);

  // Pre-fill name from ad title and fetch full ad data
  useEffect(() => {
    if (!open) return;
    setName(adTitle.slice(0, 40));
    setDescription('');
    setLockedFields(new Set());
    setAdData(null);

    setLoading(true);
    api.get<Ad>(`/api/ads/by-file/${adFile}`)
      .then((data) => {
        // Strip bot-managed fields
        const cleaned: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(data)) {
          if (!BOT_MANAGED_FIELDS.includes(key)) {
            cleaned[key] = value;
          }
        }
        setAdData(cleaned);
      })
      .catch(() => {
        toast('error', 'Anzeigendaten konnten nicht geladen werden');
        onClose();
      })
      .finally(() => setLoading(false));
  }, [open, adFile, adTitle, toast, onClose]);

  const toggleField = useCallback((field: string) => {
    setLockedFields((prev) => {
      const next = new Set(prev);
      if (next.has(field)) next.delete(field);
      else next.add(field);
      return next;
    });
  }, []);

  const handleSave = useCallback(async () => {
    if (!name.trim() || !adData) return;

    setSaving(true);
    try {
      await api.post('/api/templates', {
        name: name.trim(),
        description: description.trim(),
        locked_fields: Array.from(lockedFields),
        ad_data: { ...adData, _source_ad_file: adFile },
      });
      toast('success', `Vorlage "${name.trim()}" gespeichert`);
      onClose();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Fehler beim Speichern';
      toast('error', message);
    } finally {
      setSaving(false);
    }
  }, [name, description, lockedFields, adData, toast, onClose, adFile]);

  return (
    <Modal open={open} onClose={onClose} title="Als Vorlage speichern" footer={
      <div className={styles.footer}>
        <Button variant="secondary" onClick={onClose} disabled={saving}>
          Abbrechen
        </Button>
        <Button variant="warning" onClick={handleSave} disabled={saving || loading || !name.trim()}>
          {saving ? 'Speichern…' : 'Vorlage speichern'}
        </Button>
      </div>
    }>
      {loading ? (
        <div className={styles.loading}>Lade Anzeigendaten…</div>
      ) : (
        <div className={styles.form}>
          <Input
            label="Vorlagenname"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Name der Vorlage"
            required
            autoFocus
          />

          <Textarea
            label="Beschreibung"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Optionale Beschreibung der Vorlage"
            rows={3}
          />

          <fieldset className={styles.fieldset}>
            <legend className={styles.legend}>Felder sperren</legend>
            <p className={styles.hint}>
              Gesperrte Felder können beim Erstellen aus dieser Vorlage nicht geändert werden.
            </p>
            <div className={styles.checkboxGrid}>
              {LOCKABLE_FIELDS.map(({ key, label }) => (
                <label key={key} className={styles.checkboxLabel}>
                  <input
                    type="checkbox"
                    checked={lockedFields.has(key)}
                    onChange={() => toggleField(key)}
                    className={styles.checkbox}
                  />
                  {label}
                </label>
              ))}
            </div>
          </fieldset>
        </div>
      )}
    </Modal>
  );
}
