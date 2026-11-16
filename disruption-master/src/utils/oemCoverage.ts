/**
 * The OEM coverage rule, in one place.
 *
 * Three endpoints need the same answer - create, live update, and the
 * Bucket/Ticket edit - and the rule has two halves that are easy to get subtly
 * different if each route spells them out for itself:
 *
 *   1. A supplied value has to be one of the three. Free text here would make
 *      the column unreportable inside a week ("AMC", "amc", "Amc contract").
 *   2. Resolved by OEM cannot be set without a coverage on the record. An
 *      earlier update that already recorded one satisfies this, so re-setting
 *      the status does not ask twice.
 *
 * Kept as a pure function so it can be tested directly rather than only through
 * an HTTP round trip.
 */

import { Disruption, isOemCoverage, OEM_COVERAGE_OPTIONS, requiresOemCoverage } from '../types';

export type StoredOemCoverage = Disruption['oemCoverage'];

export interface OemCoverageDecision {
  /**
   * What to write, or `undefined` for "the caller said nothing, leave the
   * record alone". An empty string means it was explicitly cleared.
   */
  value: StoredOemCoverage | undefined;
  /** The coverage the record will end up with, once `value` is applied. */
  effective: StoredOemCoverage;
  /** Non-null when the request must be refused, with the message to send. */
  error: string | null;
}

/**
 * Reads a coverage off a request body and decides whether the request stands.
 *
 * `targetStatus` is the status the record is heading to, and `existing` is
 * whatever coverage it already carries - both are needed, because the rule is
 * about the record's end state rather than about this one request.
 */
export function decideOemCoverage(args: {
  body: unknown;
  targetStatus: string;
  existing?: StoredOemCoverage;
}): OemCoverageDecision {
  const { body, targetStatus, existing } = args;

  const raw = (body as { oemCoverage?: unknown } | null | undefined)?.oemCoverage;

  let value: StoredOemCoverage | undefined;
  if (raw === undefined) {
    // Said nothing. Whatever is on the record stands.
    value = undefined;
  } else {
    const trimmed = String(raw ?? '').trim();
    if (trimmed === '') {
      value = '';
    } else if (!isOemCoverage(trimmed)) {
      return {
        value: undefined,
        effective: existing ?? '',
        error: `OEM coverage must be one of ${OEM_COVERAGE_OPTIONS.join(', ')}.`,
      };
    } else {
      value = trimmed;
    }
  }

  const effective: StoredOemCoverage = value !== undefined ? value : existing ?? '';

  if (requiresOemCoverage(targetStatus) && !effective) {
    return {
      value,
      effective,
      error: `Pick how the OEM job was covered - ${OEM_COVERAGE_OPTIONS.join(
        ', '
      )} - before closing this as "${targetStatus}".`,
    };
  }

  return { value, effective, error: null };
}
