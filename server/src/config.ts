import fs from 'node:fs';
import { env } from './env.js';

export interface SheetColumnMap {
  outletId: string;
  storeName: string;
  city: string;
  mode: string;
  vendor: string;
  pocName: string;
  pocContact: string;
}

export interface AppConfig {
  brand: { appName: string; reportTitle: string; timezone: string };
  googleSheet: {
    url: string;
    spreadsheetId: string;
    masterDataTab: string;
    headerRow: number;
    syncIntervalMinutes: number;
    columns: SheetColumnMap;
  };
  ccPocOptions: string[];
  buckets: string[];
  bucketsRequiringTicketId: string[];
  statuses: string[];
  inactiveStatuses: { values: string[] };
  statusesRequiringIssue: string[];
  report: {
    secondarySectionTitle: string;
    secondarySectionStatuses: string[];
    breakdownBucket: string;
    nonBreakdownBucket: string;
  };
  issueMaster: Record<string, string[] | boolean | string>;
}

export const PENDING = 'PENDING';

const SHEET_FIELDS: (keyof SheetColumnMap)[] = [
  'outletId', 'storeName', 'city', 'mode', 'vendor', 'pocName', 'pocContact',
];

let cached: AppConfig | null = null;

/** Extracts the spreadsheet id out of a full Google Sheets URL. */
export function parseSpreadsheetId(urlOrId: string): string {
  if (!urlOrId || urlOrId === PENDING) return '';
  const match = urlOrId.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (match) return match[1];
  return /^[a-zA-Z0-9-_]{20,}$/.test(urlOrId) ? urlOrId : '';
}

export function loadConfig(force = false): AppConfig {
  if (cached && !force) return cached;

  const raw = JSON.parse(fs.readFileSync(env.configPath, 'utf8')) as AppConfig;

  // Env overrides win over the JSON file so secrets can stay out of the repo.
  const sheetId = env.sheetIdOverride
    || parseSpreadsheetId(raw.googleSheet.spreadsheetId)
    || parseSpreadsheetId(raw.googleSheet.url);
  raw.googleSheet.spreadsheetId = sheetId;
  if (env.sheetTabOverride) raw.googleSheet.masterDataTab = env.sheetTabOverride;
  if (env.syncIntervalMinutesOverride) {
    raw.googleSheet.syncIntervalMinutes = Number(env.syncIntervalMinutesOverride);
  }

  cached = raw;
  return raw;
}

export function reloadConfig(): AppConfig {
  return loadConfig(true);
}

/** Issue -> sub issue map, with the metadata keys (_comment, _pending) stripped. */
export function issueMaster(config = loadConfig()): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const [key, value] of Object.entries(config.issueMaster)) {
    if (key.startsWith('_')) continue;
    if (Array.isArray(value)) out[key] = value;
  }
  return out;
}

export function issueMasterIsPending(config = loadConfig()): boolean {
  return config.issueMaster._pending === true;
}

/** Which configuration values still need to be supplied before sync can run. */
export function missingSheetConfig(config = loadConfig()): string[] {
  const missing: string[] = [];
  if (!config.googleSheet.spreadsheetId) missing.push('googleSheet.spreadsheetId / url');
  if (!config.googleSheet.masterDataTab || config.googleSheet.masterDataTab === PENDING) {
    missing.push('googleSheet.masterDataTab');
  }
  for (const field of SHEET_FIELDS) {
    const value = config.googleSheet.columns[field];
    if (!value || value === PENDING) missing.push(`googleSheet.columns.${field}`);
  }
  return missing;
}

export function sheetConfigReady(config = loadConfig()): boolean {
  return missingSheetConfig(config).length === 0;
}
