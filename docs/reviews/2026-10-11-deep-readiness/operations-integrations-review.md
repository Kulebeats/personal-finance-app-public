# Operations and integrations deep review — 11 October 2026

Baseline: `381e9439afabe7c6cf829cb1cbded91d36da44ee` (`main`). Updated user objective: fully functional existing application, with staging and complete end-to-end evidence; the November deadline and reduced pilot scope have been withdrawn. Feature-off behavior remains necessary for outages/configuration, but disabling an advertised feature does not satisfy completion. This is a read-only source/configuration review; no application files, provider settings, databases, emails, or remote resources were changed. No tests, provider calls, or browser sessions were run by this review stream. Runtime evidence collected by the main assessment belongs in its evidence register; it must not be inferred from the source findings here.

The deployment foundation exists, but full operational completion remains unfinished. The repository does not establish durable file storage, current deployed identity, functioning financial schedules, verified database certificates, dependency-aware release health, or a demonstrated restore. Several reachable integration paths also contain defects which a development-mode browser smoke would miss.

## Scope and coverage

| Surface | Implementation | Source-verified strengths | Remaining verification/completion |
|---|---|---|---|
| Production entry/build | PRESENT | `server/index-prod.ts` serves compiled client alongside Express; `render.yaml:20-23` builds, migrates, starts, probes | Exact revision deployed on confirmed staging URL; current supported Node runtime; production browser paths |
| Migrations | PRESENT | Versioned `db:migrate` before traffic; CI uses migrations, not schema push (`.github/workflows/ci.yml:72-76`) | Empty and representative populated database migration proof; rollback/compatibility rehearsal; parent owns migration execution |
| Database TLS | PARTIAL | Production enables TLS; CA file/cert resolution and validation exist (`server/dbSsl.ts:22-62`) | Certificate verification defaults false; staging CA/hostname proof and approved configuration required |
| Upload storage | PARTIAL | Receipt type/size/magic-byte checks and household authorization exist | Persistent storage missing from blueprint; restart/redeploy and restore proof; orphan recovery |
| Receipt OCR | PARTIAL | Client lazy-loads OCR; server stores sanitized results; immediate matching exists | Production CSP conflicts with default OCR worker; OCR outcomes and correction/transaction read-back unexecuted here |
| Receipt retry worker | PRESENT but unreachable at startup | Retry queue and interval worker implemented | `startReceiptMatchingJob` has no application caller; automatic delayed retry is unproven and unwired |
| Internal schedules | PARTIAL | Three jobs wrapped in ownership-token Redis locks | Durable run ledger, lease renewal, timezone, retries, shutdown coordination, and multi-instance proof absent |
| Financial cron routes | PRESENT | Secret-gated endpoints for snapshots, recurring, budgets, goals, investments | No external schedules declared in blueprint; provider-side schedules unknown; observe actual runs and outputs |
| Redis/cache/rate limits | PARTIAL | Required production URL; shared stores/counters; production lock-acquisition errors fail closed | Bounded outage handling; actual health ping; eviction-safe coordination keys; cache invalidation under failure |
| Notifications | PARTIAL | User-scoped reads/mutations, pagination, preference checks, in-app unique dedupe, role-filtered household fan-out | Delivery truth/retry, HTML escaping, push endpoint validation, currency correctness, timezone/quiet-hour proof |
| Weekly recap | PARTIAL | Routes/settings/history, source-scoped spending/net worth, consent check before email, egress audit | Private recurring visibility, truthful failure states, currency semantics, connected preference behavior, email idempotency |
| AI assistant | PRESENT with local fallback | Household consent/admin mutation; scoped tools; central sanitizer; provider fallback; persisted user-scoped conversations; quota headers | Live provider/model viability, precise disclosure/input minimization, provider cancellation/usage accounting and operating caps |
| Health/observability | PARTIAL | Liveness/readiness, DB SELECT, request IDs, structured logging, shutdown flag | Redis/outage health; revision identity; preserved job/error metadata; alert delivery and operational owner |
| CI/test safety | PARTIAL | Node 20/PG16 isolated CI; coverage ratchets; production audit and build budgets; nine Chromium smoke specs | Local E2E DB/server identity guard; production security configuration coverage; mobile/WebKit/Firefox release evidence |
| Restore/rollback/support | UNKNOWN operationally | Deployment/rollback guidance and W9 evidence template exist | No fresh execution evidence established; storage+DB restore, RPO/RTO, support owner, incident procedure, budget |

