import React, { useEffect, useMemo, useRef, useState } from 'react';

/**
 * Multi-series line chart for week-over-week movement.
 *
 * Plain SVG for the same reason the column chart is: the shapes are simple and
 * this keeps the bundle and the styling ours. Colours come in as CSS custom
 * properties rather than hex, so one stylesheet rule swaps the whole palette
 * for dark mode and the PNG export picks up whichever one is live at capture.
 *
 * House data-viz rules applied here:
 *   - 2px strokes, round join and cap; 8px markers with a 2px surface ring so
 *     crossings stay readable;
 *   - hairline solid gridlines in a one-step-off-surface grey, never dashed;
 *   - one y axis, always — the measure is a toggle, never a second scale;
 *   - a crosshair that snaps to the nearest week and one tooltip listing every
 *     series at that week, value first and series name second;
 *   - a legend from two series up, plus direct end-of-line labels at four or
 *     fewer, so identity is never carried by colour alone;
 *   - axis and label text in ink tokens, never in the series colour.
 */

export interface LineSeries {
  key: string;
  label: string;
  /** A CSS colour, normally `var(--dms-series-n)`. */
  color: string;
  /** One per category. null is a genuine gap, drawn as a break, not a zero. */
  values: (number | null)[];
}

export interface LineTrendChartProps {
  categories: string[];
  /** Longer form of each category, used in the tooltip heading. */
  categoryTitles?: string[];
  series: LineSeries[];
  title: string;
  subtitle?: string;
  /** Printed on the axis and in the tooltip. */
  valueSuffix?: string;
  formatValue?: (n: number) => string;
  height?: number;
  emptyMessage?: string;
  /** Rendered under the plot — used for the counting caveat. */
  footnote?: string;
}

const FALLBACK_VIEW_WIDTH = 1000;
const PAD_LEFT = 52;
const PAD_RIGHT = 18;
const PAD_TOP = 16;
const PAD_BOTTOM = 40;

const STROKE = 2;
const MARKER_R = 4;
const RING = 2;

/** Room kept on the right for direct end labels, when they are drawn. */
const LABEL_GUTTER = 108;
/** Baseline offset of a label's second line (the series name). */
const LABEL_SECOND_LINE = 15;
/**
 * Minimum vertical distance between two stacked labels. A label is two lines -
 * value then name - so this has to clear both; at one line's height the pairs
 * printed over each other whenever two series finished close together.
 */
const LABEL_LINE_GAP = 28;

