import { Router } from 'express';
import { issueMaster, issueMasterIsPending, loadConfig, missingSheetConfig } from '../config.js';
import { disruptionRepo } from '../repos/disruptionRepo.js';
import { outletRepo } from '../repos/outletRepo.js';
import { hasServiceAccount } from '../services/sheets.js';
import { requireAuth } from '../middleware/auth.js';

export const configRouter = Router();

/**
 * Everything the UI needs to render its dropdowns and apply the same rules
 * client-side. Deliberately contains no credentials.
 */
configRouter.get('/', requireAuth, (_req, res) => {
  const config = loadConfig();
  res.json({
    brand: config.brand,
    ccPocOptions: config.ccPocOptions,
    buckets: config.buckets,
    bucketsRequiringTicketId: config.bucketsRequiringTicketId,
    statuses: config.statuses,
    inactiveStatuses: config.inactiveStatuses.values,
    statusesRequiringIssue: config.statusesRequiringIssue,
    issueMaster: issueMaster(config),
    issueMasterPending: issueMasterIsPending(config),
    report: config.report,
    sheet: {
      tab: config.googleSheet.masterDataTab,
      syncIntervalMinutes: config.googleSheet.syncIntervalMinutes,
      configured: missingSheetConfig(config).length === 0,
      missing: missingSheetConfig(config),
      authMode: hasServiceAccount() ? 'service-account' : 'public-csv',
    },
    outletCount: outletRepo.count(),
  });
});

/** Filter option lists, sourced from live data so they never show dead values. */
configRouter.get('/filters', requireAuth, (_req, res) => {
  res.json({
    cities: outletRepo.distinctValues('city'),
    vendors: outletRepo.distinctValues('vendor'),
    modes: outletRepo.distinctValues('mode'),
    disruptionCities: disruptionRepo.distinctValues('city'),
    disruptionVendors: disruptionRepo.distinctValues('vendor'),
    disruptionModes: disruptionRepo.distinctValues('mode'),
  });
});
