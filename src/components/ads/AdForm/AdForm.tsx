'use client';

import { useCallback, useRef, useState, type ReactNode } from 'react';
import { useForm, FormProvider, type FieldErrors } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { adCreateSchema, type AdCreateInput } from '@/validation/schemas';
import { Button, Toggle, useToast } from '@/components/ui';
import { InfoTip } from './InfoTip';
import { DetailsSection } from './DetailsSection';
import { LocationSection } from './LocationSection';
import { ContactSection } from './ContactSection';
import { AdvancedSection } from './AdvancedSection';
import { PriceReductionSection } from './PriceReductionSection';
import { BotInfoSection } from './BotInfoSection';
import styles from './AdForm.module.scss';

// Data passed from AI generation stored in sessionStorage
export interface AiPriceHint {
  uvp?: number | null;
  market_low?: number | null;
  market_high?: number | null;
  suggestion?: number | null;
  condition_note?: string;
}

export interface AdFormData extends Partial<AdCreateInput> {
  // AI-provided extras not in schema
  price_hint?: AiPriceHint;
  shipping_size?: string;
}

interface AdFormProps {
  defaultValues?: AdFormData;
  initialFiles?: File[];
  pendingFilesRef?: React.MutableRefObject<File[]>;
  onSubmit: (data: AdCreateInput) => Promise<void>;
  onPublishAndSave?: (data: AdCreateInput) => Promise<void>;
  onUpdateAndSave?: (data: AdCreateInput) => Promise<void>;
  isPublishing?: boolean;
  isUpdating?: boolean;
  onDelete?: () => void;
  isSubmitting?: boolean;
  isEdit?: boolean;
  adFile?: string;
  title?: string;
  onDuplicate?: () => void;
  onSaveAsTemplate?: () => void;
  // Bot-managed fields for edit mode display
  botInfo?: {
    id?: string | number | null;
    created_on?: string | null;
    updated_on?: string | null;
    content_hash?: string | null;
    repost_count?: number | null;
    price_reduction_count?: number | null;
  };
  configDefaults?: Record<string, unknown>;
  submitLabel?: string;
  deleteLabel?: string;
  lockedFields?: string[];
  templateName?: string;
}

// Clean up fields that don't apply based on current selections
function cleanupAdData(data: AdCreateInput) {
  if (data.shipping_type !== 'SHIPPING') {
    data.shipping_costs = null;
    data.shipping_options = null;
    data.sell_directly = false;
  } else {
    // Mutual exclusivity: shipping_options OR shipping_costs, never both
    const hasOptions = data.shipping_options && data.shipping_options.length > 0;
    if (hasOptions) {
      data.shipping_costs = null;
    } else {
      data.shipping_options = null;
    }
  }
  if (data.price_type === 'GIVE_AWAY') {
    data.price = 0;
  }
}

// Human-readable labels for lockable field keys
const LOCKED_FIELD_LABELS: Record<string, string> = {
  category: 'Kategorie',
  price_type: 'Preistyp',
  shipping_type: 'Versandart',
  type: 'Angebotstyp',
  contact: 'Kontaktdaten',
  republication_interval: 'Republizierungsintervall',
  description_prefix: 'Beschreibungs-Prefix',
  description_suffix: 'Beschreibungs-Suffix',
};

