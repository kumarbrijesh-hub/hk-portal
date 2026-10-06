import express from 'express';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { createServer as createViteServer } from 'vite';

// Types and Defaults
import { DEFAULT_CONFIG, INITIAL_OUTLETS, DEFAULT_CC_POCS, DEFAULT_ISSUE_MASTER } from './src/data/defaultConfig';
import { INITIAL_DISRUPTIONS } from './src/data/initialDisruptions';
import { AppConfig, Disruption, DisruptionUpdateHistory, OutletMaster, SyncStatus } from './src/types';
import { formatToIST, getCurrentISTDate } from './src/utils/dateUtils';

// Hosting platforms inject the port; 3000 stays the local default.
const PORT = Number(process.env.PORT ?? 3000);
// DATA_DIR is overridable so the JSON store can live on a mounted volume.
const DATA_DIR = process.env.DATA_DIR ?? path.join(process.cwd(), 'data');
const DB_FILE = path.join(DATA_DIR, 'store.json');

// --- Access control -------------------------------------------------------
// Set APP_PASSWORD to put the whole app behind a shared password. Left unset,
// the app stays open exactly as before, which keeps local preview friction-free.
const APP_PASSWORD = process.env.APP_PASSWORD ?? '';
const AUTH_REQUIRED = APP_PASSWORD.length > 0;
const SESSION_SECRET =
  process.env.SESSION_SECRET ?? (AUTH_REQUIRED ? crypto.createHash('sha256').update(APP_PASSWORD).digest('hex') : '');
const SESSION_COOKIE = 'dms_session';
const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // one shift

function signSession(expiresAt: number): string {
  const payload = String(expiresAt);
  const mac = crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('hex');
  return `${payload}.${mac}`;
}

function sessionIsValid(token: string | undefined): boolean {
  if (!token) return false;
  const [payload, mac] = token.split('.');
  if (!payload || !mac) return false;
  const expected = crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('hex');
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false;
  const expiresAt = Number(payload);
  return Number.isFinite(expiresAt) && expiresAt > Date.now();
}

function readCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return undefined;
}

// Enough to make password guessing impractical without pulling in a dependency.
const loginAttempts = new Map<string, { count: number; firstAt: number }>();
const LOGIN_WINDOW_MS = 5 * 60 * 1000;
const LOGIN_MAX_ATTEMPTS = 10;

function loginThrottled(ip: string): boolean {
  const entry = loginAttempts.get(ip);
  if (!entry) return false;
  if (Date.now() - entry.firstAt > LOGIN_WINDOW_MS) {
    loginAttempts.delete(ip);
    return false;
  }
  return entry.count >= LOGIN_MAX_ATTEMPTS;
}

function recordFailedLogin(ip: string): void {
  const entry = loginAttempts.get(ip);
  if (!entry || Date.now() - entry.firstAt > LOGIN_WINDOW_MS) {
    loginAttempts.set(ip, { count: 1, firstAt: Date.now() });
  } else {
    entry.count++;
  }
}

interface DatabaseStore {
  outlets: OutletMaster[];
  disruptions: Disruption[];
  config: AppConfig;
  syncStatus: SyncStatus;
}

// Ensure data folder exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// Initial DB state
let db: DatabaseStore = {
  outlets: [...INITIAL_OUTLETS],
  disruptions: [...INITIAL_DISRUPTIONS],
  config: { ...DEFAULT_CONFIG },
  syncStatus: {
    lastSyncTime: '08/09/2026 11:30:00',
    lastAttemptedTime: '08/09/2026 11:30:00',
    status: 'Success',
    recordsCount: INITIAL_OUTLETS.length,
    errorDetails: null,
    source: 'Seed Master Dataset',
  },
};

// Load DB from file if exists
try {
  if (fs.existsSync(DB_FILE)) {
    const fileContent = fs.readFileSync(DB_FILE, 'utf-8');
    const parsed = JSON.parse(fileContent);
    if (parsed.outlets) db.outlets = parsed.outlets;
    if (parsed.disruptions) db.disruptions = parsed.disruptions;
    if (parsed.config) {
      db.config = { ...DEFAULT_CONFIG, ...parsed.config };
      if (!parsed.config.sheetTabName || parsed.config.sheetTabName === 'Master_Data') {
        db.config.sheetTabName = 'Live_data';
      }
    }
    if (parsed.syncStatus) db.syncStatus = parsed.syncStatus;
  } else {
    fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), 'utf-8');
  }
} catch (err) {
  console.error('Failed to load DB file, using in-memory defaults:', err);
}

function saveDb() {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), 'utf-8');
  } catch (err) {
    console.error('Error persisting database to disk:', err);
  }
}

// Helper to parse CSV line handling quotes
function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current.trim());
  return result;
}

