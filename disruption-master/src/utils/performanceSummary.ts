/**
 * Date-wise performance aggregation.
 *
 * Answers the questions asked of the summary page: on each date, how many
 * disruptions were raised, how many stores they hit, how many distinct stores
 * that was, how much downtime it added up to, and how long closure took on
 * average.
 *
 * Downtime for a record runs from the disruption start to the ticket closure.
 * Records still open have no closure, so they are counted separately and their
 * elapsed time is reported apart from the settled figure — mixing the two would
 * make the mean drift upwards every time the page is refreshed.
 */

import { Disruption, isDisruptionActive } from '../types';
import { hoursBetween, parseISTTimestamp } from './dateUtils';

export interface DailySummary {
  /** YYYY-MM-DD, the key the rows sort on. */
  date: string;
  /** "22 Oct 2026" for display. */
  displayDate: string;
  disruptionCount: number;
  /** Distinct outlets hit on this date. */
  uniqueStores: number;
  breakdownCount: number;
  nonBreakdownCount: number;
  /** Disruptions raised on this date that have since been closed. */
  closedCount: number;
  openCount: number;
  /** Downtime of the closed records, start to ticket closure. */
  closedDowntimeHours: number;
  /** Mean closure time over the closed records, or null when none are closed. */
  meanClosureHours: number | null;
  /** Longest single closure on the date, for spotting outliers. */
  maxClosureHours: number | null;
  /** Elapsed time of records still open, reported apart from the settled total. */
  openElapsedHours: number;
}

export interface SummaryTotals {
  disruptionCount: number;
  uniqueStores: number;
  closedCount: number;
  openCount: number;
  closedDowntimeHours: number;
  meanClosureHours: number | null;
  datesCovered: number;
}

export interface PerformanceSummary {
  days: DailySummary[];
  totals: SummaryTotals;
  /**
   * Mean closure time over the newer half of the dates minus the older half.
   * Negative means closures are getting faster. Null when there is not enough
   * closed data on both halves to compare.
   */
  closureTrendDelta: number | null;
}

/** The closure time of one record, or null while it is still open. */
export function closureHoursFor(d: Disruption): number | null {
  const closedAt = d.ticketClosedAt || d.endTime;
  if (!closedAt) return null;
  return hoursBetween(d.disruptionStartDateTime, closedAt);
}

/** Hours a still-open record has been running. */
function openElapsedHoursFor(d: Disruption): number {
  const start = parseISTTimestamp(d.disruptionStartDateTime);
  if (start === null) return 0;
  const elapsed = (Date.now() - start) / (1000 * 60 * 60);
  return elapsed > 0 ? elapsed : 0;
}

/** YYYY-MM-DD bucket for a record, preferring the explicit start date field. */
function dateKeyFor(d: Disruption): string | null {
  if (d.disruptionStartDate && /^\d{4}-\d{2}-\d{2}$/.test(d.disruptionStartDate)) {
    return d.disruptionStartDate;
  }
  const ms = parseISTTimestamp(d.disruptionStartDateTime);
  if (ms === null) return null;
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(ms));
  return parts; // en-CA gives YYYY-MM-DD
}

function displayDateFor(dateKey: string): string {
  const [y, m, d] = dateKey.split('-').map(Number);
  if (!y || !m || !d) return dateKey;
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'UTC',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(new Date(Date.UTC(y, m - 1, d)));
}

function round(n: number, places = 1): number {
  const f = 10 ** places;
  return Math.round(n * f) / f;
}

export interface SummaryFilters {
  /** Restrict to these outlet IDs. Empty means every outlet. */
  outletIds?: string[];
  /** Inclusive YYYY-MM-DD bounds. */
  fromDate?: string;
  toDate?: string;
}

/** Normalises a comma, space or newline separated outlet list into IDs. */
export function parseOutletFilter(raw: string): string[] {
  return raw
    .split(/[\s,;]+/)
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);
}