export function AdForm({
  defaultValues,
  initialFiles,
  pendingFilesRef,
  onSubmit,
  onPublishAndSave,
  onUpdateAndSave,
  isPublishing = false,
  isUpdating = false,
  onDelete,
  isSubmitting = false,
  isEdit = false,
  adFile,
  title,
  onDuplicate,
  onSaveAsTemplate,
  botInfo,
  configDefaults,
  submitLabel = 'Speichern',
  deleteLabel = 'Löschen',
  lockedFields,
  templateName,
}: AdFormProps) {
  const { toast } = useToast();
  // Merge config defaults for new ads
  const cfgDefaults = configDefaults ?? {};
  const cfgContact = (cfgDefaults.contact as Record<string, string>) ?? {};

  const methods = useForm<AdCreateInput>({
    resolver: zodResolver(adCreateSchema),
    defaultValues: {
      active: true,
      type: 'OFFER',
      price_type: 'NEGOTIABLE',
      shipping_type: 'SHIPPING',
      sell_directly: false,
      republication_interval: 7,
      images: [],
      shipping_options: [],
      special_attributes: {},
      description_prefix: '',
      description_suffix: '',
      // Apply config defaults for new ads
      ...(!isEdit && cfgContact.name ? { contact_name: cfgContact.name } : {}),
      ...(!isEdit && cfgContact.zipcode ? { contact_zipcode: cfgContact.zipcode } : {}),
      ...(!isEdit && cfgContact.location ? { contact_location: cfgContact.location } : {}),
      ...(!isEdit && cfgContact.street ? { contact_street: cfgContact.street } : {}),
      ...(!isEdit && cfgContact.phone ? { contact_phone: cfgContact.phone } : {}),
      ...(!isEdit && cfgDefaults.republication_interval ? { republication_interval: cfgDefaults.republication_interval as number } : {}),
      ...(!isEdit && cfgDefaults.description_prefix ? { description_prefix: cfgDefaults.description_prefix as string } : {}),
      ...(!isEdit && cfgDefaults.description_suffix ? { description_suffix: cfgDefaults.description_suffix as string } : {}),
      ...(!isEdit && cfgDefaults.auto_price_reduction ? { auto_price_reduction: cfgDefaults.auto_price_reduction as AdCreateInput['auto_price_reduction'] } : {}),
      ...(!isEdit && cfgDefaults.price_type ? { price_type: cfgDefaults.price_type as AdCreateInput['price_type'] } : {}),
      ...(!isEdit && cfgDefaults.shipping_type ? { shipping_type: cfgDefaults.shipping_type as AdCreateInput['shipping_type'] } : {}),
      ...(!isEdit && cfgDefaults.type ? { type: cfgDefaults.type as AdCreateInput['type'] } : {}),
      ...defaultValues,
    },
  });

  // Global drop zone for images
  const [dragOver, setDragOver] = useState(false);
  const dragCounter = useRef(0);
  const dropHandlerRef = useRef<((files: File[]) => void) | null>(null);

  const handleGlobalDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    dragCounter.current++;
    if (e.dataTransfer.types.includes('Files')) {
      setDragOver(true);
    }
  }, []);

  const handleGlobalDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    dragCounter.current--;
    if (dragCounter.current === 0) {
      setDragOver(false);
    }
  }, []);

  const handleGlobalDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  }, []);

  const handleGlobalDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    dragCounter.current = 0;
    setDragOver(false);
    const files = Array.from(e.dataTransfer.files).filter((f) => f.type.startsWith('image/'));
    if (files.length > 0 && dropHandlerRef.current) {
      dropHandlerRef.current(files);
    }
  }, []);

  const onFormError = useCallback((errors: FieldErrors<AdCreateInput>) => {
    const fieldNames: Record<string, string> = {
      title: 'Titel', description: 'Beschreibung', category: 'Kategorie',
      price: 'Preis', price_type: 'Preistyp', shipping_type: 'Versandart',
      shipping_costs: 'Versandkosten', republication_interval: 'Republication-Intervall',
      contact_name: 'Name', contact_zipcode: 'PLZ', contact_location: 'Ort',
    };
    const messages = Object.entries(errors)
      .map(([key, err]) => err && 'message' in err ? `${fieldNames[key] ?? key}: ${err.message}` : null)
      .filter(Boolean);
    if (messages.length) {
      toast('error', messages.join(' · '));
    }
    // Scroll to and focus the first invalid field, expanding collapsed sections if needed
    const firstKey = Object.keys(errors)[0];
    if (firstKey) {
      const el = document.querySelector<HTMLElement>(`[name="${firstKey}"], [data-field="${firstKey}"]`);
      if (el) {
        // Check if element is inside a collapsed section
        const hiddenBody = el.closest(`.${styles.sectionBodyWrapCollapsed}`);
        if (hiddenBody) {
          // Find the section header button and click it to expand
          const section = hiddenBody.closest(`.${styles.section}`);
          const header = section?.querySelector<HTMLButtonElement>(`.${styles.sectionHeader}`);
          if (header) header.click();
          // Wait for re-render, then scroll
          requestAnimationFrame(() => {
            el.scrollIntoView({ behavior: 'smooth', block: 'center' });
            requestAnimationFrame(() => { if (typeof el.focus === 'function') el.focus(); });
          });
        } else {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
          requestAnimationFrame(() => { if (typeof el.focus === 'function') el.focus(); });
        }
      }
    }
  }, [toast]);

  const handleSubmit = useCallback(
    async (data: AdCreateInput) => {
      cleanupAdData(data);
      await onSubmit(data);
    },
    [onSubmit],
  );

  const handlePublish = useCallback(
    async (data: AdCreateInput) => {
      if (!onPublishAndSave) return;
      cleanupAdData(data);
      await onPublishAndSave(data);
    },
    [onPublishAndSave],
  );

  const handleUpdate = useCallback(
    async (data: AdCreateInput) => {
      if (!onUpdateAndSave) return;
      cleanupAdData(data);
      await onUpdateAndSave(data);
    },
    [onUpdateAndSave],
  );

  const headerTitle = title ?? (isEdit ? (defaultValues?.title || 'Anzeige bearbeiten') : 'Neue Anzeige');

  return (
    <div
      className={styles.adForm}
      onDragEnter={handleGlobalDragEnter}
      onDragLeave={handleGlobalDragLeave}
      onDragOver={handleGlobalDragOver}
      onDrop={handleGlobalDrop}
    >
      {/* Global drop overlay */}
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
      {/* Sticky header */}
      <div className={styles.stickyHeader}>
        <h2 className={styles.stickyHeaderTitle}>{headerTitle}</h2>
        {isEdit && (
          <div className={styles.stickyHeaderActions}>
            {onDuplicate && (
              <button
                type="button"
                className={styles.headerAction}
                onClick={onDuplicate}
                title="Duplizieren"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
                  <path d="M9 2h6v4H9z" />
                </svg>
              </button>
            )}
            {onSaveAsTemplate && (
              <button
                type="button"
                className={styles.headerAction}
                onClick={onSaveAsTemplate}
                title="Als Vorlage speichern"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
                  <path d="M17 21v-8H7v8" />
                  <path d="M7 3v5h8" />
                </svg>
              </button>
            )}
          </div>
        )}
      </div>

      {/* Locked fields banner from template */}
      {lockedFields && lockedFields.length > 0 && (
        <div className={styles.lockedBanner}>
          <div className={styles.lockedBannerHeader}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
              <path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </svg>
            {templateName
              ? <>Vorlage: <strong>{templateName}</strong> · {lockedFields.length} gesperrte Felder</>
              : <>{lockedFields.length} gesperrte Felder aus Vorlage</>
            }
          </div>
          <div className={styles.lockedBannerFields}>
            {lockedFields.map((f) => (
              <span key={f} className={styles.lockedBannerTag}>
                {LOCKED_FIELD_LABELS[f] ?? f}
              </span>
            ))}
          </div>
        </div>
      )}

      <FormProvider {...methods}>
        <form onSubmit={methods.handleSubmit(handleSubmit, onFormError)}>
          {/* Active toggle (always visible, top-level) */}
          <div className={styles.activeToggle}>
            <Toggle
              label={<>Anzeige aktiv <InfoTip text="Deaktivierte Anzeigen werden vom Bot übersprungen" /></>}
              checked={methods.watch('active') ?? true}
              onChange={(checked) => methods.setValue('active', checked, { shouldDirty: true })}
            />
          </div>

          {/* Section 1: Anzeigendetails (expanded) */}
          <DetailsSection
            adFile={adFile}
            isEdit={isEdit}
            initialFiles={initialFiles}
            pendingFilesRef={pendingFilesRef}
            priceHint={defaultValues?.price_hint}
            onDropHandlerReady={(handler) => { dropHandlerRef.current = handler; }}
            lockedFields={lockedFields}
            defaultSizeGroup={defaultValues?.shipping_size}
          />

          {/* Section 2: Ort (collapsed for new ads, expanded if editing with data) */}
          <LocationSection
            defaultCollapsed={!isEdit || !!(methods.getValues('contact_zipcode') || methods.getValues('contact_location'))}
            locked={lockedFields?.includes('contact')}
          />

          {/* Section 3: Deine Angaben (collapsed for new ads, expanded if editing with data) */}
          <ContactSection
            defaultCollapsed={!isEdit || !!methods.getValues('contact_name')}
            locked={lockedFields?.includes('contact')}
          />

          {/* Section 4: Erweitert (always collapsed) */}
          <AdvancedSection lockedFields={lockedFields} />

          {/* Section 5: Automatische Preisreduktion (collapsed if not enabled) */}
          <PriceReductionSection botInfo={botInfo} />

          {/* Section 6: Bot-Informationen (edit only, collapsed) */}
          {isEdit && botInfo && <BotInfoSection botInfo={botInfo} />}

          {/* Submit actions */}
          <div className={styles.formActions}>
            {onPublishAndSave && (
              <Button
                type="button"
                variant="primary"
                size="lg"
                loading={isPublishing}
                disabled={isSubmitting || isPublishing || isUpdating}
                className={styles.publishBtn}
                onClick={methods.handleSubmit(handlePublish, onFormError)}
              >
                {botInfo?.id ? 'Erneut veröffentlichen' : 'Veröffentlichen'}
              </Button>
            )}
            {onUpdateAndSave && (
              <Button
                type="button"
                variant="outline"
                size="lg"
                loading={isUpdating}
                disabled={isSubmitting || isPublishing || isUpdating}
                onClick={methods.handleSubmit(handleUpdate, onFormError)}
              >
                Aktualisieren
              </Button>
            )}
            <Button
              type="submit"
              variant={onPublishAndSave ? 'outline' : 'primary'}
              size="lg"
              loading={isSubmitting}
              disabled={isSubmitting || isPublishing || isUpdating}
              className={onPublishAndSave ? undefined : styles.saveBtnFull}
            >
              {submitLabel}
            </Button>
            {onDelete && (
              <Button
                type="button"
                variant="danger"
                size="lg"
                onClick={onDelete}
                disabled={isSubmitting || isPublishing || isUpdating}
                className={styles.deleteBtn}
              >
                {deleteLabel}
              </Button>
            )}
          </div>

          <div className={styles.bottomSpacer} />
        </form>
      </FormProvider>
    </div>
  );
}

