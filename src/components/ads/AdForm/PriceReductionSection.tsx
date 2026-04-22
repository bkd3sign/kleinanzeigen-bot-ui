'use client';

import { useEffect, useMemo, useState } from 'react';
import { useFormContext } from 'react-hook-form';
import { Input, Select, Toggle } from '@/components/ui';
import { CollapsibleSection } from './AdForm';
import { InfoTip } from './InfoTip';
import { projectReposts, getCurrentPrice, type RepostProjection, type DelayReason } from '@/lib/ads/pricing';
import type { AdListItem } from '@/types/ad';
import type { AdCreateInput } from '@/validation/schemas';
import styles from './AdForm.module.scss';

const STRATEGY_OPTIONS = [
  { value: 'PERCENTAGE', label: 'Prozentual' },
  { value: 'FIXED', label: 'Fester Betrag' },
];

interface BotInfo {
  id?: string | number | null;
  created_on?: string | null;
  updated_on?: string | null;
  content_hash?: string | null;
  repost_count?: number | null;
  price_reduction_count?: number | null;
}

export function PriceReductionSection({ botInfo }: { botInfo?: BotInfo }) {
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
      setValue('auto_price_reduction.min_price', Math.max(price - 1, 0), { shouldDirty: true });
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
        label={<>Republication-Intervall (Tage) <InfoTip text="Anzeige wird neu eingestellt, wenn mehr als N volle Tage seit dem letzten Publish vergangen sind. Beispiel: Bei 7 wird frühestens nach 8 Kalendertagen repostet, weil der Bot auf ganze Tage abrundet und auf strikt-größer prüft." /></>}
        type="number"
        min="1"
        placeholder="z.B. 7"
        {...register('republication_interval', { valueAsNumber: true })}
      />
      <Toggle
        label={<>Preisreduktion aktiviert <InfoTip text="Senkt den Preis automatisch bei jedem Repost. Der erste Repost ändert den Preis nie — die Reduktion beginnt erst ab dem zweiten Repost." /></>}
        checked={aprEnabled}
        onChange={(checked) => {
          setValue('auto_price_reduction.enabled', checked, { shouldDirty: true });
          if (checked && !aprStrategy) {
            setValue('auto_price_reduction.strategy', 'PERCENTAGE', { shouldDirty: true });
          }
        }}
      />

      {aprEnabled && (
        <>
          <div className={styles.row}>
            <Select
              label={<>Strategie <InfoTip text="Prozentual: Senkt den Preis um X% des aktuellen Preises pro Repost (Zinseszins-Effekt). Fester Betrag: Senkt um einen fixen Euro-Betrag pro Repost (gleichmäßige Schritte). Tipp: Prozentual für teure Artikel, fester Betrag für günstige." /></>}
              options={STRATEGY_OPTIONS}
              {...register('auto_price_reduction.strategy')}
            />
            <Input
              label={<>Betrag <InfoTip text="Wie viel pro Repost gesenkt wird. Bei Prozentual: z.B. 5 = 5% vom aktuellen Preis. Bei Fester Betrag: z.B. 5 = 5 € weniger pro Repost. Alle Preise werden auf ganze Euro gerundet." /></>}
              type="number"
              min="0"
              step="1"
              placeholder="z.B. 5"
              {...register('auto_price_reduction.amount', { valueAsNumber: true })}
            />
          </div>

          <div className={styles.row}>
            <Input
              label={<>Mindestpreis (€) <InfoTip text="Untergrenze: Der Preis wird nie unter diesen Wert gesenkt. Pflichtfeld wenn Preisreduktion aktiviert ist." /></>}
              type="number"
              min="0"
              max={price ? price - 1 : undefined}
              step="1"
              placeholder="z.B. 10"
              required
              {...register('auto_price_reduction.min_price', { valueAsNumber: true })}
            />
            <Input
              label={<>Verzögerung (Reposts) <InfoTip text="Wartet N zusätzliche Reposts bevor die erste Preissenkung greift. Beispiel: Bei 2 bleiben die ersten 3 Reposts zum vollen Preis (1 implizit + 2 Verzögerung), ab Repost 4 wird gesenkt. Empfohlen wenn der Artikel zuerst zum Vollpreis Chancen haben soll." /></>}
              type="number"
              min="0"
              step="1"
              placeholder="0"
              {...register('auto_price_reduction.delay_reposts', { valueAsNumber: true })}
            />
          </div>

          <Input
            label={<>Verzögerung (Tage) <InfoTip text="Senkt den Preis erst, wenn seit dem letzten Publish mindestens N Tage vergangen sind. Achtung: Der Zähler startet bei jedem Repost neu! Wenn delay_days größer als das Republication-Intervall ist, greift die Reduktion nie. Tipp: Nutze stattdessen Verzögerung (Reposts) — das ist zuverlässiger." /></>}
            type="number"
            min="0"
            step="1"
            placeholder="0"
            {...register('auto_price_reduction.delay_days', { valueAsNumber: true })}
          />

          {/* Warning when delay_days > interval + 1 (delay is never satisfied) */}
          {(aprDelayDays ?? 0) > (republicationInterval ?? 7) + 1 && (
            <div className={styles.priceReductionWarning}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                <line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
              </svg>
              <div>
                <strong>Verzögerung (Tage) wirkungslos</strong>
                <p>
                  Der Bot setzt updated_on nach jedem Repost neu. Zwischen zwei Reposts vergehen nur ~{(republicationInterval ?? 7) + 1} Tage,
                  aber die Verzögerung erfordert {aprDelayDays} Tage — die Bedingung wird nie erfüllt.
                  Nutze stattdessen Verzögerung (Reposts).
                </p>
              </div>
            </div>
          )}

          <Toggle
            label={<>Auch bei Update anwenden <InfoTip text="Senkt den Preis auch beim update-Befehl (Text-/Bildänderungen), nicht nur beim publish (Neu-Einstellen). Nur die Tage-Verzögerung wird dabei berücksichtigt, die Repost-Verzögerung nicht." /></>}
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
            botInfo={botInfo}
          />
        </>
      )}
    </CollapsibleSection>
  );
}

