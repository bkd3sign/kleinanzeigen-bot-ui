'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useFormContext } from 'react-hook-form';
import { Input, Select, Textarea } from '@/components/ui';
import { useToast } from '@/components/ui';
import { CategoryPicker } from '../CategoryPicker/CategoryPicker';
import { CategoryAttributesPicker } from './CategoryAttributesPicker';
import { ImageGallery } from '../ImageGallery/ImageGallery';
import { MAX_AD_IMAGES } from '@/lib/images/formats';
import { detectSizeGroup } from '@/lib/shipping';
import { ShippingPicker, type ShippingMode } from './ShippingPicker';
import { CollapsibleSection, type AiPriceHint } from './AdForm';
import { LockedBadge, withLocked } from './InfoTip';
import type { AdCreateInput } from '@/validation/schemas';
import { checkSellDirectly } from '@/lib/ads/sellDirectly';
import styles from './AdForm.module.scss';

const PRICE_TYPE_OPTIONS = [
  { value: 'FIXED', label: 'Festpreis' },
  { value: 'NEGOTIABLE', label: 'Verhandlungsbasis' },
  { value: 'GIVE_AWAY', label: 'Zu verschenken' },
];

const SHIPPING_TYPE_OPTIONS = [
  { value: 'PICKUP', label: 'Nur Abholung' },
  { value: 'SHIPPING', label: 'Versand' },
];

interface DetailsSectionProps {
  adFile?: string;
  isEdit?: boolean;
  initialFiles?: File[];
  pendingFilesRef?: React.MutableRefObject<File[]>;
  priceHint?: AiPriceHint;
  onDropHandlerReady?: (handler: (files: File[]) => void) => void;
  lockedFields?: string[];
  defaultSizeGroup?: string;
  legacyShippingCosts?: number | null;
}

