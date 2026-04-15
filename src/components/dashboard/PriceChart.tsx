'use client';

import { memo, useMemo, useState, useCallback, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import type { AdListItem } from '@/types/ad';
import { projectReposts, getCurrentPrice } from '@/lib/ads/pricing';
import styles from './PriceChart.module.scss';

interface PriceChartProps {
  ads: AdListItem[];
}

const CHART_COLORS = [
  'var(--accent)',
  'var(--green)',
  'var(--red)',
  'var(--yellow)',
  'var(--orange)',
  '#8b5cf6',
  '#06b6d4',
  '#ec4899',
  '#14b8a6',
  '#f97316',
];

interface PricePoint {
  repost: number;
  price: number;
  date: string | null;
}

const formatDate = (d: Date) =>
  d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });

/** Build chart points from shared projectReposts(), starting at current effective price. */
function buildChartPoints(ad: AdListItem): PricePoint[] {
  const projections = projectReposts(ad);
  if (projections.length === 0) return [];

  const currentPrice = getCurrentPrice(ad) ?? ad.price ?? 0;
  const startRepost = ad.repost_count ?? 0;

  // Start point = current state
  const points: PricePoint[] = [{
    repost: startRepost,
    price: currentPrice,
    date: null,
  }];

  // Add future projections only
  for (const step of projections) {
    if (step.isPast) continue;
    points.push({
      repost: step.repostNumber,
      price: step.price,
      date: formatDate(step.date),
    });
  }

  return points;
}

interface TooltipState {
  visible: boolean;
  text: string;
  x: number;
  y: number;
}