// Helper to convert Google Sheets URL to candidate CSV export URLs
function getGoogleSheetCandidateCsvUrls(url: string, tabName: string): string[] {
  if (!url) return [];
  const trimmed = url.trim();

  // If already a direct CSV download or published URL
  if (trimmed.includes('format=csv') || trimmed.includes('output=csv')) {
    return [trimmed];
  }

  const match = trimmed.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (!match) return [trimmed];

  const sheetId = match[1];
  const gidMatch = trimmed.match(/[?&#]gid=([0-9]+)/);
  const gid = gidMatch ? gidMatch[1] : null;

  const candidates: string[] = [];

  // Priority 1: If gid found, use export with gid
  if (gid) {
    candidates.push(`https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv&gid=${gid}`);
    candidates.push(`https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:csv&gid=${gid}`);
  }

  // Priority 2: If tabName is provided
  if (tabName && tabName.trim()) {
    candidates.push(
      `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(
        tabName.trim()
      )}`
    );
  }

  // Priority 3: Default export
  candidates.push(`https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv`);

  return candidates;
}

// Sync Service
async function syncGoogleSheetData(): Promise<{ success: boolean; count: number; error?: string }> {
  const { formattedIST } = getCurrentISTDate();
  db.syncStatus.lastAttemptedTime = formattedIST;
  db.syncStatus.status = 'Syncing';
  db.syncStatus.errorDetails = null;

  const url = db.config.googleSheetUrl;
  const tab = db.config.sheetTabName;
  const mapping = db.config.columnMapping;

  if (!url || !url.trim()) {
    // If no URL provided yet, preserve existing valid dataset and set status
    db.syncStatus.status = 'Success';
    db.syncStatus.recordsCount = db.outlets.length;
    db.syncStatus.lastSyncTime = formattedIST;
    db.syncStatus.errorDetails = 'Running on active Master Data cache. Add Google Sheet URL in Settings for live cloud sync.';
    db.syncStatus.source = 'Internal Cached Master Dataset';
    saveDb();
    return { success: true, count: db.outlets.length };
  }

  const candidateUrls = getGoogleSheetCandidateCsvUrls(url, tab);
  let csvText = '';
  let lastFetchError = '';

  for (const candidateUrl of candidateUrls) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);
      const response = await fetch(candidateUrl, {
        signal: controller.signal,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          Accept: 'text/csv, text/plain, */*',
        },
      });
      clearTimeout(timeout);

      if (response.ok) {
        const text = await response.text();
        if (text && !text.includes('<!DOCTYPE html>') && !text.includes('<html') && !text.includes('google.com/ServiceLogin')) {
          csvText = text;
          break;
        } else {
          lastFetchError = 'Google Sheet returned a login/HTML page. Permissions required.';
        }
      } else {
        lastFetchError = `HTTP ${response.status}: ${response.statusText}`;
      }
    } catch (e: unknown) {
      lastFetchError = e instanceof Error ? e.message : 'Network timeout/failure';
    }
  }

  try {
    if (!csvText) {
      throw new Error(
        `Google Sheet sync failed (${lastFetchError}). Ensure sheet link is set to "Anyone with the link can view" (Viewer access), or use "Quick Sync / Paste Sheet Data" to paste all rows in 1 click.`
      );
    }

    const lines = csvText.split(/\r?\n/).filter((l) => l.trim().length > 0);
    if (lines.length < 2) {
      throw new Error('Google Sheet appears empty or has no data rows.');
    }

    const rawHeaders = parseCsvLine(lines[0]);
    const cleanHeaders = rawHeaders.map((h) => h.toLowerCase().replace(/[^a-z0-9]/g, ''));

    // Intelligent column header matching with priority aliases
    const findIndex = (targetName: string, fallbackAliases: string[]): number => {
      const targetClean = (targetName || '').toLowerCase().replace(/[^a-z0-9]/g, '');
      if (targetClean) {
        const exactIdx = cleanHeaders.indexOf(targetClean);
        if (exactIdx !== -1) return exactIdx;
      }
      for (const alias of fallbackAliases) {
        const aliasClean = alias.toLowerCase().replace(/[^a-z0-9]/g, '');
        const idx = cleanHeaders.indexOf(aliasClean);
        if (idx !== -1) return idx;
      }
      for (const alias of fallbackAliases) {
        const aliasClean = alias.toLowerCase().replace(/[^a-z0-9]/g, '');
        if (aliasClean.length < 3) continue;
        const idx = cleanHeaders.findIndex((h) => h.includes(aliasClean) || aliasClean.includes(h));
        if (idx !== -1) return idx;
      }
      return -1;
    };

    const idxOutlet = findIndex(mapping.outletId, [
      'outlet_id',
      'outletid',
      'outlet id',
      'store_id',
      'storeid',
      'outlet',
      'hub_id',
      'code',
    ]);
    const idxCity = findIndex(mapping.city, ['city', 'location', 'region', 'zone', 'town']);
    const idxStore = findIndex(mapping.storeName, [
      'store name',
      'store_name',
      'storename',
      'store',
      'hub name',
      'hub',
    ]);
    const idxPoc = findIndex(mapping.pocName, [
      'cold poc name-2',
      'cold poc name 2',
      'cold poc name',
      'cold_poc_name_2',
      'cold_poc_name',
      'poc name-2',
      'poc name',
      'poc_name',
      'manager name',
      'poc',
    ]);
    const idxContact = findIndex(mapping.pocContact, [
      'cold poc contact-2',
      'cold poc contact 2',
      'cold poc contact',
      'cold_poc_contact_2',
      'cold_poc_contact',
      'poc contact-2',
      'poc contact number',
      'poc contact',
      'poc_contact',
      'contact number',
      'phone',
      'mobile',
    ]);
    const idxMode = findIndex(mapping.mode, ['mode', 'store mode', 'format', 'store type', 'type']);
    const idxVendor = findIndex(mapping.vendor, ['vendor', 'partner', 'agency', 'oem']);
    const idxAmc = findIndex(mapping.amcCoverage || 'amc coverage', ['amc coverage', 'amc', 'coverage', 'amc status']);
    const idxCurrentVendor = findIndex(mapping.currentVendor || 'current vendor (amc or warranty)', [
      'current vendor (amc or warranty)',
      'current vendor',
      'vendor (amc or warranty)',
      'vendor (auto)',
    ]);
    const idxL1Name = findIndex(mapping.lodL1Name || 'lod - 2 l1 name', [
      'lod - 2 l1 name',
      'lod 2 l1 name',
      'lod-2 l1 name',
      'lod l1 name',
      'l1 name',
    ]);
    const idxL1Email = findIndex(mapping.lodL1Email || 'lod - 2 l1 email', [
      'lod - 2 l1 email',
      'lod 2 l1 email',
      'lod-2 l1 email',
      'lod l1 email',
      'l1 email',
    ]);
    const idxL1Contact = findIndex(mapping.lodL1Contact || 'lod - 2 l1 contact no', [
      'lod - 2 l1 contact no',
      'lod 2 l1 contact',
      'lod - 2 l1 contact',
      'l1 contact no',
      'l1 contact',
    ]);
    const idxL2Name = findIndex(mapping.lodL2Name || 'lod - 2 l2 name', [
      'lod - 2 l2 name',
      'lod 2 l2 name',
      'lod-2 l2 name',
      'lod l2 name',
      'l2 name',
    ]);
    const idxL2Email = findIndex(mapping.lodL2Email || 'lod - 2 l2 email', [
      'lod - 2 l2 email',
      'lod 2 l2 email',
      'lod-2 l2 email',
      'lod l2 email',
      'l2 email',
    ]);
    const idxL2Contact = findIndex(mapping.lodL2Contact || 'lod - 2 l2 contact no', [
      'lod - 2 l2 contact no',
      'lod 2 l2 contact',
      'lod - 2 l2 contact',
      'l2 contact no',
      'l2 contact',
    ]);
    const idxL3Name = findIndex(mapping.lodL3Name || 'lod - 2 l3 name', [
      'lod - 2 l3 name',
      'lod 2 l3 name',
      'lod-2 l3 name',
      'lod l3 name',
      'l3 name',
    ]);
    const idxL3Email = findIndex(mapping.lodL3Email || 'lod - 2 l3 email', [
      'lod - 2 l3 email',
      'lod 2 l3 email',
      'lod-2 l3 email',
      'lod l3 email',
      'l3 email',
    ]);
    const idxL3Contact = findIndex(mapping.lodL3Contact || 'lod - 2 l3 contact no.', [
      'lod - 2 l3 contact no.',
      'lod - 2 l3 contact no',
      'lod 2 l3 contact',
      'lod - 2 l3 contact',
      'l3 contact no',
      'l3 contact',
    ]);
    const idxRegion = findIndex('region (auto)', ['region (auto)', 'region', 'zone']);
    const idxMstRacName = findIndex('mst/rac name (auto)', ['mst/rac name (auto)', 'mst/rac name', 'mst rac name', 'mst name']);
    const idxMstRacContact = findIndex('mst/rac contact no. (auto)', ['mst/rac contact no. (auto)', 'mst/rac contact no', 'mst rac contact']);

    if (idxOutlet === -1) {
      throw new Error(`Outlet ID column (e.g. "outlet_id" / "${mapping.outletId}") not found in Google Sheet headers.`);
    }

    const newOutlets: OutletMaster[] = [];
    const seenIds = new Set<string>();

    for (let i = 1; i < lines.length; i++) {
      const row = parseCsvLine(lines[i]);
      const rawOutletId = (row[idxOutlet] || '').trim();
      if (!rawOutletId) continue;
      const outletId = rawOutletId.toUpperCase();
      if (seenIds.has(outletId)) continue;

      seenIds.add(outletId);
      const storeName = (idxStore !== -1 ? row[idxStore] : '') || `Store ${outletId}`;
      const city = (idxCity !== -1 ? row[idxCity] : '') || 'Unspecified';
      const mode = (idxMode !== -1 ? row[idxMode] : '') || 'Dark Store';
      const vendor = (idxVendor !== -1 ? row[idxVendor] : '') || 'RAC';
      const pocName = (idxPoc !== -1 ? row[idxPoc] : '') || 'Store POC';
      const pocContact = (idxContact !== -1 ? row[idxContact] : '') || '+91 00000 00000';

      const amcCoverage = (idxAmc !== -1 ? row[idxAmc] : '') || '';
      const currentVendor = (idxCurrentVendor !== -1 ? row[idxCurrentVendor] : '') || vendor;
      const lodL1Name = (idxL1Name !== -1 ? row[idxL1Name] : '') || '';
      const lodL1Email = (idxL1Email !== -1 ? row[idxL1Email] : '') || '';
      const lodL1Contact = (idxL1Contact !== -1 ? row[idxL1Contact] : '') || '';
      const lodL2Name = (idxL2Name !== -1 ? row[idxL2Name] : '') || '';
      const lodL2Email = (idxL2Email !== -1 ? row[idxL2Email] : '') || '';
      const lodL2Contact = (idxL2Contact !== -1 ? row[idxL2Contact] : '') || '';
      const lodL3Name = (idxL3Name !== -1 ? row[idxL3Name] : '') || '';
      const lodL3Email = (idxL3Email !== -1 ? row[idxL3Email] : '') || '';
      const lodL3Contact = (idxL3Contact !== -1 ? row[idxL3Contact] : '') || '';
      const region = (idxRegion !== -1 ? row[idxRegion] : '') || '';
      const mstRacName = (idxMstRacName !== -1 ? row[idxMstRacName] : '') || '';
      const mstRacContact = (idxMstRacContact !== -1 ? row[idxMstRacContact] : '') || '';

      newOutlets.push({
        outletId,
        storeName,
        city,
        mode,
        vendor,
        pocName,
        pocContact,
        coldPocName2: pocName,
        coldPocContact2: pocContact,
        amcCoverage,
        currentVendor,
        lodL1Name,
        lodL1Email,
        lodL1Contact,
        lodL2Name,
        lodL2Email,
        lodL2Contact,
        lodL3Name,
        lodL3Email,
        lodL3Contact,
        region,
        mstRacName,
        mstRacContact,
        syncedAt: formattedIST,
      });
    }

    if (newOutlets.length === 0) {
      throw new Error('No valid Outlet records found in Google Sheet data.');
    }

    // Update database cache
    db.outlets = newOutlets;
    db.syncStatus.status = 'Success';
    db.syncStatus.lastSyncTime = formattedIST;
    db.syncStatus.recordsCount = newOutlets.length;
    db.syncStatus.errorDetails = null;
    db.syncStatus.source = `Google Sheet (${tab || 'Default'})`;
    saveDb();

    return { success: true, count: newOutlets.length };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : 'Unknown synchronization error';
    db.syncStatus.status = 'Failed';
    db.syncStatus.errorDetails = errorMsg;
    saveDb();
    return { success: false, count: db.outlets.length, error: errorMsg };
  }
}