Source verification proves reachable code and declared configuration, not deployed behavior or legal compliance.

## Findings

### [CRITICAL] OPS-005 — Weekly recap can disclose another member's private recurring bills

**Priority:** P0; required for full household functionality. **Confidence:** high; source path verified, synthetic cross-user execution still required.

`server/modules/weekly-recap/weekly-recap.service.ts:108-112` passes the caller's user ID into spending/net-worth operations but omits it from `getUpcomingRecurring`. That helper (`:273-309`) calls `recurringService.getUpcomingBills(householdId, ...)`. `server/services/recurring/RecurringBaseService.ts:41-45` delegates to `server/repositories/RecurringRepository.ts:133-161`, whose query filters household, active/paused state and due date, with no account-visibility predicate. Private-account recurring rules are possible: creation uses `accountRepository.findByIdWithVisibility(..., userId)` at `RecurringBaseService.ts:91-95`.

**Reproduction to execute in disposable data:** user A creates a recurring item against A's private account, due inside the requested recap week. User B in the same household requests `/api/weekly-recap`. Check whether A's item name, amount, and date appear; repeat generated/history/email paths and restricted roles. Household isolation alone does not satisfy private-account visibility.

**Fix:** carry the viewer identity into recurring reads and apply the same visibility policy as transactions/accounts. Apply this at the shared query boundary so recap, AI, reports, notifications, and direct recurring endpoints cannot diverge. This should be consolidated with the financial review's recurring authorization finding.

### [CRITICAL] OPS-008 — Push subscription accepts an arbitrary outbound HTTPS destination

**Priority:** P0 if web push is enabled; otherwise a hard prerequisite to enable it. **Confidence:** high on the SSRF path; no network exploit was attempted.

`server/modules/notifications/notifications.controller.ts:329-335` checks only that `subscription`, `endpoint`, and `keys` are truthy. `server/services/notification/push.ts:64-99` persists them. With VAPID configured and the user's push preference enabled, `:202-204` passes the stored subscription into `webpush.sendNotification`. The installed library parses the supplied URL and issues `https.request` against its hostname/port (`node_modules/web-push/src/web-push-lib.js:348-369`). The application has no endpoint scheme/host/address allowlist or egress boundary.

**Impact:** an authenticated member who supplies valid push encryption keys can make notification delivery contact an arbitrary HTTPS host from the server. HTTPS certificate checks limit some targets, but they do not establish that the destination is a browser push service. Delivery is asynchronous; this is not evidence that arbitrary responses are returned to the attacker.

**Fix:** schema-validate keys/endpoint, restrict destinations to explicitly supported push providers, reject credentials/nonstandard ports/private or loopback resolution, and enforce bounded connect/request timeouts. Test with a local controlled transport stub; do not probe real internal systems. Keep push off until completed.

### [HIGH] OPS-001 — Uploaded files have no declared durable deployment storage

**Priority:** P1; launch blocker whenever any upload feature is enabled. **Confidence:** high for the repository deployment definition; actual provider configuration unknown.

`server/services/receipt/upload.service.ts:87-105` writes images/thumbnails under relative `uploads/receipts/<household>/...` and then persists those paths. `server/middleware/uploadsAuth.ts:33` resolves its read root from the process working directory. The complete `render.yaml` defines web, key-value and PostgreSQL services without a disk or object storage. Goals, banners, profile pictures and transaction attachments also depend on the upload root. A database backup alone will not restore those bytes.

The parent assessment separately checked Render's documented ephemeral filesystem behavior. Do not treat the source finding as proof that the user's actual service lacks a manually configured disk; obtain that configuration evidence.

**Fix:** choose persistent disk for the declared single-instance deployment or object storage with authenticated reads; use one configured storage abstraction/root for all writers and readers. Include bytes in backup/restore, quotas and deletion. Test upload → authorized read → restart → redeploy → read → restore. For disk, explicitly accept single-instance and deployment availability constraints.

