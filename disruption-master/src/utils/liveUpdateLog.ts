/**
 * Live Update as a running log.
 *
 * Every update ever posted against a disruption is already kept in
 * `updateHistory`; `latestLiveUpdate` only ever holds the most recent one. The
 * tracker and the report want the whole run - "this was added, then this, then
 * this" - so that a glance at one cell tells the full story without opening the
 * record.
 *
 * Who posted which update, and when, stays out of this deliberately. That is
 * the audit log's job - it shows updatedBy and updatedAt per entry - and
 * keeping the two separate is what lets this read as a story of the disruption
 * rather than a list of edits. It also keeps the report's cell down to the
 * sentences themselves, which is the whole reason anyone reads it.
 */

import { Disruption, DisruptionUpdateHistory } from '../types';

/** Oldest first, so the log reads top to bottom in the order things happened. */
function orderedHistory(d: Disruption): DisruptionUpdateHistory[] {
  return [...(d.updateHistory || [])]
    .filter((u) => (u.updateText || '').trim())
    .sort((a, b) => (a.updatedAt || '').localeCompare(b.updatedAt || ''));
}

/**
 * One update, flattened to a single line.
 *
 * An update typed with line breaks in it would otherwise be indistinguishable
 * from two updates once they are joined, and a report cell is read as one line
 * per update.
 */
function oneLine(text?: string): string {
  return (text || '').replace(/\s+/g, ' ').trim();
}

export interface LiveUpdateEntry {
  /**
   * Kept for ordering and as a stable React key only - never displayed. Dates
   * belong in the audit log, not in the Live Update column.
   */
  updatedAt: string;
  text: string;
}

/** The running log as structured entries, for rendering in the UI. */
export function liveUpdateEntries(d: Disruption): LiveUpdateEntry[] {
  const history = orderedHistory(d);
  if (history.length === 0) {
    const latest = oneLine(d.latestLiveUpdate);
    return latest ? [{ updatedAt: (d.lastUpdatedAt || '').trim(), text: latest }] : [];
  }
  return history.map((u) => ({
    updatedAt: (u.updatedAt || '').trim(),
    text: oneLine(u.updateText),
  }));
}

/**
 * The running log as one block of text, oldest first, joined with commas so it
 * reads as one continuous account rather than a list.
 *
 * "Temperature is not maintained" plus, hours later, "RAC aligned at site"
 * comes out as "Temperature is not maintained, RAC aligned at site".
 *
 * Trailing punctuation is dropped only where a comma is about to follow, so the
 * comma does not land after a stray period. The last update keeps its own full
 * stop, and punctuation inside any update is left alone - that is the author's
 * sentence, not our separator.
 */
export function cumulativeLiveUpdate(d: Disruption): string {
  const texts = liveUpdateEntries(d)
    .map((e) => e.text.trim())
    .filter(Boolean);

  return texts
    .map((text, i) => (i === texts.length - 1 ? text : text.replace(/[.,;\s]+$/, '')))
    .join(', ');
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
