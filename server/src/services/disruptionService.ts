import { transaction } from '../db/index.js';
import { auditRepo } from '../repos/auditRepo.js';
import { disruptionRepo, type DisruptionRow } from '../repos/disruptionRepo.js';
import { outletRepo } from '../repos/outletRepo.js';
import { updateRepo } from '../repos/updateRepo.js';
import type { Disruption, DisruptionUpdate, SessionUser } from '../types.js';
import { nowIso, parseIstInputToIso } from '../utils/time.js';
import { broadcast } from './events.js';
import {
  ValidationError,
  buildDisruptionId,
  isActiveStatus,
  isResolvedStatus,
  validateDisruptionFields,
} from './rules.js';

export class ConflictError extends Error {
  readonly status = 409;
  readonly existingId: string;

  constructor(message: string, existingId: string) {
    super(message);
    this.name = 'ConflictError';
    this.existingId = existingId;
  }
}

export class NotFoundError extends Error {
  readonly status = 404;

  constructor(message: string) {
    super(message);
    this.name = 'NotFoundError';
  }
}

export interface CreateDisruptionInput {
  outletId: string;
  /** "DD/MM/YYYY HH:MM:SS" or an ISO/datetime-local value, interpreted as IST. */
  disruptionStartAt: string;
  ccPoc: string;
  bucket: string;
  ticketId?: string | null;
  currentStatus: string;
  issue?: string | null;
  subIssue?: string | null;
  liveUpdate: string;
  ccFrtMins?: number | null;
  mstFrtMins?: number | null;
  auditDurationHrs?: number | null;
}

function numberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Rule 1 + Rule 2: master lookup, then deterministic Disruption ID. */
export function previewDisruptionId(outletId: string, startInput: string): {
  disruptionId: string;
  startIso: string;
  taken: boolean;
} {
  const trimmed = (outletId ?? '').trim();
  if (!trimmed) throw new ValidationError({ outletId: 'Outlet ID is mandatory.' });

  const startIso = parseIstInputToIso(startInput ?? '');
  if (!startIso) {
    throw new ValidationError({
      disruptionStartAt: 'Enter a valid start date & time (DD/MM/YYYY HH:MM:SS).',
    });
  }

  const disruptionId = buildDisruptionId(trimmed, startIso);
  return { disruptionId, startIso, taken: disruptionRepo.exists(disruptionId) };
}

export function createDisruption(input: CreateDisruptionInput, user: SessionUser): Disruption {
  const errors: Record<string, string> = {};

  const outletId = (input.outletId ?? '').trim();
  if (!outletId) errors.outletId = 'Outlet ID is mandatory.';

  const startIso = parseIstInputToIso(input.disruptionStartAt ?? '');
  if (!startIso) {
    errors.disruptionStartAt = 'Enter a valid start date & time (DD/MM/YYYY HH:MM:SS).';
  }

  const outlet = outletId ? outletRepo.findById(outletId) : null;
  if (outletId && !outlet) {
    errors.outletId = outletRepo.count() === 0
      ? 'Outlet master is empty - run Sync Now before creating disruptions.'
      : `Outlet ID "${outletId}" was not found in the synced master data.`;
  }

  if (Object.keys(errors).length) throw new ValidationError(errors);

  const fields = validateDisruptionFields(input, { requireLiveUpdate: true });
  const disruptionId = buildDisruptionId(outlet!.outletId, startIso!);

  if (disruptionRepo.exists(disruptionId)) {
    throw new ConflictError(
      `A disruption already exists for this Outlet ID and start minute (${disruptionId}). `
      + 'Open the existing record and add a Live Update instead of creating a duplicate.',
      disruptionId,
    );
  }

  const at = nowIso();
  const liveUpdate = input.liveUpdate.trim();
  const active = isActiveStatus(fields.currentStatus);

  const row: DisruptionRow = {
    disruption_id: disruptionId,
    outlet_id: outlet!.outletId,
    store_name: outlet!.storeName,
    city: outlet!.city,
    mode: outlet!.mode,
    vendor: outlet!.vendor,
    poc_name: outlet!.pocName,
    poc_contact: outlet!.pocContact,
    disruption_start_at: startIso!,
    cc_poc: fields.ccPoc,
    bucket: fields.bucket,
    ticket_id: fields.ticketId,
    current_status: fields.currentStatus,
    issue: fields.issue,
    sub_issue: fields.subIssue,
    cc_frt_mins: numberOrNull(input.ccFrtMins),
    mst_frt_mins: numberOrNull(input.mstFrtMins),
    audit_duration_hrs: numberOrNull(input.auditDurationHrs),
    resolved_at: isResolvedStatus(fields.currentStatus) ? at : null,
    latest_live_update: liveUpdate,
    last_updated_by: user.name,
    last_updated_at: at,
    created_by: user.name,
    created_at: at,
    updated_at: at,
    is_active: active ? 1 : 0,
  };

  transaction(() => {
    disruptionRepo.insert(row);
    updateRepo.append({
      disruptionId,
      updateText: liveUpdate,
      updatedBy: user.name,
      updatedAt: at,
      previousStatus: null,
      newStatus: fields.currentStatus,
    });
    auditRepo.record({
      entityType: 'disruption',
      entityId: disruptionId,
      action: 'create',
      newValue: JSON.stringify({
        outletId: row.outlet_id,
        bucket: row.bucket,
        currentStatus: row.current_status,
        ticketId: row.ticket_id,
      }),
      actor: user.name,
      at,
    });
  });

  const created = disruptionRepo.findById(disruptionId)!;
  broadcast('disruption:created', { disruptionId, isActive: created.isActive });
  return created;
}