### [HIGH] OPS-002 — Release health can stay green while required Redis is unavailable

**Priority:** P1. **Confidence:** high.

Render probes `/healthz` (`render.yaml:23`), whose handler checks only the shutdown flag (`server/app.ts:256-263`). `/health/ready` executes a DB query (`health.controller.ts:71`) but calls synchronous `cacheStore.getStats()` for its cache check (`:83`); that method merely returns local counters (`server/core/cache/store.ts:288-289`). No Redis connection/read/write is tested. Yet production requires Redis for shared rate limits and job locks (`server/utils/validateEnv.ts:145-152`).

`server/config/redis.ts:10` sets `maxRetriesPerRequest: null` without an application command deadline. A disconnected Redis client can keep commands queued/retrying instead of reaching the fallback catch. Consequently a live process can pass its deployment probe while user requests/jobs wait on a dependency.

**Fix:** separate liveness from readiness, add bounded dependency probes and revision identity, route deployment readiness to the appropriate probe, and fail/disable affected operations within a defined timeout. Keep the response free of raw database/provider error detail. Prove Redis disconnect and recovery against a disposable environment.

### [HIGH] OPS-003 — Automatic financial processing is not fully wired or operationally evidenced

**Priority:** P1 for any advertised automation. **Confidence:** high for missing application wiring; external schedules unknown.

`server/startup.ts:40` starts `initScheduler`; `server/scheduler.ts:123,135,148` schedules only security reports, notification cleanup, and Monday recap emails. Financial work is exposed as HTTP jobs in `server/routes/cron.ts:57,80,126,201,254,332,357,382,407,440`, but the blueprint has no cron service or corresponding trigger configuration. `CRON_SECRET` is optional and, absent in production, rejects every cron request (`cron.ts:34-41`).

Receipt retries are a separate definite wiring gap: `server/jobs/receiptMatcher.ts:17-24` implements startup/interval behavior, but searching all non-test server code finds no caller of `startReceiptMatchingJob`. OCR invokes one immediate attempt through `server/services/receipt/index.ts:54-68`; later attempts scheduled by `matching.service.ts:88-101` are not consumed by that immediate call. `startRunner` in the generic jobs module is likewise exported/documented but has no application startup caller; inspect actual queued job producers before deciding its launch necessity.

**Fix:** publish one explicit job registry describing trigger, timezone, owner, due-run identity, lease, retries, catch-up, output invariant, and last-success monitor. Wire only required workers; configure external schedules deliberately. Prove recurring creation, snapshots, rollover and enabled investment automation by observing their persisted outputs after a scheduled tick and restart.

### [HIGH] OPS-004 — Receipt OCR conflicts with production Content Security Policy

**Priority:** P1; OCR is part of full existing functionality. **Confidence:** high source-derived incompatibility; browser reproduction pending.

`client/src/hooks/useOcrProcessor.ts:51-61` creates Tesseract's worker with only a logger override. Installed defaults set `workerBlobURL: true`, spawn `new Worker(URL.createObjectURL(blob))`, and import the worker from jsDelivr (`node_modules/tesseract.js/src/constants/defaultOptions.js`, `src/worker/browser/defaultOptions.js`, `src/worker/browser/spawnWorker.js`). Language data also defaults to jsDelivr (`src/worker-script/index.js:127-139`). Production `server/app.ts:59-77` uses `scriptSrc: ["'self'"]`, `connectSrc: ["'self'"]`, and no worker allowance. The development/test configuration disables this CSP.

**Fix:** preferably package/self-host the worker, language and WASM assets with narrowly scoped CSP directives; do not solve by disabling CSP. Verify real production response headers and OCR execution, failed asset download, mobile memory/cancel/unmount behavior, and persisted corrected data.

### [HIGH] OPS-006 — Recap can publish false zero values and incorrect currency labels

**Priority:** P1 if recap is enabled. **Confidence:** high.

`weekly-recap.service.ts:207-211`, `:264-266`, and `:314-318` catch upstream failures and return successful zero/empty data. A missing FX rate or report outage can therefore appear as no spending, zero net worth or no bills, including in an emailed financial digest. The browser has no structured degraded-state signal.

