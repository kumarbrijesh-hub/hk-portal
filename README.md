# Blinkit Disruption

Operational disruption management system — live tracker, active-disruption dashboard,
Google Sheet master-data sync and hourly report download. Timezone: **Asia/Kolkata (IST)**.

## What is in here

| Path | Purpose |
|---|---|
| `config/app.config.json` | **All master/configuration data.** Sheet URL, column mapping, CC POC list, buckets, statuses, active-status rule, Issue/Sub Issue master, report sections. No code change is needed to edit any of these. |
| `server/` | Express + TypeScript API, SQLite storage, sheet sync, validation, reports, SSE. |
| `web/` | React + Vite SPA (Live Tracker, Live Active Disruption). |
| `Dockerfile` | Single-container build serving both. |

## Architecture

```
Google Sheet (master data, source of truth)
        ↓  automatic sync every N minutes + manual "Sync Now"
Cloud database / cached master dataset  (SQLite, WAL)
        ↓
API  ──  business rules, validation, audit trail, report generation
        ↓  Server-Sent Events for live refresh
React SPA  ──  fast Outlet ID lookup, never queries the sheet directly
```

The sheet is **never** queried on the user path. Outlet ID lookups read the synced
snapshot, so they stay fast, and a failed sync leaves the previous good snapshot in place.

## Setup

```bash
npm install
cp .env.example .env          # fill in JWT_SECRET and the bootstrap admin
npm run seed -- ops@example.com "Ops Admin" "<password>" admin
npm run seed:demo             # optional: synthetic outlets, to try the app before the sheet is wired
npm run dev                   # API on 127.0.0.1:8080, Vite on 127.0.0.1:5173
```

Production:

```bash
npm run build
npm start                     # serves the API and the built SPA from one process
```

Both the API and the dev server bind to loopback by default. Set `HOST=0.0.0.0` only
where a platform terminates TLS in front of the container.

## Configuration still needed

These are marked `PENDING` in `config/app.config.json` and must be supplied before
master-data sync can run. Everything else in the app works without them — the header
shows exactly what is missing.

| Key | Value |
|---|---|
| `googleSheet.url` / `spreadsheetId` | the master sheet |
| `googleSheet.masterDataTab` | tab name |
| `googleSheet.columns.*` | header label (or column letter) for outletId, storeName, city, mode, vendor, pocName, pocContact |
| `issueMaster` | real Issue → Sub Issue master (currently placeholder values) |

Sheet access, in order of preference:

1. **Service account** — share the sheet read-only with the service account's
   `client_email`, then set `GOOGLE_SERVICE_ACCOUNT_JSON` (or
   `GOOGLE_APPLICATION_CREDENTIALS`). Works with a privately shared sheet.
2. **Public CSV export** — no credentials, but the sheet must be
   "anyone with the link can view".

Credentials are read from the environment on the server only and are never sent to
the browser.

## Business rules (as implemented)

| Rule | Behaviour |
|---|---|
| Outlet lookup | Outlet ID resolves against the synced master data; store/city/mode/vendor/POC are read-only. |
| Disruption ID | `OutletID-YYMMDDHHMM` in IST, generated automatically. `ES001` + 09/09/2026 14:35:42 → `ES001-2609091435`. |
| Duplicates | Same outlet + same start minute is rejected with a link to the existing record — never a silent overwrite. |
| Ticket ID | Mandatory only when Bucket = `Breakdown`. |
| Issue / Sub Issue | Hidden unless status is `Resolved by RAC / OEM / Dealer / CC`; then both are mandatory and validated against the master. |
| Live Updates | Always appended as a new history entry. Editing keeps the original text plus who edited it and when. |
| Active | Every status **except** `Resolved by RAC`, `Resolved by OEM`, `Resolved by CC`, `Disable`. Note `Resolved by Dealer` counts as **active** — this follows the spec literally; change `inactiveStatuses` in the config to alter it. |
| Audit | Every create, status change and field change is recorded with actor, timestamp, previous and new value. |

Start time cannot be edited to a different minute, because the Disruption ID is derived
from it; the API rejects that and asks for a new record instead.

## Hourly report

`Live Active Disruption → Download Active Report`. Always restricted to the active set
and to the filters on screen, with a generation timestamp in IST.

- **Excel** (`.xlsx`) — headed summary rows, frozen header, autofilter, a separate
  "Auditing & Non-Admin Disruptions" block.
- **CSV** — same columns, UTF-8 BOM so Excel on Windows opens it cleanly.
- **HTML** (`Open hourly report`) — the shareable/printable layout: KPI tiles
  (Active Now, Total Duration, Avg Duration, Avg MST FRT, Avg CC FRT, each split by
  Breakdown / Non Breakdown) above the record tables.

## API

| Method | Path | Notes |
|---|---|---|
| `POST` | `/api/auth/login` `/logout`, `GET /me` | httpOnly cookie session, rate-limited |
| `GET` | `/api/config`, `/api/config/filters` | dropdown + filter options (no secrets) |
| `GET` | `/api/outlets/search?q=`, `/api/outlets/:id` | synced master lookup |
| `GET` | `/api/disruptions`, `/active`, `/preview-id`, `/:id`, `/:id/history` | |
| `POST` | `/api/disruptions`, `/:id/updates` | create, append Live Update |
| `PATCH` | `/api/disruptions/:id`, `/:id/updates/:updateId` | update record, edit an update |
| `GET` | `/api/sync/status`, `POST /api/sync/now` | sync state + manual sync |
| `GET` | `/api/reports/active/summary`, `/active.xlsx`, `/active.csv`, `/active.html` | |
| `GET` | `/api/events` | SSE stream driving live refresh |

Every endpoint except `/api/health` and login requires an authenticated session.

## Storage note

Storage is SQLite (WAL) behind a small repository layer, chosen so the app runs as one
container with a mounted volume. Every query lives in `server/src/repos/`, which is the
only place to change when moving to a managed Postgres — no service or route code
depends on the driver.
