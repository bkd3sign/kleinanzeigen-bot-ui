'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api/client';
import { Input, Textarea, Button, Spinner, useToast, showConfirm } from '@/components/ui';
import { AdForm, type AdFormData } from '@/components/ads/AdForm/AdForm';
import type { AdCreateInput } from '@/validation/schemas';
import type { Ad } from '@/types/ad';
import styles from './TemplateForm.module.scss';

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

interface TemplateData {
  slug: string;
  name: string;
  description: string;
  locked_fields: string[];
  source_ad_file?: string | null;
  ad_data: Record<string, unknown>;
}

interface TemplateFormProps {
  slug?: string;
  onSaved?: () => void;
}

// Map raw ad_data to AdFormData
function toFormDefaults(ad: Record<string, unknown>): AdFormData {
  const contact = (ad.contact as Record<string, string>) ?? {};
  return {
    title: (ad.title as string) ?? '',
    description: (ad.description as string) ?? '',
    category: (ad.category as string) ?? '',
    price: ad.price as number | undefined,
    price_type: (ad.price_type as AdFormData['price_type']) ?? 'NEGOTIABLE',
    shipping_type: (ad.shipping_type as AdFormData['shipping_type']) ?? 'SHIPPING',
    shipping_costs: ad.shipping_costs as number | undefined,
    shipping_options: (ad.shipping_options as string[]) ?? [],
    sell_directly: (ad.sell_directly as boolean) ?? false,
    images: (ad.images as string[]) ?? [],
    contact_name: contact.name ?? '',
    contact_zipcode: contact.zipcode ?? '',
    contact_location: contact.location ?? '',
    contact_street: contact.street ?? '',
    contact_phone: contact.phone ?? '',
    republication_interval: (ad.republication_interval as number) ?? 7,
    active: (ad.active as boolean) ?? true,
    type: (ad.type as AdFormData['type']) ?? 'OFFER',
    description_prefix: (ad.description_prefix as string) ?? '',
    description_suffix: (ad.description_suffix as string) ?? '',
    special_attributes: ad.special_attributes
      ? Object.fromEntries(Object.entries(ad.special_attributes as Record<string, unknown>).map(([k, v]) => [k, String(v)]))
      : {},
    auto_price_reduction: ad.auto_price_reduction as AdFormData['auto_price_reduction'],
  };
}

// Convert AdCreateInput back to ad_data for the API
function toAdData(data: AdCreateInput): Record<string, unknown> {
  const result: Record<string, unknown> = { ...data };

  // Reconstruct contact object
  const contact: Record<string, string> = {};
  if (data.contact_name) contact.name = data.contact_name;
  if (data.contact_zipcode) contact.zipcode = data.contact_zipcode;
  if (data.contact_location) contact.location = data.contact_location;
  if (data.contact_street) contact.street = data.contact_street;
  if (data.contact_phone) contact.phone = data.contact_phone;
  if (Object.keys(contact).length > 0) result.contact = contact;

  // Remove flat contact fields
  delete result.contact_name;
  delete result.contact_zipcode;
  delete result.contact_location;
  delete result.contact_street;
  delete result.contact_phone;

  return result;
}