The recap also discards currency context and can label household totals as the user's unrelated display currency. Spending/net-worth repositories calculate in household currency (`server/repositories/reports/SpendingReportRepository.ts:97-113,311`, `NetWorthReportRepository.ts:53-55`); email formatting instead uses `userDisplaySettings.currency || "ZMW"` (`weekly-recap.email.service.ts:264-280`) without conversion. Recurring totals simply sum raw amounts (`weekly-recap.service.ts:297-310`), without account-currency conversion.

**Fix:** retain Money DTO currency through the recap contract; convert only with an explicit rate/date policy. Return unavailable/error states when inputs fail and suppress misleading emails. Use independent expectations for a ZMW household, USD display preference, multi-currency recurring items, and deliberately absent FX.

### [HIGH] OPS-009 — User-controlled names are interpolated directly into notification emails

**Priority:** P1 if financial notification/recap emails are enabled. **Confidence:** high for HTML injection; mail-client script execution is not claimed.

`server/services/notification/email.ts:25-34` inserts `title`/`body` directly into HTML. These values contain stored goal/budget/merchant names (`notification/service.ts:213-216,235-248,277-289`). Recap directly inserts category and bill names (`weekly-recap.email.service.ts:189,204`). No HTML escaping occurs at these output boundaries.

**Impact:** a stored name containing markup can alter email layout or insert deceptive links/images for another household member. Most mail clients block scripts; that does not prevent HTML content injection.

**Fix:** encode all text values at the HTML boundary, validate any URL separately, and retain literal plain-text output. Test hostile names across both templates with assertions on generated HTML, followed by a controlled mail-sink preview.

### [HIGH] OPS-010 — Notification delivery status and deduplication do not reflect channel outcomes

**Priority:** P1; reliable supported notification channels are required for full functionality. **Confidence:** high.

`sendEmail` returns `false` for missing SMTP, missing sender, and send failure (`server/services/emailService.ts:81-122`). `notification/service.ts:461-469` ignores that boolean and logs that the notification email was sent. Dedupe uses the in-app notification record (`:71-105`): if an in-app row exists but email fails, the next attempt skips delivery; when in-app is disabled, there is no created record to reserve an email/push dedupe key. Quiet-hour messages are suppressed (`:108-145`), without a deferred delivery mechanism. This is acceptable only if suppression is the explicit product contract.

**Fix:** model delivery per channel with queued/sent/skipped/failed status, retry policy and durable unique event/channel identity. Handle the boolean result and display honest capability/status. Verify email-only duplicate invocation, in-app-success/email-failure retry, quiet hours, invalid push subscriptions, and provider recovery.

### [HIGH] OPS-011 — Local browser suites can mutate the wrong environment and bypass production protections

**Priority:** P1 verification-safety gate. **Confidence:** high; no suite was run by this stream.

`playwright.config.ts:17,42-53` uses fixed localhost:5000, starts `npm run dev` with `NODE_ENV=test`, and reuses an existing server locally. `e2e/global-setup.ts:75-96,325-334` independently imports `server/db`, updates the resolved user's email verification/lock/MFA flags, and has no dedicated-database assertion or binding between the server and database identity. This can target the ambient development database, or a different database than the reused server.

The server Vitest guard is an improvement (`server/vitest.config.ts:20-33`), but it applies only to that runner. Its helper checks database names (`server/testing/test-database.ts:90-128`), not proof of ownership/disposability. CI supplies ephemeral databases; a local database named `*_test` is not automatically disposable.

Browser smoke also bypasses CSRF (`server/app.ts:198`), production CSP/secure cookies, production Redis requirement, SMTP, and standard rate limits (`server/middleware/rateLimit.ts:155-240`). CI smoke selects Chromium only (`package.json:36`). Therefore a green smoke suite cannot close those release checks.

**Fix:** use a dedicated port, explicit disposable database identity, test-run marker/ownership checks, and reject unknown existing servers. Add a distinct production-mode HTTPS staging suite covering cookies, CSRF, rate limits, CSP/OCR, real email via a controlled inbox, and mobile/relevant browsers. Keep auth fixture bypasses out of end-to-end verification of email/MFA itself.