// Reusable collapsible section wrapper
interface CollapsibleSectionProps {
  title: string;
  description?: string;
  defaultCollapsed?: boolean;
  isLast?: boolean;
  titleExtra?: ReactNode;
  children: ReactNode;
}

export function CollapsibleSection({
  title,
  description,
  defaultCollapsed = false,
  isLast = false,
  titleExtra,
  children,
}: CollapsibleSectionProps) {
  const [collapsed, setCollapsed] = useCollapsed(defaultCollapsed);

  return (
    <div className={`${styles.section} ${isLast ? styles.sectionLast : ''}`}>
      <button
        type="button"
        className={styles.sectionHeader}
        onClick={() => setCollapsed(!collapsed)}
      >
        <div className={styles.sectionTitleCol}>
          <div className={styles.sectionTitleRow}>
            <span className={styles.sectionTitle}>{title}</span>
            {titleExtra}
          </div>
          {description && (
            <span className={styles.sectionDesc}>{description}</span>
          )}
        </div>
        <span className={`${styles.sectionChevron} ${collapsed ? styles.sectionChevronCollapsed : ''}`}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </span>
      </button>
      <div className={`${styles.sectionBodyWrap} ${collapsed ? styles.sectionBodyWrapCollapsed : ''}`}>
        <div className={styles.sectionBody}>
          {children}
        </div>
      </div>
    </div>
  );
}

// Simple hook for collapse state
function useCollapsed(initial: boolean): [boolean, (v: boolean) => void] {
  const [collapsed, setCollapsed] = useState(initial);
  return [collapsed, setCollapsed];
}
