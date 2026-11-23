<!-- Subagent inventory report saved verbatim by the lead (bold markers removed). Source: code-explorer agent, read-only, no external contact, 2026-10-13, HEAD 381e943. -->

## Deployment and Operations Inventory

Paths are relative to C:\Dev\personal-finance-app. Labels: FACT means read in code. INFERENCE means reasoned from code. UNVERIFIED means it needs a live check.

### 1. Deploy path

render.yaml (68 lines) declares:
- One web service, `personal-finance-app` (render.yaml:14-19). Runtime node, plan `starter`, region oregon, `numInstances: 1`.
- Commands: `buildCommand: npm ci && npm run build` (:20); `preDeployCommand: npm run db:migrate` (:21), which is `drizzle-kit migrate`; `startCommand: npm run start` (:22), which is `node dist/index.js`; `healthCheckPath: /healthz` (:23); `autoDeploy: true` (:24).
- Env vars in the blueprint (:26-44): `NODE_ENV=production`; `TRUST_PROXY="1"`; `DATABASE_URL` from `fromDatabase` `personal-finance-db`; `REDIS_URL` from `fromService` keyvalue `personal-finance-cache`; `SESSION_SECRET` with `generateValue: true`; `CLIENT_URL` and `APP_URL`, both hardcoded to `https://personal-finance-app.onrender.com`.
- Commented-out optional vars (:45-49): SMTP_*, GEMINI_API_KEY, VAPID_*, CRON_SECRET. DB TLS verification is also commented out (:51-56).
- Key Value store `personal-finance-cache`: starter plan, oregon, `maxmemoryPolicy: allkeys-lru` (:58-62).
- Postgres `personal-finance-db`: `basic-256mb`, oregon, PG 16 (:64-68).
- Not declared: no `type: cron` services; no `disk:` block; no worker; no `ipAllowList` on the keyvalue service (UNVERIFIED whether the Blueprint spec requires it); no Dockerfile; no `NODE_VERSION` (`package.json` engines is `>=20 <21`, no `.nvmrc`).

scripts/verify-deploy-readiness.mjs (`npm run deploy:verify`) is purely file-based. It reads `package.json`, `.replit` and `render.yaml` and checks substrings. It never reads live infra, never boots the server and never hits an endpoint. Checks: build script equals an exact string (:23-27); start equals `node dist/index.js` (:28-31); `db:migrate` equals `drizzle-kit migrate` (:32-35); `.replit` has `deploymentTarget = "cloudrun"` etc. (:37-52); `render.yaml` contains `type: web`, the build command, `preDeployCommand: npm run db:migrate`, the start command, `healthCheckPath: /healthz`, `fromDatabase:` plus `personal-finance-db`, `REDIS_URL` from `personal-finance-cache`, `SESSION_SECRET` with `generateValue: true`, `CLIENT_URL` and `APP_URL` keys, `TRUST_PROXY` set to `"1"`, the strings `DATABASE_SSL_REJECT_UNAUTHORIZED` and `DATABASE_SSL_CA_FILE` (these pass on comments alone), `type: keyvalue` plus `allkeys-lru`.

Weaknesses: does not check that `/healthz` exists in code; does not check the Redis `ipAllowList`; does not check that `CLIENT_URL` matches the real host; requires `.replit` to exist; no CI job runs it.

CI (.github/workflows/ci.yml) runs `npm audit --omit=dev`, `npm run check`, `db:migrate` against a test Postgres, server and client tests, build, and the bundle budget. E2E runs with NODE_ENV=test. Nothing boots `dist/index.js` with `NODE_ENV=production`, so the prod-only paths in section 2 are never exercised by CI. `amplify.yml` is an Amplify Security scan only. There is no deploy workflow.

Risk to verify on first deploy (UNVERIFIED): `NODE_ENV=production` is set in the blueprint and `npm ci` runs in the build step. If Render applies that env var at build time, npm omits devDependencies. vite, esbuild, drizzle-kit and tsx are all devDependencies (package.json:185-194). That would break both `npm run build` and the preDeploy `db:migrate`.

### 2. Startup