### [HIGH] OPS-013 — Coordination uses expiring/evictable Redis keys without durable run identity

**Priority:** P1 for reliable scheduling; verify the declared single-instance deployment and any supported scaling topology. **Confidence:** high for architectural limitation, no duplicate run claimed as observed.

Ownership-token release and production acquisition failure handling are good (`server/config/redis.ts:78-120,158`). However locks expire after ten minutes (`server/scheduler.ts:23`) without renewal, are deleted when the callback completes, and contain no scheduled-date completion key. Two instances whose same scheduled tick is delayed beyond the first instance's completion can each run. A callback lasting beyond the TTL can overlap another holder. `render.yaml:62` puts caches, rate limits, and locks together under `allkeys-lru`, so memory pressure may evict coordination/quota state.

**Fix:** use durable per-job/per-period unique run records and idempotent effects; renew leases or bound/split work; use an eviction policy/storage separation suitable for coordination. Test overlapping invocations, delayed same-tick invocation, crash-after-write, lease expiry and memory-pressure scenarios. Until then do not claim exactly-once cluster execution from a mutex alone.

### [HIGH] OPS-015 — Database certificate verification remains an unfinished release gate

**Priority:** P1; close before real sensitive data. **Confidence:** high for defaults; actual deployment flags unknown.

`server/dbSsl.ts:57-62` sets `rejectUnauthorized` only when explicitly configured true. The blueprint provides only comments directing a later CA mount and verification flip (`render.yaml:51-56`). Encryption alone does not authenticate the database endpoint. The historical W9 checkpoint explicitly leaves this operation pending.

**Fix:** establish the correct target/CA, verify normal connectivity, enable strict certificate verification in staging, reject a wrong CA/hostname, and rerun the functional smoke. Also inspect migration connection TLS separately from the app connection. Do not weaken verification to get a green deployment.

### [MEDIUM] OPS-007 — Saved recap content preferences do not govern generated content

**Priority:** P2 implementation order; completion is mandatory for the advertised controls. **Confidence:** high for content flags.

`weekly-recap.controller.ts:307-350` persists `includeGoals` and `includeRecurring`. The generated service contract (`weekly-recap.service.ts:87-172`) reads neither flag, always computes recurring items, and contains no goal section. Email likewise does not read them. `client/src/pages/settings/sections/WeeklyRecapSection.tsx:181-213` exposes these as content controls. The scheduler always runs Monday (`scheduler.ts:83,148`); the UI's day text concerns display, so changing that control is not alone proof that email scheduling violates a promise.

**Fix:** decide and document whether flags govern dashboard, wizard and email, then implement that policy consistently for the advertised controls. Keep first-day-of-week separate from email delivery day/time. Test settings save/reload plus visible generated/email content, not only database persistence.

### [MEDIUM] OPS-012 — AI privacy/cost controls need precise boundaries before provider enablement

**Priority:** P1 completion/enablement gate; full AI functionality must be demonstrated. **Confidence:** high on source behavior.

Central tool sanitization and fail-closed unknown tools are present (`ai.sanitizer.ts:380-456`), but user messages receive only whitespace/control-character normalization (`ai.guardrails.ts:225-235`). That string goes directly into `geminiClient.analyzeQuery` and response generation (`ai.service.ts:217-222,272-276`). Selected stored user messages are replayed too. Canonical draft consent text says personal names/contact details are removed and that context adds no additional personal data (`docs/ai-integration/specifications/ai-assistant-consent-disclosure-copy.md:13-16,30-35`), which overstates what happens if the user types an email/name/account number.

Provider code fixes the model name to `gemini-2.0-flash` (`ai.gemini.ts:27`), and `isAvailable()` only tests that a model object exists (`:381-383`), not successful current provider access. The parent checked Google's [official Gemini deprecation schedule](https://ai.google.dev/gemini-api/docs/deprecations) on 11 October 2026: it lists 1 June 2026 as the shutdown date for this model, with the document's qualification that schedule dates are the earliest possible dates. Therefore model support must be refreshed before provider enablement. This source-review stream made no provider calls; the parent's separate runtime evidence records a failed dummy-key Gemini attempt and local keyword fallback, not a successful provider response. Actual project-level availability remains unverified, and that failure does not isolate model lifecycle as its cause. Timeout uses `Promise.race` without cancelling the request (`:690-701`); token usage is estimated and capped in returned telemetry (`:453-457,605-606`), not measured from provider usage. These controls should not be presented as an exact spend ceiling.

