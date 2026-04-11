'use client';

import { useEffect, useMemo, useState } from 'react';
import { useFormContext } from 'react-hook-form';
import { Input, Select, Toggle } from '@/components/ui';
import { CollapsibleSection } from './AdForm';
import { InfoTip } from './InfoTip';
import type { AdCreateInput } from '@/validation/schemas';
import styles from './AdForm.module.scss';

const STRATEGY_OPTIONS = [
  { value: '', label: '– Keine –' },
  { value: 'PERCENTAGE', label: 'Prozentual' },
  { value: 'FIXED', label: 'Fester Betrag' },
];

export function PriceReductionSection({ reductionCount = 0, createdOn }: { reductionCount?: number; createdOn?: string | null }) {
  const { register, watch, setValue } = useFormContext<AdCreateInput>();

  const aprEnabled = watch('auto_price_reduction.enabled') ?? false;
  const aprStrategy = watch('auto_price_reduction.strategy');
  const aprAmount = watch('auto_price_reduction.amount');
  const aprMinPrice = watch('auto_price_reduction.min_price');
  const aprDelayReposts = watch('auto_price_reduction.delay_reposts');
  const aprDelayDays = watch('auto_price_reduction.delay_days');
  const price = watch('price');
  const republicationInterval = watch('republication_interval');

  // Clamp min_price to price - 1 when price changes
  useEffect(() => {
    if (aprEnabled && price != null && aprMinPrice != null && aprMinPrice >= price) {
      setValue('auto_price_reduction.min_price', Math.max(price - 1, 1), { shouldDirty: true });
    }
  }, [price, aprEnabled, aprMinPrice, setValue]);

  return (
    <CollapsibleSection
      title="Republication & Preisreduktion"
      description="Intervall für Neueinstellungen und automatische Preissenkung."
      defaultCollapsed={!aprEnabled}
      titleExtra={
        <span className={`${styles.sectionBadge} ${aprEnabled ? styles.sectionBadgeOn : styles.sectionBadgeOff}`}>
          {aprEnabled ? 'Aktiv' : 'Aus'}
        </span>
      }
    >
      <Input
        label={<>Republication-Intervall (Tage) <InfoTip text="Alle N Tage wird die Anzeige automatisch neu eingestellt" /></>}
        type="number"
        min="1"
        placeholder="z.B. 7"
        {...register('republication_interval', { valueAsNumber: true })}
      />
      <Toggle
        label={<>Preisreduktion aktiviert <InfoTip text="Preis automatisch senken bei Republication" /></>}
        checked={aprEnabled}
        onChange={(checked) => setValue('auto_price_reduction.enabled', checked, { shouldDirty: true })}
      />

      {aprEnabled && (
        <>
          <div className={styles.row}>
            <Select
              label={<>Strategie <InfoTip text="PERCENTAGE: z.B. 5% pro Repost. FIXED: z.B. 5€ pro Repost." /></>}
              options={STRATEGY_OPTIONS}
              {...register('auto_price_reduction.strategy')}
            />
            <Input
              label={<>Betrag <InfoTip text="Reduktionsbetrag (% oder €)" /></>}
              type="number"
              min="0"
              step="1"
              placeholder="z.B. 5"
              {...register('auto_price_reduction.amount', { valueAsNumber: true })}
            />
          </div>

          <div className={styles.row}>
            <Input
              label={<>Mindestpreis (€) <InfoTip text="Preisuntergrenze, unter die nicht gesenkt wird. Pflicht wenn aktiviert." /></>}
              type="number"
              min="1"
              max={price ? price - 1 : undefined}
              step="1"
              placeholder="z.B. 10"
              required
              {...register('auto_price_reduction.min_price', { valueAsNumber: true })}
            />
            <Input
              label={<>Verzögerung (Reposts) <InfoTip text="Erst nach N Reposts mit der Reduktion beginnen" /></>}
              type="number"
              min="0"
              step="1"
              placeholder="0"
              {...register('auto_price_reduction.delay_reposts', { valueAsNumber: true })}
            />
          </div>

          <Input
            label={<>Verzögerung (Tage) <InfoTip text="Erst nach N Tagen mit der Reduktion beginnen" /></>}
            type="number"
            min="0"
            step="1"
            placeholder="0"
            {...register('auto_price_reduction.delay_days', { valueAsNumber: true })}
          />

          <Toggle
            label={<>Auch bei Update anwenden <InfoTip text="Preis auch senken, wenn die Anzeige nur aktualisiert wird (z.B. Text- oder Bildänderungen) — nicht nur beim Neu-Einstellen. Die Tage-Verzögerung wird berücksichtigt, die Repost-Verzögerung nicht." /></>}
            checked={watch('auto_price_reduction.on_update') ?? false}
            onChange={(checked) => setValue('auto_price_reduction.on_update', checked, { shouldDirty: true })}
          />

          {/* Price reduction preview */}
          <PricePreview
            price={price}
            strategy={aprStrategy ?? null}
            amount={aprAmount ?? null}
            minPrice={aprMinPrice ?? null}
            republicationInterval={republicationInterval ?? 7}
            delayReposts={aprDelayReposts ?? 0}
            delayDays={aprDelayDays ?? 0}
            reductionCount={reductionCount}
            createdOn={createdOn}
          />
        </>
      )}
    </CollapsibleSection>
  );
}

