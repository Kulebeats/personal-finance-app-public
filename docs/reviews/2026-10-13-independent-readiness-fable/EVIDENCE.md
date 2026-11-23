# C. Evidence register

Independent readiness assessment of the personal finance app ("Capital"). Assessor: Claude Fable 5.1 as lead with Opus 5.5 domain verifiers. Independence rule: the 2026-10-11 package under `docs/reviews/2026-10-11-deep-readiness/` was deliberately not read; the owner will compare the two.

## 1. Identity of what was assessed

| Item | Value |
|---|---|
| Repository | C:\Dev\personal-finance-app |
| Branch / HEAD | `main` @ `381e9439afabe7c6cf829cb1cbded91d36da44ee`, equal to `origin/main` after fetch (2026-10-13T20:09Z) |
| Working tree | untracked only: `.claude/launch.json` (local launch config; an `audit` entry was added for this assessment), `docs/reviews/2026-10-11-deep-readiness/` (prior assessment, unread), and this package |
| Worktrees | none besides the main checkout |
| Open PRs (not merged, not assumed correct) | #149 hooks money-guard precision, #150 MFA flag honesty, #151 CI concurrency, #152 GRZ route split (draft) |
| Host | Windows 11, Node v22.23.2, npm 11.19.1, PostgreSQL 18.6 (local), host timezone Africa/Lusaka (UTC+2), DB session TimeZone Africa/Johannesburg |
| CI pins | Node 20, `postgres:16` (`.github/workflows/ci.yml`) — local results are not environment-parity proof |
| Deployed environment | none reachable; `render.yaml` declares a Render web service that has not been provisioned. No staging URL was available, so "verified on deployed environment" is not claimed for anything |
| Trackers | Linear not authorised in this session (blocked); GitHub via `gh` |

## 2. Environments created for verification (all disposable, synthetic data only)

| Environment | How | Purpose |
|---|---|---|
| `finance_app_test` | `npm run db:test:setup` (drizzle-kit push) | `npm run test:server:run` target; refused by the vitest guard unless test-scoped |
| `finance_app_audit_fable_20261013` | `CREATE DATABASE` + `drizzle-kit migrate` from empty (migrations 0000–0011 applied in 4.9 s) | browser journeys and all HTTP/DB probes; served by the app on port 5055 |
| `finance_app_audit_fable_e2e` | `CREATE DATABASE` + `drizzle-kit migrate` | Playwright smoke target (run blocked, see §5) |
| Audit app server | launch config `audit` → `npm run dev` with `DATABASE_URL` swapped to the audit DB, `PORT=5055`, `SMTP_HOST=127.0.0.1:2525` (local sink, no outbound mail), `GEMINI_API_KEY=''` (AI unconfigured), `LOG_LEVEL=debug`, `NODE_ENV=development` (rate limiters and CSRF active) | runtime verification |
| SMTP sink | `.local/readiness-fable-2026-10-13/smtp-sink.mjs` on 127.0.0.1:2525, appends every message to `smtp-sink.log` | capture verification, reset, invitation, MFA and recap emails |
| HTTP helper | `api.mjs` (cookie jar + CSRF double-submit), `q.mjs` (read-only SQL against audit DBs only), `mkuser.mjs`, `verify-in-db.mjs` (fixture shortcut: marks synthetic users verified because F-AUTH-04 blocks the API path from a fresh session) | scripted probes |
| Real dev DB `finance_app` | never written; `q.mjs` refuses non-audit DB names | — |

Note on environment correction: the first server start loaded the real `GEMINI_API_KEY` from `.env` because `dotenv` re-injects a deleted variable; one chat request reached Google and failed with a provider error (no successful external AI call, no quota consumed on the provider). The server was restarted at 20:48Z with the key explicitly empty, and `GET /api/ai/status` then reported `degraded: true`.

Timeline: baseline 20:09Z; inventories 20:10–20:25Z; suites 20:11–20:35Z; browser journeys 20:13Z onward; domain verifiers first launched 20:44Z, terminated by an account spend limit ~21:10Z, relaunched 22:15–22:20Z after the session resumed (audit server restarted 22:13Z, Postgres-backed sessions survived).

## 3. Automated verification results (executed once per baseline)

