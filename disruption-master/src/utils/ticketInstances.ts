/**
 * Ticket-level grouping.
 *
 * One fault can produce several disruption records. A store goes down, the
 * ticket is raised, the store auto-disables after two hours without the fault
 * being fixed, and later the same fault takes it down again under the same
 * ticket. Each of those is its own row - they have to be, the store really did
 * go down twice - but they are one problem, and two questions get asked about
 * them that the per-row numbers answer wrongly:
 *
 *   "How long has this been going on?"  -> add the rows up, not the latest one.
 *   "How many times did this store break?" -> count tickets, not rows.
 *
 * Both answers live here so the board, the reports and the instance view cannot
 * disagree about them.
 *
 * Grouping is on the Ticket ID alone. It is the identifier the ops team keys on
 * and a ticket belongs to one store, so adding the outlet to the key would only
 * split a group apart when a store was renamed between the two records.
 */

import { Disruption } from '../types';
import { calculateDurationHours, parseISTTimestamp } from './dateUtils';
import { disruptionDurationHours } from './liveUpdateLog';

/**
 * Hours on one record: the settled end-minus-start once an end time is known,
 * otherwise a running count from the start.
 */
export function runHours(d: Disruption): number | null {
  return disruptionDurationHours(d) ?? calculateDurationHours(d.disruptionStartDateTime);
}

/** Case and spacing are how the same ticket gets typed two different ways. */
export function normalizeTicket(ticketId?: string): string {
  return (ticketId || '').trim().toUpperCase();
}

export interface TicketRollup {
  /** The normalized ticket, or '' when the record carries none. */
  ticket: string;
  /** Every record under this ticket, oldest start first. */
  records: Disruption[];
  /** How many times the store went down on this ticket. */
  occurrences: number;
  /** Hours on this record alone. */
  ownHours: number | null;
  /** Hours on the other records under the same ticket. */
  priorHours: number | null;
  /** Every record added up - the answer to "how long has this been going on". */
  totalHours: number | null;
}

/** Ticket -> its records, oldest start first. Untagged records are left out. */
export function groupByTicket(disruptions: Disruption[]): Map<string, Disruption[]> {
  const groups = new Map<string, Disruption[]>();
  for (const d of disruptions) {
    const ticket = normalizeTicket(d.ticketId);
    if (!ticket) continue;
    const list = groups.get(ticket);
    if (list) list.push(d);
    else groups.set(ticket, [d]);
  }
  for (const list of groups.values()) {
    list.sort((a, b) => (a.disruptionStartDateTime || '').localeCompare(b.disruptionStartDateTime || ''));
  }
  return groups;
}

/**
 * Sums a list of hour figures, treating "not known yet" as absent rather than
 * as zero: a record with no duration must not drag a total down to a number
 * that reads as fact. Null only when nothing in the list is known at all.
 */
function sumHours(values: (number | null)[]): number | null {
  const known = values.filter((v): v is number => v !== null && Number.isFinite(v));
  if (known.length === 0) return null;
  return known.reduce((a, b) => a + b, 0);
}

/**
 * What one record looks like once its ticket siblings are taken into account.
 *
 * `all` is the whole record set, not the filtered view: a repeat that has since
 * been resolved still happened, and leaving it out would under-report the hours
 * the store was actually down.
 */
export function ticketRollupFor(d: Disruption, all: Disruption[]): TicketRollup {
  const ticket = normalizeTicket(d.ticketId);
  const ownHours = runHours(d);

  // No ticket means nothing to group it with. The record stands alone, which is
  // the honest answer rather than lumping every untagged row together.
  if (!ticket) {
    return { ticket: '', records: [d], occurrences: 1, ownHours, priorHours: null, totalHours: ownHours };
  }

  const records = (groupByTicket(all).get(ticket) ?? [d]).slice();
  const others = records.filter((r) => r.disruptionId !== d.disruptionId);

  return {
    ticket,
    records,
    occurrences: records.length,
    ownHours,
    priorHours: sumHours(others.map(runHours)),
    totalHours: sumHours(records.map(runHours)),
  };
}

/** Builds every rollup once, for a table that needs one per row. */
export function ticketRollupIndex(all: Disruption[]): Map<string, TicketRollup> {
  const groups = groupByTicket(all);
  const index = new Map<string, TicketRollup>();

  for (const d of all) {
    const ticket = normalizeTicket(d.ticketId);
    const ownHours = runHours(d);

    if (!ticket) {
      index.set(d.disruptionId, {
        ticket: '',
        records: [d],
        occurrences: 1,
        ownHours,
        priorHours: null,
        totalHours: ownHours,
      });
      continue;
    }

    const records = groups.get(ticket) ?? [d];
    const others = records.filter((r) => r.disruptionId !== d.disruptionId);
    index.set(d.disruptionId, {
      ticket,
      records,
      occurrences: records.length,
      ownHours,
      priorHours: sumHours(others.map(runHours)),
      totalHours: sumHours(records.map(runHours)),
    });
  }

  return index;
}

/**
 * The one duration figure a report shows for a row.
 *
 * "How long has this store been down" is the question the column is read for,
 * and when a fault has produced several records under one ticket the honest
 * answer is the sum of them: a store that went down for four hours, came back,
 * and has been down two more has been down six, not two.
 *
 * The Active report used to print the run's own hours with the combined figure
 * on a second line underneath - "20.4" over "67.0 total" - which left the reader
 * to decide which of the two numbers was the answer, and the first one they read
 * was the wrong one. One number now, and the "RUN 2 OF 3" badge in the Ticket ID
 * column is what says it covers more than this run.
 *
 * Falls back to the row's own hours when the record carries no ticket, which is
 * what the rollup index already stores for an untagged record.
 */
