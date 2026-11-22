/**
 * Week-by-week trend aggregation, grouped by city or by vendor.
 *
 * Three measures come out of the same pass, because the page shows one at a
 * time but the tooltip shows all three and they must agree:
 *
 *   - disruptions: raw row count, the number people are used to;
 *   - instances:   distinct Ticket IDs, so a store that went down, auto
 *                  disabled and went down again on one ticket counts once;
 *   - hours:       each row's own run, added up.
 *
 * One rule worth being explicit about: instances are counted **inside a week**.
 * A ticket whose rows straddle Sunday midnight is one instance in each of the
 * two weeks, not half an instance in each. Any other choice makes the weekly
 * numbers stop adding to the period total, and the page says so in plain words
 * rather than hiding it.
 */

import { Disruption } from '../types';
import { isoWeekOfIndex, weekIndexOf } from './repeatOffender';
import { normalizeTicket, runHours } from './ticketInstances';

/** What the lines are grouped by. */
export type TrendDimension = 'city' | 'vendor';

/** Which measure is on the y axis. One axis only, so this is a toggle. */
export type TrendMetric = 'disruptions' | 'instances' | 'hours';

export const TREND_METRIC_LABELS: Record<TrendMetric, string> = {
  disruptions: 'Disruptions',
  instances: 'Instances',
  hours: 'Hours',
};

export const TREND_METRIC_HINTS: Record<TrendMetric, string> = {
  disruptions: 'Every disruption row raised that week',
  instances: 'Distinct Ticket IDs — repeats on one ticket count once',
  hours: 'Each row’s own running time, added up',
};

export interface TrendWeek {
  /** Monday-anchored internal index, the key everything is bucketed on. */
  weekIndex: number;
  /** The real ISO week number people say out loud: 47, 48, 49. */
  isoWeek: number;
  isoYear: number;
  /** "W47" for an axis tick. */
  shortLabel: string;
  /** "Week 47 · 2026" for a tooltip heading. */
  longLabel: string;
}

export interface TrendCell {
  disruptions: number;
  instances: number;
  hours: number;
}

export interface TrendSeriesRow {
  /** Upper-cased group key, stable across filter changes. */
  key: string;
  /** As it should be printed. */
  label: string;
  /** weekIndex -> measures. Missing weeks are genuinely absent, not zero. */
  cells: Map<number, TrendCell>;
  /** The whole selected window, for ranking and for the table view. */
  total: TrendCell;
}

export interface CityTrendReport {
  /** The weeks actually plotted, oldest first — a line reads left to right. */
  weeks: TrendWeek[];
  /** Series, worst first on the chosen measure. */
  rows: TrendSeriesRow[];
  /** Rows with no readable start time, which cannot be put in a week. */
  undatedRecords: number;
  /** Rows whose group field is blank, counted under "Not set". */
  ungroupedRecords: number;
}

export const UNGROUPED_LABEL = 'Not set';