| Command | Result | Classification | Log |
|---|---|---|---|
| `npm run check` | exit 0 in 9.3 s (tsc, storage-import guard, LOC ratchet, node tool syntax, module-assessment metadata/report `--check`, w9/w10 coverage) | static | `.local/readiness-fable-2026-10-13/npm-check.log` |
| `npm run test:server:run` | `Test Files 201 passed (201)`, `Tests 2660 passed (2660)`, 400 s, against `finance_app_test` | mixed: 77 real-DB files (45 over HTTP), 70 mock-based, 54 pure unit (see inventory-verification-system.md) | `test-server.log` |
| `npm run test:run` (client) | `Test Files 164 passed (164)`, `Tests 1384 passed (1384)`, 318 s | jsdom, all mocked, UI behaviour only | `test-client.log` |
| `npm run build` | vite + esbuild, built in 11.7 s | build | `build-and-gates.log` |
| `npm run check:bundle` | pass, 300 kB gzip initial-JS budget | static | same |
| `npm run deploy:verify` | pass (string checks on package.json, .replit, render.yaml only; no live infrastructure) | static | same |
| `npm audit --omit=dev` | exit 1: 9 vulnerabilities (1 critical `proxy-addr`, 4 high `multer` x5 advisories, `nodemailer` x7, `ip-address` x7, 4 moderate `body-parser`, `csv-parse`, `qs`, `sharp`/libvips) | dependency | `evidence/npm-audit-prod-2026-10-13.txt` |
| `drizzle-kit migrate` on empty DB | 12 migrations applied in 4.9 s; schema identical to push-built (925 columns, 202 indexes, 662 constraints, zero differences) | migration path | `migrate-audit-db.log`, `schema-diff-migrate-vs-push.txt` |
| `npm run test:e2e:smoke` (own DB, SMTP sink) | 71 failed in 59.6 s, all at `browserType.launch`: Playwright expects `chromium_headless_shell-1208`, host has 1223 | BLOCKED (environment); CI installs browsers itself | `e2e-smoke.log` |
| CI on main | not re-run; last known state from git history only | configured, not executed here | — |

Interpretation: green suites prove the tested behaviour; they do not negate the runtime defects below, several of which sit in client code paths or client↔API contracts that the mocked client suite cannot catch.

## 4. Runtime verification (browser + HTTP + database read-back)

Browser: the app's built-in browser pane against http://localhost:5055, Chromium 1280×720, user `audit_owner_a` in "Audit Household A" (ZMW). Thirteen of the 21 journeys (R1–R7, R9–R11, R14, R17, R21) have a database read-back; the rest are browser or HTTP observations only.