Env validation. `validateEnvOrThrow()` runs at import of `server/app.ts:28`. Zod schema in `server/utils/validateEnv.ts`.
- Required always: `DATABASE_URL` valid `postgres(ql)://` URL (:53-62); `SESSION_SECRET` at least 32 characters (:65-69).
- Defaulted: `PORT` (5000), `NODE_ENV` (development).
- Required in production only (:139-155): `CLIENT_URL`; `REDIS_URL` must be `redis://` or `rediss://` (:37-43).
- Optional but validated if present: `GEMINI_API_KEY`; `VAPID_*` both or neither (:178-189); `CRON_SECRET` at least 16 characters (:129-136); `DATABASE_SSL*` contradictory combinations rejected (:157-176).
- Not in the schema: APP_URL, SMTP_*, TRUST_PROXY, SHUTDOWN_TIMEOUT_MS. If APP_URL is missing in production nothing fails at boot, but email links will be wrong.
- On failure it throws listing each variable (:237-248). Second guards for `SESSION_SECRET` at `app.ts:142-144` and `CLIENT_URL` at `app.ts:108-110`.
- Dotenv: `index-prod.ts:1` uses `dotenv/config`; `index-dev.ts:1` uses `dotenv-safe/config`.

Migration on deploy: Render `preDeployCommand` (render.yaml:21), not app start. `server/index-prod.ts:27-29` and `server/app.ts` contain no migrate call. `drizzle.config.ts:10-17` uses `dbCredentials.url` with no ssl setting; TLS behaviour of `db:migrate` against Render is UNVERIFIED. The runbook's claim that there are only "0000 + 0001" migrations (docs/runbooks/deploy.md:97) is stale.

Trust proxy (`server/app.ts:37-51`): with TRUST_PROXY unset it defaults to `1` in production and unset otherwise. render.yaml sets `"1"`. `getClientIp` relies on `req.ip` (rateLimit.ts:97-99).

Cookies (prod): session cookie (`app.ts:157-162`) `httpOnly`, `secure: NODE_ENV==="production"`, `sameSite: "lax"`, 30-day maxAge, not rolling, no custom cookie name. CSRF cookie (`app.ts:179-188`) named `__Host-csrf` in production, `httpOnly`, `sameSite: lax`, secure, path `/`. CSRF is skipped in tests, on safe methods, and for `/healthz*`, `/api/cron*`, login, MFA verify and resend, resend-verification, forgot-password, reset-password, register, logout (`app.ts:195-216`). Session store is `connect-pg-simple` with `createTableIfMissing: true` (`app.ts:146-153`), same pg pool (`max: 20`, `connectionTimeoutMillis: 2000`).

DB SSL (`server/dbSsl.ts`): SSL on when `DATABASE_SSL=true`, or when `NODE_ENV=production` and `DATABASE_SSL` is not `false` (:50-52). `rejectUnauthorized` true only if `DATABASE_SSL_REJECT_UNAUTHORIZED` is exactly `"true"` (:56-58). Current blueprint state: TLS on, certificate verification OFF, documented as staging-gated (render.yaml:51-56; deploy.md:110-127).

Graceful shutdown (`app.ts:329-394`): `SHUTDOWN_TIMEOUT_MS` defaults to 10000. SIGTERM/SIGINT set `isShuttingDown`, close server, poll connections every 500 ms, then `pool.end()` and exit. The Redis client is never closed; node-cron tasks are not stopped; in-flight cron runs are not awaited. `server/utils/processHandlers.ts:13-36`: unhandledRejection logged only; uncaughtException logs then exits after 100 ms.

### 3. Health and readiness

| Endpoint | File | Checks | Auth |
|---|---|---|---|
| `GET /healthz` | `app.ts:256-262` | Returns `{status:"ok"}`, or 503 if shutting down. Does NOT ping DB, Redis or migrations. | None. Not rate-limited. CSRF-exempt. |
| `GET /health/live` | `health.controller.ts:34-39` | Process uptime only. | None. `generalLimiter`. |
| `GET /health/ready` | `health.controller.ts:47-104` | 503 if shutting down. `SELECT 1` on the DB. The "cache" check is `cacheStore.getStats()`, in-memory only. | Same. |
| `GET /health/startup` | `health.controller.ts:112-115` | Delegates to ready. Docs claim it checks migrations and seed data; it does not. | Same. |
| `GET /api/health/routes` | `routes.ts:86-92` | Static JSON. | None. |