export interface UpdateDisruptionInput {
  ccPoc?: string;
  bucket?: string;
  ticketId?: string | null;
  currentStatus?: string;
  issue?: string | null;
  subIssue?: string | null;
  /** When present, appended as a new history entry - never overwrites earlier text. */
  liveUpdate?: string;
  ccFrtMins?: number | null;
  mstFrtMins?: number | null;
  auditDurationHrs?: number | null;
  disruptionStartAt?: string;
}

const METRIC_FIELDS: [keyof UpdateDisruptionInput, string][] = [
  ['ccFrtMins', 'cc_frt_mins'],
  ['mstFrtMins', 'mst_frt_mins'],
  ['auditDurationHrs', 'audit_duration_hrs'],
];

/**
 * Applies a status/metadata change and optionally appends a Live Update.
 * Status changes are recorded both in the audit log and on the history entry.
 */
export function updateDisruption(
  disruptionId: string,
  input: UpdateDisruptionInput,
  user: SessionUser,
): Disruption {
  const existing = disruptionRepo.findById(disruptionId);
  if (!existing) throw new NotFoundError(`Disruption ${disruptionId} not found.`);

  const merged = {
    ccPoc: input.ccPoc ?? existing.ccPoc,
    bucket: input.bucket ?? existing.bucket,
    ticketId: input.ticketId !== undefined ? input.ticketId : existing.ticketId,
    currentStatus: input.currentStatus ?? existing.currentStatus,
    issue: input.issue !== undefined ? input.issue : existing.issue,
    subIssue: input.subIssue !== undefined ? input.subIssue : existing.subIssue,
    liveUpdate: input.liveUpdate,
  };

  const fields = validateDisruptionFields(merged, { requireLiveUpdate: false });

  let startIso = existing.disruptionStartAt;
  if (input.disruptionStartAt) {
    const parsed = parseIstInputToIso(input.disruptionStartAt);
    if (!parsed) {
      throw new ValidationError({
        disruptionStartAt: 'Enter a valid start date & time (DD/MM/YYYY HH:MM:SS).',
      });
    }
    // The start time is baked into the Disruption ID, so it cannot move to a
    // different minute without changing the record's identity.
    if (buildDisruptionId(existing.outletId, parsed) !== disruptionId) {
      throw new ValidationError({
        disruptionStartAt:
          'Start time cannot be changed to a different minute - the Disruption ID is derived from it. '
          + 'Create a new disruption instead.',
      });
    }
    startIso = parsed;
  }

  const at = nowIso();
  const statusChanged = fields.currentStatus !== existing.currentStatus;
  const active = isActiveStatus(fields.currentStatus);
  const liveUpdateText = (input.liveUpdate ?? '').trim();

  const changes: Record<string, unknown> = {
    cc_poc: fields.ccPoc,
    bucket: fields.bucket,
    ticket_id: fields.ticketId,
    current_status: fields.currentStatus,
    issue: fields.issue,
    sub_issue: fields.subIssue,
    disruption_start_at: startIso,
    updated_at: at,
    is_active: active ? 1 : 0,
  };

  for (const [inputKey, column] of METRIC_FIELDS) {
    if (input[inputKey] !== undefined) changes[column] = numberOrNull(input[inputKey]);
  }

  if (statusChanged) {
    changes.resolved_at = isResolvedStatus(fields.currentStatus) ? (existing.resolvedAt ?? at) : null;
  }

  if (liveUpdateText) {
    changes.latest_live_update = liveUpdateText;
    changes.last_updated_by = user.name;
    changes.last_updated_at = at;
  } else if (statusChanged || hasMetadataChange(existing, fields)) {
    changes.last_updated_by = user.name;
    changes.last_updated_at = at;
  }

  transaction(() => {
    disruptionRepo.updateFields(disruptionId, changes);

    if (liveUpdateText) {
      updateRepo.append({
        disruptionId,
        updateText: liveUpdateText,
        updatedBy: user.name,
        updatedAt: at,
        previousStatus: existing.currentStatus,
        newStatus: fields.currentStatus,
      });
      auditRepo.record({
        entityType: 'disruption',
        entityId: disruptionId,
        action: 'live_update',
        field: 'latestLiveUpdate',
        previousValue: existing.latestLiveUpdate,
        newValue: liveUpdateText,
        actor: user.name,
        at,
      });
    }

    // Field-level audit trail (spec section 27).
    const audited: [string, string | null, string | null][] = [
      ['currentStatus', existing.currentStatus, fields.currentStatus],
      ['bucket', existing.bucket, fields.bucket],
      ['ticketId', existing.ticketId, fields.ticketId],
      ['ccPoc', existing.ccPoc, fields.ccPoc],
      ['issue', existing.issue, fields.issue],
      ['subIssue', existing.subIssue, fields.subIssue],
    ];
    for (const [field, previous, next] of audited) {
      if ((previous ?? '') === (next ?? '')) continue;
      auditRepo.record({
        entityType: 'disruption',
        entityId: disruptionId,
        action: field === 'currentStatus' ? 'status_change' : 'update',
        field,
        previousValue: previous,
        newValue: next,
        actor: user.name,
        at,
      });
    }
  });

  const updated = disruptionRepo.findById(disruptionId)!;
  broadcast(liveUpdateText ? 'live-update:added' : 'disruption:updated', {
    disruptionId,
    isActive: updated.isActive,
    statusChanged,
  });
  return updated;
}

