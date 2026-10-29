/**
 * Postgres persistence for the disruption store.
 *
 * The app keeps its whole working set in memory and calls `saveDb()` from
 * request handlers, synchronously, in about fifty places. Rewriting all of
 * those to await a database round-trip would be a large change with a lot of
 * surface for mistakes, so persistence stays fire-and-forget: handlers mark the
 * store dirty and a single writer drains it.
 *
 * What that buys and what it costs:
 *  - A write is never lost to a crash *between* requests, because the flush
 *    runs immediately and the JSON file on the volume is still written
 *    synchronously as a local fallback.
 *  - A crash in the few milliseconds between a handler returning and the flush
 *    completing loses that one write from Postgres, but not from the file. Boot
 *    reconciles the two by taking whichever source has more records.
 *
 * Rows are stored with the columns worth querying lifted out of the record and
 * the full record kept alongside as jsonb. That way a report can be written in
 * SQL without the schema having to track every field the app grows.
 */

import { createHash } from 'crypto';
import { Pool, PoolClient } from 'pg';
import { AppConfig, Disruption, OutletMaster, SyncStatuses } from '../types';

export interface PersistedState {
  users: unknown[];
  outlets: OutletMaster[];
  disruptions: Disruption[];
  config: AppConfig;
  syncStatuses: SyncStatuses;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS disruptions (
  disruption_id        TEXT PRIMARY KEY,
  outlet_id            TEXT,
  city                 TEXT,
  bucket               TEXT,
  current_status       TEXT,
  start_time           TEXT,
  end_time             TEXT,
  cc_frt_mins          INTEGER,
  rac_frt_mins         INTEGER,
  oem_frt_hours        DOUBLE PRECISION,
  resolution_tat_hours DOUBLE PRECISION,
  resolved_by          TEXT,
  created_at           TEXT,
  updated_at           TEXT,
  payload              JSONB NOT NULL
);
CREATE INDEX IF NOT EXISTS disruptions_outlet_idx ON disruptions (outlet_id);
CREATE INDEX IF NOT EXISTS disruptions_status_idx ON disruptions (current_status);

CREATE TABLE IF NOT EXISTS outlets (
  outlet_id TEXT PRIMARY KEY,
  payload   JSONB NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  email   TEXT PRIMARY KEY,
  payload JSONB NOT NULL
);

CREATE TABLE IF NOT EXISTS app_state (
  key     TEXT PRIMARY KEY,
  payload JSONB NOT NULL
);
`;

/**
 * A failed flush retries on a backoff rather than waiting for the next write.
 * Without it a database that comes back during a quiet spell stays behind until
 * someone happens to save, which is exactly when nobody is watching.
 */
const RETRY_MIN_MS = 2_000;
const RETRY_MAX_MS = 60_000;

/** Cheap content fingerprint, used to skip rewriting a section that is unchanged. */
function digest(value: unknown): string {
  return createHash('sha1').update(JSON.stringify(value) ?? 'null').digest('hex');
}

/** Numeric fields arrive as numbers or undefined; Postgres wants null. */
function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function text(value: unknown): string | null {
  const shown = typeof value === 'string' ? value.trim() : '';
  return shown ? shown : null;
}

export class PostgresStore {
  private pool: Pool;
  /** Set by a handler, cleared by the writer. */
  private dirty = false;
  /** Guards against two flushes running at once. */
  private flushing = false;
  private snapshot: (() => PersistedState) | null = null;
  private lastError: string | null = null;
  /** Pending retry after a failed flush, so an outage does not strand a write. */
  private retryTimer: NodeJS.Timeout | null = null;
  private retryDelayMs = RETRY_MIN_MS;
  /**
   * Digest of each section as it was last written, so a flush only touches the
   * sections that actually changed.
   *
   * Without this, every save rewrote all of them. The scheduled sheet sync
   * stamps a timestamp onto syncStatuses every few minutes and saves, which was
   * re-upserting the entire outlet master - thousands of rows - to record that
   * one field. Postgres showed it as a steady few megabytes of WAL per
   * checkpoint on a store with a handful of disruptions in it.
   */
  private written: Partial<Record<'disruptions' | 'outlets' | 'users' | 'appState', string>> = {};

  constructor(connectionString: string) {
    this.pool = new Pool({
      connectionString,
      max: 4,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
    });
    // A pool error with no listener takes the process down, and a database
    // blip should never do that - the file store is still carrying the data.
    this.pool.on('error', (err) => {
      this.lastError = err.message;
      console.error('[Postgres] idle client error:', err.message);
    });
  }

  async init(): Promise<void> {
    await this.pool.query(SCHEMA);
  }

  /** Everything Postgres holds, or null when it has not been written yet. */
  async read(): Promise<Partial<PersistedState> | null> {
    const [disruptions, outlets, users, state] = await Promise.all([
      this.pool.query<{ payload: Disruption }>('SELECT payload FROM disruptions'),
      this.pool.query<{ payload: OutletMaster }>('SELECT payload FROM outlets'),
      this.pool.query<{ payload: unknown }>('SELECT payload FROM users'),
      this.pool.query<{ key: string; payload: unknown }>('SELECT key, payload FROM app_state'),
    ]);

    const byKey = new Map(state.rows.map((r) => [r.key, r.payload]));
    const empty =
      disruptions.rowCount === 0 &&
      outlets.rowCount === 0 &&
      users.rowCount === 0 &&
      state.rowCount === 0;
    if (empty) return null;

    return {
      disruptions: disruptions.rows.map((r) => r.payload),
      outlets: outlets.rows.map((r) => r.payload),
      users: users.rows.map((r) => r.payload),
      config: byKey.get('config') as AppConfig | undefined,
      syncStatuses: byKey.get('syncStatuses') as SyncStatuses | undefined,
    };
  }

  /**
   * Registers how to read the live store, then flushes on every `markDirty`.
   * Called once at boot.
   */
  attach(snapshot: () => PersistedState): void {
    this.snapshot = snapshot;
  }

  markDirty(): void {
    this.dirty = true;
    void this.drain();
  }

  /** Schedules the next attempt, doubling the wait up to the ceiling. */
  private scheduleRetry(): void {
    if (this.retryTimer) return;
    const delay = this.retryDelayMs;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      void this.drain();
    }, delay);
    // A stuck retry must never be the reason the process refuses to exit.
    this.retryTimer.unref?.();
    this.retryDelayMs = Math.min(this.retryDelayMs * 2, RETRY_MAX_MS);
    console.warn(`[Postgres] retrying the pending write in ${Math.round(delay / 1000)}s.`);
  }

  private async drain(): Promise<void> {
    if (this.flushing || !this.snapshot) return;
    this.flushing = true;
    try {
      // Re-check inside the loop: a handler can dirty the store again while the
      // previous flush is still in flight, and that write must not be dropped.
      while (this.dirty) {
        this.dirty = false;
        await this.write(this.snapshot());
      }
      // Back to a healthy connection: start the next outage from a short wait.
      this.retryDelayMs = RETRY_MIN_MS;
    } catch (err) {
      // Keep serving - the file store on the volume still has the records - and
      // keep trying until the write lands.
      this.dirty = true;
      this.lastError = err instanceof Error ? err.message : String(err);
      console.error('[Postgres] flush failed:', this.lastError);
      this.flushing = false;
      this.scheduleRetry();
      return;
    } finally {
      this.flushing = false;
    }
  }

  /**
   * One transaction so a reader never sees a half-written generation.
   *
   * Only the sections whose contents changed since the last successful write
   * are touched. The digests are committed together with the data, so a failed
   * transaction leaves them as they were and the next attempt writes the lot.
   */
  async write(state: PersistedState): Promise<void> {
    const next = {
      disruptions: digest(state.disruptions),
      outlets: digest(state.outlets),
      users: digest(state.users),
      appState: digest([state.config, state.syncStatuses]),
    };

    const changed = (Object.keys(next) as Array<keyof typeof next>).filter(
      (section) => this.written[section] !== next[section]
    );
    if (changed.length === 0) return;

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      if (changed.includes('disruptions')) {
        await this.writeDisruptions(client, state.disruptions);
      }
      if (changed.includes('outlets')) {
        await this.writeKeyed(client, 'outlets', 'outlet_id', state.outlets, (o) => o.outletId);
      }
      if (changed.includes('users')) {
        await this.writeKeyed(
          client,
          'users',
          'email',
          state.users as Array<{ email: string }>,
          (u) => u.email
        );
      }
      if (changed.includes('appState')) {
        await client.query(
          `INSERT INTO app_state (key, payload) VALUES ('config', $1), ('syncStatuses', $2)
           ON CONFLICT (key) DO UPDATE SET payload = EXCLUDED.payload`,
          [JSON.stringify(state.config), JSON.stringify(state.syncStatuses)]
        );
      }
      await client.query('COMMIT');
      this.written = next;
      this.lastError = null;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  }

  private async writeDisruptions(client: PoolClient, disruptions: Disruption[]): Promise<void> {
    const ids: string[] = [];
    for (const d of disruptions) {
      if (!d.disruptionId) continue;
      ids.push(d.disruptionId);
      await client.query(
        `INSERT INTO disruptions (
           disruption_id, outlet_id, city, bucket, current_status, start_time, end_time,
           cc_frt_mins, rac_frt_mins, oem_frt_hours, resolution_tat_hours, resolved_by,
           created_at, updated_at, payload
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
         ON CONFLICT (disruption_id) DO UPDATE SET
           outlet_id = EXCLUDED.outlet_id,
           city = EXCLUDED.city,
           bucket = EXCLUDED.bucket,
           current_status = EXCLUDED.current_status,
           start_time = EXCLUDED.start_time,
           end_time = EXCLUDED.end_time,
           cc_frt_mins = EXCLUDED.cc_frt_mins,
           rac_frt_mins = EXCLUDED.rac_frt_mins,
           oem_frt_hours = EXCLUDED.oem_frt_hours,
           resolution_tat_hours = EXCLUDED.resolution_tat_hours,
           resolved_by = EXCLUDED.resolved_by,
           created_at = EXCLUDED.created_at,
           updated_at = EXCLUDED.updated_at,
           payload = EXCLUDED.payload`,
        [
          d.disruptionId,
          text(d.outletId),
          text(d.city),
          text(d.bucket),
          text(d.currentStatus),
          text(d.disruptionStartDateTime),
          text(d.endTime),
          num(d.ccFrtMins),
          num(d.mstFrtMins),
          num(d.oemFrtHours),
          num(d.resolutionTatHours),
          text(d.resolvedBy),
          text(d.createdAt),
          text(d.updatedAt),
          JSON.stringify(d),
        ]
      );
    }
    // A deleted record has to leave Postgres too, or it reappears on the next boot.
    await client.query(
      ids.length > 0
        ? 'DELETE FROM disruptions WHERE NOT (disruption_id = ANY($1::text[]))'
        : 'DELETE FROM disruptions',
      ids.length > 0 ? [ids] : []
    );
  }

  private async writeKeyed<T>(
    client: PoolClient,
    table: 'outlets' | 'users',
    keyColumn: 'outlet_id' | 'email',
    rows: T[],
    keyOf: (row: T) => string | undefined
  ): Promise<void> {
    const keys: string[] = [];
    for (const row of rows) {
      const key = keyOf(row);
      if (!key) continue;
      keys.push(key);
      await client.query(
        `INSERT INTO ${table} (${keyColumn}, payload) VALUES ($1, $2)
         ON CONFLICT (${keyColumn}) DO UPDATE SET payload = EXCLUDED.payload`,
        [key, JSON.stringify(row)]
      );
    }
    await client.query(
      keys.length > 0
        ? `DELETE FROM ${table} WHERE NOT (${keyColumn} = ANY($1::text[]))`
        : `DELETE FROM ${table}`,
      keys.length > 0 ? [keys] : []
    );
  }

  /** Surfaced on /api/health so a broken database is visible without a shell. */
  status(): { connected: boolean; lastError: string | null; pendingWrite: boolean } {
    return { connected: this.lastError === null, lastError: this.lastError, pendingWrite: this.dirty };
  }

  async close(): Promise<void> {
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    await this.pool.end();
  }
}
