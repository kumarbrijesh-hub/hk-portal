import { db } from '../db/index.js';
import type { SyncState } from '../types.js';

interface SyncRow {
  last_attempt_at: string | null;
  last_success_at: string | null;
  status: SyncState['status'];
  record_count: number;
  error: string | null;
  duration_ms: number | null;
}

export const syncRepo = {
  get(): SyncState {
    const row = db.prepare('SELECT * FROM sync_state WHERE id = 1').get() as SyncRow;
    return {
      lastAttemptAt: row.last_attempt_at,
      lastSuccessAt: row.last_success_at,
      status: row.status,
      recordCount: row.record_count,
      error: row.error,
      durationMs: row.duration_ms,
    };
  },

  markSyncing(at: string): void {
    db.prepare(
      `UPDATE sync_state SET last_attempt_at = ?, status = 'syncing', error = NULL WHERE id = 1`,
    ).run(at);
  },

  markSuccess(at: string, recordCount: number, durationMs: number): void {
    db.prepare(
      `UPDATE sync_state
       SET last_success_at = ?, status = 'success', record_count = ?, error = NULL, duration_ms = ?
       WHERE id = 1`,
    ).run(at, recordCount, durationMs);
  },

  /** Keeps last_success_at and record_count intact - the previous dataset is still live. */
  markFailure(error: string, durationMs: number): void {
    db.prepare(`UPDATE sync_state SET status = 'failed', error = ?, duration_ms = ? WHERE id = 1`)
      .run(error.slice(0, 2000), durationMs);
  },
};
