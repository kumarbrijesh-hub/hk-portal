import { db, transaction } from '../db/index.js';
import type { OutletMaster } from '../types.js';

interface OutletRow {
  outlet_id: string;
  store_name: string;
  city: string;
  mode: string;
  vendor: string;
  poc_name: string;
  poc_contact: string;
  synced_at: string;
}

function toOutlet(row: OutletRow): OutletMaster {
  return {
    outletId: row.outlet_id,
    storeName: row.store_name,
    city: row.city,
    mode: row.mode,
    vendor: row.vendor,
    pocName: row.poc_name,
    pocContact: row.poc_contact,
    syncedAt: row.synced_at,
  };
}

export const outletRepo = {
  count(): number {
    return (db.prepare('SELECT COUNT(*) AS n FROM outlet_master').get() as { n: number }).n;
  },

  findById(outletId: string): OutletMaster | null {
    const row = db
      .prepare('SELECT * FROM outlet_master WHERE outlet_id = ? COLLATE NOCASE')
      .get(outletId.trim()) as OutletRow | undefined;
    return row ? toOutlet(row) : null;
  },

  /** Typeahead over outlet id + store name + city. */
  search(query: string, limit = 25): OutletMaster[] {
    const term = `%${query.trim()}%`;
    const rows = db
      .prepare(
        `SELECT * FROM outlet_master
         WHERE outlet_id LIKE ? COLLATE NOCASE
            OR store_name LIKE ? COLLATE NOCASE
            OR city LIKE ? COLLATE NOCASE
         ORDER BY
           CASE WHEN outlet_id LIKE ? COLLATE NOCASE THEN 0 ELSE 1 END,
           outlet_id
         LIMIT ?`,
      )
      .all(term, term, term, `${query.trim()}%`, limit) as OutletRow[];
    return rows.map(toOutlet);
  },

  list(limit = 500): OutletMaster[] {
    const rows = db
      .prepare('SELECT * FROM outlet_master ORDER BY outlet_id LIMIT ?')
      .all(limit) as OutletRow[];
    return rows.map(toOutlet);
  },

  distinctValues(column: 'city' | 'vendor' | 'mode'): string[] {
    const rows = db
      .prepare(
        `SELECT DISTINCT ${column} AS value FROM outlet_master
         WHERE ${column} <> '' ORDER BY ${column}`,
      )
      .all() as { value: string }[];
    return rows.map((row) => row.value);
  },

  /**
   * Replaces the whole master dataset atomically. Callers must only invoke this
   * with a validated, non-empty payload - a failed sync must leave the previous
   * dataset untouched.
   */
  replaceAll(outlets: Omit<OutletMaster, 'syncedAt'>[], syncedAt: string): number {
    return transaction(() => {
      db.prepare('DELETE FROM outlet_master').run();
      const insert = db.prepare(
        `INSERT INTO outlet_master
           (outlet_id, store_name, city, mode, vendor, poc_name, poc_contact, synced_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const outlet of outlets) {
        insert.run(
          outlet.outletId,
          outlet.storeName,
          outlet.city,
          outlet.mode,
          outlet.vendor,
          outlet.pocName,
          outlet.pocContact,
          syncedAt,
        );
      }
      return outlets.length;
    });
  },
};