| # | Journey | Result | Evidence |
|---|---|---|---|
| R1 | Register | 201; user row with hashed verification token; `security_audit_logs` REGISTER row; session established immediately (unverified) | DB read-back 20:16Z |
| R2 | Verification email | captured by sink; link `/auth/verify-email?token=` → app 404 page (F-AUTH-01); same token at `/verify-email` → "Email verified", `email_verified=true`, token cleared | sink log, browser, DB |
| R3 | Household create | 201; `households` + `household_members(owner)`; 0 categories seeded, tags seeded (F-ONB-01); audit row `household_preferences` CREATE | DB |
| R4 | Account create (UI) | 201; `balance=initial_balance=1000.00`, ZMW, owner set; two audit rows (F-ACC-02); Accounts page shows "No accounts yet" under default `ownerUserId=shared` filter while net worth shows K1,000.00 (F-ACC-01); "All" filter lists it | network bodies, DB |
| R5 | Second account (HTTP) | 201; 500.00 savings | DB |
| R6 | Expense 125.50 (UI) | 201; balance 874.50; audit row; category picker offered only Uncategorized (F-TXN-02); stored with owner despite "Shared" (F-TXN-03); summary panel 0 transactions (F-TXN-01: stale 5-minute summary cache plus UTC month range; the first "exclusive endDate" reading was withdrawn after a re-test at 23:05Z showed the endpoint inclusive) | network, DB |
| R7 | Transfer 200.00 checking→savings (UI) | 401 STEP_UP_REQUIRED (FINANCIAL, 5 min) → step-up dialog → `POST step-up` 200 → transfer 201; two paired legs (`is_transfer_in` false/true, `transfer_transaction_id` set); balances 674.50 / 700.00; audit row | network, DB |
| R8 | Dashboard | net worth K1,374.50 = 674.50+700.00; recent transactions correct; "Budget: Expenses K0.00 spent" vs "Spending K125.50" (same end-date issue); greeting "Good morning, User" at 22:40 | browser |
| R9 | Goal create (UI wizard) | 201; `goals` row target 5000.00, type save_up/emergency_fund, audit row; Continue with type "Other" and empty specify field does nothing silently (F-GOAL-UX-01) | DB |
| R10 | Recurring create (UI) | 400 VALIDATION_ERROR `frequency` and `nextDueDate` required; no UI error (F-REC-01); inline merchant created and orphaned | network body |
| R11 | Members → Add member (UI) | `POST /api/household/members` 404 HTML; toast "Unexpected token '<'" (F-HH-01); members list shows "Unknown User" (F-HH-03); fake plan panel (F-HH-02) | network, browser |
| R12 | Investments page | empty-state gate blocks GRZ/tax/pension tabs (F-INV-01) | browser |
| R13 | Reports / Cash Flow | totals consistent with ledger (K125.50 expenses, K1,374.50 net worth); "InvalidDate" axis label (F-REP-01); avg monthly over future months (F-CF-01) | browser |
| R14 | Thandi (AI) | consent gate → consent 200 → chat with provider failure returns 200 and an empty "Based on your financial data:" reply, quota 50→49, `ai_query` audit row with `provider_error: EXTERNAL_API_ERROR`, `used_gemini:false`, `data_sanitized:true` (F-AI-01); with empty key `status.degraded=true` | browser, DB |
| R15 | Login | wrong password → 401 "Invalid email or password" (no enumeration); correct → dashboard; login page fires two unrelated error toasts (F-UX-01) | browser |
| R16 | Security settings | sessions list and login history render; no MFA controls (F-SEC-05); login-history times two hours ahead of sessions list (F-DATE-01b) | browser |
| R17 | Password reset | forgot-password 200 → sink email → `/reset-password?token=` (route exists) → reset 200; other HTTP session 401 afterwards; `session` table empty for the user; browser session also revoked; login with new password 200 | sink, HTTP, DB |
| R18 | Unauthenticated CSRF | fresh cookie jar: `GET /api/csrf-token` sets `csrf-token` cookie, `POST /api/auth/verify-email` with header → 403 CSRF_INVALID, repeatable (F-AUTH-04) | curl |
| R19 | Auth rate limit | scripted register→resend→verify→login from one IP hit 429 on login (F-SEC-04b) | HTTP |
| R20 | Receipt upload (UI) | dialog renders (file input + "Upload & Scan"); file upload not exercised in the built-in browser; HTTP path covered by the import/receipts verifier | browser |
| R21 | Timestamps | API returns `createdAt: 2026-10-13T22:29:06.479Z` for a row stored at 20:29Z; UI shows "10/14/2026" for an account created 13 Oct (F-DATE-01) | JS fetch, DB |

Domain verifier results (budgets/goals/recurring, import/receipts/organisation, investments/GRZ, reports consistency, security/privacy, settings/notifications/AI/deletion) are in `evidence/domain-*.md` and summarised in GAPS.md. The adversarial skeptic pass (`evidence/skeptic-pass.md`, Opus 5.5) reproduced ISO-01, PRIV-01/02/03, RC-01 and IMP-01 live, reconciled all 21 audit accounts and 89 transactions with zero drift, and found the bookkeeping errors corrected in this revision (RC-01 root cause, over-claims on view_only and read-back counts, coverage rows, ID collisions, weekday dates, effort sums).

## 4b. Re-verification on 14 October (after the cross-read with the 11 October package)

Audit server restarted with the same `audit` launch entry (port 5055, `NODE_ENV=development`, SMTP sink, AI key empty) against `finance_app_audit_fable_20261013`; sessions in the saved cookie jars were still valid (Postgres-backed). Household A5, actor `audit_a5_member`. Full commands, ids and before/after snapshots: `evidence/findings-draft.md`, "14 Oct re-verification".

