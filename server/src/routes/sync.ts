import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { missingSheetConfig } from '../config.js';
import { outletRepo } from '../repos/outletRepo.js';
import { syncRepo } from '../repos/syncRepo.js';
import { requireAuth } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/errors.js';
import { syncIntervalMs, syncNow } from '../services/syncService.js';

export const syncRouter = Router();

syncRouter.use(requireAuth);

const manualSyncLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Sync Now was pressed too often. Wait a moment and retry.' },
});

/** Header status strip: last sync time, status and record count (spec section 23). */
syncRouter.get('/status', (_req, res) => {
  res.json({
    ...syncRepo.get(),
    outletCount: outletRepo.count(),
    intervalMinutes: syncIntervalMs() / 60000,
    missingConfig: missingSheetConfig(),
  });
});

syncRouter.post(
  '/now',
  manualSyncLimiter,
  asyncHandler(async (req, res) => {
    const result = await syncNow('manual', req.user?.name ?? 'unknown');
    res.status(result.ok ? 200 : 502).json({
      ...result,
      state: syncRepo.get(),
      outletCount: outletRepo.count(),
    });
  }),
);