Render's health check (`/healthz`) stays green with the database or Redis down. No Redis ping and no migration-version check exist anywhere. `/health/ready` puts the process version and DB error messages into public JSON (`health.controller.ts:74`). The health module is mounted at `/health`, not `/api/health`.

### 4. Rate limiting and cache

- All limiters are created through `createLimiter` (`server/middleware/rateLimit.ts:75-83`) which builds a `rate-limit-redis` store per limiter via `buildStore` (:42-66) whenever `redis` is non-null. Every limiter uses Redis when `REDIS_URL` is set: `generalLimiter` 100/min, `analyticsLimiter` 30/min, `authLimiter` 10/min, `ipAuthLimiter` 5/min, `strictLimiter` 5/min, `expensiveAnalyticsLimiter` 10/min, `uploadLimiter` 20/hour.
- Fallback without Redis: default in-memory store (:44-51). `validateEnv` blocks production boot without `REDIS_URL`. So the CLAUDE.md audit claim "no limiter uses the Redis store" is stale.
- Keys: `user:<id>`, else IP bucketed by an IPv6 /56 subnet (:101-113). Strict and IP limiters are IP only.
- Redis client (`server/config/redis.ts:8-23`): ioredis with `maxRetriesPerRequest: null`, `enableReadyCheck: false`, retry back-off capped at 2 s.
- Outage behaviour (INFERENCE): ioredis queues commands while offline with no command timeout, so rate-limited requests could hang during a Redis outage. No `passOnStoreError` found. Scheduler locks fail closed in production (`redis.ts:158`). Redis outage behaviour is not tested or documented.
- Other Redis consumers: cache store `server/core/cache/store.ts`; `withCache` consumed in `services/transaction/queries.ts:188`, `AccountReportingService`, `AnalyticsCache`; AI per-household cap of 50 queries per 24 h via `redisIncrementWithTtl` (`modules/ai/ai.middleware.ts:60-100`) with in-memory fallback; AI two-level response cache (`ai.cache.ts`); snapshot worker locks (`jobs/snapshotWorker.ts:14-15, 43-66`); scheduler locks.
- Redis eviction policy `allkeys-lru` (render.yaml:62) could evict rate-limit counters, AI quota counters and scheduler locks along with cache entries (INFERENCE).
- Multi-instance: `numInstances: 1` today. If scaled out, limits, AI caps and scheduler locks are cluster-wide; per-process state remains in the L1 cache and the AI in-memory fallback.

### 5. Jobs

In-process node-cron (`server/scheduler.ts:119-158`), started from `initializeServices()` (`startup.ts:40`). Only three jobs: `0 8 * * *` daily security report (loops over all users and emails each); `0 2 * * *` notification cleanup; `0 9 * * 1` weekly recap email. Cron times use the server's local timezone. Each job is wrapped in `withRedisLock("scheduler:lock:<job>", 600 s)` (:99-114). A missed tick while the instance is down is skipped, no catch-up.

HTTP-triggered jobs (`server/routes/cron.ts`, mounted at `/api/cron`, `routes.ts:190`), all POST: `/snapshots`, `/recurring`, `/recurring-reminders`, `/budget-rollover`, `/budget-alerts`, `/goals-status`, `/goals-weekly`, `/goals-deadlines`, `/market-data` (FX plus security prices plus price alerts), `/investment-automation` (T-bill maturities plus due SIPs). Auth: `strictLimiter` plus `x-cron-secret` header (:28-54). No `CRON_SECRET` in production returns 403. The secret comparison is `!==`, not constant-time.

Gap: nothing calls these endpoints. render.yaml has no cron services and `CRON_SECRET` is not in the blueprint. No GitHub workflow calls them. `docs/runbooks/deploy.md` documents no schedule. Result: in production as declared, these never run: no recurring-transaction materialisation, no budget rollover, no net-worth snapshots, no FX refresh, no T-bill maturities or SIP execution, no goal reminders or budget alerts.

