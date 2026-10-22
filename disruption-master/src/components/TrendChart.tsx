import React, { useEffect, useMemo, useRef, useState } from 'react';

/**
 * Grouped column chart for date-wise trends.
 *
 * Deliberately plain SVG rather than a charting dependency: the shapes needed
 * here are simple, and this keeps the bundle and the styling under our control.
 *
 * Mark specs follow the house data-viz rules — columns capped at 24px with a
 * 4px rounded cap and a square baseline, a 2px surface gap between neighbours,
 * hairline solid gridlines, a legend whenever there are two or more series, and
 * a direct label only on the extreme. Axis and value text uses ink tokens, never
 * the series colour.
 */

export interface ChartSeries {
  key: string;
  label: string;
  /** Series colour, from the validated categorical palette. */
  color: string;
  values: number[];
}

interface TrendChartProps {
  categories: string[];
  series: ChartSeries[];
  /** Rendered above the plot, naming what is measured. */
  title: string;
  subtitle?: string;
  formatValue?: (n: number) => string;
  /** Plot height in viewBox units. */
  height?: number;
  emptyMessage?: string;
}

const FALLBACK_VIEW_WIDTH = 1000;
const PAD_LEFT = 54;
const PAD_RIGHT = 16;
const PAD_TOP = 14;
const PAD_BOTTOM = 44;

const MAX_BAR_THICKNESS = 24;
const BAR_GAP = 2; // surface gap between touching columns
const CAP_RADIUS = 4;

const INK_SECONDARY = '#52525b';
const INK_MUTED = '#a1a1aa';
const GRID = '#e4e4e7';
const SURFACE = '#ffffff';

/**
 * Picks a clean tick step and ceiling for the axis.
 *
 * Counts get whole-number ticks — "1.3 disruptions" is not a readable gridline —
 * and the ceiling is the smallest clean multiple above the peak, so a 29.9 peak
 * tops out at 30 rather than wasting half the plot on a 50.
 */
function axisScale(peak: number, integral: boolean, targetTicks = 4): { max: number; ticks: number[] } {
  if (peak <= 0) return { max: integral ? 1 : 1, ticks: integral ? [0, 1] : [0, 1] };

  const raw = peak / targetTicks;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const candidates = integral ? [1, 2, 5, 10] : [1, 2, 2.5, 5, 10];

  let step = magnitude * candidates[candidates.length - 1];
  for (const c of candidates) {
    if (magnitude * c >= raw) {
      step = magnitude * c;
      break;
    }
  }
  if (integral) step = Math.max(1, Math.round(step));

  const max = step * Math.ceil(peak / step);
  const ticks: number[] = [];
  for (let v = 0; v <= max + 1e-9; v += step) {
    ticks.push(Number(v.toFixed(6)));
  }
  return { max, ticks };
}