| # | Probe | Result | Evidence |
|---|---|---|---|
| R22 | ORG-003: member rule with categorize and add_tags values taken from household A4; create a matching transaction in A5 | 201; transaction stored with A4's category id and linked to A4's tag; A4 tag usage count 0 → 1. A4's own tag-transactions endpoint did not list the row | HTTP + DB read-back |
| R23 | ORG-004: dry-run of an add_tags rule, then of a split_transaction rule, with DB snapshots before and after | add_tags: `transaction_tags` 0 → 1, `usage_count` 2 → 3, response `proposedUpdates: {}`; split: `transaction_splits` 0 → 2, response proposes a note only | HTTP + DB read-back |
| R24 | AH-09: member demoted to view_only; `PUT /api/settings/preferences` | 200; `household_preferences` row for the household written; admin reads the new values | HTTP + DB read-back |
| S1 | ORG-001: `server/middleware/validateEntity.ts:266-301` | `professional` absent from the hierarchy; comparison with `undefined` is false; guard passes | source |
| S2 | FIN-03: `server/services/ImportService.ts:279-352` | account-level overwrite selects by account id only, no paired-transfer deletion | source |

Cleanup: the three probe rules were deleted through the API and the member role restored; the probe transaction, its two split rows and the foreign tag link remain in the disposable database. The audit server was stopped afterwards.

## 5. Blocked or not exercised

| Check | Status | What is needed |
|---|---|---|
| Playwright smoke locally | BLOCKED by browser build mismatch | `npx playwright install chromium` (a ~150 MB download; owner approval) |
| Deployed environment (Render) | BLOCKED, nothing deployed | provision per render.yaml; then W9-style staging checks |
| Linear status | BLOCKED | authorise the Linear connector or export the board |
| Real email delivery | not exercised by design (sink) | staging SMTP test |
| External AI call | not exercised by design (empty key) | staging with a quota-bearing key |
| Market-data fetch (Yahoo / exchangerate-api) | not exercised (external) | staging run of `POST /api/cron/market-data` |
| Push notifications | VAPID unset; subscribe path only | staging with VAPID keys |
| Mobile layout | partial: viewport checks on dashboard/transactions only (see COVERAGE.md) | device testing in pilot |
| Receipt upload through the browser UI | not exercised (no file-chooser automation in the pane) | manual check; HTTP path verified |
| Backup/restore drill | not possible (no deployment) | run on staging; record results |

## 6. Where the raw evidence lives

- Durable, sanitised: this directory (`evidence/*.md`, `evidence/*.txt`).
- Raw logs and helper scripts (gitignored): `.local/readiness-fable-2026-10-13/` (`npm-check.log`, `test-server.log`, `test-client.log`, `build-and-gates.log`, `e2e-smoke.log`, `migrate-audit-db.log`, `schema-diff-migrate-vs-push.txt`, `smtp-sink.log`, `jars/`, `api.mjs`, `q.mjs`, `mkuser.mjs`, `verify-in-db.mjs`, `AGENT-BRIEF.md`).
- Credentials: synthetic only (`*@audit.invalid`); no real credentials or secrets were written to any artifact; the `.env` database URL was only ever read in memory with the database name swapped.

## 7. Historical-finding reconciliation

By design this assessment did not read the earlier assessment packages. Reconciliation against them is therefore left to the owner's comparison. Two historical claims recorded in the repository instructions were checked incidentally:

| Claim (source) | Current evidence | Status |
|---|---|---|
| "`./migrations` is inert; `drizzle-kit generate` is never run" (CLAUDE.md) | 12 versioned migrations exist and apply cleanly from empty; CI and render.yaml run `db:migrate` | superseded, stale |
| "No rate limiter uses the Redis store" (CLAUDE.md audit note) | every limiter uses `rate-limit-redis` when `REDIS_URL` is set (`server/middleware/rateLimit.ts:42-83`) | superseded, stale |
| "Push-built DBs lack migration indexes" (memory note) | migrate-built and push-built schemas are identical today | resolved |
| "GRZ purchase is holdings-only, no cash mutated" (product decision) | re-checked by the investments verifier (see domain report) | preserved as a decision |
