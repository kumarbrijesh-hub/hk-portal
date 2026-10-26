# Deploying to apps.blinkit.in

The Blinkit Apps project is already created, so the subdomain is reserved and the
platform-side wiring is done. What is left is shipping the source.

| Thing | Value |
|---|---|
| Project | `blinkit-disruption` |
| Namespace | `blinkit-apps-kumarbrijesh` |
| URL (locked) | https://star-marmoset.apps.blinkit.in |
| Container port | 8080 (`EXPOSE 8080`, Service `blinkit-disruption` on 8080) |
| Data | JSON store at `/data/store.json`, on a 1Gi PersistentVolumeClaim |
| Timezone | `TZ=Asia/Kolkata` set in the Deployment |

## Ship it (from this folder)

```bash
# one-time: install the CLI (the install page carries your token)
#   https://apps.blinkit.in/?tab=cli

chef skaffold up          # builds with local Docker, pushes, applies k8s/
# or, equivalently
chef push
```

The CLI builds the image from this folder with your own Docker daemon, which is why
it needs no source upload. `skaffold.yaml` and `k8s/deployment.yaml` here are the ones
the platform generated/expects — no edits needed.

## What runs

`npm run build` does two things: `vite build` emits the SPA into `dist/`, and `esbuild`
bundles `server.ts` into `dist/server.cjs`. The container runs only `dist/server.cjs`,
which serves the API and the built SPA from one process on port 8080
(`NODE_ENV=production` selects the static-file branch instead of Vite middleware).

`data/` is deliberately not in the image. The pod starts with an empty store and seeds
itself from `src/data/defaultConfig.ts` + `src/data/initialDisruptions.ts` (synthetic
demo records), so no real data ships in the build.

## After the first deploy

1. Share the master Google Sheet as **"Anyone with the link can view"**. The sync path
   is Google's public CSV export (`/export?format=csv`, `gviz/tq?tqx=out:csv`) — there
   is no service account, so a privately shared sheet returns Google's login HTML and
   the sync fails with a permissions error.
2. In **Google Sheet & Masters**, paste the sheet URL, confirm the tab name
   (`Live_data`) and the column mapping, then press **SYNC NOW**. None of this needs a
   code change — it is stored in the JSON config.
3. Replace the placeholder **Issue / Sub Issue** master on the same tab with the real list.

## Access control

Set `APP_PASSWORD` to put the whole app behind a shared password. Left unset, the
app is open to anyone who can reach the URL — fine for a preview, not for real
operational data.

```yaml
# k8s/deployment.yaml, in the container's env:
- name: APP_PASSWORD
  valueFrom:
    secretKeyRef:
      name: blinkit-disruption-auth
      key: password
```

```bash
kubectl create secret generic blinkit-disruption-auth --from-literal=password='<pick one>'
```

With it set, every `/api/*` route except `/api/health` needs a session cookie,
which `POST /api/auth/login` issues (HttpOnly, SameSite=Lax, 12 hours, `Secure`
behind the platform's HTTPS). Failed logins are throttled to 10 per 5 minutes per
IP. Note this is one shared password, not per-user accounts: the "Operator"
dropdown in the header is still self-selected, so the audit trail records who
*said* they made a change, not an independently authenticated identity.

## Where the data lives

Postgres is the system of record; the JSON file on the app volume is the local
fallback. `GET /api/health` reports which backend is actually in use:

```json
{ "store": { "backend": "postgres", "connected": true, "pendingWrite": false }, "records": 412 }
```

Postgres runs as a sidecar in the same pod as the app, started with
`listen_addresses=127.0.0.1`. Nothing outside the pod can reach it, and there is
no Service for it — the only clients are the other containers in that pod. The
volumes it needs are in `k8s/postgres.yaml`: 5Gi for the data, a second 2Gi claim
for the nightly dumps. The platform has no managed database, so backups are ours
to take — nothing else is taking them.

The dump runs in a third container in the same pod rather than as a CronJob,
because a CronJob pod cannot reach a database that only listens on localhost. It
wakes at 02:17 IST, writes `dms-<stamp>.sql.gz` to the backup claim via a
`.partial` name it then renames, and keeps a fortnight.

### The password is not in the repository, and not in a Secret either

An init container, `init-db-password`, generates a 40-character alphanumeric
password on first boot and writes it to the database volume:

- `/dbdata/secret/password` — what Postgres initialises with
  (`POSTGRES_PASSWORD_FILE`)
- `/dbdata/secret/url` — the connection string the app reads
  (`DATABASE_URL_FILE`)

Both are mode 600 and owned by uid 70, the postgres user in the image. The
container is idempotent: if the password file already exists it is reused, so a
restart does not lock the app out of its own data.

This means there is no Secret to create and no manual step before applying the
manifests. The literal never exists outside the cluster — not in git, not in a
manifest, not in a terminal history. `DATABASE_URL` is still honoured if it is
set directly, which is how a local run points at a development database.

If `DATABASE_URL_FILE` cannot be read, the app logs it and carries on with the
file store rather than refusing to start — a forgotten volume shows up as
`"backend": "file"` on `/api/health`, not as an outage.

### First boot and migration

On start the app reads the JSON file, then reconciles:

- Postgres empty → the file's records are written into it once, and the log says
  `[Store] Postgres is empty - seeding it from the file (N disruptions, …)`.
- Postgres has at least as many disruptions as the file → Postgres wins.
- The file has more (a flush lost to a crash) → the file wins and Postgres is
  rewritten from it.

That last rule is deliberately crude. It cannot silently drop records, which is
the only failure here that would not be recoverable.

### Restoring a dump

Everything runs in one pod, so the restore happens inside it. `POD` is the app
pod's name from `kubectl get pods`:

```bash
kubectl exec -it "$POD" -c db -- sh -c \
  'PGPASSWORD=$(cat /dbdata/secret/password) psql -h 127.0.0.1 -U dms -d dms \
     -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"'

kubectl exec -it "$POD" -c db -- sh -c \
  'gunzip -c /backup/dms-<stamp>.sql.gz | PGPASSWORD=$(cat /dbdata/secret/password) \
     psql -h 127.0.0.1 -U dms -d dms'
```

Then restart the pod so the app reloads from the restored database. Mind the
first-boot rule above: if the JSON file on the app volume still holds *more*
disruptions than the restored dump, the file wins and the restore is overwritten.
Clear `/data/store.json` in the same pod first if the dump is meant to be
authoritative.
