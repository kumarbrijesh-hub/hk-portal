import { db } from '../db/index.js';
import type { Disruption, DisruptionFilters } from '../types.js';
import { hoursBetween, istPartsToIso, roundTo } from '../utils/time.js';

interface DisruptionRow {
  disruption_id: string;
  outlet_id: string;
  store_name: string;
  city: string;
  mode: string;
  vendor: string;
  poc_name: string;
  poc_contact: string;
  disruption_start_at: string;
  cc_poc: string;
  bucket: string;
  ticket_id: string | null;
  current_status: string;
  issue: string | null;
  sub_issue: string | null;
  cc_frt_mins: number | null;
  mst_frt_mins: number | null;
  audit_duration_hrs: number | null;
  resolved_at: string | null;
  latest_live_update: string;
  last_updated_by: string | null;
  last_updated_at: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
  is_active: number;
}

export function toDisruption(row: DisruptionRow): Disruption {
  const endIso = row.resolved_at ?? undefined;
  return {
    disruptionId: row.disruption_id,
    outletId: row.outlet_id,
    storeName: row.store_name,
    city: row.city,
    mode: row.mode,
    vendor: row.vendor,
    pocName: row.poc_name,
    pocContact: row.poc_contact,
    disruptionStartAt: row.disruption_start_at,
    ccPoc: row.cc_poc,
    bucket: row.bucket,
    ticketId: row.ticket_id,
    currentStatus: row.current_status,
    issue: row.issue,
    subIssue: row.sub_issue,
    ccFrtMins: row.cc_frt_mins,
    mstFrtMins: row.mst_frt_mins,
    auditDurationHrs: row.audit_duration_hrs,
    resolvedAt: row.resolved_at,
    latestLiveUpdate: row.latest_live_update,
    lastUpdatedBy: row.last_updated_by,
    lastUpdatedAt: row.last_updated_at,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    isActive: row.is_active === 1,
    durationHours: roundTo(hoursBetween(row.disruption_start_at, endIso), 1),
  };
}

const SORTABLE: Record<string, string> = {
  disruptionId: 'disruption_id',
  outletId: 'outlet_id',
  storeName: 'store_name',
  city: 'city',
  vendor: 'vendor',
  mode: 'mode',
  ccPoc: 'cc_poc',
  bucket: 'bucket',
  currentStatus: 'current_status',
  disruptionStartAt: 'disruption_start_at',
  lastUpdatedAt: 'last_updated_at',
  createdAt: 'created_at',
};

/** Builds the shared WHERE clause for list/count/export so all three agree. */
function buildWhere(filters: DisruptionFilters): { sql: string; params: unknown[] } {
  const clauses: string[] = [];
  const params: unknown[] = [];

  if (filters.activeOnly) clauses.push('is_active = 1');

  const exact: [keyof DisruptionFilters, string][] = [
    ['city', 'city'],
    ['outletId', 'outlet_id'],
    ['storeName', 'store_name'],
    ['vendor', 'vendor'],
    ['mode', 'mode'],
    ['ccPoc', 'cc_poc'],
    ['bucket', 'bucket'],
    ['currentStatus', 'current_status'],
  ];
  for (const [key, column] of exact) {
    const value = filters[key];
    if (typeof value === 'string' && value.trim()) {
      clauses.push(`${column} = ? COLLATE NOCASE`);
      params.push(value.trim());
    }
  }

  if (filters.search?.trim()) {
    const term = `%${filters.search.trim()}%`;
    clauses.push(`(
      disruption_id LIKE ? COLLATE NOCASE OR outlet_id LIKE ? COLLATE NOCASE
      OR store_name LIKE ? COLLATE NOCASE OR city LIKE ? COLLATE NOCASE
      OR vendor LIKE ? COLLATE NOCASE OR ticket_id LIKE ? COLLATE NOCASE
      OR cc_poc LIKE ? COLLATE NOCASE OR latest_live_update LIKE ? COLLATE NOCASE
    )`);
    params.push(term, term, term, term, term, term, term, term);
  }

  // Date filters are IST calendar days, converted to a UTC instant range.
  const dayRange = (day: string): [string, string] | null => {
    const match = day.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return null;
    const [y, m, d] = [+match[1], +match[2], +match[3]];
    return [
      istPartsToIso({ year: y, month: m, day: d, hour: 0, minute: 0, second: 0 }),
      istPartsToIso({ year: y, month: m, day: d, hour: 23, minute: 59, second: 59 }),
    ];
  };

  if (filters.date) {
    const range = dayRange(filters.date);
    if (range) {
      clauses.push('disruption_start_at BETWEEN ? AND ?');
      params.push(range[0], range[1]);
    }
  }
  if (filters.fromDate) {
    const range = dayRange(filters.fromDate);
    if (range) {
      clauses.push('disruption_start_at >= ?');
      params.push(range[0]);
    }
  }
  if (filters.toDate) {
    const range = dayRange(filters.toDate);
    if (range) {
      clauses.push('disruption_start_at <= ?');
      params.push(range[1]);
    }
  }

  return { sql: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '', params };
}

