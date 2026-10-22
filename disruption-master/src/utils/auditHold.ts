/**
 * Audit hold tracking.
 *
 * Putting a store on "Audit in Process" is meant to be temporary. The team
 * needs to see when a hold has outlived its window so they can take the store
 * back off audit, which is what these helpers report on.
 */

import { AUDIT_HOLD_LIMIT_HOURS, Disruption, isAuditStatus } from '../types';
import { hoursSince } from './dateUtils';

export interface AuditHoldState {
  /** The record is sitting on an audit status right now. */
  onHold: boolean;
  /** Hours since the hold was applied, or null if the stamp is missing. */
  hoursOnHold: number | null;
  /** The hold has run past AUDIT_HOLD_LIMIT_HOURS and should be cleared. */
  expired: boolean;
  /** Whole minutes past the limit, for the reminder text. */
  minutesOverdue: number;
}

export function auditHoldState(d: Disruption): AuditHoldState {
  if (!isAuditStatus(d.currentStatus)) {
    return { onHold: false, hoursOnHold: null, expired: false, minutesOverdue: 0 };
  }

  // Older records predate the stamp; fall back to the disruption start so a
  // long-running hold is still flagged rather than silently ignored.
  const elapsed = hoursSince(d.auditStartedAt ?? d.disruptionStartDateTime);
  if (elapsed === null) {
    return { onHold: true, hoursOnHold: null, expired: false, minutesOverdue: 0 };
  }

  const expired = elapsed >= AUDIT_HOLD_LIMIT_HOURS;
  return {
    onHold: true,
    hoursOnHold: elapsed,
    expired,
    minutesOverdue: expired ? Math.floor((elapsed - AUDIT_HOLD_LIMIT_HOURS) * 60) : 0,
  };
}

/** Every record whose audit hold has run past the limit. */
export function expiredAuditHolds(disruptions: Disruption[]): Disruption[] {
  return disruptions.filter((d) => auditHoldState(d).expired);
}

/** "2h 41m" from a fractional hour count. */
export function formatHoursMinutes(hours: number): string {
  const total = Math.max(0, Math.round(hours * 60));
  const h = Math.floor(total / 60);
  const m = total % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}
