import express from 'express';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { createServer as createViteServer } from 'vite';

// Types and Defaults
import {
  DEFAULT_CONFIG,
  DEFAULT_SHEET_SOURCES,
  INITIAL_OUTLETS,
  DEFAULT_CC_POCS,
  DEFAULT_ISSUE_MASTER,
} from './src/data/defaultConfig';
import {
  AppConfig,
  Disruption,
  DisruptionUpdateHistory,
  OutletMaster,
  SheetSourceConfig,
  SheetSourceKey,
  SHEET_SOURCE_KEYS,
  SHEET_SOURCE_LABELS,
  SyncStatus,
  SyncStatuses,
} from './src/types';
import { formatDateTimeIST, formatToIST, getCurrentISTDate, hoursBetween } from './src/utils/dateUtils';
import { deriveIssues, readIssues, readSubIssues } from './src/utils/issueTaxonomy';
import { formatHoursMinutes } from './src/utils/auditHold';
import { cumulativeLiveUpdate } from './src/utils/liveUpdateLog';
import { PostgresStore } from './src/server/postgresStore';
import {
  CURRENT_STATUS_OPTIONS,
  isAuditStatus,
  PROTECTED_STATUSES,
  RESOLVED_BY_FOR_STATUS,
  STATUS_REQUIRING_RAC_FRT,
  STEP_STAMP_FIELDS,
} from './src/types';

/**
 * Keeps `auditStartedAt` in step with the status: stamped when a record goes on
 * audit hold, left alone while it stays there, cleared when it comes off.
 */
function auditStampFor(
  previousStatus: string,
  nextStatus: string,
  existingStamp: string | undefined,
  nowIST: string
): string | undefined {
  if (!isAuditStatus(nextStatus)) return undefined;
  if (isAuditStatus(previousStatus) && existingStamp) return existingStamp;
  return nowIST;
}

// Hosting platforms inject the port; 3000 stays the local default.
const PORT = Number(process.env.PORT ?? 3000);
// In the cluster the pod has to accept traffic from the Service, so 0.0.0.0 is
// the deployed default. Set HOST=127.0.0.1 to keep a local run off the network.
const HOST = process.env.HOST ?? '0.0.0.0';
// DATA_DIR is overridable so the JSON store can live on a mounted volume.
const DATA_DIR = process.env.DATA_DIR ?? path.join(process.cwd(), 'data');
const DB_FILE = path.join(DATA_DIR, 'store.json');
// Set DATABASE_URL to make Postgres the system of record. Unset, the JSON file
// on the volume is all there is, which is how a local run works.
//
// DATABASE_URL_FILE is the deployed form. The password is generated inside the
// cluster by an init container and written to the database volume, so it never
// exists in this repository, in a tool call, or in anyone's shell history - and
// an env var cannot be sourced from a file, hence the second variable.
function resolveDatabaseUrl(): string {
  const direct = (process.env.DATABASE_URL ?? '').trim();
  if (direct) return direct;

  const file = (process.env.DATABASE_URL_FILE ?? '').trim();
  if (!file) return '';
  try {
    return fs.readFileSync(file, 'utf-8').trim();
  } catch (err) {
    // Not fatal: the app falls back to the JSON file and says so on /api/health,
    // which beats refusing to start because a sidecar is a few seconds behind.
    console.error(`[Store] Could not read DATABASE_URL_FILE (${file}):`, err);
    return '';
  }
}

const DATABASE_URL = resolveDatabaseUrl();

// --- Access control -------------------------------------------------------
// Sign-in is always on: the console needs an identity so it can stamp the CC
// POC, the audit trail and the owner-only controls. Only work addresses are
// accepted. APP_PASSWORD, when set, adds a shared secret on top of the address.
const ALLOWED_EMAIL_DOMAINS = (process.env.ALLOWED_EMAIL_DOMAINS ?? 'zomato.com,grofers.com')
  .split(',')
  .map((d) => d.trim().toLowerCase())
  .filter(Boolean);

// Owners hold the admin rights: editing the issue master and deleting entries.
const OWNER_EMAILS = (process.env.OWNER_EMAILS ?? 'kumarbrijesh@grofers.com')
  .split(',')
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);

/**
 * The shared sign-in password.
 *
 * APP_PASSWORD_FILE is the deployed form, for the same reason DATABASE_URL_FILE
 * is: the value is generated inside the cluster and written to a volume, so it
 * never exists in this repository, in a manifest, or in anyone's shell history.
 * APP_PASSWORD still works for a local run.
 *
 * Unset, the console accepts any address on an allowed domain with no password
 * at all, which is why a missing file is worth a loud line in the log.
 */
function resolveAppPassword(): string {
  const direct = (process.env.APP_PASSWORD ?? '').trim();
  if (direct) return direct;

  const file = (process.env.APP_PASSWORD_FILE ?? '').trim();
  if (!file) return '';
  try {
    return fs.readFileSync(file, 'utf-8').trim();
  } catch (err) {
    console.error(`[Auth] Could not read APP_PASSWORD_FILE (${file}):`, err);
    return '';
  }
}

const APP_PASSWORD = resolveAppPassword();
const PASSWORD_REQUIRED = APP_PASSWORD.length > 0;
if (!PASSWORD_REQUIRED) {
  console.warn(
    '[Auth] No password is set - any address on an allowed domain can sign in.'
  );
}
const SESSION_COOKIE = 'dms_session';
/**
 * The platform edge strips the Cookie header before a request reaches this
 * container, so the cookie alone can never carry a session here. The same
 * signed token is accepted from this header, which the edge forwards intact.
 */
const SESSION_HEADER = 'x-dms-session';
const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // one shift

/**
 * Signing key for session cookies. Generated once and kept on the data volume
 * so a pod restart does not sign everyone out.
 */
const SESSION_SECRET = (() => {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  const secretFile = path.join(DATA_DIR, '.session-secret');
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    if (fs.existsSync(secretFile)) return fs.readFileSync(secretFile, 'utf-8').trim();
    const generated = crypto.randomBytes(32).toString('hex');
    fs.writeFileSync(secretFile, generated, { encoding: 'utf-8', mode: 0o600 });
    return generated;
  } catch {
    // Read-only volume: fall back to a per-process key. Sessions then end with
    // the process, which is inconvenient but never insecure.
    return crypto.randomBytes(32).toString('hex');
  }
})();

export type UserRole = 'owner' | 'member';

export interface SessionUser {
  email: string;
  name: string;
  contact: string;
  role: UserRole;
}

/** Keeps sign-in logs readable without writing whole addresses to the log. */
function maskEmail(email: string): string {
  const at = email.lastIndexOf('@');
  if (at < 1) return '***';
  return `${email.slice(0, 2)}***${email.slice(at)}`;
}

function isAllowedEmail(email: string): boolean {
  const at = email.lastIndexOf('@');
  if (at < 1) return false;
  return ALLOWED_EMAIL_DOMAINS.includes(email.slice(at + 1).toLowerCase());
}

function roleFor(email: string): UserRole {
  return OWNER_EMAILS.includes(email.toLowerCase()) ? 'owner' : 'member';
}

