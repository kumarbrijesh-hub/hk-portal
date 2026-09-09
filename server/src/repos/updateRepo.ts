import { randomUUID } from 'node:crypto';
import { db } from '../db/index.js';
import type { DisruptionUpdate } from '../types.js';

interface UpdateRow {
  update_id: string;
  disruption_id: string;
  update_text: string;
  updated_by: string;
  updated_at: string;
  previous_status: string | null;
  new_status: string | null;
  original_text: string | null;
  edited_text: string | null;
  edited_by: string | null;
  edited_at: string | null;
}

function toUpdate(row: UpdateRow): DisruptionUpdate {
  return {
    updateId: row.update_id,
    disruptionId: row.disruption_id,
    updateText: row.update_text,
    updatedBy: row.updated_by,
    updatedAt: row.updated_at,
    previousStatus: row.previous_status,
    newStatus: row.new_status,
    originalText: row.original_text,
    editedText: row.edited_text,
    editedBy: row.edited_by,
    editedAt: row.edited_at,
  };
}

export const updateRepo = {
  /** Appends a new history entry. Existing entries are never overwritten. */
  append(entry: {
    disruptionId: string;
    updateText: string;
    updatedBy: string;
    updatedAt: string;
    previousStatus: string | null;
    newStatus: string | null;
  }): DisruptionUpdate {
    const updateId = randomUUID();
    db.prepare(
      `INSERT INTO disruption_updates
         (update_id, disruption_id, update_text, updated_by, updated_at,
          previous_status, new_status, original_text)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      updateId,
      entry.disruptionId,
      entry.updateText,
      entry.updatedBy,
      entry.updatedAt,
      entry.previousStatus,
      entry.newStatus,
      entry.updateText,
    );
    return this.findById(updateId)!;
  },

  findById(updateId: string): DisruptionUpdate | null {
    const row = db
      .prepare('SELECT * FROM disruption_updates WHERE update_id = ?')
      .get(updateId) as UpdateRow | undefined;
    return row ? toUpdate(row) : null;
  },

  /** Full history for one disruption, oldest first. */
  history(disruptionId: string): DisruptionUpdate[] {
    const rows = db
      .prepare(
        `SELECT * FROM disruption_updates
         WHERE disruption_id = ? ORDER BY updated_at ASC, rowid ASC`,
      )
      .all(disruptionId) as UpdateRow[];
    return rows.map(toUpdate);
  },

  latest(disruptionId: string): DisruptionUpdate | null {
    const row = db
      .prepare(
        `SELECT * FROM disruption_updates
         WHERE disruption_id = ? ORDER BY updated_at DESC, rowid DESC LIMIT 1`,
      )
      .get(disruptionId) as UpdateRow | undefined;
    return row ? toUpdate(row) : null;
  },

  /**
   * Edits an existing entry in place while keeping the original text for the
   * audit trail. original_text is only written once - the first edit captures it.
   */
  edit(updateId: string, newText: string, editedBy: string, editedAt: string): DisruptionUpdate | null {
    const existing = this.findById(updateId);
    if (!existing) return null;
    db.prepare(
      `UPDATE disruption_updates
       SET original_text = COALESCE(original_text, update_text),
           update_text = ?,
           edited_text = ?,
           edited_by = ?,
           edited_at = ?
       WHERE update_id = ?`,
    ).run(newText, newText, editedBy, editedAt, updateId);
    return this.findById(updateId);
  },
};
