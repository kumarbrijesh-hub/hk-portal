import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { env } from '../env.js';

const here = path.dirname(fileURLToPath(import.meta.url));

export const db = new Database(env.dbPath);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 5000');

/** Applies schema.sql. Every statement is idempotent, so this is safe on every boot. */
export function migrate(): void {
  const schemaPath = [
    path.join(here, 'schema.sql'),                       // dev (tsx, src/)
    path.join(here, '..', '..', 'src', 'db', 'schema.sql'), // build (dist/)
  ].find((candidate) => fs.existsSync(candidate));

  if (!schemaPath) throw new Error('schema.sql not found');
  db.exec(fs.readFileSync(schemaPath, 'utf8'));
}

export function transaction<T>(fn: () => T): T {
  return db.transaction(fn)();
}