/** Turns kumarbrijesh@grofers.com into "Kumarbrijesh" as a first-run display name. */
function nameFromEmail(email: string): string {
  const local = email.slice(0, email.lastIndexOf('@'));
  return local
    .split(/[._-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function signSession(email: string, expiresAt: number): string {
  const payload = `${Buffer.from(email, 'utf-8').toString('base64url')}.${expiresAt}`;
  const mac = crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('hex');
  return `${payload}.${mac}`;
}

/** Returns the email the token was signed for, or null when it is not usable. */
function readSession(token: string | undefined): string | null {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [encodedEmail, expiry, mac] = parts;
  const payload = `${encodedEmail}.${expiry}`;
  const expected = crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('hex');
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  const expiresAt = Number(expiry);
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) return null;
  const email = Buffer.from(encodedEmail, 'base64url').toString('utf-8').toLowerCase();
  return isAllowedEmail(email) ? email : null;
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

/**
 * Throttle key. Behind the platform ingress every request shares one client
 * address, so keying on the address alone would let a single mistyped sign-in
 * lock out the whole team. The address the person is trying is part of the key.
 */
function loginKey(ip: string, email: string): string {
  return `${ip}|${email}`;
}

function loginThrottled(key: string): boolean {
  const entry = loginAttempts.get(key);
  if (!entry) return false;
  if (Date.now() - entry.firstAt > LOGIN_WINDOW_MS) {
    loginAttempts.delete(key);
    return false;
  }
  return entry.count >= LOGIN_MAX_ATTEMPTS;
}

function recordFailedLogin(key: string): void {
  const entry = loginAttempts.get(key);
  if (!entry || Date.now() - entry.firstAt > LOGIN_WINDOW_MS) {
    loginAttempts.set(key, { count: 1, firstAt: Date.now() });
  } else {
    entry.count++;
  }
}

interface StoredUser {
  email: string;
  name: string;
  contact: string;
  firstSeenAt: string;
  lastSeenAt: string;
}

interface DatabaseStore {
  users: StoredUser[];
  outlets: OutletMaster[];
  disruptions: Disruption[];
  config: AppConfig;
  /** One status per feed. A failure on one feed never masks the other two. */
  syncStatuses: SyncStatuses;
}

/** A feed that has never run. */
function idleSyncStatus(): SyncStatus {
  return {
    lastSyncTime: null,
    lastAttemptedTime: null,
    status: 'Idle',
    recordsCount: 0,
    errorDetails: null,
    source: 'Not configured yet',
  };
}

/**
 * Fills in anything a stored config predates, so a file written before the
 * feeds were split still loads. The legacy single-sheet fields become the
 * store-master feed.
 */
function migrateConfig(stored: Partial<AppConfig>): AppConfig {
  const merged: AppConfig = {
    ...DEFAULT_CONFIG,
    ...stored,
    columnMapping: { ...DEFAULT_CONFIG.columnMapping, ...(stored.columnMapping || {}) },
    sources: { ...DEFAULT_SHEET_SOURCES, ...(stored.sources || {}) },
  };

  for (const key of SHEET_SOURCE_KEYS) {
    merged.sources[key] = { ...DEFAULT_SHEET_SOURCES[key], ...(merged.sources[key] || {}) };
  }

  // Pre-split configs only ever had the store-master sheet.
  if (!merged.sources.outletMaster.url && stored.googleSheetUrl) {
    merged.sources.outletMaster.url = stored.googleSheetUrl;
    merged.sources.outletMaster.tabName = stored.sheetTabName || DEFAULT_SHEET_SOURCES.outletMaster.tabName;
  }

  // Keep the legacy pair pointing at the store master so older clients agree.
  merged.googleSheetUrl = merged.sources.outletMaster.url;
  merged.sheetTabName = merged.sources.outletMaster.tabName;

  // The status list is admin-editable, so normalise whatever was stored: drop
  // blanks and duplicates, and re-add any protected status that went missing,
  // since the audit reminder and the active/closed split match on those exact
  // words and would otherwise go quiet.
  const statusList = (merged.statusOptions ?? []).map((v) => String(v).trim()).filter(Boolean);
  const deduped = Array.from(new Set(statusList.length > 0 ? statusList : CURRENT_STATUS_OPTIONS));
  for (const required of PROTECTED_STATUSES) {
    if (!deduped.includes(required)) deduped.push(required);
  }
  merged.statusOptions = deduped;

  return merged;
}

// Ensure data folder exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// Initial DB state.
//
// Disruptions start empty: they are operational records, and seeding sample
// incidents means a store that never lost power shows up in the tracker and in
// reports. A deleted record also used to come back here whenever the volume was
// replaced, because the seed was written in as if it were real.
//
// Outlets are seeded because they are a lookup master, not a record of events:
// a sync or a CSV upload replaces the whole list, and without something in it
// no disruption can be logged at all.
let db: DatabaseStore = {
  users: [],
  outlets: [...INITIAL_OUTLETS],
  disruptions: [],
  config: migrateConfig(DEFAULT_CONFIG),
  syncStatuses: {
    outletMaster: {
      lastSyncTime: null,
      lastAttemptedTime: null,
      status: 'Idle',
      recordsCount: INITIAL_OUTLETS.length,
      errorDetails: 'Running on the seeded store master. Sync or upload the real one.',
      source: 'Seed Master Dataset',
    },
    disruptionTimings: idleSyncStatus(),
    tickets: idleSyncStatus(),
  },
};

// Load DB from file if exists
try {
  if (fs.existsSync(DB_FILE)) {
    const fileContent = fs.readFileSync(DB_FILE, 'utf-8');
    const parsed = JSON.parse(fileContent);
    if (parsed.users) db.users = parsed.users;
    if (parsed.outlets) db.outlets = parsed.outlets;
    if (parsed.disruptions) db.disruptions = parsed.disruptions;
    if (parsed.config) {
      if (!parsed.config.sheetTabName || parsed.config.sheetTabName === 'Master_Data') {
        parsed.config.sheetTabName = 'Live_data';
      }
      db.config = migrateConfig(parsed.config);
    }
    if (parsed.syncStatuses) {
      db.syncStatuses = { ...db.syncStatuses, ...parsed.syncStatuses };
    } else if (parsed.syncStatus) {
      // Before the split there was one status, and it described the store master.
      db.syncStatuses.outletMaster = parsed.syncStatus;
    }
  } else {
    fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), 'utf-8');
  }
} catch (err) {
  // A damaged store.json would otherwise drop us to seed data, and the next
  // save would write that over the real records. The backup is one save behind,
  // which loses far less than starting from seeds.
  console.error('Failed to load DB file:', err);
  try {
    const backup = path.join(DATA_DIR, 'store.json.bak');
    if (fs.existsSync(backup)) {
      const parsed = JSON.parse(fs.readFileSync(backup, 'utf-8'));
      if (parsed.users) db.users = parsed.users;
      if (parsed.outlets) db.outlets = parsed.outlets;
      if (parsed.disruptions) db.disruptions = parsed.disruptions;
      if (parsed.config) db.config = migrateConfig(parsed.config);
      if (parsed.syncStatuses) db.syncStatuses = { ...db.syncStatuses, ...parsed.syncStatuses };
      console.warn(
        `[Store] Recovered from store.json.bak — ${db.disruptions.length} disruptions, ${db.outlets.length} outlets.`
      );
    } else {
      console.error('[Store] No backup to recover from; starting from seed data.');
    }
  } catch (backupErr) {
    console.error('[Store] Backup is unreadable too; starting from seed data:', backupErr);
  }
}

const DB_TMP_FILE = `${DB_FILE}.tmp`;
const DB_BACKUP_FILE = `${DB_FILE}.bak`;

/**
 * Persists the store.
 *
 * Writing straight over store.json is not safe here: the whole file is
 * rewritten on every save, and the platform restarts this pod several times a
 * day, so a save can be cut in half. A truncated file makes the next boot fall
 * back to the seed data and then write that over the real records. Writing to a
 * temp file and renaming makes the swap atomic - a reader sees either the old
 * file or the new one, never a half-written one - and the previous copy is kept
 * alongside as a last resort.
 */
/**
 * Fills in the timing fields for records saved before they existed.
 *
 * Their step stamps were never taken, so OEM's first response genuinely cannot
 * be recovered and stays blank. Resolution TAT can be: a closed record's end
 * time is the moment the store came back, which is the resolution moment, so it
 * stands in for the stamp that was never written. Runs once at boot and only
 * touches records missing the field.
 */
function backfillDerivedTimings(): number {
  let touched = 0;
  for (const record of db.disruptions) {
    const party = RESOLVED_BY_FOR_STATUS[record.currentStatus];
    if (party) {
      if (!record.resolvedBy) record.resolvedBy = party;
      if (!record.resolvedAt && record.endTime) record.resolvedAt = record.endTime;
    }
    const before = record.resolutionTatHours;
    recomputeDerivedTimings(record);
    if (record.resolutionTatHours !== before) touched++;
  }
  return touched;
}

/**
 * Postgres, once DATABASE_URL is set. Null on a local run, and null until the
 * connection is up, so every write path has to tolerate its absence.
 */
let pgStore: PostgresStore | null = null;

/** How long to wait between attempts at the *first* connection. */
const ATTACH_RETRY_MIN_MS = 3_000;
const ATTACH_RETRY_MAX_MS = 60_000;

function saveDb() {
  try {
    const json = JSON.stringify(db, null, 2);
    fs.writeFileSync(DB_TMP_FILE, json, 'utf-8');
    if (fs.existsSync(DB_FILE)) {
      fs.copyFileSync(DB_FILE, DB_BACKUP_FILE);
    }
    fs.renameSync(DB_TMP_FILE, DB_FILE);
  } catch (err) {
    console.error('Error persisting database to disk:', err);
  }
  // The file write above stays even with Postgres configured. It costs a few
  // milliseconds and it is what lets the pod keep serving, and keep its data,
  // through a database outage.
  pgStore?.markDirty();
}

/**
 * Brings Postgres up and decides which copy of the data wins.
 *
 * The file has already been read into `db` by this point. If Postgres has rows
 * it is normally the newer of the two, but a flush lost to a crash can leave it
 * one write behind, so whichever side holds more disruptions is taken. That
 * rule is deliberately crude: it cannot silently discard records, which is the
 * only failure here that would not be recoverable.
 *
 * Returns whether Postgres is now attached. A false is not fatal - the caller
 * keeps retrying in the background while the console serves off the file.
 */
async function attachPostgres(): Promise<boolean> {
  const store = new PostgresStore(DATABASE_URL);
  try {
    await store.init();
    const remote = await store.read();

    if (!remote) {
      console.log(
        `[Store] Postgres is empty - seeding it from the file (${db.disruptions.length} disruptions, ${db.outlets.length} outlets).`
      );
      await store.write(db);
    } else {
      const remoteCount = remote.disruptions?.length ?? 0;
      const localCount = db.disruptions.length;
      if (remoteCount >= localCount) {
        if (remote.users) db.users = remote.users as typeof db.users;
        if (remote.outlets) db.outlets = remote.outlets;
        if (remote.disruptions) db.disruptions = remote.disruptions;
        if (remote.config) db.config = migrateConfig(remote.config);
        if (remote.syncStatuses) db.syncStatuses = { ...db.syncStatuses, ...remote.syncStatuses };
        console.log(`[Store] Loaded ${remoteCount} disruptions from Postgres.`);
      } else {
        console.warn(
          `[Store] File has ${localCount} disruptions against Postgres' ${remoteCount} - keeping the file and rewriting Postgres from it.`
        );
        await store.write(db);
      }
    }

    store.attach(() => db);
    pgStore = store;
    console.log('[Store] Postgres is the system of record; the JSON file is the local fallback.');
    return true;
  } catch (err) {
    // Starting without the database is better than not starting: the volume
    // still holds every record and the pod stays usable.
    console.error(
      '[Store] Could not reach Postgres, carrying on with the JSON file only:',
      err instanceof Error ? err.message : err
    );
    await store.close().catch(() => undefined);
    return false;
  }
}

/**
 * Attaches Postgres, and keeps trying if it is not up yet.
 *
 * Deployed, the database is a sidecar in this same pod, so the two start
 * together and a first boot has to run initdb - the app reliably wins that race
 * and finds nothing listening. Without a retry the pod would then serve off the
 * JSON file until somebody noticed and restarted it, which is the failure this
 * whole change was meant to remove.
 *
 * The first attempt is awaited so that a database which is already up is the
 * system of record before the first request is served. Later attempts run in
 * the background.
 */
async function initPersistence(): Promise<void> {
  if (!DATABASE_URL) {
    console.log(
      '[Store] No DATABASE_URL/DATABASE_URL_FILE - using the JSON file on the volume.'
    );
    return;
  }

  if (await attachPostgres()) return;

  let delayMs = ATTACH_RETRY_MIN_MS;
  const retry = () => {
    const timer = setTimeout(() => {
      void attachPostgres().then((attached) => {
        if (attached) return;
        delayMs = Math.min(delayMs * 2, ATTACH_RETRY_MAX_MS);
        retry();
      });
    }, delayMs);
    // A pending retry must never be what keeps the process alive.
    timer.unref?.();
    console.warn(`[Store] Retrying the Postgres connection in ${Math.round(delayMs / 1000)}s.`);
  };
  retry();
}

{
  const touched = backfillDerivedTimings();
  if (touched > 0) {
    console.log(`[Store] Backfilled resolution TAT on ${touched} existing record(s).`);
    saveDb();
  }
}

// --- User directory -------------------------------------------------------
// One record per work address that has signed in. The display name starts off
// derived from the address and can be corrected by the person it belongs to.

function findStoredUser(email: string): StoredUser | undefined {
  return db.users.find((u) => u.email === email.toLowerCase());
}

/** Looks the address up, creating the record on first sign-in. */
function upsertUser(email: string): StoredUser {
  const normalised = email.toLowerCase();
  const { formattedIST } = getCurrentISTDate();
  let user = findStoredUser(normalised);
  if (!user) {
    user = {
      email: normalised,
      name: nameFromEmail(normalised),
      contact: '',
      firstSeenAt: formattedIST,
      lastSeenAt: formattedIST,
    };
    db.users.push(user);
  } else {
    user.lastSeenAt = formattedIST;
  }
  saveDb();
  return user;
}

function toSessionUser(user: StoredUser): SessionUser {
  return { email: user.email, name: user.name, contact: user.contact, role: roleFor(user.email) };
}

/** The session token a request carries, from the header first, then the cookie. */
function sessionTokenFromRequest(req: express.Request): string | undefined {
  const header = req.headers[SESSION_HEADER];
  const fromHeader = Array.isArray(header) ? header[0] : header;
  if (fromHeader) return fromHeader;
  return readCookie(req.headers.cookie, SESSION_COOKIE);
}

/** The signed-in user for a request, or null when the token is missing or stale. */
function userFromRequest(req: express.Request): SessionUser | null {
  const email = readSession(sessionTokenFromRequest(req));
  if (!email) return null;
  const stored = findStoredUser(email);
  return toSessionUser(
    stored ?? { email, name: nameFromEmail(email), contact: '', firstSeenAt: '', lastSeenAt: '' }
  );
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

/**
 * Pulls a sheet down as CSV, trying each candidate export URL in turn.
 * Returns the text, or an error describing why none of them worked.
 */
async function fetchSheetCsv(url: string, tabName: string): Promise<{ csvText: string; error: string }> {
  const candidateUrls = getGoogleSheetCandidateCsvUrls(url, tabName);
  let lastFetchError = 'No candidate URL could be derived from the sheet link.';

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
        // A login page comes back with HTTP 200, so sniff the body too.
        if (
          text &&
          !text.includes('<!DOCTYPE html>') &&
          !text.includes('<html') &&
          !text.includes('google.com/ServiceLogin')
        ) {
          return { csvText: text, error: '' };
        }
        lastFetchError = 'Google Sheet returned a login/HTML page. Permissions required.';
      } else {
        lastFetchError = `HTTP ${response.status}: ${response.statusText}`;
      }
    } catch (e: unknown) {
      lastFetchError = e instanceof Error ? e.message : 'Network timeout/failure';
    }
  }

  return { csvText: '', error: lastFetchError };
}