export function DetailsSection({ adFile, isEdit = false, initialFiles, pendingFilesRef, priceHint, onDropHandlerReady, lockedFields, defaultSizeGroup, legacyShippingCosts }: DetailsSectionProps) {
  const isLocked = useCallback((field: string) => lockedFields?.includes(field) ?? false, [lockedFields]);
  const hasLockedFields = ['type', 'category', 'price_type', 'shipping_type']
    .some((f) => isLocked(f));
  const {
    register,
    watch,
    setValue,
    getValues,
    formState: { errors },
  } = useFormContext<AdCreateInput>();
  const { toast } = useToast();

  const adType = watch('type');
  const priceType = watch('price_type');
  const shippingType = watch('shipping_type');
  const category = watch('category') ?? '';
  const description = watch('description') ?? '';
  const images = watch('images') ?? [];
  const shippingOptionsRaw = watch('shipping_options');
  const shippingOptions = useMemo(() => shippingOptionsRaw ?? [], [shippingOptionsRaw]);
  const attrs = watch('special_attributes') ?? {};

  const [shippingMode, setShippingMode] = useState<ShippingMode>(
    () => detectSizeGroup(shippingOptions),
  );
  const [klaPriceHint, setKlaPriceHint] = useState<AiPriceHint | null>(null);

  const sellDirectly = watch('sell_directly') ?? false;
  const sellDirectlyCheck = useMemo(
    () => checkSellDirectly({ type: adType, shipping_type: shippingType, shipping_options: shippingOptions, price_type: priceType }),
    [adType, shippingType, shippingOptions, priceType],
  );

  // Reset an invalid direct-buy flag so the form never submits a combination the
  // bot would reject (e.g. after switching price_type to GIVE_AWAY).
  useEffect(() => {
    if (sellDirectly && !sellDirectlyCheck.ok) {
      setValue('sell_directly', false, { shouldDirty: true });
    }
  }, [sellDirectly, sellDirectlyCheck.ok, setValue]);

  const handleTitleBlur = useCallback(async (title: string) => {
    if (!title.trim() || isLocked('category')) return;
    // Only autosuggest when category AND attributes are empty — same trigger condition as a
    // fresh AI generation, so editing an already-filled ad never overwrites existing data.
    const currentAttrs = getValues('special_attributes');
    if (getValues('category') || (currentAttrs && Object.keys(currentAttrs).length > 0)) return;
    try {
      // Identical SoT pipeline as the AI generator — same article yields the same result
      const res = await fetch('/api/ads/resolve-category', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, description: getValues('description') ?? '' }),
      });
      if (!res.ok) return;
      const data = await res.json() as { category: string | null; special_attributes: Record<string, string> } | null;
      if (!data?.category) return;

      if (Object.keys(data.special_attributes).length > 0) {
        pendingSuggestedAttrs.current = data.special_attributes;
      }
      setValue('category', data.category, { shouldDirty: true });

      // Price suggestion based on the resolved category + first attribute
      const categoryId = data.category.split('/')[1];
      if (!categoryId) return;
      const priceParams = new URLSearchParams({ title, categoryId });
      const firstAttrKey = Object.keys(data.special_attributes)[0];
      if (firstAttrKey) {
        priceParams.set('attrKey', firstAttrKey);
        priceParams.set('attrValue', data.special_attributes[firstAttrKey]);
      }
      const priceRes = await fetch(`/api/ads/price-suggest?${priceParams}`);
      if (priceRes.ok) {
        const priceData = await priceRes.json() as { market_low: number; market_high: number } | null;
        if (priceData) setKlaPriceHint(priceData);
      }
    } catch {
      // API unavailable — silently ignore
    }
  }, [isLocked, setValue, getValues]);

  // When category changes, clear attributes — but apply any pending suggestion attrs instead of empty.
  // Track previous category to detect real user-driven changes (survives React Strict Mode double-invoke).
  const prevCategoryRef = useRef<string | null>(null);
  const pendingSuggestedAttrs = useRef<Record<string, string> | null>(null);
  useEffect(() => {
    const prev = prevCategoryRef.current;
    prevCategoryRef.current = category;
    // Skip on first run (initialization) and when category hasn't actually changed
    if (prev === null || prev === category) return;
    const pending = pendingSuggestedAttrs.current;
    pendingSuggestedAttrs.current = null;
    setValue('special_attributes', pending ?? {}, { shouldDirty: true });
  }, [category, setValue]);

  // AI hint takes priority; KA market data as fallback
  const activePriceHint = priceHint ?? klaPriceHint;

  // Character counter
  const remaining = 4000 - description.length;
  const counterWarning = remaining < 200;

  const isGiveAway = priceType === 'GIVE_AWAY';

  // Shipping details visible only for SHIPPING type
  const showShipping = shippingType === 'SHIPPING';

  const handleApplyPriceSuggestion = useCallback(() => {
    const price = activePriceHint?.suggestion ?? activePriceHint?.market_high;
    if (price != null) {
      setValue('price', price, { shouldDirty: true });
      toast('success', `Preis auf ${price} € gesetzt`);
    }
  }, [activePriceHint, setValue, toast]);

  return (
    <CollapsibleSection
      title="Anzeigendetails"
      description="Typ, Titel, Kategorie, Preis, Beschreibung, Bilder und Versandoptionen."
      defaultCollapsed={false}
      titleExtra={hasLockedFields ? <LockedBadge /> : undefined}
    >
      {/* Offer/Wanted toggle */}
      <div>
        <label className={styles.toggleLabel}>{withLocked('Angebot / Gesuch', isLocked('type'))}</label>
        <div className={styles.toggleGroup}>
          <button
            type="button"
            className={`${styles.toggleBtn} ${styles.toggleBtnBorder} ${adType === 'OFFER' ? styles.toggleBtnActive : ''}`}
            onClick={() => setValue('type', 'OFFER', { shouldDirty: true })}
            disabled={isLocked('type')}
          >
            Ich biete
          </button>
          <button
            type="button"
            className={`${styles.toggleBtn} ${adType === 'WANTED' ? styles.toggleBtnActive : ''}`}
            onClick={() => setValue('type', 'WANTED', { shouldDirty: true })}
            disabled={isLocked('type')}
          >
            Ich suche
          </button>
        </div>
      </div>

      {/* Title */}
      <Input
        label="Titel"
        placeholder="Was bietest du an?"
        error={errors.title?.message}
        required
        maxLength={65}
        {...register('title', {
          onBlur: (e) => handleTitleBlur(e.target.value),
        })}
      />
      <div className={styles.tip}>
        Tipp: Mit einem aussagekräftigen Titel verkaufst du besser.
      </div>

      {/* Category */}
      <div data-field="category">
        <CategoryPicker
          value={category}
          onChange={(val) => setValue('category', val, { shouldDirty: true })}
          label={withLocked('Kategorie', isLocked('category'))}
          disabled={isLocked('category')}
        />
      </div>

      {/* Special attributes — smart dropdowns per category */}
      <CategoryAttributesPicker
        category={category}
        values={attrs}
        onChange={(newAttrs) => setValue('special_attributes', newAttrs, { shouldDirty: true })}
      />

      {/* Shipping type */}
      <Select
        label={withLocked('Versandart', isLocked('shipping_type'))}
        options={SHIPPING_TYPE_OPTIONS}
        error={errors.shipping_type?.message}
        disabled={isLocked('shipping_type')}
        required
        {...register('shipping_type')}
      />

      {/* Shipping size picker / carrier options */}
      {showShipping && (
        <>
          {shippingOptions.length === 0 && legacyShippingCosts != null && (
            <p className={styles.migrationBanner} role="alert">
              Individueller Versand ({legacyShippingCosts.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €) wird von Kleinanzeigen nicht mehr unterstützt. Bitte wähle eine Paketgröße — der alte Versandpreis wird beim Speichern entfernt.
            </p>
          )}
          <ShippingPicker
            selectedOptions={shippingOptions}
            onChange={(opts) => setValue('shipping_options', opts, { shouldDirty: true })}
            sellDirectly={sellDirectly}
            onSellDirectlyChange={(val) => setValue('sell_directly', val, { shouldDirty: true })}
            sellDirectlyDisabled={!sellDirectlyCheck.ok}
            sellDirectlyHint={sellDirectlyCheck.reason}
            activeMode={shippingMode}
            onModeChange={setShippingMode}
            defaultSizeGroup={defaultSizeGroup}
          />
          {errors.shipping_options?.message && (
            <p className={styles.shippingOptionsError} role="alert">
              {errors.shipping_options.message}
            </p>
          )}
        </>
      )}

      {/* Price + Price type row */}
      <div className={styles.row}>
        <Input
          label="Preis (EUR)"
          type="number"
          min="0"
          step="1"
          placeholder={isGiveAway ? '0' : 'z.B. 45'}
          error={errors.price?.message}
          required={!isGiveAway}
          disabled={isGiveAway}
          {...register('price', {
            valueAsNumber: true,
            onChange: (e) => {
              if (parseFloat(e.target.value) === 0) {
                setValue('price_type', 'GIVE_AWAY', { shouldDirty: true });
              }
            },
          })}
        />
        <Select
          label={withLocked('Preistyp', isLocked('price_type'))}
          options={PRICE_TYPE_OPTIONS}
          error={errors.price_type?.message}
          disabled={isLocked('price_type')}
          {...register('price_type', {
            onChange: (e) => {
              if (e.target.value === 'GIVE_AWAY') {
                setValue('price', 0, { shouldDirty: true });
              } else if (priceType === 'GIVE_AWAY') {
                setValue('price', NaN, { shouldDirty: true });
              }
            },
          })}
        />
      </div>

      {/* Price hint from AI */}
      {activePriceHint && (activePriceHint.suggestion || activePriceHint.market_low) && (
        <PriceHintBox priceHint={activePriceHint} onApply={handleApplyPriceSuggestion} />
      )}

      {/* Description */}
      <Textarea
        label="Beschreibung"
        placeholder="Beschreibe dein Angebot so detailliert wie möglich..."
        error={errors.description?.message}
        required
        rows={10}
        maxLength={4000}
        {...register('description')}
      />
      <div className={`${styles.charCounter} ${counterWarning ? styles.charCounterWarning : ''}`}>
        Du hast noch {remaining} Zeichen übrig
      </div>

      {/* Images */}
      <ImageGallery
        images={images}
        adFile={adFile}
        isEdit={isEdit}
        initialFiles={initialFiles}
        pendingFilesRef={pendingFilesRef}
        onChange={(newImages) => setValue('images', newImages, { shouldDirty: true })}
        onDropHandlerReady={onDropHandlerReady}
      />
      <div className={styles.tipImages}>
        Tipp: Bis zu {MAX_AD_IMAGES} Bilder. Drag & Drop zum Sortieren. Klick für Vorschau.
      </div>
    </CollapsibleSection>
  );
}