export const disruptionRepo = {
  findById(disruptionId: string): Disruption | null {
    const row = db
      .prepare('SELECT * FROM disruptions WHERE disruption_id = ?')
      .get(disruptionId) as DisruptionRow | undefined;
    return row ? toDisruption(row) : null;
  },

  exists(disruptionId: string): boolean {
    return db
      .prepare('SELECT 1 FROM disruptions WHERE disruption_id = ?')
      .get(disruptionId) !== undefined;
  },

  list(filters: DisruptionFilters = {}): { rows: Disruption[]; total: number } {
    const where = buildWhere(filters);
    const total = (db
      .prepare(`SELECT COUNT(*) AS n FROM disruptions ${where.sql}`)
      .get(...where.params) as { n: number }).n;

    const column = SORTABLE[filters.sortBy ?? ''] ?? 'disruption_start_at';
    const direction = filters.sortDir === 'asc' ? 'ASC' : 'DESC';
    const limit = Math.min(Math.max(filters.limit ?? 200, 1), 5000);
    const offset = Math.max(filters.offset ?? 0, 0);

    const rows = db
      .prepare(
        `SELECT * FROM disruptions ${where.sql}
         ORDER BY ${column} ${direction}, disruption_id ${direction}
         LIMIT ? OFFSET ?`,
      )
      .all(...where.params, limit, offset) as DisruptionRow[];

    return { rows: rows.map(toDisruption), total };
  },

  /** Every matching row, no pagination - used by report generation. */
  listAll(filters: DisruptionFilters = {}): Disruption[] {
    const where = buildWhere(filters);
    const rows = db
      .prepare(`SELECT * FROM disruptions ${where.sql} ORDER BY disruption_start_at ASC`)
      .all(...where.params) as DisruptionRow[];
    return rows.map(toDisruption);
  },

  activeCount(filters: DisruptionFilters = {}): number {
    const where = buildWhere({ ...filters, activeOnly: true });
    return (db
      .prepare(`SELECT COUNT(*) AS n FROM disruptions ${where.sql}`)
      .get(...where.params) as { n: number }).n;
  },

  distinctValues(column: keyof typeof SORTABLE): string[] {
    const dbColumn = SORTABLE[column];
    if (!dbColumn) return [];
    const rows = db
      .prepare(
        `SELECT DISTINCT ${dbColumn} AS value FROM disruptions
         WHERE ${dbColumn} IS NOT NULL AND ${dbColumn} <> '' ORDER BY ${dbColumn}`,
      )
      .all() as { value: string }[];
    return rows.map((row) => row.value);
  },

  insert(row: DisruptionRow): void {
    db.prepare(
      `INSERT INTO disruptions (
         disruption_id, outlet_id, store_name, city, mode, vendor, poc_name, poc_contact,
         disruption_start_at, cc_poc, bucket, ticket_id, current_status, issue, sub_issue,
         cc_frt_mins, mst_frt_mins, audit_duration_hrs, resolved_at,
         latest_live_update, last_updated_by, last_updated_at,
         created_by, created_at, updated_at, is_active
       ) VALUES (
         @disruption_id, @outlet_id, @store_name, @city, @mode, @vendor, @poc_name, @poc_contact,
         @disruption_start_at, @cc_poc, @bucket, @ticket_id, @current_status, @issue, @sub_issue,
         @cc_frt_mins, @mst_frt_mins, @audit_duration_hrs, @resolved_at,
         @latest_live_update, @last_updated_by, @last_updated_at,
         @created_by, @created_at, @updated_at, @is_active
       )`,
    ).run(row);
  },

  updateFields(disruptionId: string, fields: Record<string, unknown>): void {
    const keys = Object.keys(fields);
    if (!keys.length) return;
    const assignments = keys.map((key) => `${key} = @${key}`).join(', ');
    db.prepare(`UPDATE disruptions SET ${assignments} WHERE disruption_id = @disruption_id`)
      .run({ ...fields, disruption_id: disruptionId });
  },
};

export type { DisruptionRow };