/**
 * Builds a column locator over a header row. Matching is lenient — exact first,
 * then aliases, then a loose contains — because these sheets are hand-maintained
 * and header wording drifts.
 */
function makeHeaderIndexer(headerCells: string[]): (configured: string, aliases: string[]) => number {
  const cleanHeaders = headerCells.map((h) => h.toLowerCase().replace(/[^a-z0-9]/g, ''));

  return (configured: string, aliases: string[]): number => {
    const targetClean = (configured || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    if (targetClean) {
      const exactIdx = cleanHeaders.indexOf(targetClean);
      if (exactIdx !== -1) return exactIdx;
    }
    for (const alias of aliases) {
      const aliasClean = alias.toLowerCase().replace(/[^a-z0-9]/g, '');
      const idx = cleanHeaders.indexOf(aliasClean);
      if (idx !== -1) return idx;
    }
    for (const alias of aliases) {
      const aliasClean = alias.toLowerCase().replace(/[^a-z0-9]/g, '');
      if (aliasClean.length < 3) continue;
      const idx = cleanHeaders.findIndex((h) => h.includes(aliasClean) || aliasClean.includes(h));
      if (idx !== -1) return idx;
    }
    return -1;
  };
}

/** Splits CSV text into a header row and data rows, or throws if unusable. */
function parseCsvTable(csvText: string): { headers: string[]; rows: string[][] } {
  const lines = csvText.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) {
    throw new Error('Sheet appears empty or has no data rows.');
  }
  return {
    headers: parseCsvLine(lines[0]),
    rows: lines.slice(1).map(parseCsvLine),
  };
}

