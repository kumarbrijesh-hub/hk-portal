/**
 * Reading and re-pointing a Disruption ID.
 *
 * A Disruption ID is not a label, it is a derivation: OUTLETID-YYMMDDHHMM, made
 * from the outlet and the minute the disruption started. Two sheets key off it,
 * so when the minute someone typed here differs from the minute the sheet
 * recorded, the two IDs differ and every row the sheet sends is silently
 * dropped at the lookup.
 *
 * The fix has to keep the derivation true. Renaming the ID alone would leave a
 * record whose ID says 08:00 and whose start field says 08:20 - and duration,
 * TAT and every report read the start field, not the ID. So the default repair
 * moves the start to the minute the ID encodes and regenerates the ID from it,
 * which lands on the sheet's spelling precisely because both sides compute it
 * the same way.
 *
 * Kept as pure functions, away from the request handler, so the rules can be
 * tested directly instead of through an HTTP round trip.
 */

import { IdAlignMode } from '../types';
import { generateDisruptionId } from './idGenerator';

export interface ParsedDisruptionId {
  /** The ID as given, trimmed and upper-cased. */
  raw: string;
  /** Everything before the final dash group. Empty when there is no dash. */
  outletId: string;
  /** YYYY-MM-DD, or '' when the trailing group is not a valid stamp. */
  date: string;
  /** HH:MM:SS, or ''. */
  time: string;
  /** Minutes since 1970 in naive local terms, for gap arithmetic. */
  minuteStamp: number | null;
}

const EMPTY_PARSE: ParsedDisruptionId = {
  raw: '',
  outletId: '',
  date: '',
  time: '',
  minuteStamp: null,
};

/** Minutes since epoch for a naive Y/M/D H:M, with no timezone applied. */
export function minuteStampFor(date: string, time: string): number | null {
  const dateParts = (date || '').split('-');
  if (dateParts.length !== 3) return null;
  const year = Number(dateParts[0]);
  const month = Number(dateParts[1]);
  const day = Number(dateParts[2]);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null;

  const timeParts = (time || '').split(':');
  const hour = Number(timeParts[0] ?? 0);
  const minute = Number(timeParts[1] ?? 0);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;

  const ms = Date.UTC(year, month - 1, day, hour, minute);
  if (!Number.isFinite(ms)) return null;
  return Math.round(ms / 60000);
}

/**
 * Splits an ID back into the outlet and the minute it was generated from.
 *
 * The split is on the LAST dash, not the first: outlet IDs themselves contain
 * dashes in some regions, and splitting on the first would read "ES" out of
 * "ES-NORTH-2611100800".
 */
export function parseDisruptionId(rawId: string): ParsedDisruptionId {
  const raw = String(rawId ?? '').trim().toUpperCase();
  if (!raw) return EMPTY_PARSE;

  const cut = raw.lastIndexOf('-');
  // No dash at all: the whole thing is a name, with no outlet/stamp split to be
  // had. Reported as the outlet so a caller still has something to show.
  if (cut === -1) {
    return { ...EMPTY_PARSE, raw, outletId: raw };
  }

  const outletId = raw.slice(0, cut);
  const stamp = raw.slice(cut + 1);

  // Exactly ten digits, or it is not a YYMMDDHHMM stamp and we do not guess.
  // An empty outlet half disqualifies it too: "-2611100800" carries a stamp
  // shape but names no outlet, and treating it as a dated ID would have the
  // caller compare a blank outlet against a real one.
  if (!outletId || !/^\d{10}$/.test(stamp)) {
    return { ...EMPTY_PARSE, raw, outletId };
  }

  const year = 2000 + Number(stamp.slice(0, 2));
  const month = Number(stamp.slice(2, 4));
  const day = Number(stamp.slice(4, 6));
  const hour = Number(stamp.slice(6, 8));
  const minute = Number(stamp.slice(8, 10));

  if (month < 1 || month > 12) return { ...EMPTY_PARSE, raw, outletId };
  if (day < 1 || day > 31) return { ...EMPTY_PARSE, raw, outletId };
  if (hour > 23 || minute > 59) return { ...EMPTY_PARSE, raw, outletId };

  // Rejects a day the month does not have rather than rolling it into the next.
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (
    probe.getUTCFullYear() !== year ||
    probe.getUTCMonth() !== month - 1 ||
    probe.getUTCDate() !== day
  ) {
    return { ...EMPTY_PARSE, raw, outletId };
  }

  const pad = (n: number) => String(n).padStart(2, '0');
  const date = `${year}-${pad(month)}-${pad(day)}`;
  const time = `${pad(hour)}:${pad(minute)}:00`;

  return { raw, outletId, date, time, minuteStamp: minuteStampFor(date, time) };
}