export function reportedDurationHours(
  d: Disruption,
  rollups: Map<string, TicketRollup>
): number | null {
  const rollup = rollups.get(d.disruptionId);
  if (!rollup) return runHours(d);
  return rollup.totalHours;
}

/** Hours as a cell, blank while nothing about the duration is known. */
export function hoursLabel(hours: number | null): string {
  return hours === null ? '' : `${hours.toFixed(2)} Hrs`;
}

// ---------------------------------------------------------------------------
// Instances per store
// ---------------------------------------------------------------------------

export const INSTANCE_WINDOW_OPTIONS = [1, 3, 6, 12] as const;
export type InstanceWindowMonths = (typeof INSTANCE_WINDOW_OPTIONS)[number];

export interface StoreInstanceRow {
  outletId: string;
  storeName: string;
  city: string;
  vendor: string;
  /** Every disruption row for this store inside the window. */
  records: number;
  /**
   * How many separate times the store actually broke. Repeats carrying one
   * ticket count once; a row with no ticket cannot be grouped, so it counts on
   * its own.
   */
  instances: number;
  /** Distinct Ticket IDs seen. */
  uniqueTickets: number;
  /** Rows carrying no Ticket ID at all. */
  untaggedRecords: number;
  /**
   * Rows beyond the first on a ticket - the auto-disable repeats. records minus
   * instances, and the number that says how much the raw row count overstates
   * things.
   */
  repeatRecords: number;
  /** Every row's hours added up. */
  totalHours: number | null;
  /** Start of the most recent row, as stored (IST, DD/MM/YYYY HH:MM:SS). */
  lastDisruptionAt: string;
  /** The tickets themselves, newest first, for the detail line. */
  tickets: string[];
}

export interface StoreInstanceReport {
  months: InstanceWindowMonths;
  /** Window start, as a readable IST date. */
  fromLabel: string;
  rows: StoreInstanceRow[];
  totalRecords: number;
  totalInstances: number;
  /** Rows whose start time could not be read, so they sit outside any window. */
  undatedRecords: number;
}

function istDateLabel(ms: number): string {
  return new Date(ms).toLocaleDateString('en-GB', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

/**
 * Instance counts per store over the last `months`.
 *
 * The window is measured back from now rather than from the newest record, so
 * "last 3 months" keeps meaning the last three months even on a quiet week.
 * Records whose start time will not parse are counted separately instead of
 * being quietly dropped or quietly included - either would be a wrong number
 * nobody could see.
 */
export function buildStoreInstanceReport(
  disruptions: Disruption[],
  months: InstanceWindowMonths,
  now: number = Date.now()
): StoreInstanceReport {
  const cutoff = new Date(now);
  cutoff.setMonth(cutoff.getMonth() - months);
  const cutoffMs = cutoff.getTime();

  let undatedRecords = 0;
  const inWindow: Disruption[] = [];
  for (const d of disruptions) {
    const started = parseISTTimestamp(d.disruptionStartDateTime);
    if (started === null) {
      undatedRecords += 1;
      continue;
    }
    if (started >= cutoffMs && started <= now) inWindow.push(d);
  }

  const byOutlet = new Map<string, Disruption[]>();
  for (const d of inWindow) {
    const key = (d.outletId || '').trim().toUpperCase() || 'UNKNOWN';
    const list = byOutlet.get(key);
    if (list) list.push(d);
    else byOutlet.set(key, [d]);
  }

  const rows: StoreInstanceRow[] = [];
  for (const [outletId, records] of byOutlet) {
    const newestFirst = [...records].sort((a, b) =>
      (b.disruptionStartDateTime || '').localeCompare(a.disruptionStartDateTime || '')
    );

    const tickets: string[] = [];
    let untaggedRecords = 0;
    for (const d of newestFirst) {
      const ticket = normalizeTicket(d.ticketId);
      if (!ticket) untaggedRecords += 1;
      else if (!tickets.includes(ticket)) tickets.push(ticket);
    }

    const instances = tickets.length + untaggedRecords;
    const newest = newestFirst[0];

    rows.push({
      outletId,
      // Taken from the newest row: a store that was renamed should read under
      // the name it has now.
      storeName: (newest?.storeName || '').trim(),
      city: (newest?.city || '').trim(),
      vendor: (newest?.currentVendor || newest?.vendor || '').trim(),
      records: records.length,
      instances,
      uniqueTickets: tickets.length,
      untaggedRecords,
      repeatRecords: Math.max(0, records.length - instances),
      totalHours: sumHours(records.map(runHours)),
      lastDisruptionAt: newest?.disruptionStartDateTime || '',
      tickets,
    });
  }

  // Worst store first, same principle as the active report: the outlet breaking
  // most often has to be the first thing read.
  rows.sort((a, b) => {
    if (b.instances !== a.instances) return b.instances - a.instances;
    if (b.records !== a.records) return b.records - a.records;
    return a.outletId.localeCompare(b.outletId);
  });

  return {
    months,
    fromLabel: istDateLabel(cutoffMs),
    rows,
    totalRecords: inWindow.length,
    totalInstances: rows.reduce((sum, r) => sum + r.instances, 0),
    undatedRecords,
  };
}