function axisScale(peak: number, integral: boolean, targetTicks = 4): { max: number; ticks: number[] } {
  if (peak <= 0) return { max: 1, ticks: [0, 1] };

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
 * Splits a series into the runs of consecutive readable points. A week with no
 * record for that city is a hole in the data, and joining across it would draw
 * a straight line through a fact nobody has.
 */
function runsOf(values: (number | null)[]): { index: number; value: number }[][] {
  const runs: { index: number; value: number }[][] = [];
  let current: { index: number; value: number }[] = [];
  values.forEach((v, index) => {
    if (v === null || Number.isNaN(v)) {
      if (current.length) runs.push(current);
      current = [];
    } else {
      current.push({ index, value: v });
    }
  });
  if (current.length) runs.push(current);
  return runs;
}

/**
 * Pushes labels apart just enough to stop them overlapping, keeping their
 * original order. Each one keeps a leader line back to its own line-end, so a
 * nudged label still reads as belonging to its series.
 */
function stackLabels(
  entries: { key: string; label: string; color: string; y: number; value: number }[],
  minGap: number,
  top: number,
  bottom: number
): Map<string, number> {
  const sorted = [...entries].sort((a, b) => a.y - b.y);
  const placed: number[] = [];
  let cursor = top;
  for (const entry of sorted) {
    const y = Math.max(entry.y, cursor);
    placed.push(y);
    cursor = y + minGap;
  }
  // If the stack ran past the bottom, slide the whole thing back up.
  const overflow = cursor - minGap - bottom;
  if (overflow > 0) {
    for (let i = 0; i < placed.length; i++) placed[i] -= overflow;
  }
  const out = new Map<string, number>();
  sorted.forEach((entry, i) => out.set(entry.key, placed[i]));
  return out;
}

export const LineTrendChart: React.FC<LineTrendChartProps> = ({
  categories,
  categoryTitles,
  series,
  title,
  subtitle,
  valueSuffix = '',
  formatValue = compact,
  height = 300,
  emptyMessage = 'No data for the selected filters.',
  footnote,
}) => {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

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

  /** Four or fewer lines get their names written at the end of the line. */
  const directLabels = series.length > 0 && series.length <= 4;
  const rightPad = PAD_RIGHT + (directLabels ? LABEL_GUTTER : 0);

  const plotWidth = Math.max(40, viewWidth - PAD_LEFT - rightPad);
  const plotHeight = height - PAD_TOP - PAD_BOTTOM;

  const { yMax, ticks } = useMemo(() => {
    const values = series.flatMap((s) => s.values).filter((v): v is number => v !== null);
    const peak = Math.max(0, ...values);
    const integral = values.every((v) => Number.isInteger(v));
    return (({ max, ticks: t }) => ({ yMax: max, ticks: t }))(axisScale(peak, integral));
  }, [series]);

  if (categories.length === 0 || series.length === 0) {
    return (
      <figure className="bg-white rounded-xl border border-slate-200 p-5 m-0">
        <figcaption className="mb-1">
          <h3 className="text-sm font-bold text-slate-900">{title}</h3>
          {subtitle && <p className="text-[11px] text-slate-500">{subtitle}</p>}
        </figcaption>
        <div className="h-40 flex items-center justify-center text-xs text-slate-400">{emptyMessage}</div>
      </figure>
    );
  }

  // A single week has no run to draw, so points sit in the middle of the plot
  // rather than hard against the left edge.
  const step = categories.length > 1 ? plotWidth / (categories.length - 1) : 0;
  const xFor = (i: number) =>
    categories.length > 1 ? PAD_LEFT + i * step : PAD_LEFT + plotWidth / 2;
  const yFor = (v: number) => PAD_TOP + plotHeight - (yMax === 0 ? 0 : (v / yMax) * plotHeight);

  const baseline = PAD_TOP + plotHeight;

  /** Where each series ends, for the direct label. */
  const endPoints = series
    .map((s) => {
      const runs = runsOf(s.values);
      const last = runs[runs.length - 1];
      if (!last || last.length === 0) return null;
      const point = last[last.length - 1];
      return {
        key: s.key,
        label: s.label,
        color: s.color,
        x: xFor(point.index),
        y: yFor(point.value),
        value: point.value,
      };
    })
    .filter((p): p is NonNullable<typeof p> => p !== null);

  const labelY = directLabels
    ? stackLabels(endPoints, LABEL_LINE_GAP, PAD_TOP + 6, baseline - LABEL_SECOND_LINE)
    : new Map<string, number>();

  // Thin the week ticks only if they would actually collide.
  const labelStride = Math.max(1, Math.ceil(categories.length / Math.max(1, Math.floor(plotWidth / 44))));

  const hoveredTitle =
    hoverIndex === null ? '' : categoryTitles?.[hoverIndex] ?? categories[hoverIndex];

  /** Tooltip sits on whichever side of the crosshair has room. */
  const tooltipLeftPct =
    hoverIndex === null ? 0 : Math.min(100, Math.max(0, (xFor(hoverIndex) / viewWidth) * 100));
  const tooltipFlip = tooltipLeftPct > 62;

  return (
    <figure className="bg-white rounded-xl border border-slate-200 p-5 m-0">
      <figcaption className="mb-2 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-bold text-slate-900">{title}</h3>
          {subtitle && <p className="text-[11px] text-slate-500">{subtitle}</p>}
        </div>

        {/* Mandatory from two series up. Keyed with a line, mirroring the mark. */}
        {series.length > 1 && (
          <ul className="flex flex-wrap items-center gap-x-3 gap-y-1.5 m-0 p-0 list-none">
            {series.map((s) => (
              <li key={s.key} className="flex items-center gap-1.5 text-[11px] font-medium text-slate-600">
                <span
                  aria-hidden="true"
                  className="inline-block w-4 h-0.5 rounded-full shrink-0"
                  style={{ backgroundColor: s.color }}
                />
                {s.label}
              </li>
            ))}
          </ul>
        )}
      </figcaption>

      <div ref={containerRef} className="relative w-full">
        <svg
          viewBox={`0 0 ${viewWidth} ${height}`}
          width="100%"
          height={height}
          role="img"
          aria-label={title}
          style={{ display: 'block', overflow: 'visible' }}
          onPointerLeave={() => setHoverIndex(null)}
        >
          {/* Gridlines + y ticks */}
          {ticks.map((t) => (
            <g key={t}>
              <line
                x1={PAD_LEFT}
                x2={PAD_LEFT + plotWidth}
                y1={yFor(t)}
                y2={yFor(t)}
                stroke="var(--dms-chart-grid)"
                strokeWidth={1}
              />
              <text
                x={PAD_LEFT - 10}
                y={yFor(t) + 3.5}
                textAnchor="end"
                fontSize={10}
                fill="var(--dms-chart-muted)"
              >
                {formatValue(t)}
              </text>
            </g>
          ))}

          {/* Baseline */}
          <line
            x1={PAD_LEFT}
            x2={PAD_LEFT + plotWidth}
            y1={baseline}
            y2={baseline}
            stroke="var(--dms-chart-axis)"
            strokeWidth={1}
          />

          {/* Week ticks */}
          {categories.map((c, i) =>
            i % labelStride === 0 || i === categories.length - 1 ? (
              <text
                key={c + i}
                x={xFor(i)}
                y={baseline + 16}
                textAnchor="middle"
                fontSize={10}
                fontWeight={hoverIndex === i ? 700 : 500}
                fill={hoverIndex === i ? 'var(--dms-chart-ink)' : 'var(--dms-chart-muted)'}
              >
                {c}
              </text>
            ) : null
          )}

          {/* Crosshair, under the marks so it never hides a value. */}
          {hoverIndex !== null && (
            <line
              x1={xFor(hoverIndex)}
              x2={xFor(hoverIndex)}
              y1={PAD_TOP}
              y2={baseline}
              stroke="var(--dms-chart-axis)"
              strokeWidth={1}
            />
          )}

          {/* Lines */}
          {series.map((s) =>
            runsOf(s.values).map((run, runIndex) => (
              <polyline
                key={`${s.key}-${runIndex}`}
                points={run.map((p) => `${xFor(p.index)},${yFor(p.value)}`).join(' ')}
                fill="none"
                stroke={s.color}
                strokeWidth={STROKE}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            ))
          )}

          {/* Markers. The surface ring is what keeps a crossing legible. */}
          {series.map((s) =>
            s.values.map((v, i) =>
              v === null ? null : (
                <circle
                  key={`${s.key}-m-${i}`}
                  cx={xFor(i)}
                  cy={yFor(v)}
                  r={hoverIndex === i ? MARKER_R + 1.5 : MARKER_R}
                  fill={s.color}
                  stroke="var(--dms-chart-surface)"
                  strokeWidth={RING}
                />
              )
            )
          )}

          {/* Direct end labels with a leader back to the line. */}
          {directLabels &&
            endPoints.map((p) => {
              const ly = labelY.get(p.key) ?? p.y;
              const lx = PAD_LEFT + plotWidth + 10;
              return (
                <g key={`${p.key}-label`}>
                  <path
                    d={`M ${p.x + MARKER_R + 2} ${p.y} L ${lx - 5} ${ly}`}
                    fill="none"
                    stroke="var(--dms-chart-grid)"
                    strokeWidth={1}
                  />
                  <text x={lx} y={ly + 3.5} fontSize={10.5} fontWeight={700} fill="var(--dms-chart-ink)">
                    {formatValue(p.value)}
                    {valueSuffix}
                  </text>
                  <text x={lx} y={ly + 15} fontSize={9.5} fill="var(--dms-chart-muted)">
                    {p.label.length > 16 ? `${p.label.slice(0, 15)}…` : p.label}
                  </text>
                </g>
              );
            })}

          {/* Hit bands. One per week, full plot height, so the reader aims at a
              week rather than at a 2px line. */}
          {categories.map((c, i) => (
            <rect
              key={`hit-${c}-${i}`}
              x={categories.length > 1 ? xFor(i) - step / 2 : PAD_LEFT}
              y={PAD_TOP}
              width={categories.length > 1 ? step : plotWidth}
              height={plotHeight}
              fill="transparent"
              onPointerEnter={() => setHoverIndex(i)}
              onFocus={() => setHoverIndex(i)}
              tabIndex={0}
              aria-label={`${categoryTitles?.[i] ?? c}`}
              style={{ outline: 'none' }}
            />
          ))}
        </svg>

        {/* Tooltip: every series at the hovered week, value first. */}
        {hoverIndex !== null && (
          <div
            className="pointer-events-none absolute z-10 min-w-[160px] rounded-lg border border-slate-200 bg-white px-3 py-2 shadow-lg"
            style={{
              left: `${tooltipLeftPct}%`,
              top: 6,
              transform: tooltipFlip ? 'translateX(calc(-100% - 12px))' : 'translateX(12px)',
            }}
          >
            <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
              {hoveredTitle}
            </div>
            <ul className="mt-1 space-y-1 m-0 p-0 list-none">
              {series.map((s) => {
                const v = s.values[hoverIndex];
                return (
                  <li key={s.key} className="flex items-center gap-2 text-xs">
                    <span
                      aria-hidden="true"
                      className="inline-block w-3.5 h-0.5 rounded-full shrink-0"
                      style={{ backgroundColor: s.color }}
                    />
                    <span className="font-bold tabular-nums text-slate-900">
                      {v === null ? '—' : `${formatValue(v)}${valueSuffix}`}
                    </span>
                    <span className="text-slate-500 truncate">{s.label}</span>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </div>

      {footnote && <p className="mt-2 text-[11px] text-slate-500">{footnote}</p>}
    </figure>
  );
};
