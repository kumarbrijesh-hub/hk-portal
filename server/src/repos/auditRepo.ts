import { db } from '../db/index.js';
import type { AuditEntry } from '../types.js';
import { nowIso } from '../utils/time.js';

interface AuditRow {
  id: number;
  entity_type: string;
  entity_id: string;
  action: string;
  field: string | null;
  previous_value: string | null;
  new_value: string | null;
  actor: string;
  at: string;
}

export interface AuditInput {
  entityType: string;
  entityId: string;
  action: string;
  field?: string | null;
  previousValue?: string | null;
  newValue?: string | null;
  actor: string;
  at?: string;
}

function toEntry(row: AuditRow): AuditEntry {
  return {
    id: row.id,
    entityType: row.entity_type,
    entityId: row.entity_id,
    action: row.action,
    field: row.field,
    previousValue: row.previous_value,
    newValue: row.new_value,
    actor: row.actor,
    at: row.at,
  };
}

export const auditRepo = {
  record(entry: AuditInput): void {
    db.prepare(
      `INSERT INTO audit_log
         (entity_type, entity_id, action, field, previous_value, new_value, actor, at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      entry.entityType,
      entry.entityId,
      entry.action,
      entry.field ?? null,
      entry.previousValue ?? null,
      entry.newValue ?? null,
      entry.actor,
      entry.at ?? nowIso(),
    );
  },

  recordMany(entries: AuditInput[]): void {
    for (const entry of entries) this.record(entry);
  },

  forEntity(entityType: string, entityId: string, limit = 200): AuditEntry[] {
    const rows = db
      .prepare(
        `SELECT * FROM audit_log
         WHERE entity_type = ? AND entity_id = ?
         ORDER BY at DESC, id DESC LIMIT ?`,
      )
      .all(entityType, entityId, limit) as AuditRow[];
    return rows.map(toEntry);
  },

  recent(limit = 200): AuditEntry[] {
    const rows = db
      .prepare('SELECT * FROM audit_log ORDER BY at DESC, id DESC LIMIT ?')
      .all(limit) as AuditRow[];
    return rows.map(toEntry);
  },
};