export function buildPerformanceSummary(
  disruptions: Disruption[],
  filters: SummaryFilters = {}
): PerformanceSummary {
  const wanted = new Set((filters.outletIds ?? []).map((o) => o.toUpperCase()));

  const scoped = disruptions.filter((d) => {
    if (wanted.size > 0 && !wanted.has((d.outletId || '').trim().toUpperCase())) return false;
    const key = dateKeyFor(d);
    if (!key) return false;
    if (filters.fromDate && key < filters.fromDate) return false;
    if (filters.toDate && key > filters.toDate) return false;
    return true;
  });

  const buckets = new Map<string, Disruption[]>();
  for (const d of scoped) {
    const key = dateKeyFor(d)!;
    const list = buckets.get(key);
    if (list) list.push(d);
    else buckets.set(key, [d]);
  }

  const days: DailySummary[] = [...buckets.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, records]) => {
      const closureTimes: number[] = [];
      let openElapsed = 0;
      let openCount = 0;
      let breakdownCount = 0;
      let nonBreakdownCount = 0;
      const stores = new Set<string>();

      for (const d of records) {
        stores.add((d.outletId || '').trim().toUpperCase());
        if (d.bucket === 'Breakdown') breakdownCount++;
        else if (d.bucket === 'Non Breakdown') nonBreakdownCount++;

        const closure = closureHoursFor(d);
        if (closure !== null && !isDisruptionActive(d.currentStatus)) {
          closureTimes.push(closure);
        } else {
          openCount++;
          openElapsed += openElapsedHoursFor(d);
        }
      }

      const closedDowntime = closureTimes.reduce((a, b) => a + b, 0);

      return {
        date,
        displayDate: displayDateFor(date),
        disruptionCount: records.length,
        uniqueStores: stores.size,
        breakdownCount,
        nonBreakdownCount,
        closedCount: closureTimes.length,
        openCount,
        closedDowntimeHours: round(closedDowntime),
        meanClosureHours: closureTimes.length ? round(closedDowntime / closureTimes.length, 2) : null,
        maxClosureHours: closureTimes.length ? round(Math.max(...closureTimes), 2) : null,
        openElapsedHours: round(openElapsed),
      };
    });

  const allStores = new Set(scoped.map((d) => (d.outletId || '').trim().toUpperCase()));
  const totalClosed = days.reduce((a, d) => a + d.closedCount, 0);
  const totalClosedDowntime = days.reduce((a, d) => a + d.closedDowntimeHours, 0);

  const totals: SummaryTotals = {
    disruptionCount: scoped.length,
    uniqueStores: allStores.size,
    closedCount: totalClosed,
    openCount: days.reduce((a, d) => a + d.openCount, 0),
    closedDowntimeHours: round(totalClosedDowntime),
    meanClosureHours: totalClosed ? round(totalClosedDowntime / totalClosed, 2) : null,
    datesCovered: days.length,
  };

  return { days, totals, closureTrendDelta: closureTrend(days) };
}

/**
 * Compares mean closure time across the newer and older halves of the range, so
 * the page can say whether closures are speeding up or slowing down.
 */
function closureTrend(days: DailySummary[]): number | null {
  const withClosures = days.filter((d) => d.meanClosureHours !== null);
  if (withClosures.length < 4) return null;

  const mid = Math.floor(withClosures.length / 2);
  const older = withClosures.slice(0, mid);
  const newer = withClosures.slice(mid);

  // Weight by how many closures each day contributed, not by the day itself.
  const weightedMean = (rows: DailySummary[]) => {
    const n = rows.reduce((a, r) => a + r.closedCount, 0);
    if (!n) return null;
    return rows.reduce((a, r) => a + r.closedDowntimeHours, 0) / n;
  };

  const a = weightedMean(older);
  const b = weightedMean(newer);
  if (a === null || b === null) return null;
  return round(b - a, 2);
}