**Fix:** explicitly disclose typed-query/context transmission or implement appropriate input minimization; obtain product/privacy owner approval for actual processing. Keep provider disabled until supported-model smoke, cancellation/error paths, consent revoke, quota/outage policy, and real usage/cost alerts are evidenced. Avoid a high-cost model escalation as the solution to deterministic financial calculations.

### [MEDIUM] OPS-014 — Job outcomes and errors are lost by the structured logger

**Priority:** P1 operational acceptance gate, small implementation scope. **Confidence:** high.

`server/utils/logger.ts:76-108` serializes a fixed list of fields and ignores other context keys. Many callers supply `{error}`, `{sent, failed}`, `{jobName}`, `{lockKey}` or provider metadata only in context (`scheduler.ts:84-88,125-153`; `config/redis.ts:91-94`). Those diagnostics are discarded; only errors passed as the third `logger.error` argument survive. `redactSensitive` exists but is not invoked by the serializer.

**Fix:** define a structured, recursively redacted allowlist/schema for operational context and standardize error arguments. Verify serialized output contains job identity/count/outcome/reason while excluding passwords, tokens, raw queries and personal financial details. Prove that one induced job failure produces an actionable alert to a named owner.

## Operational gaps requiring evidence, not speculative bug claims

- **OPS-E01 staging identity:** confirmed owner-supplied URL, provider service identity, deployed full SHA, environment name, public origin match, health and authenticated smoke. The parent refreshed the blueprint default host on 11 October; `.local/readiness-2026-10-11/render-probe.json` records root and `/healthz` timeouts and `/health/ready` returning HTTP 404 at `2026-10-11T18:45:34.960Z`. This artifact was inspected here. The default URL remains a candidate, not proof of the actual environment or a verified deployment.
- **OPS-E02 current gates:** parent owns fresh dependency audit and test execution. Current raw `.local/readiness-2026-10-11/dependency-audit.json` metadata was inspected here: 9 affected production package entries, including 1 critical and 4 high. These are package/advisory findings, not 9 proven reachable exploits. Historical zero vulnerabilities and July CI cannot establish October vulnerability status. Node runtime policy must be refreshed; `package.json:7` and CI currently pin Node 20.
- **OPS-E03 restore and rollback:** `docs/runbooks/deploy.md:145-152` describes restoring a backup or writing an inverse migration. It is not evidence of a successful restore, acceptable data loss, upload restoration, or compatible rollback. `docs/system/deployment.md:194-197` contains generic DB commands, not a staged exercise.
- **OPS-E04 migration parity:** runbook `deploy.md:97-103` still says some legacy constraints are missing, while later versioned migrations exist. Reconcile this against the actual schema/migration results; do not repeat the old gap as a current defect without checking. Parent owns empty/populated migration execution.
- **OPS-E05 email readiness:** blueprint labels SMTP optional, and startup does not validate complete SMTP/APP_URL delivery capability. Complete invitation, verification and recovery delivery is required. Prove deliverability in controlled mailboxes and clear unavailable behavior; do not reset users to bypass a failed flow.
- **OPS-E06 capacity/cost:** no measured representative load or verified operating bill established. Budget compute, PG storage/backups, Redis, upload storage/egress, email, AI, monitoring and domains. Quote live provider prices separately; do not derive affordability from outdated tier comments.
- **OPS-E07 operating ownership:** select a support inbox/owner, incident contact, first-week daily checks, backup retention, access review and alert recipient. A document listing these is not proof of delivery or restore.

## Historical reconciliation