// Shared step calculation
interface PriceStep {
  price: number;
  isFinal: boolean;
}

function computePriceSteps(
  price: number,
  strategy: string,
  amount: number,
  minPrice: number,
): PriceStep[] {
  const result: PriceStep[] = [];
  let current = Math.round(price);
  const maxSteps = 50;
  let stepCount = 0;

  while (current > minPrice && stepCount < maxSteps) {
    result.push({ price: current, isFinal: false });

    let next: number;
    if (strategy === 'PERCENTAGE') {
      next = current - (current * amount / 100);
    } else {
      next = current - amount;
    }
    next = Math.round(next);
    if (next < minPrice) next = minPrice;
    if (next >= current) break;

    current = next;
    stepCount++;
  }

  if (stepCount > 0 || current === minPrice) {
    result.push({ price: current, isFinal: true });
  }

  return result;
}

// Timeline step with date information
interface TimelineStep {
  price: number;
  isFinal: boolean;
  date: Date;
  daysFromNow: number;
  repostNumber: number;
  isDelayed: boolean;
}

function computeTimeline(
  price: number,
  strategy: string,
  amount: number,
  minPrice: number,
  intervalDays: number,
  delayReposts: number,
  delayDays: number,
  createdOn?: string | null,
): TimelineStep[] {
  // Use created_on as base for past reposts, fall back to today
  const base = createdOn ? new Date(createdOn) : new Date();
  if (isNaN(base.getTime())) base.setTime(Date.now());
  base.setHours(0, 0, 0, 0);
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const steps: TimelineStep[] = [];
  let currentPrice = Math.round(price);
  const maxSteps = 50;
  const interval = Math.max(intervalDays, 1);

  for (let repost = 1; repost <= maxSteps; repost++) {
    const daysFromBase = repost * interval;
    const date = new Date(base.getTime() + daysFromBase * 86400000);
    const daysFromNow = Math.round((date.getTime() - now.getTime()) / 86400000);

    // Check if still in delay phase
    const withinDelayReposts = repost <= delayReposts;
    const withinDelayDays = daysFromNow <= delayDays;
    const isDelayed = withinDelayReposts || withinDelayDays;

    if (isDelayed) {
      steps.push({
        price: currentPrice,
        isFinal: false,
        date,
        daysFromNow,
        repostNumber: repost,
        isDelayed: true,
      });
      continue;
    }

    // Apply reduction
    let nextPrice: number;
    if (strategy === 'PERCENTAGE') {
      nextPrice = currentPrice - (currentPrice * amount / 100);
    } else {
      nextPrice = currentPrice - amount;
    }
    nextPrice = Math.round(nextPrice);
    if (nextPrice < minPrice) nextPrice = minPrice;
    if (nextPrice >= currentPrice && currentPrice > minPrice) break;

    currentPrice = nextPrice;
    const isFinal = currentPrice <= minPrice;

    steps.push({
      price: currentPrice,
      isFinal,
      date,
      daysFromNow,
      repostNumber: repost,
      isDelayed: false,
    });

    if (isFinal) break;
  }

  return steps;
}

