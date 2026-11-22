/**
 * Ticket-level linkage between the runs of one disruption.
 *
 * One fault produces several rows: the store goes down, auto-disables, comes
 * back, goes down again - all on one ticket. Two consequences of that were
 * being handled by hand:
 *
 *   1. The parking bay listed every parked row forever, including ones whose
 *      ticket had since gone live again somewhere else. Somebody reading the
 *      bay could not tell which parked rows were still parked and which had
 *      simply been overtaken.
 *   2. When the ticket was finally closed, the issue, sub-issue and OEM
 *      coverage were recorded on the closing row only. The earlier runs of the
 *      same fault kept no record of what the fault had turned out to be, so a
 *      store with five rows and one diagnosis read as four untagged
 *      disruptions.
 *
 * Both are decided here rather than in a component, so the rules are testable
 * and the server and the screen cannot drift apart on them.
 */

import { Disruption, isAutoDisabled, isOnActiveBoard, RESOLVED_BY_FOR_STATUS } from '../types';
import { normalizeTicket } from './ticketInstances';
import { parseISTTimestamp } from './dateUtils';

/** Whether this status is one of the resolving ones. */
export function isResolvingStatus(status: string): boolean {
  return Boolean(RESOLVED_BY_FOR_STATUS[status]);
}

/**
 * Parked rows that a later run of the same ticket has overtaken.
 *
 * A parked row is superseded when another record on the same Ticket ID is on
 * the Active board AND started later. The "started later" half matters: a
 * ticket whose newest run is the parked one is genuinely parked, and dropping
 * it because an older run is still open would hide the current state instead of
 * the stale one.
 *
 * Nothing is deleted or rewritten. This only decides what the parking bay
 * lists; the row keeps its place in the Master Log, the counts, the reports and
 * the ticket's history, which is the whole point of keeping it.
 */
export function supersededParkedIds(disruptions: Disruption[]): Set<string> {
  /** ticket -> the latest start among its records that are on the Active board. */
  const latestActiveStart = new Map<string, number>();

  for (const d of disruptions) {
    const ticket = normalizeTicket(d.ticketId);
    if (!ticket) continue;
    if (!isOnActiveBoard(d.currentStatus)) continue;
    const start = parseISTTimestamp(d.disruptionStartDateTime);
    if (start === null) continue;
    const seen = latestActiveStart.get(ticket);
    if (seen === undefined || start > seen) latestActiveStart.set(ticket, start);
  }

  const superseded = new Set<string>();
  for (const d of disruptions) {
    // Only parked rows can be superseded, which is what the name promises. An
    // open row is the live state of its ticket by definition, and putting its
    // ID in this set would invite a caller to hide the very row the bay exists
    // to point at.
    if (!isAutoDisabled(d.currentStatus)) continue;
    const ticket = normalizeTicket(d.ticketId);
    if (!ticket) continue;
    const activeStart = latestActiveStart.get(ticket);
    if (activeStart === undefined) continue;
    const start = parseISTTimestamp(d.disruptionStartDateTime);
    // A row with no readable start cannot be shown to be the older one, so it
    // stays listed. Hiding it on a guess is the worse failure here.
    if (start === null) continue;
    if (start < activeStart) superseded.add(d.disruptionId);
  }

  return superseded;
}

/** One record's worth of fields to fill in. */
export interface PropagationChange {
  disruptionId: string;
  issues?: string[];
  subIssues?: string[];
  issue?: string;
  subIssue?: string;
  oemCoverage?: string;
  /** For the message the API sends back. */
  filled: string[];
}

export interface PropagationSource {
  disruptionId: string;
  ticketId?: string;
  currentStatus: string;
  issues?: string[];
  subIssues?: string[];
  issue?: string;
  subIssue?: string;
  oemCoverage?: string | '';
}

function hasAny(list?: string[]): boolean {
  return Array.isArray(list) && list.length > 0;
}

/**
 * What a resolving update should fill in on the earlier runs of its ticket.
 *
 * Deliberately conservative in three ways:
 *
 *   - it only fires on a resolving status, because that is the moment the fault
 *     is actually known;
 *   - it only fills fields that are **empty** on the target. A row somebody
 *     tagged differently was tagged by a person who was looking at it, and
 *     overwriting that would destroy the one piece of information this feature
 *     exists to preserve;
 *   - it never touches `currentStatus`. The earlier runs stay Auto Disable, or
 *     whatever they were, so the ticket still reads as "down, parked, down,
 *     parked, resolved by OEM" rather than five identical resolved rows.
 */
export function planTicketPropagation(
  source: PropagationSource,
  candidates: Disruption[]
): PropagationChange[] {
  if (!isResolvingStatus(source.currentStatus)) return [];

  const ticket = normalizeTicket(source.ticketId);
  if (!ticket) return [];

  const sourceSubIssues = hasAny(source.subIssues) ? source.subIssues! : [];
  const sourceIssues = hasAny(source.issues) ? source.issues! : [];
  const sourceCoverage = (source.oemCoverage ?? '').trim();

  if (sourceSubIssues.length === 0 && sourceIssues.length === 0 && !sourceCoverage) {
    return [];
  }

  const changes: PropagationChange[] = [];

  for (const target of candidates) {
    if (target.disruptionId === source.disruptionId) continue;
    if (normalizeTicket(target.ticketId) !== ticket) continue;

    const change: PropagationChange = { disruptionId: target.disruptionId, filled: [] };

    if (sourceSubIssues.length > 0 && !hasAny(target.subIssues) && !(target.subIssue || '').trim()) {
      change.subIssues = [...sourceSubIssues];
      change.subIssue = sourceSubIssues[0];
      change.filled.push('sub-issue');
    }

    if (sourceIssues.length > 0 && !hasAny(target.issues) && !(target.issue || '').trim()) {
      change.issues = [...sourceIssues];
      change.issue = sourceIssues[0];
      change.filled.push('issue');
    }

    if (sourceCoverage && !(target.oemCoverage ?? '').trim()) {
      change.oemCoverage = sourceCoverage;
      change.filled.push('OEM coverage');
    }

    if (change.filled.length > 0) changes.push(change);
  }

  return changes;
}