function compact(n: number): string {
  if (Math.abs(n) >= 1000) return `${(n / 1000).toFixed(n % 1000 === 0 ? 0 : 1)}K`;
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

/**
 * A column with a rounded cap and square feet. Drawn as a path so the baseline
 * stays flat against the axis — a uniformly rounded rect lifts off it.
 */
function columnPath(x: number, y: number, w: number, h: number): string {
  if (h <= 0) return '';
  const r = Math.min(CAP_RADIUS, w / 2, h);
  return [
    `M ${x} ${y + h}`,
    `L ${x} ${y + r}`,
    `Q ${x} ${y} ${x + r} ${y}`,
    `L ${x + w - r} ${y}`,
    `Q ${x + w} ${y} ${x + w} ${y + r}`,
    `L ${x + w} ${y + h}`,
    'Z',
  ].join(' ');
}

export const TrendChart: React.FC<TrendChartProps> = ({
  categories,
  series,
  title,
  subtitle,
  formatValue = compact,
  height = 260,
  emptyMessage = 'No data for the selected filters.',
}) => {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  /**
   * The viewBox is sized to the container so one viewBox unit is one CSS pixel.
   * Without this a chart in a container wider than the viewBox is letterboxed —
   * `preserveAspectRatio` centres it and leaves gutters down both sides.
   */
  const containerRef = useRef<HTMLDivElement>(null);
  const [viewWidth, setViewWidth] = useState(FALLBACK_VIEW_WIDTH);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width;
      if (width && width > 0) setViewWidth(Math.round(width));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const plotWidth = viewWidth - PAD_LEFT - PAD_RIGHT;
  const plotHeight = height - PAD_TOP - PAD_BOTTOM;

  const { yMax, ticks } = useMemo(() => {
    const values = series.flatMap((s) => s.values);
    const peak = Math.max(0, ...values);
    // Whole-number ticks when every plotted value is a whole number.
    const integral = values.every((v) => Number.isInteger(v));
    const { max, ticks: t } = axisScale(peak, integral);
    return { yMax: max, ticks: t };
  }, [series]);

  // The single highest column across every series gets the direct label.
  const extreme = useMemo(() => {
    let best = { index: -1, seriesKey: '', value: -Infinity };
    series.forEach((s) =>
      s.values.forEach((v, i) => {
        if (v > best.value) best = { index: i, seriesKey: s.key, value: v };
      })
    );
    return best;
  }, [series]);

  if (categories.length === 0) {
    return (
      <figure className="bg-white rounded-xl border border-slate-200 p-5 m-0">
        <figcaption className="mb-1">
          <h3 className="text-sm font-bold text-slate-900">{title}</h3>
          {subtitle && <p className="text-[11px] text-slate-500">{subtitle}</p>}
        </figcaption>
        <div className="h-32 flex items-center justify-center text-xs text-slate-400">{emptyMessage}</div>
      </figure>
    );
  }

  const bandWidth = plotWidth / categories.length;
  const groupWidth = Math.min(bandWidth * 0.68, MAX_BAR_THICKNESS * series.length + BAR_GAP * (series.length - 1));
  const barWidth = Math.max(2, (groupWidth - BAR_GAP * (series.length - 1)) / series.length);

  const yFor = (v: number) => PAD_TOP + plotHeight - (yMax === 0 ? 0 : (v / yMax) * plotHeight);

  // Thin the x labels when the dates would otherwise collide.
  const labelStride = Math.ceil(categories.length / 14);

  return (
    <figure className="bg-white rounded-xl border border-slate-200 p-5 m-0">
      <figcaption className="mb-2 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-bold text-slate-900">{title}</h3>
          {subtitle && <p className="text-[11px] text-slate-500">{subtitle}</p>}
        </div>

        {/* Legend is mandatory from two series up; one series is named by the title. */}
        {series.length > 1 && (
          <ul className="flex flex-wrap items-center gap-3 m-0 p-0 list-none">
            {series.map((s) => (
              <li key={s.key} className="flex items-center gap-1.5 text-[11px] text-slate-600">
                <span
                  aria-hidden="true"
                  className="inline-block w-2.5 h-2.5 rounded-sm shrink-0"
                  style={{ backgroundColor: s.color }}
                />
                {s.label}
              </li>
            ))}
          </ul>
        )}
      </figcaption>

      <div className="relative" ref={containerRef}>
        <svg
          viewBox={`0 0 ${viewWidth} ${height}`}
          width="100%"
          height={height}
          role="img"
          aria-label={`${title}. ${subtitle ?? ''}`}
          onMouseLeave={() => setHoverIndex(null)}
        >
          {/* Gridlines and y ticks */}
          {ticks.map((t) => (
            <g key={t}>
              <line
                x1={PAD_LEFT}
                x2={viewWidth - PAD_RIGHT}
                y1={yFor(t)}
                y2={yFor(t)}
                stroke={GRID}
                strokeWidth={1}
              />
              <text
                x={PAD_LEFT - 8}
                y={yFor(t) + 4}
                textAnchor="end"
                fontSize={11}
                fill={INK_MUTED}
                fontFamily="inherit"
              >
                {compact(t)}
              </text>
            </g>
          ))}

          {categories.map((cat, i) => {
            const bandStart = PAD_LEFT + bandWidth * i;
            const groupStart = bandStart + (bandWidth - groupWidth) / 2;
            const isHovered = hoverIndex === i;

            return (
              <g key={cat}>
                {/* Hit target spans the whole band so hovering is forgiving. */}
                <rect
                  x={bandStart}
                  y={PAD_TOP}
                  width={bandWidth}
                  height={plotHeight}
                  fill={isHovered ? '#f4f4f5' : 'transparent'}
                  onMouseEnter={() => setHoverIndex(i)}
                />

                {series.map((s, si) => {
                  const v = s.values[i] ?? 0;
                  const y = yFor(v);
                  const h = PAD_TOP + plotHeight - y;
                  const x = groupStart + si * (barWidth + BAR_GAP);
                  const isExtreme = extreme.index === i && extreme.seriesKey === s.key && v > 0;

                  return (
                    <g key={s.key} pointerEvents="none">
                      <path d={columnPath(x, y, barWidth, h)} fill={s.color} />
                      {isExtreme && (
                        <text
                          x={x + barWidth / 2}
                          y={y - 6}
                          textAnchor="middle"
                          fontSize={11}
                          fontWeight={700}
                          fill={INK_SECONDARY}
                          fontFamily="inherit"
                        >
                          {formatValue(v)}
                        </text>
                      )}
                    </g>
                  );
                })}

                {/* X label, thinned so dates never overlap */}
                {i % labelStride === 0 && (
                  <text
                    x={bandStart + bandWidth / 2}
                    y={height - PAD_BOTTOM + 18}
                    textAnchor="middle"
                    fontSize={11}
                    fill={INK_MUTED}
                    fontFamily="inherit"
                    pointerEvents="none"
                  >
                    {cat}
                  </text>
                )}
              </g>
            );
          })}

          {/* Baseline sits above the marks so columns read as grown from it */}
          <line
            x1={PAD_LEFT}
            x2={viewWidth - PAD_RIGHT}
            y1={PAD_TOP + plotHeight}
            y2={PAD_TOP + plotHeight}
            stroke={INK_MUTED}
            strokeWidth={1}
          />
        </svg>

        {/* Tooltip. Positioned over the hovered band. */}
        {hoverIndex !== null && (
          <div
            className="absolute pointer-events-none z-10 px-2.5 py-1.5 rounded-lg bg-slate-900 text-white shadow-lg text-[11px] whitespace-nowrap"
            style={{
              left: `${((PAD_LEFT + bandWidth * (hoverIndex + 0.5)) / viewWidth) * 100}%`,
              top: 0,
              transform: 'translateX(-50%)',
              backgroundColor: '#18181b',
            }}
          >
            <div className="font-bold mb-0.5">{categories[hoverIndex]}</div>
            {series.map((s) => (
              <div key={s.key} className="flex items-center gap-1.5">
                <span
                  aria-hidden="true"
                  className="inline-block w-2 h-2 rounded-sm shrink-0"
                  style={{ backgroundColor: s.color, outline: `1px solid ${SURFACE}33` }}
                />
                <span className="text-slate-300">{s.label}:</span>
                <span className="font-semibold tabular-nums">{formatValue(s.values[hoverIndex] ?? 0)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </figure>
  );
};
