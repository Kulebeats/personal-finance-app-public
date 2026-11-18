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
- Redis/Render Key Value is required in production. Rate limits, shared cache/counters, AI
  usage counters, and scheduler locks must be cluster-wide before increasing instance count.
- The blueprint keeps `numInstances: 1` for v1. Treat scaling beyond one instance as an
  operator action that requires the smoke tests below plus Redis connectivity checks.

---

## First-time setup (Render)

1. Push this branch and connect the repo to Render → **New > Blueprint**, select `render.yaml`.
   This provisions the Web Service + `personal-finance-db` (Postgres 16).
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
| `DATABASE_SSL` | optional | defaults on in prod; set `false` only for a local prod-mode test |
| `DATABASE_SSL_REJECT_UNAUTHORIZED` | optional | staging-gated; set `true` only after CA verification is proven against Render |
| `DATABASE_SSL_CA_FILE` | optional | mounted PEM path from a Render Secret File |
| `DATABASE_SSL_CA_CERT` | optional | inline PEM fallback; use `\n` escapes for dashboard env vars |
| `SMTP_HOST` … `SMTP_FROM` | feature | email / weekly recap; unset ⇒ email disabled, boot OK |
| `GEMINI_API_KEY` | feature | AI assistant |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` | feature | web push |
| `REDIS_URL` | yes (prod) | injected from Render Key Value; backs rate limits, shared cache/counters, AI caps, and scheduler locks |
| `CRON_SECRET` | optional | HTTP cron endpoints (`/api/cron/*`) |

---

## The deploy pipeline

Render runs these in order (configured in `render.yaml`):

| Step | Command | Notes |
|---|---|---|
| **Build** | `npm ci && npm run build` | produces `dist/public` (client) + `dist/index.js` (server bundle) |
| **Migrate** | `npm run db:migrate` (`preDeployCommand`) | applies versioned migrations before traffic shifts |
| **Start** | `npm run start` → `node dist/index.js` | binds `0.0.0.0:$PORT` |
| **Health check** | `GET /healthz` → `200` | Render waits for this before routing traffic |

Before opening or merging a deploy change, run the repo-level readiness guard:

```bash
npm run deploy:verify
```

This checks that `.replit`, `render.yaml`, and `package.json` still deploy the
Express backend, run versioned migrations, configure Redis, and expose `/healthz`.
It does not replace the live Render smoke tests in the definition of done.

### Database / migrations

- **Versioned migrations** are the source of truth. Schema lives in `shared/schema.ts`.
- To change the schema: edit `shared/schema.ts`, then `npm run db:generate` (writes a new
  file under `migrations/`), commit it, and deploy — Render's pre-deploy `db:migrate` applies it.
- **Do not use `npm run db:push` against production** — it does an imperative diff and can drop
  data. `db:push` is for local dev only.
- The migrations (`0000_*` baseline + `0001_*` snapshot idempotency indexes) build the current
  schema (verified: apply cleanly to an empty DB → 76 tables / 132 FKs, and the snapshot
  `ON CONFLICT` upserts resolve). The pre-`drizzle-kit` ad-hoc SQL is archived in
  `migrations-legacy/` for history only — it is not applied. **Known gap:** several other
  data-integrity constraints from the legacy ad-hoc SQL (additional unique + CHECK constraints,
  perf indexes) are not yet in `shared/schema.ts` and therefore not in these migrations — see
  the pre-merge review follow-up before relying on them in production.
- **Note:** 7 FK constraint names exceed Postgres's 63-byte identifier limit and are
  auto-truncated on apply. This is harmless under the `migrate` workflow (migrations are tracked
  by hash, not by diffing DB state) and was verified collision-free. If you ever adopt `db:push`
  against a real DB, give those FKs explicit `<63`-char names in `shared/schema.ts` first
  (see CLAUDE.md → DEPLOY-MIGRATE).

### SSL

`server/db.ts` enables TLS automatically when `NODE_ENV=production`. Certificate verification is
prepared but staging-gated: W5c adds the config path, and W9 flips it only after a real Render
database connection proves the CA settings work.

Strict verification options:

1. Preferred: add the Render/Postgres CA PEM as a Render Secret File and set
   `DATABASE_SSL_CA_FILE` to the mounted file path.
2. Fallback: set `DATABASE_SSL_CA_CERT` to the PEM content, using `\n` escapes if entered through
   an environment-variable dashboard.
3. Set `DATABASE_SSL_REJECT_UNAUTHORIZED=true`.
4. Redeploy staging and run the smoke checklist before making the same setting production-default.

Do not append `sslmode=require` to `DATABASE_URL` for this app. The Node `pg` client can let
connection-string SSL parameters override the explicit SSL object, which would bypass the CA
configuration above.

---

## Health check

```bash
curl -fsS https://<your-app>.onrender.com/healthz   # expect HTTP 200
```

**Smoke test that proves the proxy/cookie/SSL chain works end to end:** log in, then make a
second authenticated request and confirm the session persists (a logged-out second request
means `trust proxy` or the secure-cookie config is wrong).

---

## Rollback

1. **Code:** Render dashboard → the service → **Deploys** → pick the previous good deploy →
   **Rollback to this deploy**. Render keeps prior builds; this is near-instant.
2. **Database:** if the bad deploy ran a migration, roll the schema back *after* the code:
   - Restore from Render's automatic Postgres backup (point-in-time), **or**
   - Apply a hand-written inverse migration.
   Order matters: roll back code first (so the old code isn't talking to a new schema), then
   the DB only if the migration is incompatible.
3. Re-run the health check and the login smoke test after any rollback.

---

## Local production simulation (before pushing)

```bash
npm ci && npm run build
# point at a throwaway local DB; DATABASE_SSL=false because localhost has no TLS
DATABASE_URL=postgresql://USER:PASS@localhost:5432/THROWAWAY_DB \
NODE_ENV=production CLIENT_URL=http://localhost:5000 \
SESSION_SECRET=$(node -e "console.log('x'.repeat(40))") \
DATABASE_SSL=false \
node dist/index.js
# in another shell:
curl -fsS http://localhost:5000/healthz   # expect 200, no dotenv-safe crash
```

To test migrations against an empty DB locally:

```bash
psql "$ADMIN_URL" -c "CREATE DATABASE scp_test;"
DATABASE_URL=".../scp_test" npm run db:migrate    # expect "migrations applied successfully"
psql ".../scp_test" -c "\dt"                        # expect the full schema
psql "$ADMIN_URL" -c "DROP DATABASE scp_test;"
```

---

## Definition of done (SCP-306)

- [x] Repo deploy configuration passes `npm run deploy:verify`.
- [ ] Web Service is live on Render and `GET /healthz` returns 200.
- [ ] Login works and the session persists across requests (proves `trust proxy` + SSL + cookie).
- [ ] `db:migrate` ran in pre-deploy and the schema is present.
- [ ] A rollback to the previous deploy was exercised at least once.
- [ ] `CLIENT_URL`/`APP_URL` match the real assigned host.