function delayLabel(step: RepostProjection): string {
  if (step.delayReason === 'first_publish') return 'kein Abzug';
  return 'pausiert';
}

function daysFromToday(date: Date, now: Date): number {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return Math.round((d.getTime() - now.getTime()) / 86400000);
}

function formatDate(date: Date): string {
  return date.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function formatRelative(days: number): string {
  if (days < 0) {
    const abs = Math.abs(days);
    if (abs === 1) return 'gestern';
    return `vor ${abs} Tagen`;
  }
  if (days === 0) return 'heute';
  if (days === 1) return 'morgen';
  return `in ${days} Tagen`;
}

interface PricePreviewProps {
  price?: number | null;
  strategy?: string | null;
  amount?: number | null;
  minPrice?: number | null;
  republicationInterval: number;
  delayReposts: number;
  delayDays: number;
  botInfo?: BotInfo;
}

type PreviewMode = 'chips' | 'timeline';

function PricePreview({
  price, strategy, amount, minPrice,
  republicationInterval, delayReposts, delayDays, botInfo,
}: PricePreviewProps) {
  const [mode, setMode] = useState<PreviewMode>('chips');

  const projections = useMemo(() => {
    if (!price || !strategy || !amount || minPrice == null) return null;

    // Build an AdListItem-like object from form values + botInfo
    const ad: AdListItem = {
      file: '',
      title: '',
      active: true,
      type: 'OFFER',
      images: 0,
      has_description: true,
      is_changed: false,
      is_orphaned: false,
      price,
      republication_interval: republicationInterval,
      repost_count: botInfo?.repost_count ?? 0,
      price_reduction_count: botInfo?.price_reduction_count ?? 0,
      created_on: botInfo?.created_on ?? undefined,
      updated_on: botInfo?.updated_on ?? undefined,
      auto_price_reduction: {
        enabled: true,
        strategy: strategy as 'PERCENTAGE' | 'FIXED',
        amount,
        min_price: minPrice,
        delay_reposts: delayReposts,
        delay_days: delayDays,
      },
    };

    return projectReposts(ad);
  }, [price, strategy, amount, minPrice, republicationInterval, delayReposts, delayDays, botInfo]);

  if (!projections || projections.length === 0) return null;

  const now = new Date();
  now.setHours(0, 0, 0, 0);

  const roundedPrice = Math.round(price!);
  const pastAllSteps = projections.filter(s => s.isPast);
  const pastSteps = pastAllSteps.filter(s => !s.isMissed);
  const futureSteps = projections.filter(s => !s.isPast);

  // Check if first reduction step is ineffective due to rounding
  const rawReduction = strategy === 'PERCENTAGE'
    ? roundedPrice * (amount! / 100)
    : amount!;
  const firstStepRounded = Math.round(
    strategy === 'PERCENTAGE'
      ? roundedPrice - (roundedPrice * amount! / 100)
      : roundedPrice - amount!,
  );
  const isFirstStepIneffective = firstStepRounded >= roundedPrice;

  // Detect when price gets stuck above minPrice due to rounding (e.g. 5€ * 90% = 4.5 → rounds back to 5€).
  // Bot behavior: keeps republishing and incrementing price_reduction_count ("no_visible_change"), doesn't stop.
  const firstStuckIndex = futureSteps.findIndex(s => !s.isDelayed && s.reducedBy === null);
  const stuckPrice = firstStuckIndex !== -1 ? futureSteps[firstStuckIndex].price : null;
  const isPriceStuck = !isFirstStepIneffective && stuckPrice != null && stuckPrice > (minPrice ?? 0);

  const isDayDelayIneffective = delayDays > republicationInterval + 1;
  const MAX_TRUNCATE_VISIBLE = 3;

  let visibleFutureSteps = futureSteps;
  let hiddenPausedCount = 0;
  let hiddenStuckCount = 0;

  if (isDayDelayIneffective) {
    visibleFutureSteps = futureSteps.slice(0, MAX_TRUNCATE_VISIBLE);
    hiddenPausedCount = Math.max(0, futureSteps.length - MAX_TRUNCATE_VISIBLE);
  } else if (isPriceStuck) {
    visibleFutureSteps = futureSteps.slice(0, firstStuckIndex + 1);
    hiddenStuckCount = Math.max(0, futureSteps.length - firstStuckIndex - 1);
  } else if (isFirstStepIneffective) {
    const firstNonDelayedIdx = futureSteps.findIndex(s => !s.isDelayed);
    visibleFutureSteps = futureSteps.slice(0, firstNonDelayedIdx + 1);
    hiddenStuckCount = Math.max(0, futureSteps.length - firstNonDelayedIdx - 1);
  }

  // Current effective price
  const currentPrice = pastSteps.length > 0 ? pastSteps[pastSteps.length - 1].price : roundedPrice;

  // Reconstruct past price steps for chips view (start → ... → current)
  const pastPriceSteps: number[] = [];
  if (currentPrice < roundedPrice && strategy && amount && minPrice) {
    let p = roundedPrice;
    while (p > currentPrice) {
      pastPriceSteps.push(p);
      if (strategy === 'PERCENTAGE') {
        p = Math.round(p - (p * amount / 100));
      } else {
        p = Math.round(p - amount);
      }
      if (p < (minPrice ?? 0)) p = minPrice!;
    }
  }

  // Summary stats (exclude missed from count)
  const realSteps = projections.filter(s => !s.isMissed);
  const totalReposts = realSteps.length;
  const finalPrice = realSteps.length > 0 ? realSteps[realSteps.length - 1].price : roundedPrice;
  const lastStep = projections[projections.length - 1];
  const firstStep = projections[0];
  const totalDays = Math.max(0, Math.round((lastStep.date.getTime() - firstStep.date.getTime()) / 86400000));

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

      {isPriceStuck && stuckPrice != null && (
        <div className={styles.priceReductionInfo}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          <div>
            <strong>Der Preis würde bei {stuckPrice} € stecken bleiben</strong>
            <p>
              {stuckPrice} € × {100 - amount!}% = {(stuckPrice * (1 - amount! / 100)).toFixed(2)} € — nach Rundung auf ganze Euro wieder {stuckPrice} €.
              Der Bot publiziert dann weiterhin zu diesem Preis.
              {strategy === 'PERCENTAGE'
                ? ` Tipp: Erhöhe den Prozentsatz oder setze den Mindestpreis auf ${stuckPrice} €.`
                : ` Tipp: Erhöhe den Betrag oder setze den Mindestpreis auf ${stuckPrice} €.`
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
          {/* Past price steps (reconstructed from price_reduction_count) */}
          {pastPriceSteps.map((p, i) => (
            <span key={`past-${i}`}>
              {i > 0 && <span className={styles.pricePreviewArrow}> → </span>}
              <span className={`${styles.pricePreviewStep} ${styles.pricePreviewStepPast}`}>
                {p} €
              </span>
            </span>
          ))}
          {/* Current price (green) */}
          {pastPriceSteps.length > 0 && <span className={styles.pricePreviewArrow}> → </span>}
          <span className={`${styles.pricePreviewStep} ${styles.pricePreviewStepCurrent}`}>
            {currentPrice} €
          </span>
          {/* Future price steps */}
          {visibleFutureSteps.map((step, i) => (
            <span key={`future-${i}`}>
              <span className={styles.pricePreviewArrow}> → </span>
              <span className={[
                styles.pricePreviewStep,
                step.isFinal ? styles.pricePreviewStepFinal : '',
              ].filter(Boolean).join(' ')}>
                {step.price} €
              </span>
            </span>
          ))}
          {hiddenPausedCount > 0 && (
            <span>
              <span className={styles.pricePreviewArrow}> → </span>
              <span className={styles.timelineDate}>… pausiert</span>
            </span>
          )}
          {hiddenStuckCount > 0 && (
            <span>
              <span className={styles.pricePreviewArrow}> → </span>
              <span className={styles.timelineDate}>… weiterhin {stuckPrice} €</span>
            </span>
          )}
        </div>
      ) : (
      <div className={styles.priceTimeline}>
        {/* Start row */}
        <div className={`${styles.timelineRow} ${pastAllSteps.length > 0 ? styles.timelineRowPast : ''}`}>
          <div className={styles.timelineTrack}>
            <div className={`${styles.timelineDot} ${pastAllSteps.length > 0 ? styles.timelineDotPast : ''}`} />
            <div className={styles.timelineLine} />
          </div>
          <div className={styles.timelineContent}>
            <span className={`${styles.timelinePrice} ${pastAllSteps.length > 0 ? styles.timelinePricePast : ''}`}>
              {roundedPrice} €
            </span>
            <span className={styles.timelineDate}>Startpreis</span>
          </div>
        </div>

        {/* Past intervals — all shown as "verpasst" */}
        {pastAllSteps.map((step, i) => {
          const daysFromNow = daysFromToday(step.date, now);
          return (
            <div key={`past-${i}`} className={`${styles.timelineRow} ${styles.timelineRowPast}`}>
              <div className={styles.timelineTrack}>
                <div className={[
                  styles.timelineDot,
                  step.isDelayed ? styles.timelineDotDelayed : '',
                  styles.timelineDotMissed,
                ].filter(Boolean).join(' ')} />
                <div className={styles.timelineLine} />
              </div>
              <div className={styles.timelineContent}>
                <div className={styles.timelineMain}>
                  <span className={`${styles.timelinePrice} ${styles.timelinePriceDelayed}`}>
                    {step.price} €
                    {step.isDelayed
                      ? <span className={styles.timelinePause}>{delayLabel(step)}</span>
                      : <span className={styles.timelineMissed}>verpasst</span>
                    }
                  </span>
                  <span className={styles.timelineRelative}>
                    {formatRelative(daysFromNow)}
                  </span>
                </div>
                <span className={styles.timelineDate}>{formatDate(step.date)} · Repost #{step.repostNumber}</span>
              </div>
            </div>
          );
        })}

        {/* "Aktuell" — today's state */}
        <div className={styles.timelineRow}>
          <div className={styles.timelineTrack}>
            <div className={`${styles.timelineDot} ${styles.timelineDotCurrent}`} />
            {futureSteps.length > 0 && <div className={styles.timelineLine} />}
          </div>
          <div className={styles.timelineContent}>
            <span className={`${styles.timelinePrice} ${styles.timelinePriceCurrent}`}>
              {currentPrice} € <span className={styles.timelineCurrentLabel}>aktuell</span>
            </span>
            <span className={styles.timelineDate}>
              {formatDate(now)} · heute
            </span>
          </div>
        </div>

        {/* Future reposts */}
        {visibleFutureSteps.map((step, i) => {
          const daysFromNow = daysFromToday(step.date, now);
          const isLast = i === visibleFutureSteps.length - 1;
          return (
            <div key={`future-${i}`} className={styles.timelineRow}>
              <div className={styles.timelineTrack}>
                <div className={[
                  styles.timelineDot,
                  step.isFinal ? styles.timelineDotFinal : '',
                  step.isDelayed ? styles.timelineDotDelayed : '',
                ].filter(Boolean).join(' ')} />
                {(!isLast || hiddenPausedCount > 0) && <div className={styles.timelineLine} />}
              </div>
              <div className={styles.timelineContent}>
                <div className={styles.timelineMain}>
                  <span className={[
                    styles.timelinePrice,
                    step.isFinal ? styles.timelinePriceFinal : '',
                    step.isDelayed ? styles.timelinePriceDelayed : '',
                  ].filter(Boolean).join(' ')}>
                    {step.price} €
                    {step.isDelayed && (
                      <span className={styles.timelinePause}>{delayLabel(step)}</span>
                    )}
                    {!step.isDelayed && step.reducedBy === null && (
                      <span className={styles.timelinePause}>kein Abzug</span>
                    )}
                    {!step.isDelayed && step.reducedBy !== null && i === 0 && pastAllSteps.every(s => !s.reducedBy) && (
                      <span className={styles.timelineFirstReduction}>erste Reduktion</span>
                    )}
                  </span>
                  <span className={styles.timelineRelative}>{formatRelative(daysFromNow)}</span>
                </div>
                <span className={styles.timelineDate}>
                  {formatDate(step.date)} · Repost #{step.repostNumber}
                </span>
              </div>
            </div>
          );
        })}

        {hiddenPausedCount > 0 && (
          <div className={styles.timelineRow}>
            <div className={styles.timelineTrack}>
              <div className={`${styles.timelineDot} ${styles.timelineDotDelayed}`} />
            </div>
            <div className={styles.timelineContent}>
              <span className={styles.timelineDate}>
                … weitere {hiddenPausedCount} Reposts pausiert
              </span>
            </div>
          </div>
        )}
        {hiddenStuckCount > 0 && (
          <div className={styles.timelineRow}>
            <div className={styles.timelineTrack}>
              <div className={`${styles.timelineDot} ${styles.timelineDotDelayed}`} />
            </div>
            <div className={styles.timelineContent}>
              <span className={styles.timelineDate}>
                … weiterhin bei {stuckPrice} € ({hiddenStuckCount} weitere Reposts)
              </span>
            </div>
          </div>
        )}

        {/* Summary footer */}
        <div className={styles.timelineSummary}>
          <span>
            <strong>{totalReposts}</strong> Repost{totalReposts !== 1 ? 's' : ''} über{' '}
            <strong>{totalDays}</strong> Tage
          </span>
          <span>
            {roundedPrice} € → {finalPrice} €
            {' '}
            <span className={styles.timelineSavings}>
              (−{roundedPrice - finalPrice} €)
            </span>
          </span>
        </div>
      </div>
      )}
    </div>
  );
}
