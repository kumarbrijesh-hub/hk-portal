import bcrypt from 'bcryptjs';
import { db } from '../db/index.js';
import type { SessionUser } from '../types.js';
import { nowIso } from '../utils/time.js';

interface UserRow {
  id: number;
  email: string;
  name: string;
  password_hash: string;
  role: 'operator' | 'admin';
  is_active: number;
  created_at: string;
}

function toSessionUser(row: UserRow): SessionUser {
  return { id: row.id, email: row.email, name: row.name, role: row.role };
}

export const userRepo = {
  count(): number {
    return (db.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number }).n;
  },

  findByEmail(email: string): UserRow | null {
    return (db
      .prepare('SELECT * FROM users WHERE email = ? COLLATE NOCASE AND is_active = 1')
      .get(email.trim()) as UserRow | undefined) ?? null;
  },

  findById(id: number): SessionUser | null {
    const row = db
      .prepare('SELECT * FROM users WHERE id = ? AND is_active = 1')
      .get(id) as UserRow | undefined;
    return row ? toSessionUser(row) : null;
  },

  create(input: {
    email: string;
    name: string;
    password: string;
    role?: 'operator' | 'admin';
  }): SessionUser {
    const hash = bcrypt.hashSync(input.password, 10);
    const info = db
      .prepare(
        `INSERT INTO users (email, name, password_hash, role, created_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(input.email.trim().toLowerCase(), input.name.trim(), hash, input.role ?? 'operator', nowIso());
    return this.findById(Number(info.lastInsertRowid))!;
  },

  verify(email: string, password: string): SessionUser | null {
    const row = this.findByEmail(email);
    if (!row) return null;
    return bcrypt.compareSync(password, row.password_hash) ? toSessionUser(row) : null;
  },

  setPassword(email: string, password: string): boolean {
    const info = db
      .prepare('UPDATE users SET password_hash = ? WHERE email = ? COLLATE NOCASE')
      .run(bcrypt.hashSync(password, 10), email.trim());
    return info.changes > 0;
  },

  list(): SessionUser[] {
    const rows = db
      .prepare('SELECT * FROM users WHERE is_active = 1 ORDER BY name')
      .all() as UserRow[];
    return rows.map(toSessionUser);
  },
};
