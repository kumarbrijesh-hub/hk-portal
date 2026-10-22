/**
 * Repeat-offender detection.
 *
 * A store that shows up in disruptions week after week is a different problem
 * from one that broke once. Three weeks running is worth a warning, four or
 * more is a red flag, and the Live Tracker badges the outlet ID accordingly.
 */

import { Disruption } from '../types';
import { parseISTTimestamp } from './dateUtils';

/** Weeks run Monday to Sunday in IST. */
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
/** 1970-01-05 was the first Monday, i.e. epoch day 4. */
const FIRST_MONDAY_DAY = 4;

export const REPEAT_WARN_WEEKS = 3;
export const REPEAT_FLAG_WEEKS = 4;

/**
 * Monday-anchored week number for an IST timestamp, or null when unreadable.
 * The absolute value carries no meaning; only differences between two weeks do.
 */
export function weekIndexOf(istTimestamp?: string): number | null {
  const ms = parseISTTimestamp(istTimestamp);
  if (ms === null) return null;
  // Read the instant as IST wall-clock before splitting it into days.
  const istDays = Math.floor((ms + 5.5 * 60 * 60 * 1000) / DAY_MS);
  return Math.floor((istDays - FIRST_MONDAY_DAY) / 7);
}

/** Week number for right now, used when a record has no readable start time. */
export function currentWeekIndex(): number {
  const istDays = Math.floor((Date.now() + 5.5 * 60 * 60 * 1000) / DAY_MS);
  return Math.floor((istDays - FIRST_MONDAY_DAY) / 7);
}

export type RepeatSeverity = 'none' | 'warn' | 'flag';

export interface RepeatStreak {
  /** Consecutive weeks with at least one disruption, ending at the anchor week. */
  weeks: number;
  severity: RepeatSeverity;
}

/**
 * Builds, for each outlet, the set of weeks it had a disruption in. Computed
 * once per table render rather than per row.
 */
export function buildOutletWeekIndex(disruptions: Disruption[]): Map<string, Set<number>> {
  const index = new Map<string, Set<number>>();
  for (const d of disruptions) {
    const outlet = (d.outletId || '').trim().toUpperCase();
    if (!outlet) continue;
    const week = weekIndexOf(d.disruptionStartDateTime);
    if (week === null) continue;
    let weeks = index.get(outlet);
    if (!weeks) {
      weeks = new Set<number>();
      index.set(outlet, weeks);
    }
    weeks.add(week);
  }
  return index;
}

/**
 * How many weeks in an unbroken run this outlet has been breaking, counting
 * back from `anchorWeek` (the week of the row being looked at). Anchoring to
 * the row rather than to today keeps the badge correct on historical rows.
 */
export function repeatStreakFor(
  outletId: string,
  anchorWeek: number | null,
  weekIndex: Map<string, Set<number>>
): RepeatStreak {
  const weeks = weekIndex.get((outletId || '').trim().toUpperCase());
  const anchor = anchorWeek ?? currentWeekIndex();
  if (!weeks || !weeks.has(anchor)) {
    return { weeks: 0, severity: 'none' };
  }

  let streak = 0;
  for (let w = anchor; weeks.has(w); w--) {
    streak++;
    // Guard against a runaway loop on absurd data.
    if (streak > 520) break;
  }

  return {
    weeks: streak,
    severity:
      streak >= REPEAT_FLAG_WEEKS ? 'flag' : streak >= REPEAT_WARN_WEEKS ? 'warn' : 'none',
  };
}

/** Badge wording: "3 Week Broken", "4 Week Broken", and so on. */
export function repeatBadgeLabel(streak: RepeatStreak): string {
  return `${streak.weeks} Week Broken`;
}