| Earlier claim/gate | Current disposition | Evidence and qualification |
|---|---|---|
| Redis limiters unused, June audit | Resolved in reachable code | Shared Redis store wired by `server/middleware/rateLimit.ts:42-81`; production config required. Live outage behavior remains OPS-002/013. |
| Cron double-fire closed in July 4 assessment | Partially resolved | Ownership locks present, but no durable scheduled-run identity/lease renewal; only three registered internal jobs; OPS-003/013. |
| AI sanitizer coverage closed | Resolved for registered tool result routing; broader disclosure incomplete | `ai.sanitizer.ts:380-456`; raw typed/replayed query path remains OPS-012. |
| Unauthenticated uploaded files closed | Resolved in reachable code | `server/app.ts:229` and `middleware/uploadsAuth.ts` enforce household and path boundaries; durable storage/CSP separate OPS-001/004. |
| Weekly recap consent closed | Present in current email path | `weekly-recap.email.service.ts:250-261` rechecks consent before data generation/send. This does not resolve private recurring visibility or truthful amounts. |
| AI conversation persistence/fallback gaps | Substantial later implementation present | `ai.conversation.service.ts`, repository, `ai.service.ts:300-338`, scoped integration tests exist; fresh execution remains separate. |
| W9 staging/TLS/rollback | Still unverified; default host remains unsuitable for proof | July 7 checkpoint records a non-app/default host. Parent's fresh October 11 artifact shows timeouts/404; no confirmed actual owner URL or provider configuration establishes readiness. TLS/rollback still unexecuted here. |
| W10 all-module readiness | Remains gated | Existing worksheet requires staging, exact release SHA, TLS, rollback and final evidence. Local source conclusions cannot remove those gates. |
| Local server tests can delete development data | Improved but not universal | New Vitest resolver/guard present; browser global setup is outside it (OPS-011). |
| Past zero production vulnerabilities | Obsolete as a current claim | Parent fresh audit supersedes it; link raw current evidence in main report. |

## Completion specification packets

Effort is engineer-days for one primary developer, excluding wait time for provider access or owner decisions. Ranges are planning estimates, not delivery promises. Security/common infrastructure cannot be waived by hiding an unrelated page. Packets overlap with main assessment work and must be deduplicated there.