function emptyCell(): TrendCell {
  return { disruptions: 0, instances: 0, hours: 0 };
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/** Builds the display shape of one week index. */
export function describeWeek(weekIndex: number): TrendWeek {
  const { year, week } = isoWeekOfIndex(weekIndex);
  return {
    weekIndex,
    isoWeek: week,
    isoYear: year,
    shortLabel: `W${week}`,
    longLabel: `Week ${week} · ${year}`,
  };
}

/** The group field for a record, upper-cased for keying. */
function groupKeyOf(d: Disruption, dimension: TrendDimension): { key: string; label: string } {
  const raw =
    dimension === 'city'
      ? (d.city || '').trim()
      : (d.currentVendor || d.vendor || '').trim();
  if (!raw) return { key: '\u0000UNGROUPED', label: UNGROUPED_LABEL };
  return { key: raw.toUpperCase(), label: raw };
}

/**
 * Every week that carries at least one readable record, newest first — this is
 * what fills the week multi-select, so the list never offers an empty week.
 */
export function availableWeeks(disruptions: Disruption[]): TrendWeek[] {
  const seen = new Set<number>();
  for (const d of disruptions) {
    const w = weekIndexOf(d.disruptionStartDateTime);
    if (w !== null) seen.add(w);
  }
  return [...seen].sort((a, b) => b - a).map(describeWeek);
}

/** Distinct group values present in the data, alphabetical, blanks last. */
export function availableGroups(
  disruptions: Disruption[],
  dimension: TrendDimension
): string[] {
  const seen = new Set<string>();
  let hasBlank = false;
  for (const d of disruptions) {
    const { key, label } = groupKeyOf(d, dimension);
    if (key === '\u0000UNGROUPED') hasBlank = true;
    else seen.add(label);
  }
  const list = [...seen].sort((a, b) => a.localeCompare(b));
  if (hasBlank) list.push(UNGROUPED_LABEL);
  return list;
}

export interface TrendFilters {
  dimension: TrendDimension;
  /** Week indices to plot. Empty means every week in the data. */
  weekIndices: number[];
  /** Group labels to keep. Empty means every group. */
  groups: string[];
  /**
   * Cities to narrow to before grouping by vendor — "which vendor breaks most
   * in Delhi" is a vendor chart scoped to one city, and that is the question
   * the request actually asked.
   */
  cities?: string[];
  /** Ranked by this measure, and the measure the chart plots. */
  metric: TrendMetric;
}

export function buildCityTrendReport(
  disruptions: Disruption[],
  filters: TrendFilters
): CityTrendReport {
  const wantedWeeks = new Set(filters.weekIndices);
  const wantedGroups = new Set(filters.groups.map((g) => g.trim().toUpperCase()));
  const wantedCities = new Set((filters.cities ?? []).map((c) => c.trim().toUpperCase()));

  let undatedRecords = 0;
  let ungroupedRecords = 0;

  /** groupKey -> weekIndex -> rows, so instances can be counted per bucket. */
  const buckets = new Map<string, { label: string; weeks: Map<number, Disruption[]> }>();

  /**
   * The axis is the weeks the reader ASKED for, not the weeks that survived the
   * group filter. Narrowing it to what survived was a real bug: a city with
   * nothing at all in week 44 had week 44 drop off the axis, and a chart that
   * quietly deletes the quiet weeks answers "is it getting worse" wrongly - the
   * line closed the hole up and read as flat. A week in scope with no record is
   * a gap, which the chart draws as a break.
   */
  const axisWeeks = new Set<number>();
  for (const d of disruptions) {
    const week = weekIndexOf(d.disruptionStartDateTime);
    if (week === null) continue;
    if (wantedWeeks.size > 0 && !wantedWeeks.has(week)) continue;
    axisWeeks.add(week);
  }

  for (const d of disruptions) {
    // City scoping applies to the vendor view only; in the city view the city
    // multi-select already does it and a second filter would fight it.
    if (filters.dimension === 'vendor' && wantedCities.size > 0) {
      const city = (d.city || '').trim().toUpperCase();
      if (!wantedCities.has(city)) continue;
    }

    const week = weekIndexOf(d.disruptionStartDateTime);
    if (week === null) {
      undatedRecords += 1;
      continue;
    }
    if (wantedWeeks.size > 0 && !wantedWeeks.has(week)) continue;

    const { key, label } = groupKeyOf(d, filters.dimension);
    const matchKey = key === '\u0000UNGROUPED' ? UNGROUPED_LABEL.toUpperCase() : key;
    if (wantedGroups.size > 0 && !wantedGroups.has(matchKey)) continue;
    if (key === '\u0000UNGROUPED') ungroupedRecords += 1;

    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = { label, weeks: new Map() };
      buckets.set(key, bucket);
    }
    const list = bucket.weeks.get(week);
    if (list) list.push(d);
    else bucket.weeks.set(week, [d]);
  }

  // Oldest first - a line reads left to right.
  const weeks = [...axisWeeks].sort((a, b) => a - b).map(describeWeek);

  const rows: TrendSeriesRow[] = [...buckets.entries()].map(([key, bucket]) => {
    const cells = new Map<number, TrendCell>();
    const total = emptyCell();
    // Period-level instances are counted over the whole window, so the total
    // column is right even when one ticket spans two of the weeks.
    const periodTickets = new Set<string>();
    let periodUntagged = 0;

    for (const [week, records] of bucket.weeks) {
      const tickets = new Set<string>();
      let untagged = 0;
      let hours = 0;

      for (const d of records) {
        const ticket = normalizeTicket(d.ticketId);
        if (ticket) {
          tickets.add(ticket);
          periodTickets.add(ticket);
        } else {
          untagged += 1;
          periodUntagged += 1;
        }
        hours += runHours(d) ?? 0;
      }

      cells.set(week, {
        disruptions: records.length,
        instances: tickets.size + untagged,
        hours: round1(hours),
      });

      total.disruptions += records.length;
      total.hours += hours;
    }

    total.hours = round1(total.hours);
    total.instances = periodTickets.size + periodUntagged;

    return { key, label: bucket.label, cells, total };
  });

  rows.sort((a, b) => {
    const diff = b.total[filters.metric] - a.total[filters.metric];
    if (diff !== 0) return diff;
    return a.label.localeCompare(b.label);
  });

  return { weeks, rows, undatedRecords, ungroupedRecords };
}

/** The values of one series along the week axis, with gaps as nulls. */
export function seriesValues(
  row: TrendSeriesRow,
  weeks: TrendWeek[],
  metric: TrendMetric
): (number | null)[] {
  return weeks.map((w) => {
    const cell = row.cells.get(w.weekIndex);
    return cell ? cell[metric] : null;
  });
}