/** A ticket state string that means the ticket is done. */
function isClosedTicketState(state: string): boolean {
  const s = state.trim().toLowerCase();
  if (!s) return false;
  return ['closed', 'resolved', 'completed', 'complete', 'done', 'cancelled', 'canceled'].some((w) =>
    s.includes(w)
  );
}

// --- Feed 1: store master -------------------------------------------------
// Store name, city, mode, vendor, AMC and POC details against each outlet ID.
async function syncOutletMaster(): Promise<{ success: boolean; count: number; error?: string }> {
  const { formattedIST } = getCurrentISTDate();
  const status = db.syncStatuses.outletMaster;
  status.lastAttemptedTime = formattedIST;
  status.status = 'Syncing';
  status.errorDetails = null;

  const source = db.config.sources.outletMaster;
  const url = source.url;
  const tab = source.tabName;

  if (!url || !url.trim()) {
    // Nothing to pull from yet — keep serving whatever master is already cached.
    status.status = 'Success';
    status.recordsCount = db.outlets.length;
    status.lastSyncTime = formattedIST;
    status.errorDetails =
      'Running on the cached store master. Add the Store Master sheet link in Settings for live sync.';
    status.source = 'Internal Cached Master Dataset';
    saveDb();
    return { success: true, count: db.outlets.length };
  }

  const { csvText, error: fetchError } = await fetchSheetCsv(url, tab);

  try {
    if (!csvText) {
      throw new Error(
        `Store Master sync failed (${fetchError}). Set the sheet link to "Anyone with the link can view", or upload the CSV instead.`
      );
    }

    const count = applyOutletRows(parseCsvTable(csvText));
    status.status = 'Success';
    status.lastSyncTime = formattedIST;
    status.recordsCount = count;
    status.errorDetails = null;
    status.source = `Google Sheet (${tab || 'Default'})`;
    saveDb();

    return { success: true, count };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : 'Unknown synchronization error';
    status.status = 'Failed';
    status.errorDetails = errorMsg;
    saveDb();
    return { success: false, count: db.outlets.length, error: errorMsg };
  }
}

/**
 * Re-derives every timing that can be worked out from the record's own
 * timestamps. Called after any status change, so the figures cannot drift from
 * the steps the record actually went through.
 *
 * Only OEM's first response is derived this way - RAC's is typed in, because
 * the technician's arrival is not a moment the app ever sees. Resolution TAT
 * runs from the disruption starting, not from the vendor being aligned, since
 * that is the number the store actually felt.
 */
function recomputeDerivedTimings(record: Disruption): void {
  const oemFrt = hoursBetween(record.oemAlignedAt, record.oemVisitedAt);
  record.oemFrtHours = oemFrt === null ? undefined : Number(oemFrt.toFixed(2));

  const tat = hoursBetween(record.disruptionStartDateTime, record.resolvedAt);
  record.resolutionTatHours = tat === null ? undefined : Number(tat.toFixed(2));
}

/** Looks a disruption up by ID, ignoring case and stray spaces. */
function findDisruptionById(rawId: string): Disruption | undefined {
  const wanted = rawId.trim().toUpperCase();
  if (!wanted) return undefined;
  return db.disruptions.find((d) => d.disruptionId.trim().toUpperCase() === wanted);
}

/**
 * Applies an end time to a record and recomputes the duration from its own
 * start. The sheet only ever supplies the end; the start is ours.
 */
function applyEndTime(record: Disruption, endTime: string): boolean {
  const cleanEnd = endTime.trim();
  if (!cleanEnd) return false;
  if (record.endTime === cleanEnd) return false;

  record.endTime = cleanEnd;
  const hours = hoursBetween(record.disruptionStartDateTime, cleanEnd);
  record.duration = hours === null ? '' : formatHoursMinutes(hours);
  return true;
}

