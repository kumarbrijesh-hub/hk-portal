import { Router } from 'express';
import { z } from 'zod';
import { disruptionRepo } from '../repos/disruptionRepo.js';
import { requireAuth } from '../middleware/auth.js';
import type { DisruptionFilters } from '../types.js';
import {
  createDisruption,
  editLiveUpdate,
  getDisruptionDetail,
  previewDisruptionId,
  updateDisruption,
} from '../services/disruptionService.js';

export const disruptionRouter = Router();

disruptionRouter.use(requireAuth);

const optionalString = z.string().trim().optional();
const optionalNullableString = z.union([z.string(), z.null()]).optional();
const optionalNumber = z.union([z.number(), z.string(), z.null()]).optional();

/** Query-string filters shared by the tracker, the active page and the reports. */
export function parseFilters(query: Record<string, unknown>): DisruptionFilters {
  const str = (key: string) => {
    const value = query[key];
    return typeof value === 'string' && value.trim() ? value.trim() : undefined;
  };
  return {
    activeOnly: query.activeOnly === 'true' || query.activeOnly === '1',
    search: str('search'),
    city: str('city'),
    outletId: str('outletId'),
    storeName: str('storeName'),
    vendor: str('vendor'),
    mode: str('mode'),
    ccPoc: str('ccPoc'),
    bucket: str('bucket'),
    currentStatus: str('currentStatus'),
    date: str('date'),
    fromDate: str('fromDate'),
    toDate: str('toDate'),
    sortBy: str('sortBy'),
    sortDir: str('sortDir') === 'asc' ? 'asc' : 'desc',
    limit: query.limit ? Number(query.limit) : undefined,
    offset: query.offset ? Number(query.offset) : undefined,
  };
}

/** Human-readable filter summary, echoed into report headers. */
export function describeFilters(filters: DisruptionFilters): Record<string, string> {
  const labels: [keyof DisruptionFilters, string][] = [
    ['city', 'City'], ['outletId', 'Outlet ID'], ['storeName', 'Store Name'],
    ['vendor', 'Vendor'], ['mode', 'Mode'], ['ccPoc', 'CC POC'],
    ['bucket', 'Bucket'], ['currentStatus', 'Current Status'],
    ['date', 'Date'], ['fromDate', 'From'], ['toDate', 'To'], ['search', 'Search'],
  ];
  const out: Record<string, string> = {};
  for (const [key, label] of labels) {
    const value = filters[key];
    if (typeof value === 'string' && value) out[label] = value;
  }
  return out;
}

disruptionRouter.get('/', (req, res) => {
  const filters = parseFilters(req.query as Record<string, unknown>);
  const { rows, total } = disruptionRepo.list(filters);
  res.json({ rows, total, activeCount: disruptionRepo.activeCount(filters) });
});

/** Live Active Disruptions page payload: count + rows in one round trip. */
disruptionRouter.get('/active', (req, res) => {
  const filters = { ...parseFilters(req.query as Record<string, unknown>), activeOnly: true };
  const { rows, total } = disruptionRepo.list({ ...filters, limit: filters.limit ?? 1000 });
  res.json({ rows, total, activeCount: total, filters: describeFilters(filters) });
});

/** Rule 2: live preview of the generated Disruption ID as the form is filled in. */
disruptionRouter.get('/preview-id', (req, res) => {
  const preview = previewDisruptionId(
    String(req.query.outletId ?? ''),
    String(req.query.disruptionStartAt ?? ''),
  );
  res.json(preview);
});

const createSchema = z.object({
  outletId: z.string().min(1, 'Outlet ID is mandatory.'),
  disruptionStartAt: z.string().min(1, 'Disruption start date & time is mandatory.'),
  ccPoc: z.string().min(1, 'CC POC is mandatory.'),
  bucket: z.string().min(1, 'Bucket is mandatory.'),
  ticketId: optionalNullableString,
  currentStatus: z.string().min(1, 'Current Status is mandatory.'),
  issue: optionalNullableString,
  subIssue: optionalNullableString,
  liveUpdate: z.string().min(1, 'Live Update is mandatory.'),
  ccFrtMins: optionalNumber,
  mstFrtMins: optionalNumber,
  auditDurationHrs: optionalNumber,
});

disruptionRouter.post('/', (req, res) => {
  const input = createSchema.parse(req.body);
  const disruption = createDisruption(
    {
      ...input,
      ticketId: input.ticketId ?? null,
      issue: input.issue ?? null,
      subIssue: input.subIssue ?? null,
      ccFrtMins: input.ccFrtMins as number | null | undefined,
      mstFrtMins: input.mstFrtMins as number | null | undefined,
      auditDurationHrs: input.auditDurationHrs as number | null | undefined,
    },
    req.user!,
  );
  res.status(201).json({
    disruption,
    message: `Disruption created successfully. Disruption ID: ${disruption.disruptionId}`,
  });
});

disruptionRouter.get('/:disruptionId', (req, res) => {
  res.json(getDisruptionDetail(req.params.disruptionId));
});

disruptionRouter.get('/:disruptionId/history', (req, res) => {
  const { history } = getDisruptionDetail(req.params.disruptionId);
  res.json({ history });
});

const updateSchema = z.object({
  ccPoc: optionalString,
  bucket: optionalString,
  ticketId: optionalNullableString,
  currentStatus: optionalString,
  issue: optionalNullableString,
  subIssue: optionalNullableString,
  liveUpdate: optionalString,
  ccFrtMins: optionalNumber,
  mstFrtMins: optionalNumber,
  auditDurationHrs: optionalNumber,
  disruptionStartAt: optionalString,
});

disruptionRouter.patch('/:disruptionId', (req, res) => {
  const input = updateSchema.parse(req.body);
  const disruption = updateDisruption(
    req.params.disruptionId,
    input as Parameters<typeof updateDisruption>[1],
    req.user!,
  );
  res.json({ disruption, message: 'Disruption updated successfully.' });
});

const liveUpdateSchema = z.object({
  liveUpdate: z.string().min(1, 'Live Update text is mandatory.'),
  currentStatus: optionalString,
  issue: optionalNullableString,
  subIssue: optionalNullableString,
});

/** Appends a Live Update (and optionally moves the status in the same action). */
disruptionRouter.post('/:disruptionId/updates', (req, res) => {
  const input = liveUpdateSchema.parse(req.body);
  const disruption = updateDisruption(
    req.params.disruptionId,
    input as Parameters<typeof updateDisruption>[1],
    req.user!,
  );
  res.status(201).json({ disruption, message: 'Live Update added.' });
});

const editUpdateSchema = z.object({
  updateText: z.string().min(1, 'Live Update text cannot be empty.'),
});

disruptionRouter.patch('/:disruptionId/updates/:updateId', (req, res) => {
  const input = editUpdateSchema.parse(req.body);
  const update = editLiveUpdate(
    req.params.disruptionId,
    req.params.updateId,
    input.updateText,
    req.user!,
  );
  res.json({ update, message: 'Live Update edited.' });
});
