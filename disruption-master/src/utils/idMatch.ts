/**
 * Pairing unmatched sheet IDs with the app records they were meant to hit.
 *
 * The server can only say "no record has this ID". Which record the sheet row
 * actually meant is a judgement, and it is made here: same outlet, nearest
 * start minute. The page shows the gap rather than deciding for anyone - a
 * twenty-minute gap is almost certainly the same incident typed differently, a
 * three-day gap almost certainly is not, and only a person can tell which.
 */

import { Disruption, IdMatchFeedKey, SHEET_SOURCE_LABELS, UnmatchedSheetId } from '../types';
import { minuteStampFor, parseDisruptionId } from './idAlignment';

export interface IdMatchCandidate {
  disruption: Disruption;
  /** App start minus sheet stamp, in minutes. Positive means later here. */
  minuteGap: number | null;
  /** Same calendar day as the sheet stamp. */
  sameDay: boolean;
}

export interface IdMatchRow {
  /** Stable per feed+ID, for React keys and for the expanded-row state. */
  key: string;
  feed: IdMatchFeedKey;
  feedLabel: string;
  /** As the sheet spells it. */
  sheetDisruptionId: string;
  /** Read out of the ID itself. */
  outletId: string;
  sheetDate: string;
  sheetTime: string;
  minuteStamp: number | null;
  ticketId: string;
  ticketStatus: string;
  endTime: string;
  seenAt: string;
  /** Whether the outlet is one this console knows at all. */
  outletKnown: boolean;
  candidates: IdMatchCandidate[];
}

/** The app record's own start, as minutes, for comparing against an ID stamp. */
export function disruptionMinuteStamp(d: Disruption): number | null {
  return minuteStampFor(d.disruptionStartDate, d.disruptionStartTime);
}

/**
 * How many candidates to offer per row. Six is enough to cover a store that was
 * logged a few times in a day without turning the page into a second tracker.
 */
const MAX_CANDIDATES = 6;

export function buildIdMatchRows(
  unmatched: UnmatchedSheetId[],
  disruptions: Disruption[]
): IdMatchRow[] {
  const byOutlet = new Map<string, Disruption[]>();
  for (const d of disruptions) {
    const key = (d.outletId || '').trim().toUpperCase();
    if (!key) continue;
    const list = byOutlet.get(key);
    if (list) list.push(d);
    else byOutlet.set(key, [d]);
  }

  const rows = unmatched.map((entry): IdMatchRow => {
    const parsed = parseDisruptionId(entry.sheetDisruptionId);
    const pool = byOutlet.get(parsed.outletId) ?? [];

    const candidates: IdMatchCandidate[] = pool
      .map((disruption) => {
        const own = disruptionMinuteStamp(disruption);
        const minuteGap =
          own === null || parsed.minuteStamp === null ? null : own - parsed.minuteStamp;
        return {
          disruption,
          minuteGap,
          sameDay: Boolean(parsed.date) && disruption.disruptionStartDate === parsed.date,
        };
      })
      .sort((a, b) => {
        // Comparable gaps first and closest first; everything else after, newest
        // first, so a row with no stamp still shows that outlet's recent work.
        if (a.minuteGap !== null && b.minuteGap !== null) {
          return Math.abs(a.minuteGap) - Math.abs(b.minuteGap);
        }
        if (a.minuteGap !== null) return -1;
        if (b.minuteGap !== null) return 1;
        return (b.disruption.disruptionStartDate || '').localeCompare(
          a.disruption.disruptionStartDate || ''
        );
      })
      .slice(0, MAX_CANDIDATES);

    return {
      key: `${entry.feed}|${entry.sheetDisruptionId.toUpperCase()}`,
      feed: entry.feed,
      feedLabel: SHEET_SOURCE_LABELS[entry.feed],
      sheetDisruptionId: entry.sheetDisruptionId,
      outletId: parsed.outletId,
      sheetDate: parsed.date,
      sheetTime: parsed.time,
      minuteStamp: parsed.minuteStamp,
      ticketId: entry.ticketId || '',
      ticketStatus: entry.ticketStatus || '',
      endTime: entry.endTime || '',
      seenAt: entry.seenAt || '',
      outletKnown: pool.length > 0,
      candidates,
    };
  });

  // Rows with a plausible counterpart first - those are the ones a minute of
  // attention actually fixes - then by outlet and sheet time so the list reads
  // in a stable order between refreshes.
  return rows.sort((a, b) => {
    const aClose = a.candidates[0]?.minuteGap;
    const bClose = b.candidates[0]?.minuteGap;
    const aScore = aClose === null || aClose === undefined ? Number.MAX_SAFE_INTEGER : Math.abs(aClose);
    const bScore = bClose === null || bClose === undefined ? Number.MAX_SAFE_INTEGER : Math.abs(bClose);
    if (aScore !== bScore) return aScore - bScore;
    if (a.outletId !== b.outletId) return a.outletId.localeCompare(b.outletId);
    return a.sheetDisruptionId.localeCompare(b.sheetDisruptionId);
  });
}

export interface IdMatchSummary {
  total: number;
  withCandidate: number;
  withoutCandidate: number;
  outlets: number;
  byFeed: Record<IdMatchFeedKey, number>;
}

export function summariseIdMatch(rows: IdMatchRow[]): IdMatchSummary {
  const outlets = new Set<string>();
  let withCandidate = 0;
  const byFeed: Record<IdMatchFeedKey, number> = { disruptionTimings: 0, tickets: 0 };

  for (const row of rows) {
    if (row.outletId) outlets.add(row.outletId);
    if (row.candidates.length > 0) withCandidate++;
    byFeed[row.feed]++;
  }

  return {
    total: rows.length,
    withCandidate,
    withoutCandidate: rows.length - withCandidate,
    outlets: outlets.size,
    byFeed,
  };
}

/** The ID this record would generate today, for showing alongside the sheet's. */
export function currentIdOf(d: Disruption): string {
  return (d.disruptionId || '').trim().toUpperCase();
}
