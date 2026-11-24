# Deploy Runbook — Personal Finance App

> **Scope:** SCP-306 (Phase 0 deploy reconciliation). Target host: **Render**
> (Web Service + managed Postgres + Render Key Value/Redis). One instance is configured
> for v1, with Redis-backed cluster primitives required before any scale-out.
> Blueprint: [`render.yaml`](../../render.yaml).

## Why this exists

Previously `.replit` deployed a `static` target that published only the React bundle
(`dist/public`) to a CDN and never started a Node process — so the Express API, auth,
sessions, DB, and cron never ran. In production the **same Node process serves the API and
the built client** (`server/index-prod.ts`), so the fix is to run `node dist/index.js`, not
to publish static files.

---

## Architecture in production

```
Browser ──HTTPS──> Render proxy (TLS) ──HTTP──> Web Service: node dist/index.js
                                                   ├── serves /api/*  (Express)
                                                   └── serves dist/public + index.html (SPA)
                                                          │
                                                          └──TLS──> Render managed Postgres
```

- One process. Sessions are stored in Postgres (`connect-pg-simple`), so they survive restarts.
- Redis/Render Key Value is required in production. Rate limits, shared cache/counters and AI
  usage counters must be cluster-wide before increasing instance count.
- Scheduler locks are Postgres advisory locks, not Redis keys (OPS-013). Key Value runs
  `allkeys-lru`, so nothing that coordinates work may live there. Each scheduled run holds a
  job lock and a lock for its scheduled period, a heartbeat confirms both every 30 seconds,
  and the run's journal row (`jobs`, `scheduled:<job>`) records the period in
  `idempotency_key`. A delayed tick for a period that already completed is skipped. A run
  whose lock connection dies is closed as `LOCK_LOST`, never as a success, so readiness shows
  the job stale. Connect the app to Postgres directly or through a session-mode pooler:
  transaction pooling would move the session that holds the locks.
- The blueprint keeps `numInstances: 1` for v1. Treat scaling beyond one instance as an
  operator action that requires the smoke tests below plus Redis connectivity checks.

---

## First-time setup (Render)

1. Push this branch and connect the repo to Render → **New > Blueprint**, select `render.yaml`.
   The blueprint requests the Web Service + `personal-finance-db` with PostgreSQL
   major 18 for creation. It does not prove that an existing service was upgraded;
   verify the actual service major/version separately before enablement.
2. `DATABASE_URL` is injected automatically from the database. `SESSION_SECRET` is
   auto-generated. Set the remaining secrets in the dashboard as needed (see table).
3. After the first deploy, confirm the assigned URL (e.g. `https://personal-finance-app.onrender.com`).
   If Render assigned a different subdomain, update **`CLIENT_URL`** and **`APP_URL`** to match
   and redeploy — otherwise CORS/cookies will reject the real origin.

### Environment variables

