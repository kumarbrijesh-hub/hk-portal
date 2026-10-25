/**
 * Live Update as a running log.
 *
 * Every update ever posted against a disruption is already kept in
 * `updateHistory`; `latestLiveUpdate` only ever holds the most recent one. The
 * tracker and the report want the whole run - "this was added, then this, then
 * this" - so that a glance at one cell tells the full story without opening the
 * record.
 *
 * Who posted which update stays out of this deliberately. That is the audit
 * log's job, and keeping the two separate is what lets this read as a story of
 * the disruption rather than a list of edits.
 */

import { Disruption, DisruptionUpdateHistory } from '../types';

/** Oldest first, so the log reads top to bottom in the order things happened. */
function orderedHistory(d: Disruption): DisruptionUpdateHistory[] {
  return [...(d.updateHistory || [])]
    .filter((u) => (u.updateText || '').trim())
    .sort((a, b) => (a.updatedAt || '').localeCompare(b.updatedAt || ''));
}

/**
 * Timestamp trimmed to the minute. The stored form is already IST wall-clock
 * ("DD/MM/YYYY HH:MM:SS"), so the seconds are all that need dropping.
 */
function shortTimestamp(updatedAt?: string): string {
  const stamp = (updatedAt || '').trim();
  if (!stamp) return '';
  const match = stamp.match(/^(\d{2}\/\d{2}\/\d{4})[ ,T]+(\d{2}:\d{2})/);
  return match ? `${match[1]} ${match[2]}` : stamp;
}

export interface LiveUpdateEntry {
  timestamp: string;
  text: string;
}

/** The running log as structured entries, for rendering in the UI. */
export function liveUpdateEntries(d: Disruption): LiveUpdateEntry[] {
  const history = orderedHistory(d);
  if (history.length === 0) {
    const latest = (d.latestLiveUpdate || '').trim();
    return latest ? [{ timestamp: shortTimestamp(d.lastUpdatedAt), text: latest }] : [];
  }
  return history.map((u) => ({
    timestamp: shortTimestamp(u.updatedAt),
    text: (u.updateText || '').trim(),
  }));
}

/**
 * The running log as one block of text, newest at the bottom. Used wherever a
 * single string is needed - a CSV cell, a tooltip, a spreadsheet column.
 */
export function cumulativeLiveUpdate(d: Disruption): string {
  return liveUpdateEntries(d)
    .map((e) => (e.timestamp ? `[${e.timestamp}] ${e.text}` : e.text))
    .join('\n');
}

/**
 * The report's Live Update cell: the identifiers and ownership someone needs to
 * act on the row, followed by the running log.
 *
 * This lives inside the existing Live Update column on purpose. The report's
 * column list stays exactly as it was, and the one cell people actually read
 * and forward becomes self-contained - which disruption, which outlet, who
 * holds the AMC, whose machine it is, and who on CC owns it.
 */
export function liveUpdateReportBlock(d: Disruption): string {
  const lines: string[] = [];

  const detail = (label: string, value?: string) => {
    const shown = (value || '').trim();
    if (shown) lines.push(`${label}: ${shown}`);
  };

  detail('Disruption ID', d.disruptionId);
  detail('Outlet ID', d.outletId);
  detail('AMC Coverage', d.amcCoverage);
  detail('Machine / Current Vendor', d.currentVendor || d.vendor);
  detail('Cold POC', d.coldPocName2 || d.pocName);
  detail('CC POC', d.ccPoc);

  const log = cumulativeLiveUpdate(d);
  if (log) {
    lines.push('Live Updates:');
    lines.push(log);
  }

  return lines.join('\n');
}

/** How many updates the log holds, for the "3 updates" counter on a cell. */
export function liveUpdateCount(d: Disruption): number {
  return liveUpdateEntries(d).length;
}