/** "08:20 vs 08:00" in words, from the app record's point of view. */
export function describeMinuteGap(gapMinutes: number | null): string {
  if (gapMinutes === null) return 'start time not comparable';
  if (gapMinutes === 0) return 'same minute';

  const ahead = gapMinutes > 0;
  const total = Math.abs(gapMinutes);
  const days = Math.floor(total / 1440);
  const hours = Math.floor((total % 1440) / 60);
  const mins = total % 60;

  const parts: string[] = [];
  if (days) parts.push(`${days}d`);
  if (hours) parts.push(`${hours}h`);
  if (mins || parts.length === 0) parts.push(`${mins}m`);

  return `${parts.join(' ')} ${ahead ? 'later' : 'earlier'} here`;
}

export interface IdAlignDecision {
  /** The ID the record should end up with. */
  newId: string;
  /**
   * The start to move the record to, or null to leave the start alone. Null is
   * only ever returned for the id-only mode.
   */
  start: { date: string; time: string } | null;
  /** Non-null when the request must be refused, with the message to send. */
  error: string | null;
}

/** An ID has to survive a URL, a CSV cell and a sheet lookup. */
const ID_SHAPE = /^[A-Z0-9][A-Z0-9-]{2,39}$/;

/**
 * Decides what re-pointing an app record at `target` should do.
 *
 * `takenIds` is every ID currently in the store, the record's own included -
 * the caller does not have to filter it, and a target equal to the record's
 * own ID is reported as "already matches" rather than as a collision.
 */
export function decideIdAlignment(args: {
  target: unknown;
  mode: unknown;
  record: { disruptionId: string; outletId: string };
  takenIds: string[];
}): IdAlignDecision {
  const { target, mode, record, takenIds } = args;

  const newId = String(target ?? '').trim().toUpperCase();
  const currentId = String(record.disruptionId ?? '').trim().toUpperCase();
  const recordOutlet = String(record.outletId ?? '').trim().toUpperCase();

  const fail = (error: string): IdAlignDecision => ({ newId, start: null, error });

  if (!newId) {
    return fail('Give the Disruption ID the sheet uses.');
  }
  if (!ID_SHAPE.test(newId)) {
    return fail(
      `"${newId}" is not a usable Disruption ID. Use letters, digits and dashes only, 3 to 40 characters.`
    );
  }
  if (newId === currentId) {
    return fail(`This record already uses ${newId}.`);
  }

  const collision = takenIds.find(
    (id) => String(id).trim().toUpperCase() === newId && String(id).trim().toUpperCase() !== currentId
  );
  if (collision) {
    return fail(
      `${newId} is already on another record. Two disruptions cannot share an ID - open that record instead.`
    );
  }

  const parsed = parseDisruptionId(newId);

  // The outlet is the half of the ID that is never in doubt: the sheet and this
  // console both take it from the store master. A target whose prefix names a
  // different outlet means something other than the start minute is wrong, and
  // renaming would only move the contradiction somewhere harder to see.
  //
  // Only checked for an ID that actually carries a minute stamp. Without one
  // there is no outlet-dash-stamp structure, so the text before the last dash
  // is not a claim about an outlet at all - "INC-900X" names no outlet, and
  // refusing it on the grounds that "INC" is not this record's outlet would
  // block the one mode that exists for free-form IDs.
  if (parsed.date && parsed.outletId && recordOutlet && parsed.outletId !== recordOutlet) {
    return fail(
      `${newId} belongs to outlet ${parsed.outletId}, but this record is outlet ${recordOutlet}. ` +
        'Pick a record from the right outlet - an ID cannot be moved between outlets.'
    );
  }

  const alignMode: IdAlignMode = mode === 'idOnly' ? 'idOnly' : 'align';

  if (alignMode === 'idOnly') {
    return { newId, start: null, error: null };
  }

  if (!parsed.date) {
    return fail(
      `${newId} does not carry a start minute, so there is nothing to align the record's start to. ` +
        'Use the ID-only option if you want the ID changed and the start left as it is.'
    );
  }

  // Belt and braces: regenerate from the parsed parts and check we land back on
  // the same string. If the two ever disagree, the ID written here would not be
  // the one the next generator run produces, and the mismatch would return.
  const regenerated = generateDisruptionId(recordOutlet || parsed.outletId, parsed.date, parsed.time);
  if (regenerated !== newId) {
    return fail(
      `${newId} does not round-trip through the ID generator (it would regenerate as ${regenerated || 'nothing'}). ` +
        'Use the ID-only option, or correct the sheet.'
    );
  }

  return { newId, start: { date: parsed.date, time: parsed.time }, error: null };
}