function formatDate(date: Date): string {
  return date.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function formatRelative(days: number): string {
  if (days < 0) {
    const abs = Math.abs(days);
    if (abs === 1) return 'vor 1 Tag';
    return `vor ${abs} Tagen`;
  }
  if (days === 0) return 'heute';
  if (days === 1) return 'morgen';
  if (days < 7) return `in ${days} Tagen`;
  const weeks = Math.floor(days / 7);
  const rest = days % 7;
  if (rest === 0) return weeks === 1 ? 'in 1 Woche' : `in ${weeks} Wochen`;
  return weeks === 1 ? `in 1 Woche, ${rest} T.` : `in ${weeks} W., ${rest} T.`;
}

// Price preview sub-component
interface PricePreviewProps {
  price?: number | null;
  strategy?: string | null;
  amount?: number | null;
  minPrice?: number | null;
  republicationInterval: number;
  delayReposts: number;
  delayDays: number;
  reductionCount: number;
  createdOn?: string | null;
}

type PreviewMode = 'chips' | 'timeline';

function PricePreview({
  price, strategy, amount, minPrice,
  republicationInterval, delayReposts, delayDays, reductionCount, createdOn,
}: PricePreviewProps) {
  const [mode, setMode] = useState<PreviewMode>('chips');

  const steps = useMemo(() => {
    if (!price || !strategy || !amount || !minPrice) return null;
    return computePriceSteps(price, strategy, amount, minPrice);
  }, [price, strategy, amount, minPrice]);

  const timeline = useMemo(() => {
    if (!price || !strategy || !amount || !minPrice) return null;
    return computeTimeline(
      price, strategy, amount, minPrice,
      republicationInterval, delayReposts, delayDays, createdOn,
    );
  }, [price, strategy, amount, minPrice, republicationInterval, delayReposts, delayDays, createdOn]);

  if (!steps || steps.length === 0) return null;

  const totalDays = timeline && timeline.length > 0
    ? timeline[timeline.length - 1].daysFromNow
    : 0;
  const totalReposts = timeline ? timeline.length : 0;

  // Check if the first reduction step actually changes the price after rounding
  const roundedPrice = Math.round(price!);
  const rawReduction = strategy === 'PERCENTAGE'
    ? roundedPrice * (amount! / 100)
    : amount!;
  const firstStepRounded = Math.round(
    strategy === 'PERCENTAGE'
      ? roundedPrice - (roundedPrice * amount! / 100)
      : roundedPrice - amount!,
  );
  const isFirstStepIneffective = firstStepRounded >= roundedPrice;

  return (
    <div className={styles.pricePreviewWrap}>
      {isFirstStepIneffective && (
        <div className={styles.priceReductionWarning}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
            <line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
          <div>
            <strong>Preisreduktion wirkungslos</strong>
            <p>
              {strategy === 'PERCENTAGE'
                ? `${amount}% von ${roundedPrice} € = ${rawReduction.toFixed(2)} € Reduktion`
                : `${amount} € Reduktion`
              } — nach Rundung auf ganze Euro bleibt der Preis bei {roundedPrice} €.
              {strategy === 'PERCENTAGE'
                ? ` Erhöhe den Prozentsatz oder wechsle zu „Fester Betrag" mit mindestens 1 €.`
                : ` Setze den Betrag auf mindestens 1 €.`
              }
            </p>
          </div>
        </div>
      )}
      <div className={styles.pricePreviewHeader}>
        <label className={styles.pricePreviewLabel}>Preisreduktion Vorschau</label>
        <div className={styles.pricePreviewTabs}>
          <button
            type="button"
            className={`${styles.pricePreviewTab} ${mode === 'chips' ? styles.pricePreviewTabActive : ''}`}
            onClick={() => setMode('chips')}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="8" y1="6" x2="21" y2="6" /><line x1="8" y1="12" x2="21" y2="12" /><line x1="8" y1="18" x2="21" y2="18" />
              <line x1="3" y1="6" x2="3.01" y2="6" /><line x1="3" y1="12" x2="3.01" y2="12" /><line x1="3" y1="18" x2="3.01" y2="18" />
            </svg>
            Kompakt
          </button>
          <button
            type="button"
            className={`${styles.pricePreviewTab} ${mode === 'timeline' ? styles.pricePreviewTabActive : ''}`}
            onClick={() => setMode('timeline')}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
            </svg>
            Zeitleiste
          </button>
        </div>
      </div>

      {mode === 'chips' ? (
        <div className={styles.pricePreview}>
          {steps.map((step, i) => {
            const isPast = i < reductionCount;
            const isCurrent = i === reductionCount;
            return (
              <span key={i}>
                {i > 0 && <span className={styles.pricePreviewArrow}> → </span>}
                <span className={[
                  styles.pricePreviewStep,
                  step.isFinal ? styles.pricePreviewStepFinal : '',
                  isPast ? styles.pricePreviewStepPast : '',
                  isCurrent ? styles.pricePreviewStepCurrent : '',
                ].filter(Boolean).join(' ')}>
                  {step.price} €
                </span>
              </span>
            );
          })}
        </div>
      ) : timeline && timeline.length > 0 ? (
        <div className={styles.priceTimeline}>
          {/* Start row */}
          <div className={`${styles.timelineRow} ${reductionCount > 0 ? styles.timelineRowPast : ''}`}>
            <div className={styles.timelineTrack}>
              <div className={`${styles.timelineDot} ${reductionCount > 0 ? styles.timelineDotPast : ''}`} />
              <div className={styles.timelineLine} />
            </div>
            <div className={styles.timelineContent}>
              <span className={`${styles.timelinePrice} ${reductionCount > 0 ? styles.timelinePricePast : ''}`}>
                {Math.round(price!)} €
              </span>
              <span className={styles.timelineDate}>Startpreis</span>
            </div>
          </div>

          {timeline.map((step, i) => {
            const isPast = i < reductionCount;
            const isCurrent = i === reductionCount - 1;
            return (
              <div key={i} className={`${styles.timelineRow} ${isPast ? styles.timelineRowPast : ''}`}>
                <div className={styles.timelineTrack}>
                  <div className={[
                    styles.timelineDot,
                    step.isFinal ? styles.timelineDotFinal : '',
                    step.isDelayed ? styles.timelineDotDelayed : '',
                    isPast ? styles.timelineDotPast : '',
                    isCurrent ? styles.timelineDotCurrent : '',
                  ].filter(Boolean).join(' ')} />
                  {i < timeline.length - 1 && <div className={styles.timelineLine} />}
                </div>
                <div className={styles.timelineContent}>
                  <div className={styles.timelineMain}>
                    <span className={[
                      styles.timelinePrice,
                      step.isFinal ? styles.timelinePriceFinal : '',
                      step.isDelayed ? styles.timelinePriceDelayed : '',
                      isPast && !isCurrent ? styles.timelinePricePast : '',
                      isCurrent ? styles.timelinePriceCurrent : '',
                    ].filter(Boolean).join(' ')}>
                      {step.price} €
                      {step.isDelayed && (
                        <span className={styles.timelinePause}>pausiert</span>
                      )}
                      {isCurrent && (
                        <span className={styles.timelineCurrentLabel}>aktuell</span>
                      )}
                    </span>
                    <span className={styles.timelineRelative}>
                      {isPast
                        ? (step.daysFromNow < 0 ? `vor ${Math.abs(step.daysFromNow)} Tagen` : 'heute')
                        : formatRelative(step.daysFromNow)}
                    </span>
                  </div>
                  <span className={styles.timelineDate}>
                    {formatDate(step.date)} · Repost #{step.repostNumber}
                  </span>
                </div>
              </div>
            );
          })}

          {/* Summary footer */}
          <div className={styles.timelineSummary}>
            <span>
              <strong>{totalReposts}</strong> Repost{totalReposts !== 1 ? 's' : ''} über{' '}
              <strong>{totalDays}</strong> Tage
            </span>
            <span>
              {Math.round(price!)} € → {timeline[timeline.length - 1].price} €
              {' '}
              <span className={styles.timelineSavings}>
                (−{Math.round(price!) - timeline[timeline.length - 1].price} €)
              </span>
            </span>
          </div>
        </div>
      ) : null}
    </div>
  );
}