// Background auto sync timer
let syncTimer: NodeJS.Timeout | null = null;
function restartAutoSync() {
  if (syncTimer) clearInterval(syncTimer);
  const intervalMs = Math.max(1, db.config.syncIntervalMinutes || 5) * 60 * 1000;
  if (db.config.autoSyncEnabled) {
    syncTimer = setInterval(() => {
      console.log(`[Sync Service] Running scheduled Google Sheets sync (${db.config.syncIntervalMinutes}m interval)...`);
      syncGoogleSheetData().catch((e) => console.error('[Sync Service] Interval sync error:', e));
    }, intervalMs);
  }
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '50mb' }));
  app.use(express.urlencoded({ extended: true, limit: '50mb' }));

  // Gracefully catch PayloadTooLarge or malformed JSON errors
  app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (err && (err.type === 'entity.too.large' || err.status === 413)) {
      return res.status(413).json({
        error: 'Payload Too Large: The submitted data exceeds the allowed size limit (50MB).',
        details: 'Please reduce the number of records or split the upload into smaller batches.',
      });
    }
    if (err instanceof SyntaxError && 'body' in err) {
      return res.status(400).json({ error: 'Invalid JSON payload received.' });
    }
    next(err);
  });

  // Restart auto sync timer
  restartAutoSync();

  // --- API Routes ---

  // Health check
  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', time: new Date().toISOString() });
  });

  // --- Auth ---

  app.get('/api/auth/me', (req, res) => {
    res.json({
      authRequired: AUTH_REQUIRED,
      authenticated: !AUTH_REQUIRED || sessionIsValid(readCookie(req.headers.cookie, SESSION_COOKIE)),
    });
  });

  app.post('/api/auth/login', (req, res) => {
    if (!AUTH_REQUIRED) {
      return res.json({ authRequired: false, authenticated: true });
    }

    const ip = req.ip || 'unknown';
    if (loginThrottled(ip)) {
      return res.status(429).json({ error: 'Too many failed attempts. Try again in a few minutes.' });
    }

    const supplied = String(req.body?.password ?? '');
    const a = Buffer.from(supplied);
    const b = Buffer.from(APP_PASSWORD);
    const ok = a.length === b.length && crypto.timingSafeEqual(a, b);
    if (!ok) {
      recordFailedLogin(ip);
      return res.status(401).json({ error: 'Incorrect password.' });
    }

    loginAttempts.delete(ip);
    const expiresAt = Date.now() + SESSION_TTL_MS;
    const secure = req.headers['x-forwarded-proto'] === 'https';
    res.setHeader(
      'Set-Cookie',
      `${SESSION_COOKIE}=${encodeURIComponent(signSession(expiresAt))}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${Math.floor(
        SESSION_TTL_MS / 1000
      )}${secure ? '; Secure' : ''}`
    );
    res.json({ authRequired: true, authenticated: true });
  });

  app.post('/api/auth/logout', (req, res) => {
    res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`);
    res.json({ authRequired: AUTH_REQUIRED, authenticated: false });
  });

  // Everything below this line needs a session when APP_PASSWORD is set.
  app.use('/api', (req, res, next) => {
    if (!AUTH_REQUIRED) return next();
    if (sessionIsValid(readCookie(req.headers.cookie, SESSION_COOKIE))) return next();
    return res.status(401).json({ error: 'Not signed in.' });
  });

  // Outlets List & Search
  app.get('/api/outlets', (req, res) => {
    const q = ((req.query.q as string) || '').trim().toLowerCase();
    if (!q) {
      return res.json({ outlets: db.outlets });
    }
    const filtered = db.outlets.filter(
      (o) =>
        o.outletId.toLowerCase().includes(q) ||
        o.storeName.toLowerCase().includes(q) ||
        o.city.toLowerCase().includes(q) ||
        o.vendor.toLowerCase().includes(q)
    );
    res.json({ outlets: filtered });
  });

  // Fast Outlet ID Lookup
  app.get('/api/outlets/:outletId', (req, res) => {
    const outletId = (req.params.outletId || '').trim().toUpperCase();
    const found = db.outlets.find((o) => o.outletId.toUpperCase() === outletId);
    if (!found) {
      return res.status(404).json({ error: `Outlet ID "${outletId}" not found in synced master data.` });
    }
    res.json(found);
  });

  // Sync Status
  app.get('/api/sync/status', (req, res) => {
    res.json(db.syncStatus);
  });

  // Trigger Manual "Sync Now"
  app.post('/api/sync/now', async (req, res) => {
    const result = await syncGoogleSheetData();
    res.json({
      ...result,
      status: db.syncStatus,
    });
  });

  // Manual Outlet Seed / CSV / Google Sheet Paste upload
  app.post('/api/outlets/bulk-upload', (req, res) => {
    const { outlets } = req.body;
    if (!Array.isArray(outlets) || outlets.length === 0) {
      return res.status(400).json({ error: 'Provide an array of outlet objects' });
    }
    const { formattedIST } = getCurrentISTDate();
    const cleanOutlets: OutletMaster[] = outlets.map((o) => {
      const poc = String(o.pocName || o.coldPocName2 || '').trim();
      const contact = String(o.pocContact || o.coldPocContact2 || '').trim();
      return {
        outletId: String(o.outletId || '').trim().toUpperCase(),
        storeName: String(o.storeName || '').trim(),
        city: String(o.city || '').trim(),
        mode: String(o.mode || 'Dark Store').trim(),
        vendor: String(o.vendor || 'RAC').trim(),
        pocName: poc,
        pocContact: contact,
        coldPocName2: poc,
        coldPocContact2: contact,
        amcCoverage: String(o.amcCoverage || '').trim(),
        currentVendor: String(o.currentVendor || o.vendor || '').trim(),
        lodL1Name: String(o.lodL1Name || '').trim(),
        lodL1Email: String(o.lodL1Email || '').trim(),
        lodL1Contact: String(o.lodL1Contact || '').trim(),
        lodL2Name: String(o.lodL2Name || '').trim(),
        lodL2Email: String(o.lodL2Email || '').trim(),
        lodL2Contact: String(o.lodL2Contact || '').trim(),
        lodL3Name: String(o.lodL3Name || '').trim(),
        lodL3Email: String(o.lodL3Email || '').trim(),
        lodL3Contact: String(o.lodL3Contact || '').trim(),
        region: String(o.region || '').trim(),
        mstRacName: String(o.mstRacName || '').trim(),
        mstRacContact: String(o.mstRacContact || '').trim(),
        syncedAt: formattedIST,
      };
    });

    db.outlets = cleanOutlets;
    db.syncStatus.status = 'Success';
    db.syncStatus.lastSyncTime = formattedIST;
    db.syncStatus.recordsCount = cleanOutlets.length;
    db.syncStatus.errorDetails = null;
    db.syncStatus.source = 'Full Sheet Sync';
    saveDb();

    res.json({ success: true, count: cleanOutlets.length, status: db.syncStatus });
  });

  // Config endpoints
  app.get('/api/config', (req, res) => {
    res.json(db.config);
  });

  app.post('/api/config', (req, res) => {
    const updated = req.body;
    db.config = {
      ...db.config,
      ...updated,
      columnMapping: {
        ...db.config.columnMapping,
        ...(updated.columnMapping || {}),
      },
    };
    saveDb();
    restartAutoSync();
    res.json({ success: true, config: db.config });
  });

  // Disruptions - GET ALL
  app.get('/api/disruptions', (req, res) => {
    res.json({ disruptions: db.disruptions });
  });

  // Disruptions - CREATE NEW
  app.post('/api/disruptions', (req, res) => {
    const data = req.body;
    const { formattedIST } = getCurrentISTDate();

    // Mandatory validations
    if (!data.outletId || !data.outletId.trim()) {
      return res.status(400).json({ error: 'Outlet ID is mandatory.' });
    }
    if (!data.disruptionStartDate || !data.disruptionStartTime) {
      return res.status(400).json({ error: 'Disruption Start Date and Time are mandatory.' });
    }
    if (!data.ccPoc || !data.ccPoc.trim()) {
      return res.status(400).json({ error: 'CC POC is mandatory.' });
    }
    if (!data.bucket || !['False Alarm / Invalid', 'Non Breakdown', 'Breakdown'].includes(data.bucket)) {
      return res.status(400).json({ error: 'Valid Bucket selection is mandatory.' });
    }
    if (data.bucket === 'Breakdown' && (!data.ticketId || !data.ticketId.trim())) {
      return res.status(400).json({ error: 'Disruption Ticket ID is mandatory for Breakdown.' });
    }
    if (!data.currentStatus) {
      return res.status(400).json({ error: 'Current Status is mandatory.' });
    }

    const resolvedStatuses = ['Resolved by RAC', 'Resolved by OEM', 'Resolved by Dealer', 'Resolved by CC'];
    if (resolvedStatuses.includes(data.currentStatus)) {
      if (!data.issue || !data.issue.trim() || !data.subIssue || !data.subIssue.trim()) {
        return res.status(400).json({
          error: `Issue and Sub Issue are mandatory when status is "${data.currentStatus}".`,
        });
      }
    }

    if (!data.latestLiveUpdate || !data.latestLiveUpdate.trim()) {
      return res.status(400).json({ error: 'Live Update is mandatory.' });
    }

    // Resolve the outlet against the synced master. A typo must not become a
    // record with blank store/city/vendor that then shows up in the report.
    const requestedOutletId = data.outletId.trim().toUpperCase();
    const masterOutlet = db.outlets.find((o) => o.outletId.toUpperCase() === requestedOutletId);
    if (!masterOutlet) {
      return res.status(400).json({
        error: `Outlet ID "${requestedOutletId}" is not in the synced master data. Check the ID, or run Sync Now if the sheet was just updated.`,
      });
    }

    const frt = (value: unknown): number | undefined => {
      if (value === undefined || value === null || value === '') return undefined;
      const n = Number(value);
      return Number.isFinite(n) && n >= 0 ? n : undefined;
    };

    // Auto-generate Disruption ID: OutletID-YYMMDDHHMM
    let baseDisruptionId = data.disruptionId;
    if (!baseDisruptionId) {
      const cleanOutlet = data.outletId.trim().toUpperCase();
      const dateParts = data.disruptionStartDate.split('-'); // YYYY-MM-DD
      const yy = dateParts[0].slice(-2);
      const mm = (dateParts[1] || '01').padStart(2, '0');
      const dd = (dateParts[2] || '01').padStart(2, '0');
      const timeParts = data.disruptionStartTime.split(':');
      const hh = (timeParts[0] || '00').padStart(2, '0');
      const min = (timeParts[1] || '00').padStart(2, '0');
      baseDisruptionId = `${cleanOutlet}-${yy}${mm}${dd}${hh}${min}`;
    }

    // Same outlet in the same minute is the same incident: point the operator at
    // the existing record instead of creating a near-duplicate alongside it.
    const finalDisruptionId = baseDisruptionId;
    if (db.disruptions.some((d) => d.disruptionId === finalDisruptionId)) {
      return res.status(409).json({
        error: `Disruption ${finalDisruptionId} already exists for this outlet and start minute. Open that record and add a Live Update instead.`,
        existingId: finalDisruptionId,
      });
    }

    const initialHistoryEntry: DisruptionUpdateHistory = {
      updateId: `UPD-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      disruptionId: finalDisruptionId,
      updateText: data.latestLiveUpdate.trim(),
      updatedBy: data.createdBy || data.ccPoc || 'Operator',
      updatedAt: formattedIST,
      previousStatus: 'Initiated',
      newStatus: data.currentStatus,
    };

    const newDisruption: Disruption = {
      disruptionId: finalDisruptionId,
      outletId: masterOutlet.outletId,
      // Master data is the source of truth for everything outlet-derived.
      storeName: masterOutlet.storeName || '',
      city: masterOutlet.city || '',
      mode: masterOutlet.mode || '',
      vendor: masterOutlet.vendor || '',
      pocName: masterOutlet.pocName || '',
      pocContact: masterOutlet.pocContact || '',
      coldPocName2: masterOutlet.coldPocName2 || masterOutlet.pocName || '',
      coldPocContact2: masterOutlet.coldPocContact2 || masterOutlet.pocContact || '',
      amcCoverage: masterOutlet.amcCoverage || '',
      currentVendor: masterOutlet.currentVendor || masterOutlet.vendor || '',
      lodL1Name: masterOutlet.lodL1Name || '',
      lodL1Email: masterOutlet.lodL1Email || '',
      lodL1Contact: masterOutlet.lodL1Contact || '',
      lodL2Name: masterOutlet.lodL2Name || '',
      lodL2Email: masterOutlet.lodL2Email || '',
      lodL2Contact: masterOutlet.lodL2Contact || '',
      lodL3Name: masterOutlet.lodL3Name || '',
      lodL3Email: masterOutlet.lodL3Email || '',
      lodL3Contact: masterOutlet.lodL3Contact || '',
      region: masterOutlet.region || '',
      mstRacName: masterOutlet.mstRacName || '',
      mstRacContact: masterOutlet.mstRacContact || '',
      remark: data.remark || '',
      cityLead: data.cityLead || '',
      regionalHead: data.regionalHead || '',
      week: data.week || '',
      storeType: data.storeType || masterOutlet.mode || '',
      shift: data.shift || '',
      ticketMissing: data.ticketMissing || (data.ticketId ? 'No' : 'Yes'),
      parentTicketId: data.parentTicketId || data.ticketId || '',
      endTime: data.endTime || '',
      duration: data.duration || '',
      ticketClosedAt: data.ticketClosedAt || '',
      ccFrtMins: frt(data.ccFrtMins),
      mstFrtMins: frt(data.mstFrtMins),
      disruptionStartDateTime: data.disruptionStartDateTime || formattedIST,
      disruptionStartDate: data.disruptionStartDate,
      disruptionStartTime: data.disruptionStartTime,
      ccPoc: data.ccPoc,
      bucket: data.bucket,
      ticketId: data.ticketId ? data.ticketId.trim() : undefined,
      currentStatus: data.currentStatus,
      issue: data.issue ? data.issue.trim() : undefined,
      subIssue: data.subIssue ? data.subIssue.trim() : undefined,
      latestLiveUpdate: data.latestLiveUpdate.trim(),
      lastUpdatedBy: data.createdBy || data.ccPoc || 'Operator',
      lastUpdatedAt: formattedIST,
      createdBy: data.createdBy || data.ccPoc || 'Operator',
      createdAt: formattedIST,
      updatedAt: formattedIST,
      updateHistory: [initialHistoryEntry],
    };

    db.disruptions.unshift(newDisruption);
    saveDb();

    res.status(201).json({
      message: 'Disruption created successfully.',
      disruptionId: finalDisruptionId,
      disruption: newDisruption,
    });
  });

  // Disruptions - ADD LIVE UPDATE
  app.post('/api/disruptions/:id/updates', (req, res) => {
    const disruptionId = req.params.id;
    const { updateText, updatedBy, newStatus, issue, subIssue } = req.body;
    const { formattedIST } = getCurrentISTDate();

    if (!updateText || !updateText.trim()) {
      return res.status(400).json({ error: 'Update text is mandatory.' });
    }

    const disruption = db.disruptions.find((d) => d.disruptionId === disruptionId);
    if (!disruption) {
      return res.status(404).json({ error: 'Disruption not found.' });
    }

    const previousStatus = disruption.currentStatus;
    const targetStatus = newStatus || previousStatus;

    const resolvedStatuses = ['Resolved by RAC', 'Resolved by OEM', 'Resolved by Dealer', 'Resolved by CC'];
    if (resolvedStatuses.includes(targetStatus)) {
      if ((!issue || !issue.trim()) && !disruption.issue) {
        return res.status(400).json({ error: `Issue is required when setting status to "${targetStatus}".` });
      }
      if ((!subIssue || !subIssue.trim()) && !disruption.subIssue) {
        return res.status(400).json({ error: `Sub Issue is required when setting status to "${targetStatus}".` });
      }
    }

    const historyItem: DisruptionUpdateHistory = {
      updateId: `UPD-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      disruptionId: disruption.disruptionId,
      updateText: updateText.trim(),
      updatedBy: updatedBy || disruption.ccPoc || 'Operator',
      updatedAt: formattedIST,
      previousStatus,
      newStatus: targetStatus,
    };

    disruption.updateHistory.push(historyItem);
    disruption.latestLiveUpdate = updateText.trim();
    disruption.currentStatus = targetStatus;
    disruption.lastUpdatedBy = updatedBy || disruption.ccPoc || 'Operator';
    disruption.lastUpdatedAt = formattedIST;
    disruption.updatedAt = formattedIST;

    if (issue) disruption.issue = issue;
    if (subIssue) disruption.subIssue = subIssue;

    saveDb();

    res.json({
      message: 'Live update added successfully.',
      disruption,
      newUpdate: historyItem,
    });
  });

  // Disruptions - EDIT EXISTING UPDATE (Audit trail preserved)
  app.put('/api/disruptions/:id/updates/:updateId', (req, res) => {
    const { id: disruptionId, updateId } = req.params;
    const { editedText, editedBy } = req.body;
    const { formattedIST } = getCurrentISTDate();

    if (!editedText || !editedText.trim()) {
      return res.status(400).json({ error: 'Updated text cannot be empty.' });
    }

    const disruption = db.disruptions.find((d) => d.disruptionId === disruptionId);
    if (!disruption) {
      return res.status(404).json({ error: 'Disruption not found.' });
    }

    const historyEntry = disruption.updateHistory.find((u) => u.updateId === updateId);
    if (!historyEntry) {
      return res.status(404).json({ error: 'Update history item not found.' });
    }

    // Record original text for audit trail
    if (!historyEntry.originalText) {
      historyEntry.originalText = historyEntry.updateText;
    }
    historyEntry.updateText = editedText.trim();
    historyEntry.isEdited = true;
    historyEntry.editedBy = editedBy || 'Operator';
    historyEntry.editedAt = formattedIST;

    // If this was the latest update, update latestLiveUpdate on the record
    const lastHistory = disruption.updateHistory[disruption.updateHistory.length - 1];
    if (lastHistory && lastHistory.updateId === updateId) {
      disruption.latestLiveUpdate = editedText.trim();
    }
    disruption.lastUpdatedBy = editedBy || 'Operator';
    disruption.lastUpdatedAt = formattedIST;
    disruption.updatedAt = formattedIST;

    saveDb();

    res.json({
      message: 'Update modified successfully. Audit trail preserved.',
      disruption,
      updatedHistory: historyEntry,
    });
  });

  // Disruptions - EDIT GENERAL FIELDS
  app.put('/api/disruptions/:id', (req, res) => {
    const disruptionId = req.params.id;
    const updates = req.body;
    const { formattedIST } = getCurrentISTDate();

    const index = db.disruptions.findIndex((d) => d.disruptionId === disruptionId);
    if (index === -1) {
      return res.status(404).json({ error: 'Disruption not found.' });
    }

    const existing = db.disruptions[index];
    const previousStatus = existing.currentStatus;
    const targetStatus = updates.currentStatus || previousStatus;

    const resolvedStatuses = ['Resolved by RAC', 'Resolved by OEM', 'Resolved by Dealer', 'Resolved by CC'];
    if (resolvedStatuses.includes(targetStatus)) {
      if (!updates.issue && !existing.issue) {
        return res.status(400).json({ error: 'Issue is mandatory for resolved status.' });
      }
      if (!updates.subIssue && !existing.subIssue) {
        return res.status(400).json({ error: 'Sub Issue is mandatory for resolved status.' });
      }
    }

    if (updates.bucket === 'Breakdown' && !updates.ticketId && !existing.ticketId) {
      return res.status(400).json({ error: 'Disruption Ticket ID is mandatory for Breakdown.' });
    }

    // The Disruption ID is derived from outlet + start minute, so letting either
    // change here would leave the ID contradicting the record it names.
    const startChanged =
      (updates.disruptionStartDate !== undefined && updates.disruptionStartDate !== existing.disruptionStartDate) ||
      (updates.disruptionStartTime !== undefined && updates.disruptionStartTime !== existing.disruptionStartTime) ||
      (updates.outletId !== undefined &&
        String(updates.outletId).trim().toUpperCase() !== existing.outletId.toUpperCase());
    if (startChanged) {
      return res.status(400).json({
        error:
          'Outlet ID and disruption start time cannot be changed — the Disruption ID is generated from them. Create a new record instead.',
      });
    }

    const normaliseFrt = (next: unknown, current?: number): number | undefined => {
      if (next === undefined) return current;
      if (next === null || next === '') return undefined;
      const n = Number(next);
      return Number.isFinite(n) && n >= 0 ? n : current;
    };

    db.disruptions[index] = {
      ...existing,
      ...updates,
      ccFrtMins: normaliseFrt(updates.ccFrtMins, existing.ccFrtMins),
      mstFrtMins: normaliseFrt(updates.mstFrtMins, existing.mstFrtMins),
      updatedAt: formattedIST,
      lastUpdatedAt: formattedIST,
      lastUpdatedBy: updates.updatedBy || existing.lastUpdatedBy,
    };

    saveDb();
    res.json({ message: 'Disruption updated successfully.', disruption: db.disruptions[index] });
  });

  // LIVE DATA EXPORT & SYNC FOR GOOGLE SHEET "Live_data" TAB
  app.get('/api/export/live-data', (req, res) => {
    const format = (req.query.format as string) || 'json';

    const headers = [
      'Ticket Missing',
      'Disruption ID (Auto)',
      'Region (Auto)',
      'City (Auto)',
      'Store Name (Auto)',
      'Mode (Auto)',
      'Vendor (Auto)',
      'AMC Coverage',
      'Current Vendor (AMC or Warranty)',
      'POC Name (Auto)',
      'POC Contact No. (Auto)',
      'MST/RAC Name (Auto)',
      'MST/RAC contact no. (Auto)',
      'LOD - 2 L1 Name',
      'LOD - 2 L1 Email',
      'LOD - 2 L1 Contact No',
      'LOD - 2 L2 Name',
      'LOD - 2 L2 Email',
      'LOD - 2 L2 Contact No',
      'LOD - 2 L3 Name',
      'LOD - 2 L3 Email',
      'LOD - 2 L3 Contact No.',
      'CC POC',
      'Outlet ID',
      'Start time\n(Paste from Serviceabilty)',
      'Bucket',
      'Parent Ticket ID\n(Only If Machine Breakdown)',
      'Current Status',
      'Live updates',
      'Remark',
      'Issue Identified (Mandatory)',
      'Sub-issue Identified (Mandatory)',
      'End time (Auto)',
      'Duration (Auto)',
      'Ticket Closed At (Auto)',
      'City Lead',
      'Regional Head',
      'Week',
      'Store Type',
      'Shift',
    ];

    const rows = db.disruptions.map((d) => {
      const isMissing = !d.ticketId || d.ticketId.trim() === '' ? 'Yes' : 'No';
      return [
        d.ticketMissing || isMissing,
        d.disruptionId,
        d.region || '',
        d.city,
        d.storeName,
        d.mode,
        d.vendor,
        d.amcCoverage || '',
        d.currentVendor || d.vendor,
        d.coldPocName2 || d.pocName,
        d.coldPocContact2 || d.pocContact,
        d.mstRacName || '',
        d.mstRacContact || '',
        d.lodL1Name || '',
        d.lodL1Email || '',
        d.lodL1Contact || '',
        d.lodL2Name || '',
        d.lodL2Email || '',
        d.lodL2Contact || '',
        d.lodL3Name || '',
        d.lodL3Email || '',
        d.lodL3Contact || '',
        d.ccPoc,
        d.outletId,
        d.disruptionStartDateTime,
        d.bucket,
        d.parentTicketId || d.ticketId || '',
        d.currentStatus,
        d.latestLiveUpdate,
        d.remark || '',
        d.issue || '',
        d.subIssue || '',
        d.endTime || '',
        d.duration || '',
        d.ticketClosedAt || '',
        d.cityLead || '',
        d.regionalHead || '',
        d.week || '',
        d.storeType || d.mode,
        d.shift || '',
      ];
    });

    if (format === 'csv') {
      const csvContent =
        '\uFEFF' +
        [
          headers.map((h) => `"${h.replace(/"/g, '""')}"`).join(','),
          ...rows.map((r) => r.map((cell) => `"${String(cell || '').replace(/"/g, '""')}"`).join(',')),
        ].join('\r\n');

      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="Live_data.csv"');
      return res.send(csvContent);
    }

    if (format === 'tsv') {
      const tsvContent = [
        headers.map((h) => h.replace(/[\t\r\n]+/g, ' ')).join('\t'),
        ...rows.map((r) => r.map((cell) => String(cell || '').replace(/[\t\r\n]+/g, ' ')).join('\t')),
      ].join('\r\n');

      res.setHeader('Content-Type', 'text/tab-separated-values; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="Live_data.tsv"');
      return res.send(tsvContent);
    }

    res.json({
      tabName: 'Live_data',
      count: rows.length,
      headers,
      rows,
      data: db.disruptions,
    });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Disruption Management System server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