Dormant background workers (no callers outside their own definitions and tests): `startProcessor` (`core/events/processor.ts:128`), `startRunner` (`core/jobs/runner.ts:70`), `startReceiptMatchingJob` (`jobs/receiptMatcher.ts:17`). Outbox events published by `core/events/outbox.ts` are never processed in production. Receipt auto-matching never runs.

Locking and idempotency (not fully traced): scheduler jobs use a Redis NX lock with owner-token release script (`redis.ts:60-128`); snapshots use per-household per-day Redis lock plus completion key plus snapshot unique indexes; recurring and investment automation have key helpers at `services/recurring/materializationKey.ts` and `services/investment/investmentCronKeys.ts`. HTTP cron endpoints themselves take no lock.

### 6. Uploads

Files land on local disk under `process.cwd()/uploads/`, no object store: goal images `uploads/goals/<householdId>/` (`modules/goals/goals.images.controller.ts:71`); receipts `uploads/receipts/<householdId>/` (`services/receipt/upload.service.ts:87`); banners `uploads/banners/<householdId>/` (`settings.banner.controller.ts:42, 157`); profile pictures `uploads/profile-pictures/<householdId>/` (`settings.picture.controller.ts:51, 174`); transaction attachments `uploads/transactions/<txId>/` (`services/AttachmentService.ts:11`), with multer first writing to `uploads/temp/` (`transactions.routes.ts:223-228`). Account-deletion cleanup resolves under `process.cwd()/uploads` (`settings.account-deletion.files.ts:54`).

Ephemeral on Render: no `disk:` block, so every deploy and restart wipes these files; DB rows (`storagePath`, URLs) then point at missing files. Single-instance only. Not in any backup. No S3/GCS/R2 code exists.

Serving and auth: `app.ts:229` `app.get("/uploads/*", requireAuth, householdGuard, serveUpload)`. `server/middleware/uploadsAuth.ts` blocks `../` traversal (:70-82), allows only goals, receipts, banners and profile-pictures prefixes (:38-43), requires at least 3 path segments and the second segment to equal the caller's `householdId` (:106-117), then `res.sendFile`. Transaction attachments are served only via `/api/transactions/:txId/attachments/:id/download`. Receipt thumbnail/OCR image routes sit behind `requireAuth` and `householdGuard` (`receipts.routes.ts:21-22`). `merchant-logos` is outside the allowed prefixes, so `/uploads/merchant-logos/...` returns 403. Upload hardening exists: extension from validated mimetype (`server/core/uploads.ts:19-35`) and magic-byte checks (:45-58).

Repo hygiene (FACT): `git ls-files uploads` shows 30 tracked files: 15 profile-pictures, 8 merchant-logos, 4 receipts, 2 banners and 1 transaction file. User-uploaded content, including receipts, is committed in git. `.gitignore` does not exclude `uploads/`.

### 7. Email and providers

- SMTP (`server/services/emailService.ts:30-50`): required SMTP_HOST, SMTP_USER, SMTP_PASS; defaults SMTP_PORT=587, SMTP_SECURE=false; SMTP_FROM checked only at send time (:101-106). Unset in production: boot succeeds; `sendEmail` logs an error and returns `false` (:97-98). Unset in dev/test: warns and skips (:86-94). Callers must handle `false`; example `auth.mfa.service.ts:72`. Consequence: if SMTP is not set in Render, email verification, password reset and MFA email codes silently fail in production, and nothing at startup or in `/health/ready` reports it. Single lazily created transporter, no pooling or retry.
- AI (`server/modules/ai/ai.gemini.ts`): `GEMINI_API_KEY` unset means unavailable with a warning (:350-355). Hardcoded model `gemini-2.0-flash` (:27). Per-household 50/day cap.
- OCR: client-side `tesseract.js` in `client/src/hooks/useOcrProcessor.ts`. No server OCR provider.
- Push: `server/services/notification/push.ts:29-43` needs both VAPID keys, else warning and push off. `VAPID_SUBJECT` defaults to `mailto:admin@example.com`.
- FX rate source and refresh (`server/services/MarketDataService.ts:61-122`): tries Yahoo Finance `USDZMW=X`, then `https://api.exchangerate-api.com/v4/latest/USD`, and upserts a USD/ZMW rate for today. No in-process scheduler for this; refresh only through `POST /api/cron/market-data` (unscheduled) or an authenticated manual trigger (`routes/investment-market.ts:23`). Only USD→ZMW is fetched. The fallback fetch has no timeout or `response.ok` check. FX service cache TTL 5 minutes with a 30-day fallback (`server/startup.ts:32-36`). If nothing refreshes rates, multi-currency reports may refuse or degrade under the fail-closed guard.