// --- Feed 2: disruption timings -------------------------------------------
// End time against each Disruption ID. Duration is derived, never read in.
async function syncDisruptionTimings(): Promise<{ success: boolean; count: number; error?: string }> {
  const { formattedIST } = getCurrentISTDate();
  const status = db.syncStatuses.disruptionTimings;
  const source = db.config.sources.disruptionTimings;

  if (!source.url || !source.url.trim()) {
    // Nothing to pull from. Whatever a paste-in last applied stays reported.
    status.lastAttemptedTime = formattedIST;
    if (!status.lastSyncTime) {
      status.status = 'Idle';
      status.source = 'Not configured yet';
    }
    status.errorDetails =
      'No Disruption Timings sheet linked yet. Add one in Settings, or paste the rows in with Upload.';
    saveDb();
    return { success: true, count: 0 };
  }

  status.lastAttemptedTime = formattedIST;
  status.status = 'Syncing';
  status.errorDetails = null;

  const { csvText, error: fetchError } = await fetchSheetCsv(source.url, source.tabName);

  try {
    if (!csvText) {
      throw new Error(
        `Disruption Timings sync failed (${fetchError}). Set the sheet link to "Anyone with the link can view", or paste the rows in with Upload.`
      );
    }
    const count = applyDisruptionTimingRows(parseCsvTable(csvText));
    status.status = 'Success';
    status.lastSyncTime = formattedIST;
    status.recordsCount = count;
    status.errorDetails = null;
    status.source = `Google Sheet (${source.tabName || 'Default'})`;
    saveDb();
    return { success: true, count };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : 'Unknown synchronization error';
    status.status = 'Failed';
    status.errorDetails = errorMsg;
    saveDb();
    return { success: false, count: 0, error: errorMsg };
  }
}

/**
 * Shared by the sheet pull and the CSV upload. Replaces the whole store
 * master and returns the number of outlets applied.
 *
 * The column matching lives here rather than in either caller so an uploaded
 * CSV and a pulled sheet are read by exactly one parser, and the documented
 * column spec cannot drift from one of the two paths.
 */
function applyOutletRows({ headers, rows }: { headers: string[]; rows: string[][] }): number {
  const { formattedIST } = getCurrentISTDate();
  const mapping = db.config.columnMapping;
  const findIndex = makeHeaderIndexer(headers);

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
    throw new Error(`Outlet ID column (e.g. "outlet_id" / "${mapping.outletId}") not found in the Store Master header row.`);
  }

  const newOutlets: OutletMaster[] = [];
  const seenIds = new Set<string>();

  for (const row of rows) {
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
    throw new Error('No valid outlet records found. Check that the Outlet ID column is filled in.');
  }

  // Update database cache
  db.outlets = newOutlets;
  return newOutlets.length;
}
/** Shared by the sheet pull and the pasted-CSV upload. Returns rows applied. */
function applyDisruptionTimingRows({ headers, rows }: { headers: string[]; rows: string[][] }): number {
  const findIndex = makeHeaderIndexer(headers);
  const idxId = findIndex('disruption id', ['disruption id', 'disruption_id', 'disruptionid', 'id']);
  const idxEnd = findIndex('end time', [
    'end time',
    'end_time',
    'endtime',
    'disruption end time',
    'resolution time',
    'closure time',
    'resolved at',
  ]);

  if (idxId === -1) {
    throw new Error('Disruption ID column not found in the Disruption Timings sheet headers.');
  }
  if (idxEnd === -1) {
    throw new Error('End Time column not found in the Disruption Timings sheet headers.');
  }

  let applied = 0;
  for (const row of rows) {
    const record = findDisruptionById(row[idxId] || '');
    if (!record) continue;
    if (applyEndTime(record, row[idxEnd] || '')) applied++;
  }
  return applied;
}

// --- Feed 3: ticket status -------------------------------------------------
// Ticket ID, state and closure time. A closed ticket is frozen from then on.
async function syncTickets(): Promise<{ success: boolean; count: number; error?: string }> {
  const { formattedIST } = getCurrentISTDate();
  const status = db.syncStatuses.tickets;
  const source = db.config.sources.tickets;

  if (!source.url || !source.url.trim()) {
    // Nothing to pull from. Whatever a paste-in last applied stays reported.
    status.lastAttemptedTime = formattedIST;
    if (!status.lastSyncTime) {
      status.status = 'Idle';
      status.source = 'Not configured yet';
    }
    status.errorDetails =
      'No Ticket Status sheet linked yet. Add one in Settings, or paste the rows in with Upload.';
    saveDb();
    return { success: true, count: 0 };
  }

  status.lastAttemptedTime = formattedIST;
  status.status = 'Syncing';
  status.errorDetails = null;

  const { csvText, error: fetchError } = await fetchSheetCsv(source.url, source.tabName);

  try {
    if (!csvText) {
      throw new Error(
        `Ticket Status sync failed (${fetchError}). Set the sheet link to "Anyone with the link can view", or paste the rows in with Upload.`
      );
    }
    const count = applyTicketRows(parseCsvTable(csvText));
    status.status = 'Success';
    status.lastSyncTime = formattedIST;
    status.recordsCount = count;
    status.errorDetails = null;
    status.source = `Google Sheet (${source.tabName || 'Default'})`;
    saveDb();
    return { success: true, count };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : 'Unknown synchronization error';
    status.status = 'Failed';
    status.errorDetails = errorMsg;
    saveDb();
    return { success: false, count: 0, error: errorMsg };
  }
}

/** Shared by the sheet pull and the pasted-CSV upload. Returns rows applied. */
function applyTicketRows({ headers, rows }: { headers: string[]; rows: string[][] }): number {
  const { formattedIST } = getCurrentISTDate();
  const findIndex = makeHeaderIndexer(headers);
  const idxId = findIndex('disruption id', ['disruption id', 'disruption_id', 'disruptionid', 'id']);
  const idxTicket = findIndex('ticket id', ['ticket id', 'ticket_id', 'ticketid', 'ticket', 'ticket no']);
  const idxState = findIndex('ticket status', ['ticket status', 'status', 'ticket_state', 'state']);
  const idxClosed = findIndex('closure time', [
    'closure time',
    'closed at',
    'ticket closed at',
    'closed time',
    'resolution time',
  ]);

  if (idxId === -1) {
    throw new Error('Disruption ID column not found in the Ticket Status sheet headers.');
  }

  let applied = 0;
  for (const row of rows) {
    const record = findDisruptionById(row[idxId] || '');
    if (!record) continue;
    // Once a ticket is closed its fields are frozen — later syncs leave it be.
    if (record.ticketFrozenAt) continue;

    const ticketId = idxTicket === -1 ? '' : (row[idxTicket] || '').trim();
    const state = idxState === -1 ? '' : (row[idxState] || '').trim();
    const closedAt = idxClosed === -1 ? '' : (row[idxClosed] || '').trim();
    if (!ticketId && !state && !closedAt) continue;

    if (ticketId) record.ticketId = ticketId;
    if (state) record.ticketStatus = state;
    if (closedAt) record.ticketClosedAt = closedAt;

    if (isClosedTicketState(state)) {
      // A closed ticket with no closure time in the sheet falls back to the
      // disruption's own end time, and only then to the time it arrived here.
      if (!record.ticketClosedAt) record.ticketClosedAt = record.endTime || formattedIST;
      // The timings feed owns the disruption end — only backfill when it is blank.
      if (!record.endTime) applyEndTime(record, record.ticketClosedAt);
      record.ticketFrozenAt = formattedIST;
    }

    record.updatedAt = formattedIST;
    applied++;
  }
  return applied;
}