export function TemplateForm({ slug, onSaved }: TemplateFormProps) {
  const isEdit = !!slug;
  const { toast } = useToast();
  const [loading, setLoading] = useState(!!slug);
  const [saving, setSaving] = useState(false);
  const [templateName, setTemplateName] = useState('');
  const [templateDesc, setTemplateDesc] = useState('');
  const [lockedFields, setLockedFields] = useState<Set<string>>(new Set());
  const [formDefaults, setFormDefaults] = useState<AdFormData | null>(null);
  const [sourceAdFile, setSourceAdFile] = useState<string | null>(null);

  // Load existing template
  useEffect(() => {
    if (!slug) {
      setFormDefaults({});
      return;
    }
    setLoading(true);
    api.get<TemplateData>(`/api/templates/${slug}`)
      .then((data) => {
        setTemplateName(data.name);
        setTemplateDesc(data.description ?? '');
        setLockedFields(new Set(data.locked_fields ?? []));
        setSourceAdFile(data.source_ad_file ?? null);
        setFormDefaults(toFormDefaults(data.ad_data));
      })
      .catch(() => {
        toast('error', 'Vorlage konnte nicht geladen werden');
      })
      .finally(() => setLoading(false));
  }, [slug, toast]);

  const toggleField = useCallback((field: string) => {
    setLockedFields((prev) => {
      const next = new Set(prev);
      if (next.has(field)) next.delete(field);
      else next.add(field);
      return next;
    });
  }, []);

  const handleSubmit = useCallback(
    async (data: AdCreateInput) => {
      if (!templateName.trim()) {
        toast('error', 'Bitte einen Vorlagennamen angeben');
        return;
      }

      setSaving(true);
      try {
        const payload = {
          name: templateName.trim(),
          description: templateDesc.trim(),
          locked_fields: Array.from(lockedFields),
          ad_data: toAdData(data),
        };

        if (isEdit && slug) {
          await api.put(`/api/templates/${slug}`, payload);
          toast('success', 'Vorlage aktualisiert');
        } else {
          await api.post('/api/templates', payload);
          toast('success', 'Vorlage erstellt');
        }
        onSaved?.();
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Fehler beim Speichern';
        toast('error', message);
      } finally {
        setSaving(false);
      }
    },
    [templateName, templateDesc, lockedFields, isEdit, slug, toast, onSaved],
  );

  const handleDelete = useCallback(async () => {
    if (!slug) return;
    const confirmed = await showConfirm(
      'Vorlage löschen',
      `Soll die Vorlage "${templateName || slug}" wirklich gelöscht werden?`,
      'Löschen',
      'Abbrechen',
    );
    if (!confirmed) return;
    try {
      await api.delete(`/api/templates/${slug}`);
      toast('success', 'Vorlage gelöscht');
      onSaved?.();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Fehler beim Löschen';
      toast('error', message);
    }
  }, [slug, templateName, toast, onSaved]);

  if (loading || formDefaults === null) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: 'var(--space-10)' }}>
        <Spinner size="lg" />
      </div>
    );
  }

  return (
    <div>
      {/* Template meta fields */}
      <div className={styles.metaSection}>
        <div className={styles.metaHeader}>
          <span className={styles.metaBadge}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
              <path d="M17 21v-8H7v8" />
              <path d="M7 3v5h8" />
            </svg>
            Vorlage
          </span>
          <h2 className={styles.metaTitle}>
            {isEdit ? 'Vorlage bearbeiten' : 'Neue Vorlage'}
          </h2>
        </div>

        <div className={styles.metaBody}>
          <Input
            label="Vorlagenname"
            value={templateName}
            onChange={(e) => setTemplateName(e.target.value)}
            placeholder="z.B. Standard-Elektronik"
            required
          />

          <Textarea
            label="Beschreibung"
            value={templateDesc}
            onChange={(e) => setTemplateDesc(e.target.value)}
            placeholder="Wofür ist diese Vorlage?"
            rows={2}
          />

          <fieldset className={styles.fieldset}>
            <legend className={styles.legend}>Gesperrte Felder</legend>
            <p className={styles.hint}>
              Diese Felder können beim Erstellen aus dieser Vorlage nicht geändert werden.
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
      </div>

      <div className={styles.divider}>
        <span className={styles.dividerLabel}>Anzeigendaten</span>
      </div>

      {/* Reuse AdForm for the ad data fields */}
      <AdForm
        defaultValues={formDefaults}
        onSubmit={handleSubmit}
        onDelete={isEdit ? handleDelete : undefined}
        isSubmitting={saving}
        isEdit={isEdit}
        adFile={sourceAdFile ?? undefined}
        title=" "
        submitLabel="Vorlage speichern"
        deleteLabel="Vorlage löschen"
      />
    </div>
  );
}
