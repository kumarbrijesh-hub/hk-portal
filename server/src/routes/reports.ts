import { Router } from 'express';
import { disruptionRepo } from '../repos/disruptionRepo.js';
import { requireAuth } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/errors.js';
import {
  buildCsv,
  buildExcel,
  buildHtml,
  buildReportData,
  reportFileName,
} from '../services/reportService.js';
import { nowIso } from '../utils/time.js';
import { describeFilters, parseFilters } from './disruptions.js';

export const reportRouter = Router();

reportRouter.use(requireAuth);

/**
 * Hourly active-disruption report. Always restricted to the active set and to
 * whatever filters the user has applied on screen.
 */
function collect(query: Record<string, unknown>) {
  const filters = { ...parseFilters(query), activeOnly: true, limit: undefined, offset: undefined };
  const records = disruptionRepo.listAll(filters);
  return buildReportData(records, describeFilters(filters), nowIso());
}

/** Preview payload so the UI can show the tile numbers before downloading. */
reportRouter.get('/active/summary', (req, res) => {
  const data = collect(req.query as Record<string, unknown>);
  res.json({
    generatedAt: data.generatedAt,
    appliedFilters: data.appliedFilters,
    stats: data.stats,
    primaryCount: data.primary.length,
    secondaryCount: data.secondary.length,
  });
});

reportRouter.get(
  '/active.xlsx',
  asyncHandler(async (req, res) => {
    const data = collect(req.query as Record<string, unknown>);
    const buffer = await buildExcel(data);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${reportFileName(data.generatedAt, 'xlsx')}"`,
    );
    res.send(buffer);
  }),
);

reportRouter.get('/active.csv', (req, res) => {
  const data = collect(req.query as Record<string, unknown>);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="${reportFileName(data.generatedAt, 'csv')}"`,
  );
  res.send(buildCsv(data));
});

/** Shareable / printable version - same numbers, report layout. */
reportRouter.get('/active.html', (req, res) => {
  const data = collect(req.query as Record<string, unknown>);
  const download = req.query.download === 'true' || req.query.download === '1';
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  if (download) {
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${reportFileName(data.generatedAt, 'html')}"`,
    );
  }
  res.send(buildHtml(data));
});