| Var | Required to boot | Notes |
|---|---|---|
| `DATABASE_URL` | yes | injected from Render Postgres; TLS enforced (see SSL below) |
| `SESSION_SECRET` | yes | ≥32 chars; `generateValue: true` in the blueprint |
| `NODE_ENV` | yes | `production` |
| `CLIENT_URL` | yes (prod) | public origin; used for CORS + secure cookies. Boot fails closed if unset in prod |
| `PORT` | provided | Render injects it; the server binds `0.0.0.0:$PORT` |
| `TRUST_PROXY` | recommended | `1` so secure cookies are set behind Render's TLS proxy |
| `APP_URL` | recommended | same as `CLIENT_URL` for v1 |
| `DATABASE_SSL` | optional | verified TLS defaults on; `false` is restricted to explicit local development or guarded tests, never production |
| `DATABASE_SSL_REJECT_UNAUTHORIZED` | optional | verification defaults to `true`; `false` is rejected |
| `DATABASE_SSL_CA_FILE` | optional | mounted PEM path from a Render Secret File |
| `DATABASE_SSL_CA_CERT` | optional | inline PEM fallback; use `\n` escapes for dashboard env vars |
| `SMTP_HOST` … `SMTP_FROM` | feature | email / weekly recap; unset ⇒ email disabled, boot OK |
| `SMTP_FROM_NAME` | optional | From display name; unset or blank ⇒ `Personal Finance App` |
| `GEMINI_API_KEY` | feature | AI assistant |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` | feature | web push |
| `REDIS_URL` | yes (prod) | required production dependency; shared rate limits/cache need it. A logical DB is not eviction isolation, and durable job/AI authority belongs in PostgreSQL under the governing contracts |
| `CRON_SECRET` | optional | HTTP cron endpoints (`/api/cron/*`) |
| `PERSONAL_EXPORT_DIR` | feature (set in prod) | personal-data export files; see below. Unset ⇒ `<cwd>/private-exports/personal-data`, which is lost on every deploy and fails where the app user cannot write the working directory |
| `STORAGE_DRIVER` | no | `local` (default) or `s3`; the owner's choice (D18). See uploaded file storage below |
| `STORAGE_LOCAL_DIR` | feature (set in prod with `local`) | uploaded files. Unset ⇒ `<cwd>/private-objects`, which is lost on every redeploy of a container; must be on a persistent volume carrying a `.persistent-volume` marker |

### Personal-data export storage (`PERSONAL_EXPORT_DIR`)

Self-service exports (`POST /api/settings/privacy/export`) write one JSON file per export and
serve it for 7 days. The directory must be:

- **Persistent across deploys and restarts.** A ready export whose file is gone can no longer
  be downloaded. On Render the blueprint mounts the `app-data` disk at `/var/data` and sets
  `PERSONAL_EXPORT_DIR=/var/data/personal-exports`. On a container host, mount a volume for it.
- **Owned by the app user, mode `0700`** (files are written `0600`). The app creates the
  directory at boot when its parent is writable. If you create it yourself:
  `install -d -m 0700 -o <app-user> -g <app-group> <dir>` (for a container running as uid 1000,
  `-o 1000 -g 1000`).
- **Outside `uploads/`.** The app refuses a directory inside `<cwd>/uploads`, because `/uploads/*`
  serves that tree. Use a sibling, for example `/var/data/personal-exports` next to an uploads
  volume, never a subfolder of it.

At boot the app checks the directory. If it cannot be created or written, the log shows
`Personal-data exports are unavailable: set PERSONAL_EXPORT_DIR ...` with the path and the
reason, the rest of the app starts normally, and export requests answer
`503 EXPORT_STORAGE_UNAVAILABLE` without writing a row or audit entry. Fix the mount or
ownership and restart.

**Retention job `cleanup.personal-exports`** (in-process scheduler, daily at 02:30 UTC,
advisory lock key 111) deletes, in `PERSONAL_EXPORT_DIR`:

- the file of every ready export older than 7 days. The row stays and is marked `expired`
  (the user sees "Expired"; download answers 410), with one `DELETE` audit row
  (`entityType: data_export`, reason `retention`). If the file cannot be deleted, the row and
  audit roll back and the next run retries;
- any `<uuid>.json` file older than 24 hours that no ready export owns, such as a file an
  account erasure failed to remove after commit. Younger files are left alone, since they may
  belong to an export being created. Nothing else in the directory is touched.

It runs under the same job and period locks as every scheduled job, and readiness reports it
stale like the others.

### Uploaded file storage (`STORAGE_DRIVER`, `STORAGE_LOCAL_DIR`)

Every uploaded file (receipts and thumbnails, attachments, goal images, profile pictures,
banners, merchant logos) is stored in the ObjectStore, one checksummed object per file, listed
in the `storage_objects` table (OPS-001). Which backend runs in production is the owner's
decision (D18):

- `STORAGE_DRIVER=local` (the default). Objects go under `STORAGE_LOCAL_DIR`, default
  `<cwd>/private-objects`. That default lives on the container's own disk, so **on a container
  host every upload is lost on the next redeploy.** Set `STORAGE_LOCAL_DIR` to a directory on a
  persistent volume, owned by the app user and outside `uploads/` (the app refuses a directory
  inside `uploads/`).
- `STORAGE_DRIVER=s3` with the full `S3_*` set (`server/core/storage/config.ts`). Mixed settings
  (for example `S3_*` with the local driver) are refused.

**Marking the volume.** The app cannot tell a mounted volume from the container's own disk, so
the operator marks it once: create an empty `.persistent-volume` file in `STORAGE_LOCAL_DIR`
**on the mounted volume** (`touch <dir>/.persistent-volume`). Never create it on an unmounted
path.

**Boot log lines** (the app always starts):

- `File uploads are unavailable: check STORAGE_DRIVER and STORAGE_LOCAL_DIR (or the S3_* variables)`
  (error). The configuration is refused, or the directory cannot be created or written. Uploads
  and downloads answer `503 STORAGE_UNAVAILABLE`. Fix the setting, mount or ownership, then
  restart.
- `Uploads may not survive a redeploy: STORAGE_LOCAL_DIR has no .persistent-volume marker ...`
  (warning, production only, with the `root` it checked). Uploads work, but probably on the
  container's own disk. Mount a volume, point `STORAGE_LOCAL_DIR` at it and create the marker.

A file whose bytes no longer match the recorded sha256 answers `500 STORAGE_INTEGRITY` and is
never served.

**Moving files uploaded before OPS-001.** Older files sit under `<cwd>/uploads/` and are still
read from there until moved; nothing breaks if you do not move them. To move them, stop the
app, then run from the app's working directory, with its environment (`DATABASE_URL`,
`STORAGE_*`) and with dev dependencies installed:

```bash
npx tsx scripts/storage-legacy-move.ts                                   # dry run: counts only, changes nothing
npx tsx scripts/storage-legacy-move.ts --apply --report <report.json>   # move; <report.json> must not exist
npx tsx scripts/storage-legacy-move.ts --apply --resume --report <report.json> # continue an interrupted move
npx tsx scripts/storage-legacy-move.ts --rollback <report.json>         # undo exactly that move
```

The move copies each referenced file into the store, reads it back to check the sha256, and
writes its `storage_objects` row and a `storage_object` CREATE audit row in one transaction.
It never edits a referencing row and never deletes a file under `uploads/`. It is idempotent:
a separate run skips stored files. The apply command saves a run ID before copying, then records
that ID with each committed move. After an interruption, use the same report and environment
to resume or roll back just that run. A completed legacy report with explicit keys still
supports rollback. An old empty report lacks the information to recover its keys.
Referenced files that are gone are listed under `missing`;
paths outside `uploads/` are listed under `refused`. Keep the report somewhere private. It holds
file names, households, sizes and checksums, but no contents. Rollback deletes only the
objects and rows that move created, with a `storage_object` DELETE audit row each; reads then
fall back to `uploads/`. Before deleting an object, rollback checks the legacy file against the
recorded sha256. If the file is missing or different (for example after the pull below
removed it), it writes the object's checked bytes back first (`restored`). If the object itself
fails its check, rollback deletes nothing for that file and lists its key under `refused`.

**Erasure clean-up failures.** If account erasure cannot delete a stored file after its
transaction commits, the log shows `Account erasure could not delete a stored file; delete it
by hand` with the object key (or legacy name). The erased account also gets a `user_account`
audit row with `details.reason = "erasure_file_cleanup_failed"` listing the keys and names.
Delete those objects by hand. After a household delete, their manifest rows are already gone.

**Before pulling the commit that stopped tracking `uploads/`.** Pulling it deletes the 30
formerly tracked files from that checkout's `uploads/`. Run the move first, or restore the files
afterwards without touching the index: `git archive 28b433944 uploads | tar -x`.

---

## The deploy pipeline

Render runs these in order (configured in `render.yaml`):

| Step | Command | Notes |
|---|---|---|
| **Build** | `npm ci && npm run build` | produces `dist/public` (client) + `dist/index.js` (server bundle) |
| **Migrate** | `npm run db:migrate` (`preDeployCommand`) | applies versioned migrations before traffic shifts |
| **Start** | `npm run start` → `node dist/index.js` | binds `0.0.0.0:$PORT` |
| **Health check** | `GET /health/ready` → `200` | Render waits for this before routing traffic; the database (and Redis when configured) must answer. A stale scheduled job reports `degraded` but still `200` |

Before opening or merging a deploy change, run the repo-level readiness guard:

```bash
npm run deploy:verify
```

This checks that `.replit`, `render.yaml`, and `package.json` still deploy the
Express backend, run versioned migrations, configure Redis, and health-check `/health/ready`.
CI runs it in the quick and verify jobs. It does not replace the live Render smoke tests in
the definition of done.

### Database / migrations

- **Versioned migrations** are the source of truth. Schema lives in `shared/schema.ts`.
- To change the schema: edit `shared/schema.ts`, then `npm run db:generate` (writes a new
  file under `migrations/`), commit it, and deploy — Render's pre-deploy `db:migrate` applies it.
- **Do not use `npm run db:push` against production** — it does an imperative diff and can drop
  data. `db:push` is for local dev only.
- Pin the selected candidate's complete `migrations/meta/_journal.json` and SQL hashes,
  and verify empty/populated upgrade results on the approved protected target. Do not
  infer current schema/table counts from an older baseline result. `migrations-legacy/`
  is historical evidence, not a second migration runner.
- Constraint naming, legacy data-integrity gaps and rollback compatibility require their
  own evidence. PostgreSQL truncation is not a substitute for explicit reviewed names
  or proof of compatibility. Do not use `db:push` to work around a failed migration.

### SSL

The application pool and Drizzle migration tooling require verified TLS by default.
Production cannot disable TLS or certificate verification. Node's trusted CA store applies
unless an explicit CA bundle is configured; malformed or unreadable CA configuration fails closed.
Certificate hostname checks bind to the configured database host, including numeric endpoints.

Strict verification options:

1. Preferred: add the Render/Postgres CA PEM as a Render Secret File and set
   `DATABASE_SSL_CA_FILE` to the mounted file path.
2. Fallback: set `DATABASE_SSL_CA_CERT` to the PEM content, using `\n` escapes if entered through
   an environment-variable dashboard.
3. `DATABASE_SSL_REJECT_UNAUTHORIZED=true` is already the default; the blueprint sets it explicitly
   so the policy is visible in `render.yaml`. Never set it to `false` (rejected at boot).
4. Under explicit deployment authorization, prove the real staging target's CA/hostname and run
   the smoke checklist before production enablement. Real hosted identity evidence remains gated;
   a local TLS fixture does not establish Render connectivity. Do not disable verification to proceed.

`DATABASE_URL` accepts no query options except a single `sslmode=require` or
`sslmode=verify-full`; both retain full certificate and hostname verification. Other routing,
TLS and certificate-file URL overrides are rejected with a migration message. Configure CA
through the explicit variables above. The application and migration tooling pass explicit
connection fields to `pg`, preventing connection-string parsing from replacing TLS policy.
Passwordless URLs remain supported. Offline `npm run db:generate` needs no database credentials;
`db:migrate` requires valid connection configuration and does not inherit that generation exception.

---

## Health check

```bash
curl -fsS https://<your-app>.onrender.com/health/ready   # expect HTTP 200
# status: healthy | degraded (a scheduled job is stale) ; revision: the deployed git SHA
# scheduledJobs.jobs[]: each job's lastSuccessAt and stale flag
```

A job is stale when its last success is older than twice its interval (48 hours for a daily
job, 14 days for `recap.weekly`). A job that has never succeeded is measured from the
scheduler's first start against this database (a one-time `scheduler:started` row in `jobs`)
or the journal's first run, whichever is earlier. A fresh deploy is therefore not `degraded`
just because a job's first slot has not come round yet, and restarting the app never renews
that grace. In production, a never-run job with neither fact is stale (process start counts
only in dev and test). For the operator, `scheduledJobs.reasons` names any other cause of
`degraded`: `SCHEDULER_SWITCHED_OFF` (`NODE_ENV=production` with `SCHEDULER_ENABLED=false`,
so no process runs the jobs) or `SCHEDULER_START_UNRECORDED` (this process could not write
the start row; check the database grants on `jobs` and the "Scheduler start could not be
recorded" log).

**Cookie/session continuity smoke:** log in, then make a second authenticated request and
confirm the session persists. A logged-out second request requires investigation of the
session/auth/proxy/cookie chain; this smoke alone does not prove database CA/hostname
validation, required dependency readiness or every possible failure cause.

---

## Rollback

1. Quarantine unsafe traffic/effects and pin the failed/current and proposed rollback
   code/config/schema identities. Preserve evidence. Do not send an older binary traffic
   until its security and data contracts are proved against the retained migrated state.
2. Prefer that exact tested compatible code revision or a reviewed forward fix. Keep
   current migration/security state. Availability of a previous provider build is not
   rollback safety or timing evidence. In particular old code must not bypass erased-user,
   token-hashing or durable session-revocation protections.
3. Do not automatically restore an old database or write inverse SQL to undo a deploy.
   That can lose accepted writes and resurrect credentials, erasures, revoked sessions
   or file versions. If recovery is necessary, follow the separately approved
   [R19 recovery contract](../reviews/completion-v2-evidence/R19/RECOVERY-PLAN.md) with
   trusted DB/object artifacts, fresh security replay, explicit targets and operator gates.
   Provider backup/PITR availability, retention and key access are unverified until captured.
4. Before any owner-authorized release, verify `/health/ready`, cookie/session continuity,
   access denial, object/hash consistency and the exact compatibility result. If no safe
   earlier binary exists, stay quarantined and forward-fix; there is no universal code-first
   or database-first rollback order that replaces this analysis.

The governing targets are **RPO <=24h and RTO <=4h**, measured through complete joint
DB/object recovery, security replay and verified readiness. These are requirements,
not current achievements. See the [recovery policy](../policies/business-continuity-disaster-recovery.md)
for timing and unresolved provider/operator evidence.

---

## Local preparation and protected rehearsals

```bash
npm ci && npm run build
npm run deploy:verify
```

These commands prepare/check source; they do not prove a deployed service or restore.
Runtime/migration tests require a separately approved synthetic target manifest and
the protected bootstrap/runner, with persisted run-marker verification. Never point
a test at an ambient developer database or create/drop an arbitrary database from this
guide. Production does not permit `DATABASE_SSL=false`, even on localhost.

A real production-mode rehearsal additionally needs verified PostgreSQL TLS, owned
Redis, HTTPS browser trust and target/egress protection; see
[R20 production profile](../reviews/completion-v2-evidence/R20/PRODUCTION-PROFILE.md).
Missing facilities remain explicit blockers. `/healthz` is liveness; use bounded
`/health/ready` and controlled failure cases for dependency evidence. The guarded local
plaintext fixture profile is separate and cannot certify production TLS.

---

## Definition of done (SCP-306)

- [ ] Current candidate's repo deploy checks pass with recorded revision/output.
- [ ] Web Service is live on Render and `GET /healthz` returns 200.
- [ ] Login/session continuity is observed across requests; proxy/cookie and actual
  database TLS identity evidence are recorded separately.
- [ ] `db:migrate` ran in pre-deploy and the schema is present.
- [ ] Exact compatible rollback/forward-fix and joint recovery were exercised, including
  security replay and measured RPO <=24h / RTO <=4h; no assumed provider backup guarantee.
- [ ] `CLIENT_URL`/`APP_URL` match the real assigned host.