function hasMetadataChange(
  existing: Disruption,
  fields: { bucket: string; ticketId: string | null; ccPoc: string; issue: string | null; subIssue: string | null },
): boolean {
  return existing.bucket !== fields.bucket
    || (existing.ticketId ?? '') !== (fields.ticketId ?? '')
    || existing.ccPoc !== fields.ccPoc
    || (existing.issue ?? '') !== (fields.issue ?? '')
    || (existing.subIssue ?? '') !== (fields.subIssue ?? '');
}

/** Edits a past Live Update entry, keeping the original text for accountability. */
export function editLiveUpdate(
  disruptionId: string,
  updateId: string,
  newText: string,
  user: SessionUser,
): DisruptionUpdate {
  const text = (newText ?? '').trim();
  if (!text) throw new ValidationError({ updateText: 'Live Update text cannot be empty.' });

  const existing = updateRepo.findById(updateId);
  if (!existing || existing.disruptionId !== disruptionId) {
    throw new NotFoundError('Live Update entry not found for this disruption.');
  }

  const at = nowIso();
  const result = transaction(() => {
    const edited = updateRepo.edit(updateId, text, user.name, at)!;
    auditRepo.record({
      entityType: 'disruption_update',
      entityId: updateId,
      action: 'edit_update',
      field: 'updateText',
      previousValue: existing.updateText,
      newValue: text,
      actor: user.name,
      at,
    });

    // If this was the newest entry, the record's headline update moves with it.
    const latest = updateRepo.latest(disruptionId);
    if (latest && latest.updateId === updateId) {
      disruptionRepo.updateFields(disruptionId, {
        latest_live_update: text,
        last_updated_by: user.name,
        last_updated_at: at,
        updated_at: at,
      });
    }
    return edited;
  });

  broadcast('live-update:edited', { disruptionId, updateId });
  return result;
}

export function getDisruptionDetail(disruptionId: string): {
  disruption: Disruption;
  history: DisruptionUpdate[];
  audit: ReturnType<typeof auditRepo.forEntity>;
} {
  const disruption = disruptionRepo.findById(disruptionId);
  if (!disruption) throw new NotFoundError(`Disruption ${disruptionId} not found.`);
  return {
    disruption,
    history: updateRepo.history(disruptionId),
    audit: auditRepo.forEntity('disruption', disruptionId),
  };
}