### 8. Logging and observability

- Logger: custom JSON logger `server/utils/logger.ts` writing to console. No pino, winston, Sentry, Prometheus, OpenTelemetry or APM dependency. `server/config/logging.ts` defines retention constants not wired to any sink.
- Levels: `debug` emitted only when `NODE_ENV === "development"` (`logger.ts:126-130`). No `LOG_LEVEL` env.
- Structural flaw (FACT): `createLogEntry` (`logger.ts:76-108`) emits only a fixed set of fields (timestamp, level, message, requestId, truncated householdId/userId, route, method, duration, statusCode, error name and message). All other context keys are silently dropped. Many calls pass `{ error }`, `{ err }`, `{ lockKey }`, `{ ip, path }`, `{ jobName, error }` (`scheduler.ts:126`, `redis.ts:91`, `rateLimit.ts:125-130`, `cron.ts:71`, `app.ts:365, 385`). Production logs show a message with no cause.
- No stack traces in production (`logger.ts:97`).
- PII in logs: request bodies not logged (`app.ts:231-245`). Every API request produces two log lines (duplicate from `requestIdMiddleware`, `logger.ts:168-195`). Email addresses are interpolated into log message strings at `server/modules/auth/auth.email.service.ts:101, 103-104, 134, 136-137`. `redactSensitive` is exported but never applied. `error.message` is logged raw.
- Request correlation: `X-Request-ID` set (`logger.ts:174-175`), freshly generated, not propagated.
- Error handling: `apiErrorMiddleware` then fallback (`app.ts:265-313`); 5xx masked.
- Metrics: none. Alerting: none in repo. Log shipping: none.

### 9. Backup, restore, rollback

- Documented in `docs/runbooks/deploy.md:143-152`: code rollback via Render dashboard; DB restore from Render automatic backup or hand-written inverse migration. PITR availability on `basic-256mb` UNVERIFIED. Definition-of-done item "A rollback ... was exercised at least once" is unchecked (:186-189).
- Scripted: none. No backup/restore scripts, no `pg_dump` in any runbook, no migration down scripts.
- Compliance docs reference `docs/policies/data-retention-policy.md` and `docs/security/incident-response.md` (COMPLIANCE.md:26, 30) and say "Run backup and restore tests and record results" (:46); no evidence of a restore test found.
- Uploads: no backup path.

### 10. Gaps (control absent; where checked)

1. No scheduler for HTTP cron jobs (render.yaml, workflows, deploy.md, scheduler.ts).
2. Uploads on ephemeral disk; 30 uploaded files tracked in git.
3. Health check shallow (`app.ts:256`, `health.controller.ts`).
4. Observability: no error tracking, metrics or alerting; logger drops context fields; no stack in prod; no log-level control.
5. Email addresses in log message strings (`auth.email.service.ts:101, 103, 134, 136`).
6. SMTP failure silent in prod; SMTP_* not in the Zod schema.
7. DB TLS certificate verification off (`dbSsl.ts:56-58`, render.yaml:51-56).
8. No ipAllowList in the keyvalue block (UNVERIFIED).
9. Redis eviction `allkeys-lru` can drop locks and counters; no outage handling or timeout.
10. Dormant background workers (event processor, job runner, receipt matcher).
11. Backup/restore/rollback: no scripts, no tested restore, no PITR statement, no down path.
12. Deploy verification is string-matching only; nothing boots the production bundle.
13. `APP_URL` and `CLIENT_URL` hardcoded to `personal-finance-app.onrender.com`; APP_URL not validated at boot.
14. Graceful shutdown does not stop cron tasks, await jobs or close Redis.
15. No Node pin for Render.
16. Stale docs: deploy.md:97 migration count; `docs/system/health.md` startup claim; README lacks production steps.
17. Cron secret comparison not constant-time (`cron.ts:44`).
18. `VAPID_SUBJECT` placeholder default.
