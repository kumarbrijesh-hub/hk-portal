/**
 * Single home for the business rules in spec section 28. Every rule reads its
 * allowed values from config/app.config.json - nothing is hard-coded here, so the
 * option lists can change without touching this file.
 */
import { issueMaster, loadConfig } from '../config.js';
import { istStampYYMMDDHHMM } from '../utils/time.js';

export class ValidationError extends Error {
  readonly status = 400;
  readonly fieldErrors: Record<string, string>;

  constructor(fieldErrors: Record<string, string>, message = 'Validation failed') {
    super(message);
    this.name = 'ValidationError';
    this.fieldErrors = fieldErrors;
  }
}

/** Rule 3: DisruptionId = OutletID-YYMMDDHHMM (IST). */
export function buildDisruptionId(outletId: string, startIso: string): string {
  return `${outletId.trim()}-${istStampYYMMDDHHMM(startIso)}`;
}

/** Rule 11: active unless the current status is in the configured inactive list. */
export function isActiveStatus(status: string): boolean {
  const inactive = loadConfig().inactiveStatuses.values;
  return !inactive.some((value) => value.toLowerCase() === status.trim().toLowerCase());
}

/** Rule 5: Ticket ID is mandatory only for the configured buckets (Breakdown). */
export function ticketIdRequired(bucket: string): boolean {
  return loadConfig().bucketsRequiringTicketId
    .some((value) => value.toLowerCase() === bucket.trim().toLowerCase());
}

/** Rule 7: Issue + Sub Issue mandatory for the resolved-style statuses. */
export function issueRequired(status: string): boolean {
  return loadConfig().statusesRequiringIssue
    .some((value) => value.toLowerCase() === status.trim().toLowerCase());
}

/** Resolved statuses stamp resolved_at so duration stops counting. */
export function isResolvedStatus(status: string): boolean {
  return issueRequired(status) || !isActiveStatus(status);
}

function matchOption(options: string[], value: string): string | null {
  const needle = value.trim().toLowerCase();
  return options.find((option) => option.toLowerCase() === needle) ?? null;
}

export interface DisruptionInputFields {
  ccPoc: string;
  bucket: string;
  ticketId?: string | null;
  currentStatus: string;
  issue?: string | null;
  subIssue?: string | null;
  liveUpdate?: string;
}

export interface NormalisedFields {
  ccPoc: string;
  bucket: string;
  ticketId: string | null;
  currentStatus: string;
  issue: string | null;
  subIssue: string | null;
}

/**
 * Validates the dropdown-driven fields and the conditional rules together, so a
 * single response can report every problem at once.
 * `requireLiveUpdate` is on for creation (spec section 14) and off for metadata-only edits.
 */
export function validateDisruptionFields(
  input: DisruptionInputFields,
  options: { requireLiveUpdate: boolean },
): NormalisedFields {
  const config = loadConfig();
  const errors: Record<string, string> = {};

  const ccPoc = matchOption(config.ccPocOptions, input.ccPoc ?? '');
  if (!ccPoc) errors.ccPoc = 'Select a valid CC POC from the list.';

  const bucket = matchOption(config.buckets, input.bucket ?? '');
  if (!bucket) errors.bucket = 'Select a valid Bucket.';

  const currentStatus = matchOption(config.statuses, input.currentStatus ?? '');
  if (!currentStatus) errors.currentStatus = 'Select a valid Current Status.';

  const ticketId = (input.ticketId ?? '').trim() || null;
  if (bucket && ticketIdRequired(bucket) && !ticketId) {
    errors.ticketId = 'Disruption Ticket ID is mandatory for Breakdown.';
  }

  let issue = (input.issue ?? '').trim() || null;
  let subIssue = (input.subIssue ?? '').trim() || null;

  if (currentStatus && issueRequired(currentStatus)) {
    const master = issueMaster(config);
    const issueNames = Object.keys(master);

    const matchedIssue = issue ? matchOption(issueNames, issue) : null;
    if (!issue) {
      errors.issue = `Issue is mandatory when status is "${currentStatus}".`;
    } else if (!matchedIssue) {
      errors.issue = 'Select a valid Issue from the master list.';
    } else {
      issue = matchedIssue;
      const subOptions = master[matchedIssue] ?? [];
      const matchedSub = subIssue ? matchOption(subOptions, subIssue) : null;
      if (!subIssue) {
        errors.subIssue = `Sub Issue is mandatory when status is "${currentStatus}".`;
      } else if (!matchedSub) {
        errors.subIssue = `"${subIssue}" is not a Sub Issue of "${matchedIssue}".`;
      } else {
        subIssue = matchedSub;
      }
    }
  }
  // For every other status the fields are hidden in the UI; whatever was captured
  // earlier is kept as-is rather than validated against the master list.

  if (options.requireLiveUpdate && !(input.liveUpdate ?? '').trim()) {
    errors.liveUpdate = 'Live Update is mandatory.';
  }

  if (Object.keys(errors).length) throw new ValidationError(errors);

  return {
    ccPoc: ccPoc!,
    bucket: bucket!,
    ticketId,
    currentStatus: currentStatus!,
    issue,
    subIssue,
  };
}
