import { Router } from 'express';
import { outletRepo } from '../repos/outletRepo.js';
import { syncRepo } from '../repos/syncRepo.js';
import { requireAuth } from '../middleware/auth.js';

export const outletRouter = Router();

outletRouter.use(requireAuth);

/** Typeahead for the Outlet ID field. Always served from the synced snapshot. */
outletRouter.get('/search', (req, res) => {
  const query = String(req.query.q ?? '').trim();
  const limit = Math.min(Number(req.query.limit ?? 25) || 25, 100);
  const results = query ? outletRepo.search(query, limit) : outletRepo.list(limit);
  res.json({ results, total: outletRepo.count() });
});

/** Rule 1: master-data lookup that populates the read-only form fields. */
outletRouter.get('/:outletId', (req, res) => {
  const outlet = outletRepo.findById(req.params.outletId);
  if (!outlet) {
    const state = syncRepo.get();
    res.status(404).json({
      error: outletRepo.count() === 0
        ? 'Outlet master is empty. Use Sync Now to load master data from the Google Sheet.'
        : `Outlet ID "${req.params.outletId}" not found in the synced master data.`,
      syncStatus: state.status,
      lastSuccessAt: state.lastSuccessAt,
    });
    return;
  }
  res.json({ outlet });
});