// Price hint sub-component
function PriceHintBox({
  priceHint,
  onApply,
}: {
  priceHint: AiPriceHint;
  onApply: () => void;
}) {
  return (
    <div
      className={styles.priceHint}
      onClick={onApply}
      title="Klick, um den Preisvorschlag zu übernehmen"
    >
      <div className={styles.priceHintTitle}>Preisvorschlag / Orientierung</div>
      <div className={styles.priceHintList}>
        {priceHint.uvp != null && (
          <div className={styles.priceHintRow}>
            <span className={styles.priceHintLabel}>Neupreis (UVP)</span>
            <span className={styles.priceHintValue}>ca. {priceHint.uvp} €</span>
          </div>
        )}
        {priceHint.market_low != null && priceHint.market_high != null && (
          <div className={styles.priceHintRow}>
            <span className={styles.priceHintLabel}>Aktueller Marktwert (gebraucht)</span>
            <span className={styles.priceHintValue}>{priceHint.market_low}–{priceHint.market_high} €</span>
          </div>
        )}
        {priceHint.suggestion != null && (
          <div className={`${styles.priceHintRow} ${styles.priceHintSuggestion}`}>
            <span className={styles.priceHintLabel}>Mein Preisvorschlag</span>
            <span className={`${styles.priceHintValue} ${styles.priceHintSuggestionValue}`}>
              {priceHint.suggestion} €
            </span>
          </div>
        )}
      </div>
      {priceHint.condition_note && (
        <div className={styles.priceHintNote}>{priceHint.condition_note}</div>
      )}
    </div>
  );
}