export const PriceChart = memo(function PriceChart({ ads }: PriceChartProps) {
  const router = useRouter();
  const wrapRef = useRef<HTMLDivElement>(null);
  const pathRefs = useRef<(SVGPathElement | null)[]>([]);
  const [tooltip, setTooltip] = useState<TooltipState>({
    visible: false,
    text: '',
    x: 0,
    y: 0,
  });

  const lines = useMemo(() => {
    const aprAds = ads
      .filter((a) => a.auto_price_reduction?.enabled && a.price)
      .sort((a, b) => (b.price || 0) - (a.price || 0))
      .slice(0, 10);

    return aprAds.map((ad) => ({
      ad,
      points: buildChartPoints(ad),
    }));
  }, [ads]);

  const { maxRepost, maxPrice } = useMemo(() => {
    let mr = 0;
    let mp = 0;
    for (const line of lines) {
      for (const pt of line.points) {
        if (pt.repost > mr) mr = pt.repost;
        if (pt.price > mp) mp = pt.price;
      }
    }
    return { maxRepost: mr || 1, maxPrice: mp || 100 };
  }, [lines]);

  const handleDotHover = useCallback(
    (e: React.MouseEvent, adTitle: string, repost: number, price: number, date: string | null) => {
      if (!wrapRef.current) return;
      const rect = wrapRef.current.getBoundingClientRect();
      const dateStr = date ? ` · ${date}` : '';
      setTooltip({
        visible: true,
        text: `${adTitle} – #${repost}: ${price} €${dateStr}`,
        x: e.clientX - rect.left + 10,
        y: e.clientY - rect.top - 30,
      });
    },
    [],
  );

  const handleDotLeave = useCallback(() => {
    setTooltip((prev) => ({ ...prev, visible: false }));
  }, []);

  // Measure actual path lengths for draw animation
  useEffect(() => {
    pathRefs.current.forEach((path) => {
      if (!path) return;
      const len = path.getTotalLength();
      path.style.setProperty('--line-length', `${len}`);
    });
  }, [lines]);

  if (lines.length === 0 || lines.every((l) => l.points.length < 2)) return null;

  // Chart dimensions
  const margin = { top: 16, right: 8, bottom: 36, left: 22 };
  const width = 700;
  const height = 300;
  const innerW = width - margin.left - margin.right;
  const innerH = height - margin.top - margin.bottom;

  const scaleX = (repost: number) => margin.left + (repost / maxRepost) * innerW;
  const scaleY = (price: number) => margin.top + (1 - price / maxPrice) * innerH;

  // Y-axis grid + labels
  const yTicks = 5;
  const yElements = [];
  for (let i = 0; i <= yTicks; i++) {
    const y = margin.top + (innerH / yTicks) * i;
    const priceVal = Math.round(maxPrice - (maxPrice / yTicks) * i);
    yElements.push(
      <g key={`y-${i}`}>
        <line
          x1={margin.left}
          x2={width - margin.right}
          y1={y}
          y2={y}
          stroke="var(--border-color)"
          strokeWidth={1}
        />
        <text
          x={0}
          y={y - 3}
          textAnchor="start"
          className={styles.axisLabel}
        >
          {priceVal} €
        </text>
      </g>,
    );
  }

  // X-axis labels
  const xTicks = Math.min(maxRepost, 10);
  const xElements = [];
  for (let i = 0; i <= xTicks; i++) {
    const repostVal = Math.round((maxRepost / xTicks) * i);
    const x = margin.left + (innerW / xTicks) * i;
    xElements.push(
      <text
        key={`x-${i}`}
        x={x}
        y={height - 8}
        textAnchor="middle"
        className={styles.axisLabel}
      >
        #{repostVal}
      </text>,
    );
  }

  return (
    <div className={styles.section}>
      <div className={styles.sectionTitle}>Preisentwicklung (Projektion)</div>
      <div ref={wrapRef} className={styles.chartWrap}>
        {tooltip.visible && (
          <div
            className={styles.tooltip}
            style={{ left: tooltip.x, top: tooltip.y }}
          >
            {tooltip.text}
          </div>
        )}
        <svg viewBox={`0 0 ${width} ${height}`} className={styles.chartSvg}>
          {yElements}
          {xElements}
          <text
            x={margin.left + innerW / 2}
            y={height}
            textAnchor="middle"
            className={styles.axisLabel}
          >
            Repost
          </text>

          {lines.map((line, li) => {
            if (line.points.length < 2) return null;
            const color = CHART_COLORS[li % CHART_COLORS.length];
            const d = line.points
              .map(
                (pt, pi) =>
                  `${pi === 0 ? 'M' : 'L'}${scaleX(pt.repost).toFixed(1)},${scaleY(pt.price).toFixed(1)}`,
              )
              .join('');

            const lineDelay = li * 150;
            return (
              <g key={line.ad.file}>
                <path
                  ref={(el) => { pathRefs.current[li] = el; }}
                  d={d}
                  stroke={color}
                  className={styles.priceLine}
                  style={{ '--anim-delay': `${lineDelay}ms` } as React.CSSProperties}
                />
                {line.points.map((pt, pi) => (
                  <circle
                    key={`${pt.repost}-${pt.price}`}
                    cx={scaleX(pt.repost).toFixed(1)}
                    cy={scaleY(pt.price).toFixed(1)}
                    r={2}
                    fill={color}
                    className={styles.priceDot}
                    style={{ '--anim-delay': `${lineDelay + 800 + pi * 40}ms` } as React.CSSProperties}
                    onClick={() => router.push(`/ads/edit?file=${encodeURIComponent(line.ad.file)}`)}
                    onMouseOver={(e) =>
                      handleDotHover(e, line.ad.title || '', pt.repost, pt.price, pt.date)
                    }
                    onMouseOut={handleDotLeave}
                  />
                ))}
              </g>
            );
          })}
        </svg>
      </div>

      {/* Legend */}
      <div className={styles.legend}>
        {lines.map((line, li) => (
          <div
            key={line.ad.file}
            className={styles.legendItem}
            onClick={() => router.push(`/ads/edit?file=${encodeURIComponent(line.ad.file)}`)}
          >
            <span
              className={styles.legendColor}
              style={{ background: CHART_COLORS[li % CHART_COLORS.length] }}
            />
            <span>{line.ad.title || 'Anzeige'}</span>
          </div>
        ))}
      </div>
    </div>
  );
});
