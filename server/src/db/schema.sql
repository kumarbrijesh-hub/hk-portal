-- Blinkit Disruption schema. All *_at columns hold ISO-8601 UTC strings.

CREATE TABLE IF NOT EXISTS users (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  email          TEXT NOT NULL UNIQUE,
  name           TEXT NOT NULL,
  password_hash  TEXT NOT NULL,
  role           TEXT NOT NULL DEFAULT 'operator',   -- operator | admin
  is_active      INTEGER NOT NULL DEFAULT 1,
  created_at     TEXT NOT NULL
);

-- Master data mirrored from the Google Sheet. Never edited from the app.
CREATE TABLE IF NOT EXISTS outlet_master (
  outlet_id    TEXT PRIMARY KEY,
  store_name   TEXT NOT NULL DEFAULT '',
  city         TEXT NOT NULL DEFAULT '',
  mode         TEXT NOT NULL DEFAULT '',
  vendor       TEXT NOT NULL DEFAULT '',
  poc_name     TEXT NOT NULL DEFAULT '',
  poc_contact  TEXT NOT NULL DEFAULT '',
  synced_at    TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_outlet_master_store ON outlet_master (store_name);
CREATE INDEX IF NOT EXISTS idx_outlet_master_city  ON outlet_master (city);

CREATE TABLE IF NOT EXISTS disruptions (
  disruption_id         TEXT PRIMARY KEY,
  outlet_id             TEXT NOT NULL,
  store_name            TEXT NOT NULL DEFAULT '',
  city                  TEXT NOT NULL DEFAULT '',
  mode                  TEXT NOT NULL DEFAULT '',
  vendor                TEXT NOT NULL DEFAULT '',
  poc_name              TEXT NOT NULL DEFAULT '',
  poc_contact           TEXT NOT NULL DEFAULT '',
  disruption_start_at   TEXT NOT NULL,
  cc_poc                TEXT NOT NULL,
  bucket                TEXT NOT NULL,
  ticket_id             TEXT,
  current_status        TEXT NOT NULL,
  issue                 TEXT,
  sub_issue             TEXT,
  -- Optional operational metrics surfaced in the hourly report.
  cc_frt_mins           INTEGER,
  mst_frt_mins          INTEGER,
  audit_duration_hrs    REAL,
  resolved_at           TEXT,
  latest_live_update    TEXT NOT NULL DEFAULT '',
  last_updated_by       TEXT,
  last_updated_at       TEXT,
  created_by            TEXT NOT NULL,
  created_at            TEXT NOT NULL,
  updated_at            TEXT NOT NULL,
  -- Derived from current_status on every write so active filtering stays indexable.
  is_active             INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_disruptions_active   ON disruptions (is_active, disruption_start_at);
CREATE INDEX IF NOT EXISTS idx_disruptions_outlet   ON disruptions (outlet_id);
CREATE INDEX IF NOT EXISTS idx_disruptions_city     ON disruptions (city);
CREATE INDEX IF NOT EXISTS idx_disruptions_status   ON disruptions (current_status);
CREATE INDEX IF NOT EXISTS idx_disruptions_start    ON disruptions (disruption_start_at);

CREATE TABLE IF NOT EXISTS disruption_updates (
  update_id       TEXT PRIMARY KEY,
  disruption_id   TEXT NOT NULL REFERENCES disruptions (disruption_id) ON DELETE CASCADE,
  update_text     TEXT NOT NULL,
  updated_by      TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  previous_status TEXT,
  new_status      TEXT,
  original_text   TEXT,
  edited_text     TEXT,
  edited_by       TEXT,
  edited_at       TEXT
);

CREATE INDEX IF NOT EXISTS idx_updates_disruption ON disruption_updates (disruption_id, updated_at);

CREATE TABLE IF NOT EXISTS audit_log (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_type    TEXT NOT NULL,          -- disruption | disruption_update | outlet_master | auth
  entity_id      TEXT NOT NULL,
  action         TEXT NOT NULL,          -- create | update | status_change | live_update | edit_update | sync | login
  field          TEXT,
  previous_value TEXT,
  new_value      TEXT,
  actor          TEXT NOT NULL,
  at             TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_log (entity_type, entity_id, at);

CREATE TABLE IF NOT EXISTS sync_state (
  id               INTEGER PRIMARY KEY CHECK (id = 1),
  last_attempt_at  TEXT,
  last_success_at  TEXT,
  status           TEXT NOT NULL DEFAULT 'never',   -- never | syncing | success | failed
  record_count     INTEGER NOT NULL DEFAULT 0,
  error            TEXT,
  duration_ms      INTEGER
);

INSERT OR IGNORE INTO sync_state (id, status) VALUES (1, 'never');