| Packet | Links | Scope, owner and dependencies | Acceptance criteria and evidence | Effort |
|---|---|---|---|---|
| **OPS-W1 Safe audit/release environments** | OPS-011, E01/E02 | Engineer/QA. Explicit test URL/port/DB identity/run token; supported Node/PG policy; separate production-mode suite; no arbitrary existing-server reuse. Depends on provisioned disposable environment. | Given an unknown server/database, setup refuses before writing. Given an owned fixture, tests mutate only its rows. Staging suite proves secure cookies, CSRF denial/approval, real auth verification/recovery, rate-limit behavior and mobile flow with SHA recorded. | 1–2 |
| **OPS-W2 Durable files and recovery** | OPS-001, E03 | Engineer/ops owner. One upload store across receipts/attachments/profile/goals; additive path compatibility; size/quota/error/deletion policy; backup bytes and DB references. Exclude OCR redesign. | Upload then restart/redeploy retains exact hash and permissions; cross-household read denied; file-write or DB-write failure leaves no unusable accepted object; restore into a fresh target produces working authorized downloads; document measured RPO/RTO. Roll back using compatible paths, not by deleting uploads. | 1.5–3 |
| **OPS-W3 Dependency health, TLS and operations** | OPS-002/013/014/015, E01/E03/E07 | Engineer/ops owner. Bounded DB/Redis readiness, deployed SHA, certificate verification, safe structured logs, alerts. Separate transient cache from coordination state or adopt safe policy. | Redis/DB disconnect gives bounded readiness failure; dependent requests terminate within defined budget; valid CA connects and wrong CA fails; alert reaches named recipient; secret/PII log fixtures are redacted; code rollback rehearsed with compatible schema. Preserve existing liveness semantics. | 2–4 |
| **OPS-W4 Reliable schedules** | OPS-003/013 | Backend engineer. Required jobs only; registry, durable run identity/outcome, lease/retry/catch-up policy, timezone, graceful stop. Wire receipt worker for the existing automatic matching/retry workflow. Decide external scheduler vs worker deliberately. | One due item yields one persisted financial effect across simultaneous, delayed, retried and restarted runs. Failure before commit leaves no partial financial state; after commit retry deduplicates. Missed run is caught up; last-success monitor detects staleness. Receipt pending match later resolves after a transaction arrives. | 2–4 |
| **OPS-W5 Recap privacy and financial contract** | OPS-005/006/007 | Backend/frontend engineer with product owner. Carry viewer identity and Money DTO currency; explicit unavailable state; content settings actually applied. Coordinate with global recurring authorization/FX packet. | A private recurring item is absent for another member across API, history, email and AI consumers. 100 ZMW remains labelled 100 ZMW or converts using a recorded rate; USD/ZMW bills are not raw-summed. Missing FX/report failure produces no zero-success digest. Saved content flags change generated output. | 2–4 |
| **OPS-W6 Safe outbound channels** | OPS-008/009/010, E05 | Backend engineer. Push destination schema/egress policy, escaped HTML templates, per-channel delivery status/idempotency and controlled retries. Product owner decides quiet-hour defer vs suppression. Controlled enablement follows completed validation. | Arbitrary/private push destinations rejected before transport; valid provider endpoint accepted. Hostile names render literally. Email false/timeout recorded failed; retry sends once without duplicating successful channels. Recipient preference and consent revocation stop subsequent sends. Live proof uses controlled mailboxes only. | 2–4 |
| **OPS-W7 Production OCR** | OPS-004 | Frontend/backend engineer. Self-host or tightly allow required worker/WASM/language assets, keep CSP. Preserve upload/auth constraints. | Production HTTPS browser scans known synthetic receipt, shows bounded progress/error/cancel, persists corrected OCR and creates/links transaction once. Unauthorized image fetch fails; asset outage yields recoverable state; mobile first scan measured. | 1–2 |
| **OPS-W8 Complete AI provider behavior** | OPS-012 | Product/privacy owner + engineer. Supported-model provider path; truthful query/context disclosure; cancellation and actual usage telemetry, quotas and cost alert. No new premium model escalation required. | Consent absent/revoked causes zero provider calls. Approved typed-query/context policy is reflected in UI and request fixture. Supported provider completes grounded answers; unsupported/timeout provider falls back clearly; user/household context remains isolated. Provider usage and costs reconcile within stated tolerance. Feature-off behavior is tested as a failure/configuration state, not counted as AI completion. | 2–4 |

**Completion scope:** complete all existing advertised operations, including OCR, AI provider, web push, emailed recap and scheduled financial processing. The earlier reduced-pilot/feature-disable option is historical and no longer meets the user's goal. This does not add unrelated products such as bank integrations or subscriptions; new enhancements remain a separate backlog.

**Delivery implication:** estimate the complete dependency graph with financial/auth repairs and owner/provider lead times. Start staging/storage/environment packets early. Release-candidate stabilization and controlled household UAT follow functional completion; no November date or scope-cut assumption is imposed.

## Required operating evidence before invited households use real data

1. Full release SHA, supported runtime and lockfile identity on staging, plus current exact-SHA CI/audit results.
2. Private/shared account and household boundary browser/API/database proof with two users and a separate household.
3. Verified invitations, verification/recovery and support contact for all supported entry flows.
4. Persistent upload restart/redeploy/read-back, DB-and-files restore into a fresh target, and measured recovery time/data-loss window.
5. Strict DB certificate verification and production HTTPS session/CSRF/CSP behavior.
6. Scheduled-run output/idempotency proof for every enabled automation and staleness/failure alert delivery.
7. Bounded Redis/DB/provider failure and recovery; no false financial zero-success state.
8. Verified working OCR, AI, push and email recap, plus truthful unavailable/error states; an unavailable capability is not marked complete.
9. Named operational monitor, incident/rollback decision owner, retention policy and live provider budget.

## Review Summary

| Severity | Count | Status |
|----------|-------|--------|
| CRITICAL | 2 | block |
| HIGH | 10 | warn |
| MEDIUM | 3 | info |
| LOW | 0 | pass |

Verdict: **BLOCK for full functional and operational completion.** Close private recurring disclosure and push destination validation, then satisfy the remaining fixes and end-to-end operating evidence for every existing feature. This source assessment does not claim those failures have been reproduced in staging, nor that unprovided staging/provider configuration is absent.