/** Runs one feed by key. */
function syncSource(key: SheetSourceKey): Promise<{ success: boolean; count: number; error?: string }> {
  if (key === 'outletMaster') return syncOutletMaster();
  if (key === 'disruptionTimings') return syncDisruptionTimings();
  return syncTickets();
}

/**
 * Runs every enabled feed. They are run in sequence rather than together so one
 * slow sheet cannot stall the others behind a shared timeout, and each writes
 * its own status either way.
 */
async function syncEnabledSources(): Promise<void> {
  for (const key of SHEET_SOURCE_KEYS) {
    if (!db.config.sources[key]?.enabled) continue;
    try {
      await syncSource(key);
    } catch (e) {
      console.error(`[Sync Service] ${SHEET_SOURCE_LABELS[key]} sync error:`, e);
    }
  }
}

// Background auto sync timer
let syncTimer: NodeJS.Timeout | null = null;
function restartAutoSync() {
  if (syncTimer) clearInterval(syncTimer);
  const intervalMs = Math.max(1, db.config.syncIntervalMinutes || 5) * 60 * 1000;
  if (db.config.autoSyncEnabled) {
    syncTimer = setInterval(() => {
      console.log(`[Sync Service] Running scheduled sheet sync (${db.config.syncIntervalMinutes}m interval)...`);
      syncEnabledSources().catch((e) => console.error('[Sync Service] Interval sync error:', e));
    }, intervalMs);
  }
}

