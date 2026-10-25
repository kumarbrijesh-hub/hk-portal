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
fallback. `DATABASE_URL` is what switches the app over — unset, the file is all
there is, which is how a local run works. `GET /api/health` reports which
backend is actually in use:

```json
{ "store": { "backend": "postgres", "connected": true, "pendingWrite": false }, "records": 412 }
```

`k8s/postgres.yaml` carries the database: a StatefulSet on its own 5Gi claim, a
ClusterIP Service, and a nightly `pg_dump` CronJob writing gzipped dumps to a
second claim (14 kept). The platform has no managed database, so backups are
ours to take — nothing else is taking them.

### The password is not in the repository

Both the database and the app read it from a Secret named
`blinkit-disruption-db`. Create it **before** applying the manifests, with a
password you generate yourself:

```bash
PGPW=$(openssl rand -base64 24 | tr -d '/+=' | head -c 24)
kubectl create secret generic blinkit-disruption-db \
  --from-literal=password="$PGPW" \
  --from-literal=url="postgresql://dms:${PGPW}@blinkit-disruption-db:5432/dms"
unset PGPW
```

Both keys hold the same password: `password` is what Postgres initialises with,
`url` is the connection string the app reads. They must agree — rotate them
together or the app silently falls back to the file store.

The app's `DATABASE_URL` reference is marked `optional`, so a missing Secret
leaves the console running on the file store rather than refusing to start. That
is deliberate, and it means a forgotten Secret shows up as `"backend": "file"`
on `/api/health` rather than as an outage.

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

```bash
kubectl exec -it blinkit-disruption-db-0 -- psql -U dms -d dms -c 'DROP SCHEMA public CASCADE; CREATE SCHEMA public;'
gunzip -c dms-<stamp>.sql.gz | kubectl exec -i blinkit-disruption-db-0 -- psql -U dms -d dms
```

Then restart the app pod so it reloads from the restored database.
