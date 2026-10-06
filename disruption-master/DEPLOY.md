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