async function startServer() {
  // Before any route can read or write, settle where the data lives.
  await initPersistence();

  const app = express();
  // One ingress hop sits in front of the pod. Without this every request looks
  // like it came from the proxy, so a per-client throttle would be one shared
  // bucket, and req.protocol would always read "http" behind TLS termination.
  app.set('trust proxy', 1);

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
    res.json({
      status: 'ok',
      time: new Date().toISOString(),
      // Without this a database that fell over is invisible until someone
      // notices reports going stale.
      store: pgStore ? { backend: 'postgres', ...pgStore.status() } : { backend: 'file' },
      records: db.disruptions.length,
    });
  });

  // --- Auth ---

  // Never let a sign-in answer be reused. Without this an "authenticated: false"
  // body from before sign-in can be served back from the browser or an
  // intermediate cache, so a session that really exists reads as missing.
  app.use('/api/auth', (req, res, next) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    next();
  });

  app.get('/api/auth/me', (req, res) => {
    const user = userFromRequest(req);
    if (!user) {
      // Separates the ways a session goes missing: no token reached this
      // server at all, or one did and this server will not accept it (stale
      // signing key, expired token). Names only, never the token itself.
      const sent = sessionTokenFromRequest(req) !== undefined;
      console.warn(
        `[Auth] /me unauthenticated — session token ${sent ? 'present but not valid' : 'absent'}` +
          ` (header ${req.headers[SESSION_HEADER] ? 'present' : 'absent'},` +
          ` cookie header ${req.headers.cookie ? 'present' : 'absent'}).`
      );
    }
    res.json({
      authenticated: Boolean(user),
      passwordRequired: PASSWORD_REQUIRED,
      allowedDomains: ALLOWED_EMAIL_DOMAINS,
      user,
    });
  });

  app.post('/api/auth/login', (req, res) => {
    const ip = req.ip || 'unknown';
    const email = String(req.body?.email ?? '').trim().toLowerCase();
    if (!email) {
      console.warn('[Auth] Sign-in rejected: no address supplied.');
      return res.status(400).json({ error: 'Enter your work email address.' });
    }

    const key = loginKey(ip, email);
    if (loginThrottled(key)) {
      console.warn(`[Auth] Sign-in throttled for ${maskEmail(email)}.`);
      return res.status(429).json({ error: 'Too many failed attempts for this address. Try again in a few minutes.' });
    }

    if (!isAllowedEmail(email)) {
      recordFailedLogin(key);
      console.warn(`[Auth] Sign-in rejected: ${maskEmail(email)} is not on an allowed domain.`);
      return res.status(403).json({
        error: `Only ${ALLOWED_EMAIL_DOMAINS.map((d) => '@' + d).join(' and ')} addresses can sign in.`,
      });
    }

    if (PASSWORD_REQUIRED) {
      const supplied = String(req.body?.password ?? '');
      const a = Buffer.from(supplied);
      const b = Buffer.from(APP_PASSWORD);
      const ok = a.length === b.length && crypto.timingSafeEqual(a, b);
      if (!ok) {
        recordFailedLogin(key);
        console.warn(`[Auth] Sign-in rejected: wrong password for ${maskEmail(email)}.`);
        return res.status(401).json({ error: 'Incorrect password.' });
      }
    }

    loginAttempts.delete(key);
    const user = upsertUser(email);
    const expiresAt = Date.now() + SESSION_TTL_MS;
    const token = signSession(email, expiresAt);
    // With `trust proxy` on, req.protocol reflects the scheme the browser used.
    const secure = req.protocol === 'https' || req.headers['x-forwarded-proto'] === 'https';
    res.setHeader(
      'Set-Cookie',
      `${SESSION_COOKIE}=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${Math.floor(
        SESSION_TTL_MS / 1000
      )}${secure ? '; Secure' : ''}`
    );
    console.log(`[Auth] Signed in ${maskEmail(email)} as ${roleFor(email)} (secure cookie: ${secure}).`);
    // The token also goes in the body because the edge drops the cookie on the
    // way back in; the client replays it in SESSION_HEADER.
    res.json({
      authenticated: true,
      passwordRequired: PASSWORD_REQUIRED,
      user: toSessionUser(user),
      token,
      expiresAt,
    });
  });

  app.post('/api/auth/logout', (req, res) => {
    res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`);
    res.json({ authenticated: false, passwordRequired: PASSWORD_REQUIRED, user: null });
  });

  // Everything below this line needs a signed-in work address.
  app.use('/api', (req, res, next) => {
    const user = userFromRequest(req);
    if (!user) return res.status(401).json({ error: 'Not signed in.' });
    res.locals.user = user;
    next();
  });

  /** The signed-in user on a guarded route. */
  const actor = (res: express.Response): SessionUser => res.locals.user as SessionUser;

  /** Guards the controls only the owner account may use. */
  const ownerOnly: express.RequestHandler = (req, res, next) => {
    if (actor(res).role !== 'owner') {
      return res.status(403).json({ error: 'Only the owner account can change this.' });
    }
    next();
  };

  // --- Signed-in user's own profile ---

  // The display name is what lands in the CC POC column, so let people correct it.
  app.put('/api/users/me', (req, res) => {
    const me = actor(res);
    const stored = findStoredUser(me.email) ?? upsertUser(me.email);
    const name = String(req.body?.name ?? '').trim();
    if (!name) {
      return res.status(400).json({ error: 'Name cannot be empty.' });
    }
    stored.name = name;
    if (req.body?.contact !== undefined) {
      stored.contact = String(req.body.contact).trim();
    }
    saveDb();
    res.json({ success: true, user: toSessionUser(stored) });
  });

  // Owner view of everyone who has signed in, for the CC POC name list.
  app.get('/api/users', (req, res) => {
    res.json({
      users: db.users.map((u) => ({ ...toSessionUser(u), lastSeenAt: u.lastSeenAt })),
    });
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

  // Store-master status. Kept at its old path for clients written before the split.
  app.get('/api/sync/status', (req, res) => {
    res.json(db.syncStatuses.outletMaster);
  });

  // All three feeds at once, so the UI can show them side by side.
  app.get('/api/sync/statuses', (req, res) => {
    res.json(db.syncStatuses);
  });

  // Manual "Sync Now" for the store master.
  app.post('/api/sync/now', async (req, res) => {
    const result = await syncOutletMaster();
    res.json({
      ...result,
      status: db.syncStatuses.outletMaster,
    });
  });

  /** Reads :source off the URL, answering 400 for anything unknown. */
  const sourceKeyFromRequest = (req: express.Request, res: express.Response): SheetSourceKey | null => {
    const key = String(req.params.source || '') as SheetSourceKey;
    if (!SHEET_SOURCE_KEYS.includes(key)) {
      res.status(400).json({ error: `Unknown sheet feed "${req.params.source}".` });
      return null;
    }
    return key;
  };

  // Manual sync of one named feed.
  app.post('/api/sync/:source/now', async (req, res) => {
    const key = sourceKeyFromRequest(req, res);
    if (!key) return;
    const result = await syncSource(key);
    res.json({ ...result, source: key, status: db.syncStatuses[key] });
  });

  // Sync every enabled feed in one go.
  app.post('/api/sync/all', async (req, res) => {
    await syncEnabledSources();
    res.json({ success: true, statuses: db.syncStatuses });
  });

  /**
   * Upload path for all three feeds: the same CSV the sheet would have served,
   * uploaded or pasted in. This is the route to use when the sheet cannot be
   * link-shared, which is the normal case for a sheet restricted to the
   * organisation.
   *
   * A store master upload replaces the whole master, so that one feed is
   * owner-only; the timing and ticket feeds only touch rows they match by ID
   * and stay open to any signed-in user.
   */
  app.post('/api/sync/:source/upload', (req, res) => {
    const key = sourceKeyFromRequest(req, res);
    if (!key) return;
    if (key === 'outletMaster' && actor(res).role !== 'owner') {
      return res
        .status(403)
        .json({ error: 'Only the owner account can replace the store master.' });
    }

    const csvText = String(req.body?.csvText || '');
    if (!csvText.trim()) {
      return res.status(400).json({ error: 'Upload a CSV, or paste the rows including the header row.' });
    }

    const { formattedIST } = getCurrentISTDate();
    const status = db.syncStatuses[key];
    status.lastAttemptedTime = formattedIST;

    try {
      const table = parseCsvTable(csvText);
      const count =
        key === 'outletMaster'
          ? applyOutletRows(table)
          : key === 'tickets'
            ? applyTicketRows(table)
            : applyDisruptionTimingRows(table);
      status.status = 'Success';
      status.lastSyncTime = formattedIST;
      status.recordsCount = count;
      status.errorDetails = null;
      status.source = 'CSV upload';
      saveDb();
      res.json({ success: true, count, source: key, status });
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : 'Could not read the uploaded rows.';
      status.status = 'Failed';
      status.errorDetails = errorMsg;
      saveDb();
      res.status(400).json({ error: errorMsg, source: key, status });
    }
  });


  // Replaces the whole outlet master, so it is an owner-only action.
  app.post('/api/outlets/bulk-upload', ownerOnly, (req, res) => {
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
    const masterStatus = db.syncStatuses.outletMaster;
    masterStatus.status = 'Success';
    masterStatus.lastSyncTime = formattedIST;
    masterStatus.recordsCount = cleanOutlets.length;
    masterStatus.errorDetails = null;
    masterStatus.source = 'Pasted upload';
    saveDb();

    res.json({ success: true, count: cleanOutlets.length, status: masterStatus });
  });

  // Config endpoints
  app.get('/api/config', (req, res) => {
    res.json(db.config);
  });

  // Master settings, including the Issue / Sub-issue list, are the owner's alone.
  app.post('/api/config', ownerOnly, (req, res) => {
    const updated = req.body as Partial<AppConfig>;

    // Merge each feed field by field so a partial save cannot blank a sheet link.
    const mergedSources = { ...db.config.sources };
    for (const key of SHEET_SOURCE_KEYS) {
      const incoming = updated.sources?.[key];
      if (!incoming) continue;
      const current: SheetSourceConfig = mergedSources[key];
      mergedSources[key] = {
        url: typeof incoming.url === 'string' ? incoming.url.trim() : current.url,
        tabName: typeof incoming.tabName === 'string' ? incoming.tabName.trim() : current.tabName,
        enabled: typeof incoming.enabled === 'boolean' ? incoming.enabled : current.enabled,
      };
    }

    db.config = migrateConfig({
      ...db.config,
      ...updated,
      columnMapping: {
        ...db.config.columnMapping,
        ...(updated.columnMapping || {}),
      },
      sources: mergedSources,
    });
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

    // Only sub-issues are captured; the parent issue comes from the master.
    const createSubIssues: string[] = (
      Array.isArray(data.subIssues) ? data.subIssues : data.subIssue ? [data.subIssue] : []
    )
      .map((s: unknown) => String(s).trim())
      .filter(Boolean);
    const createIssues = deriveIssues(createSubIssues, db.config.issueMaster);

    const resolvedStatuses = ['Resolved by RAC', 'Resolved by OEM', 'Resolved by Dealer', 'Resolved by CC'];
    if (resolvedStatuses.includes(data.currentStatus) && createSubIssues.length === 0) {
      return res.status(400).json({
        error: `Select at least one Sub Issue when status is "${data.currentStatus}".`,
      });
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
      // Derived, not supplied: how long CC took to log the disruption after it
      // began. Any client-sent value is deliberately ignored.
      ccFrtMins: (() => {
        const hrs = hoursBetween(
          formatDateTimeIST(data.disruptionStartDate, data.disruptionStartTime),
          formattedIST
        );
        return hrs === null ? undefined : Math.max(0, Math.round(hrs * 60));
      })(),
      mstFrtMins: undefined,
      // Built from the mandatory date and time fields, never from "now": a
      // back-dated incident must keep its real start, since every duration,
      // closure and downtime figure is measured from it.
      disruptionStartDateTime:
        data.disruptionStartDateTime ||
        formatDateTimeIST(data.disruptionStartDate, data.disruptionStartTime) ||
        formattedIST,
      disruptionStartDate: data.disruptionStartDate,
      disruptionStartTime: data.disruptionStartTime,
      ccPoc: data.ccPoc,
      bucket: data.bucket,
      ticketId: data.ticketId ? data.ticketId.trim() : undefined,
      currentStatus: data.currentStatus,
      subIssues: createSubIssues,
      issues: createIssues,
      subIssue: createSubIssues[0] ?? undefined,
      issue: createIssues[0] ?? undefined,
      auditStartedAt: isAuditStatus(data.currentStatus) ? formattedIST : undefined,
      latestLiveUpdate: data.latestLiveUpdate.trim(),
      // Team-only handover note. Stored with the record but deliberately left
      // out of every export, so it never reaches a report.
      internalRemarks: data.internalRemarks ? String(data.internalRemarks).trim() || undefined : undefined,
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
    const { updateText, updatedBy, newStatus, subIssues, subIssue } = req.body;
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

    // Sub-issues arrive as a list; the parent issues are looked up, not sent.
    const incomingSubIssues: string[] | undefined = Array.isArray(subIssues)
      ? subIssues.map((s: unknown) => String(s).trim()).filter(Boolean)
      : subIssue !== undefined
      ? [String(subIssue).trim()].filter(Boolean)
      : undefined;
    const effectiveSubIssues = incomingSubIssues ?? readSubIssues(disruption);

    // Reaching RAC Visited without saying how long the technician took leaves a
    // hole nobody can fill later, so it is required the first time - and only
    // the first time, since a status set again should not ask twice.
    const rawRacFrt = req.body?.racFrtMins ?? req.body?.mstFrtMins;
    let incomingRacFrt: number | undefined;
    if (rawRacFrt !== undefined && rawRacFrt !== null && String(rawRacFrt).trim() !== '') {
      const n = Number(rawRacFrt);
      if (!Number.isFinite(n) || n < 0) {
        return res.status(400).json({ error: 'RAC arrival time must be a number of minutes.' });
      }
      incomingRacFrt = Math.round(n);
    }
    if (
      targetStatus === STATUS_REQUIRING_RAC_FRT &&
      previousStatus !== STATUS_REQUIRING_RAC_FRT &&
      disruption.mstFrtMins === undefined &&
      incomingRacFrt === undefined
    ) {
      return res.status(400).json({
        error: 'Enter how many minutes the RAC technician took to reach site before setting RAC Visited.',
        needs: 'racFrtMins',
      });
    }

    const resolvedStatuses = ['Resolved by RAC', 'Resolved by OEM', 'Resolved by Dealer', 'Resolved by CC'];
    if (resolvedStatuses.includes(targetStatus) && effectiveSubIssues.length === 0) {
      return res
        .status(400)
        .json({ error: `Select at least one Sub Issue when setting status to "${targetStatus}".` });
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
    // Only replace the handover note when this update actually carries one, so
    // an update that leaves the box untouched does not wipe the last shift's.
    if (req.body?.internalRemarks !== undefined) {
      const note = String(req.body.internalRemarks).trim();
      disruption.internalRemarks = note || undefined;
    }
    disruption.currentStatus = targetStatus;
    disruption.lastUpdatedBy = updatedBy || disruption.ccPoc || 'Operator';
    disruption.lastUpdatedAt = formattedIST;
    disruption.updatedAt = formattedIST;

    if (incomingSubIssues) {
      const effectiveIssues = deriveIssues(effectiveSubIssues, db.config.issueMaster);
      disruption.subIssues = effectiveSubIssues;
      disruption.issues = effectiveIssues;
      disruption.subIssue = effectiveSubIssues[0] ?? '';
      disruption.issue = effectiveIssues[0] ?? '';
    }

    disruption.auditStartedAt = auditStampFor(
      previousStatus,
      targetStatus,
      disruption.auditStartedAt,
      formattedIST
    );

    // Stamp the step this status represents, but only the first time: setting a
    // status again later should not move the moment it was first reached.
    const stampField = STEP_STAMP_FIELDS[targetStatus];
    if (stampField && !disruption[stampField]) {
      disruption[stampField] = formattedIST;
    }

    // Same for resolution: the first resolving status is the one that counts.
    const resolvedByParty = RESOLVED_BY_FOR_STATUS[targetStatus];
    if (resolvedByParty && !disruption.resolvedAt) {
      disruption.resolvedAt = formattedIST;
      disruption.resolvedBy = resolvedByParty;
    }

    // The RAC arrival time is only ever asked for here, so take it when it comes.
    if (incomingRacFrt !== undefined) {
      disruption.mstFrtMins = incomingRacFrt;
    }

    recomputeDerivedTimings(disruption);

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

    // Resolution taxonomy: the operator sends sub-issues, we derive the parents.
    const incomingSubIssues: string[] | undefined = Array.isArray(updates.subIssues)
      ? updates.subIssues.map((s: unknown) => String(s).trim()).filter(Boolean)
      : updates.subIssue !== undefined
      ? [String(updates.subIssue).trim()].filter(Boolean)
      : undefined;

    const effectiveSubIssues = incomingSubIssues ?? readSubIssues(existing);

    const resolvedStatuses = ['Resolved by RAC', 'Resolved by OEM', 'Resolved by Dealer', 'Resolved by CC'];
    if (resolvedStatuses.includes(targetStatus) && effectiveSubIssues.length === 0) {
      return res.status(400).json({ error: 'Select at least one Sub Issue before resolving.' });
    }

    const effectiveIssues = deriveIssues(effectiveSubIssues, db.config.issueMaster);

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
      subIssues: effectiveSubIssues,
      issues: effectiveIssues,
      // Singular fields mirror the first entry so the sheet export stays stable.
      subIssue: effectiveSubIssues[0] ?? '',
      issue: effectiveIssues[0] ?? '',
      auditStartedAt: auditStampFor(previousStatus, targetStatus, existing.auditStartedAt, formattedIST),
      ccFrtMins: normaliseFrt(updates.ccFrtMins, existing.ccFrtMins),
      mstFrtMins: normaliseFrt(updates.mstFrtMins, existing.mstFrtMins),
      updatedAt: formattedIST,
      lastUpdatedAt: formattedIST,
      lastUpdatedBy: updates.updatedBy || existing.lastUpdatedBy,
    };

    saveDb();
    res.json({ message: 'Disruption updated successfully.', disruption: db.disruptions[index] });
  });

  // Removing a record is destructive and unlogged, so it stays with the owner.
  app.delete('/api/disruptions/:id', ownerOnly, (req, res) => {
    const disruptionId = req.params.id;
    const index = db.disruptions.findIndex((d) => d.disruptionId === disruptionId);
    if (index === -1) {
      return res.status(404).json({ error: 'Disruption not found.' });
    }

    const [removed] = db.disruptions.splice(index, 1);
    saveDb();
    console.log(`Disruption ${removed.disruptionId} deleted by ${actor(res).email}`);
    res.json({ message: `Disruption ${removed.disruptionId} deleted.`, disruptionId: removed.disruptionId });
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
      'All Sub-issues Identified',
      'Sub-issue Count',
      'End time (Auto)',
      'Duration (Auto)',
      'Ticket Closed At (Auto)',
      'Ticket State (Sheet)',
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
        cumulativeLiveUpdate(d),
        d.remark || '',
        readIssues(d).join(' | '),
        d.subIssue || '',
        readSubIssues(d).join(' | '),
        String(readSubIssues(d).length),
        d.endTime || '',
        d.duration || '',
        d.ticketClosedAt || '',
        d.ticketStatus || '',
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

  app.listen(PORT, HOST, () => {
    console.log(`Disruption Management System server running on http://${HOST}:${PORT}`);
  });
}

startServer();
