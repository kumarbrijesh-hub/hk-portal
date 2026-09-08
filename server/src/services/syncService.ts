/**
 * Google Sheet -> cloud database sync (spec section 2).
 *
 * Contract:
 *  - The sheet is the source of truth, but is never queried on the user path.
 *  - Lookups always read the synced snapshot in SQLite.
 *  - A failed sync leaves the previous good snapshot in place.
 */
import { loadConfig, missingSheetConfig } from '../config.js';
import { outletRepo } from '../repos/outletRepo.js';
import { syncRepo } from '../repos/syncRepo.js';
import { auditRepo } from '../repos/auditRepo.js';
import { broadcast } from './events.js';
import { readSheet, resolveColumnIndex, type SheetGrid } from './sheets.js';
import { nowIso } from '../utils/time.js';
import type { OutletMaster } from '../types.js';

export interface SyncResult {
  ok: boolean;
  recordCount: number;
  skippedRows: number;
  duplicateOutletIds: string[];
  warnings: string[];
  error?: string;
  durationMs: number;
  source?: string;
}

let inFlight: Promise<SyncResult> | null = null;
let timer: NodeJS.Timeout | null = null;

const FIELD_ORDER = [
  'outletId', 'storeName', 'city', 'mode', 'vendor', 'pocName', 'pocContact',
] as const;

type Field = typeof FIELD_ORDER[number];

/** Maps the raw grid to outlet rows using the configured column mapping. */
export function mapGrid(grid: SheetGrid, headerRow: number, columns: Record<Field, string>): {
  outlets: Omit<OutletMaster, 'syncedAt'>[];
  skippedRows: number;
  duplicateOutletIds: string[];
  warnings: string[];
} {
  const warnings: string[] = [];
  const headerIndex = Math.max(headerRow - 1, 0);
  const header = (grid[headerIndex] ?? []).map((cell) => String(cell ?? ''));

  if (!header.length) throw new Error(`Header row ${headerRow} is empty in the master sheet`);

  const indexes = {} as Record<Field, number>;
  for (const field of FIELD_ORDER) {
    const spec = columns[field];
    const index = resolveColumnIndex(header, spec);
    if (index === null) {
      throw new Error(
        `Column for "${field}" (configured as "${spec}") was not found in the sheet header row. `
        + `Available headers: ${header.filter(Boolean).join(', ')}`,
      );
    }
    indexes[field] = index;
  }

  const seen = new Map<string, number>();
  const duplicateOutletIds: string[] = [];
  const outlets: Omit<OutletMaster, 'syncedAt'>[] = [];
  let skippedRows = 0;

  for (let rowNumber = headerIndex + 1; rowNumber < grid.length; rowNumber += 1) {
    const row = grid[rowNumber] ?? [];
    const cell = (field: Field) => String(row[indexes[field]] ?? '').trim();

    const outletId = cell('outletId');
    if (!outletId) {
      // Blank outlet id means a spacer/blank row - not an error.
      if (row.some((value) => String(value ?? '').trim())) skippedRows += 1;
      continue;
    }

    const key = outletId.toLowerCase();
    if (seen.has(key)) {
      duplicateOutletIds.push(outletId);
      // Last row wins; the earlier entry is replaced so behaviour is deterministic.
      outlets[seen.get(key)!] = {
        outletId,
        storeName: cell('storeName'),
        city: cell('city'),
        mode: cell('mode'),
        vendor: cell('vendor'),
        pocName: cell('pocName'),
        pocContact: cell('pocContact'),
      };
      continue;
    }

    seen.set(key, outlets.length);
    outlets.push({
      outletId,
      storeName: cell('storeName'),
      city: cell('city'),
      mode: cell('mode'),
      vendor: cell('vendor'),
      pocName: cell('pocName'),
      pocContact: cell('pocContact'),
    });
  }

  if (duplicateOutletIds.length) {
    const preview = [...new Set(duplicateOutletIds)].slice(0, 10).join(', ');
    warnings.push(
      `${duplicateOutletIds.length} duplicate Outlet ID row(s) in master data - last row kept. `
      + `Examples: ${preview}`,
    );
  }
  if (skippedRows) {
    warnings.push(`${skippedRows} row(s) skipped because Outlet ID was blank.`);
  }

  return { outlets, skippedRows, duplicateOutletIds, warnings };
}

async function runSync(trigger: string, actor: string): Promise<SyncResult> {
  const startedAt = Date.now();
  const attemptAt = nowIso();
  syncRepo.markSyncing(attemptAt);
  broadcast('sync:status', { status: 'syncing' });

  const config = loadConfig();
  const missing = missingSheetConfig(config);
  if (missing.length) {
    const error = `Google Sheet configuration incomplete: ${missing.join(', ')}. `
      + 'Set these in config/app.config.json (or via GOOGLE_SHEET_ID / GOOGLE_SHEET_TAB).';
    const durationMs = Date.now() - startedAt;
    syncRepo.markFailure(error, durationMs);
    broadcast('sync:status', { status: 'failed' });
    return { ok: false, recordCount: 0, skippedRows: 0, duplicateOutletIds: [], warnings: [], error, durationMs };
  }

  try {
    const { grid, source } = await readSheet(config.googleSheet.spreadsheetId, config.googleSheet.masterDataTab);
    const mapped = mapGrid(
      grid,
      config.googleSheet.headerRow || 1,
      config.googleSheet.columns as unknown as Record<Field, string>,
    );

    if (!mapped.outlets.length) {
      throw new Error('Master sheet returned zero usable outlet rows - previous data kept.');
    }

    const syncedAt = nowIso();
    const recordCount = outletRepo.replaceAll(mapped.outlets, syncedAt);
    const durationMs = Date.now() - startedAt;

    syncRepo.markSuccess(syncedAt, recordCount, durationMs);
    auditRepo.record({
      entityType: 'outlet_master',
      entityId: 'sync',
      action: 'sync',
      field: trigger,
      newValue: `${recordCount} records via ${source}`,
      actor,
    });
    broadcast('sync:status', { status: 'success', recordCount });

    return {
      ok: true,
      recordCount,
      skippedRows: mapped.skippedRows,
      duplicateOutletIds: [...new Set(mapped.duplicateOutletIds)],
      warnings: mapped.warnings,
      durationMs,
      source,
    };
  } catch (error) {
    const durationMs = Date.now() - startedAt;
    const message = error instanceof Error ? error.message : String(error);
    syncRepo.markFailure(message, durationMs);
    broadcast('sync:status', { status: 'failed' });
    return {
      ok: false, recordCount: 0, skippedRows: 0, duplicateOutletIds: [],
      warnings: [], error: message, durationMs,
    };
  }
}

/** Coalesces concurrent requests so a manual "Sync Now" cannot overlap the timer. */
export function syncNow(trigger: 'manual' | 'scheduled' | 'boot', actor = 'system'): Promise<SyncResult> {
  if (inFlight) return inFlight;
  inFlight = runSync(trigger, actor).finally(() => {
    inFlight = null;
  });
  return inFlight;
}

export function syncIntervalMs(): number {
  const minutes = loadConfig().googleSheet.syncIntervalMinutes;
  const safe = Number.isFinite(minutes) && minutes >= 1 ? minutes : 7;
  return safe * 60 * 1000;
}

export function startScheduler(): void {
  if (timer) clearInterval(timer);
  timer = setInterval(() => {
    void syncNow('scheduled');
  }, syncIntervalMs());
  timer.unref?.();
}

export function stopScheduler(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
