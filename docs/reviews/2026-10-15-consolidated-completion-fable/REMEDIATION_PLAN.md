# Remediation plan and agent operating protocol

This is the plan for executing COMPLETION_SPEC.md. Section 1 and 2 are mandatory reading for any agent before its first commit. Sections 3 to 7 are for sequencing and tracking.

## 1. Environment and safety rules

1.1 Databases. The development database `finance_app` is never written by tests, probes or scripts. Server tests run only against `finance_app_test` (`npm run db:test:setup` once; the vitest config refuses anything not test-scoped). Runtime evidence is produced against a disposable database built with versioned migrations: `CREATE DATABASE finance_app_audit_<yyyymmdd>` then `drizzle-kit migrate` with `DATABASE_URL` pointed at it (`.local/readiness-fable-2026-10-13/create-audit-db.mjs` shows the recipe). Never use `drizzle-kit push` for anything that will be compared with production.

1.2 Audit server. For runtime evidence run the app in development mode (CSRF and limiters active) with the SMTP sink and no real AI key: the `audit` entry in `.claude/launch.json` starts `run-audit-server.mjs` (port 5055, `SMTP_HOST=127.0.0.1:2525`, `GEMINI_API_KEY=''` as an empty string because dotenv re-injects deleted variables, `LOG_LEVEL=debug`). `NODE_ENV=test` relaxes CSRF, cookies and limiters and must never be the basis of a release claim.

1.3 Outbound. No real e-mail, push, provider call, deploy, merge or push to a shared branch without the owner's explicit instruction. SMTP goes to the sink (`smtp-sink.mjs`). Provider adapters are tested on stubs and recorded responses; the only live provider call path is the staging smoke under CP-19 with the owner's keys and a recorded request budget.

1.4 Secrets. Keys live in `.env` locally and in Render secrets; never in code, logs, tests, fixtures or PR text. Tests assert the absence of secret fields at HTTP boundaries.

1.5 Data. Synthetic data only. Fixture users use `@audit.invalid` or `@example.com` addresses. Nothing that looks like a real person, account number or identifier.

1.6 Hosts. The assessment host is also a CI runner (`smartcare-surface-win`); do not run two full suites at once while a CI job is active.

## 2. Working conventions

2.1 Branch per work order: `fix/cp-04-privacy-matrix`, `fix/cp-10-import-overwrite`. A work order may be split into sub-branches `fix/cp-14a-rule-references` when the PR would otherwise exceed about 600 changed lines. Base every branch on current `origin/main`; re-run `npm run check` after each merge from main (the LOC ratchet and type errors have surfaced after pulls before).

2.2 Commits: conventional (`fix:`, `feat:`, `test:`, `refactor:`, `docs:`, `chore:`), one concern per commit, the register ids in the body, the required attribution trailer.

2.3 Verification before every commit that touches code: `npm run check`; the targeted suites (`npx vitest run <path>` while iterating, the full `npm run test:run` and `npm run test:server:run` before the PR); `npm run build`; `npm audit --omit=dev` when dependencies changed. Quote the runner's summary lines in the PR, never just an exit code; say which database the server suite ran against.

2.4 Tests first for every defect: write the failing test (real-DB HTTP where the row says HTTP or DB), confirm it fails for the stated reason, fix, confirm it passes, keep it. Size tests like their neighbours; do not add unrelated tests or files.

2.5 PR per work order or sub-order with this body: register rows closed (ids); decisions applied (DEC ids and defaults assumed); files changed and why; tests added with their names and the runner summary; runtime evidence (what was run against which database, with the before and after values); migrations and their rollback; LOC ratchet status; anything left open in the work order and why.

2.6 Closure rule for a register row (no exceptions): the changed code is identified by commit; a regression test fails before and passes after; the affected UI, API and database paths agree; for rows marked HTTP or DB, runtime evidence from the audit environment is recorded (command, response, read-back); for rows whose acceptance depends on deployment, the staging run at a known revision is recorded; the REGISTER.md Status cell receives `CLOSED <sha> <test file> <evidence path>`; the CI run on the branch is green. A PR title, a success toast, a mock-only test or a historic green run does not close a row.

2.7 Known traps on this codebase and host:
- The money-float PreToolUse hook blocks writes containing `parseFloat`, `Math.round` or `Number(` in financial paths and has prose false positives when an asterisk and the words rate or amount share a paragraph; the `as any` hook blocks `as any`, `: any` and `@ts-ignore` in `.ts` and `.tsx`.
- The Stop hook blocks ending a turn while `npm run check` or the core calculation tests are red.
- Git Bash mangles `/api/...` arguments into Windows paths; export `MSYS_NO_PATHCONV=1`.
- `/api/auth/*` is limited to 5 requests per minute per IP until CP-00 lands; space scripted logins 13 seconds apart or use saved cookie jars.
- Anonymous CSRF tokens are invalid because the session is not saved; until CP-02 lands, verify fixture users directly in the audit database.
- Playwright needs `chromium_headless_shell` matching the installed Playwright version; approve the download (DEC-09).
- Subagents can be killed by the account's monthly spend limit; checkpoint evidence to files as you go.
- The LOC ratchet fails the build when a baselined file grows; extract instead of growing, and never update the baseline to make a build pass.
- Push-built databases lack some indexes that migrations create; build evidence databases with `drizzle-kit migrate`.
- Drizzle returns `date` columns as strings and `decimal` columns as strings; never compare a JS Date to a date column, never do arithmetic on an amount outside `Money`.

2.8 Evidence files. Keep raw outputs under `.local/remediation-<date>/` (git-ignored) and summarise in the PR. The assessment fixture generators under `.local/` are not portable to another machine or worktree; CP-00 ports them into `server/testing/fixtures/` so any checkout can rebuild the A1–A6 households. Reusable scripts from the assessments: `.local/readiness-fable-2026-10-13/api.mjs` (cookie-jar HTTP with CSRF), `q.mjs` (read-only SQL limited to audit and test databases), the `scratch-*` directories per domain, and the Codex `runtime-probes.mjs` under `.local/readiness-2026-10-11/`.

## 3. Phases and gates

| Phase | Work orders | Exit gate |
|---|---|---|
| 0. Decisions and baseline (week 1) | DEC-01, DEC-21 recorded; CP-00 | G0: staging provisioned from render.yaml with secrets, disk, cron services, TLS CA; `/health/ready` 200 with DB and Redis checks; CI green on the pinned runtime with the audit step blocking; limiter fix merged; Playwright smoke runs locally |
| 1. Identity and tenancy (weeks 1–4) | CP-01, CP-04, CP-02, CP-03, CP-05, CP-06, CP-07 | G1: role matrix test green for owner, admin, member, professional, view_only and an unknown value; two-browser invitation accepted; verification from a second browser; no private or cross-household row on any read, export or aggregate; DTO key-set test green; revoked cookies denied; profile and preferences persist; export file produced; deletion leaves no identifying row |
| 2. Financial core (weeks 4–9) | CP-08, CP-09, CP-10, CP-11, CP-12, CP-14, CP-13 | G2: reports verifier fixture reproduces every hand value; property suite green including edits and deletes; overwrite import idempotent and pair-safe on both paths; dry-run writes nothing; foreign references rejected; summary agrees with list within one request; budgets convert; goal unlink exact; two consecutive days of cron evidence on staging |
| 3. Planning, investments, operations (weeks 9–13) | CP-15, CP-16 (remaining), CP-17, CP-18 | G3: investments verifier hand values reproduced; sold bond cannot pay; tax summary agrees with postings; receipts scan under production CSP; push endpoint allow-list enforced; recap privacy and currency tests green; restore drill recorded |
| 4. AI, devices, accessibility (weeks 13–16) | CP-19, CP-20 | G4: Claude healthy, forced failover and both-fail cases pass on staging with recorded provenance; ledger concurrency tests green; consent version block enforced; axe-core clean; phone layout spec green |
| 5. Acceptance and release candidate (weeks 16–20) | CP-21 | G5: J01–J16 passed at the candidate SHA on production-mode staging; every P0 and P1 row closed; restore and rollback rehearsed; 14-day soak clean; owner UAT signed |
| 6. Controlled release | deploy, canary household, first invited households | G6: post-deploy smoke green; first scheduled runs observed in production; 72 hours without P1; expansion by owner decision |

Week numbers are for one developer at the low estimate (about 17 weeks of build before reserve); at the high estimate multiply by about 1.6. Gates are binding, week numbers are not.

## 4. Dependency graph and parallel lanes

Hard dependencies (an arrow means "must merge first"):

- CP-00 → CP-16 (environment foundation) → CP-17, CP-19; CP-16 staging evidence is required for closure of CP-13 and CP-18, not for starting them
- CP-13 → CP-18 (scheduled delivery)
- CP-01 → CP-02 → CP-03; CP-01 → CP-06, CP-07
- CP-04 → CP-03 (guard before the role is enabled), CP-05, CP-07, CP-14, CP-18, CP-19
- CP-08 → CP-09 → CP-11; CP-08 → CP-10, CP-12, CP-13, CP-15
- CP-13 → CP-15 (SIP scheduling), CP-17 (matcher)
- everything → CP-21

Lanes for two developers (A backend-leaning, B frontend and operations-leaning):

| Weeks | Lane A | Lane B |
|---|---|---|
| 1–2 | CP-01, CP-04 | CP-00, CP-16 (provision staging) |
| 3–4 | CP-08 | CP-02, CP-03 |
| 5–6 | CP-09, CP-10 | CP-05, CP-06, CP-14 (client half) |
| 7–8 | CP-11, CP-12, CP-14 (server half) | CP-07, CP-13 (registry with A) |
| 9–11 | CP-15 | CP-17, CP-18 |
| 12–14 | CP-19 | CP-20 |
| 15–18 | CP-21 (server evidence) | CP-21 (e2e rewrite, drills, UAT) |

Shared hot files that need sequencing rather than parallel edits: `TransactionRepository.ts`, `BaseReportRepository.ts`, `ai.service.ts`, `validateEntity.ts`, `household.routes.ts`, `render.yaml`. One owner per hot file per week.

## 5. Calendar projections

Effort 87–140 developer-days before reserve; 104–168 with the 20% reserve (plan against the Codex consolidation's 88–145 / 106–174, which prices the same scope slightly higher). One developer at about 20 working days a month, starting Monday 19 October 2026, with one week lost over Christmas and New Year:

| Milestone | Low (87 days) | High (140 days) | With reserve (104–168) |
|---|---|---|---|
| Build complete, CP-21 starts | late February 2027 | early May 2027 | mid-March to mid-June 2027 |
| Release candidate after soak and UAT | mid-March 2027 | late May 2027 | early April to mid-July 2027 |

Two developers with the lanes above (about 1.6 times one developer's throughput, not 2): build complete early January to mid-February 2027, release candidate early February to late April 2027 with reserve.

The spread is real. Re-estimate at G1 and G2 from measured throughput; do not move a gate to hit a date.

## 6. First ten working days

| Days | Work | Output |
|---|---|---|
| 1–2 | Owner records DEC-01 and DEC-21; CP-00 steps 1–3 (audit fix, runtime pin, limiter); approve the Playwright download | CI green on the pinned runtime; no self-inflicted 429s; smoke run recorded |
| 3–4 | CP-01 (DTO allow-list, real revocation, atomic MFA codes); CP-16 step 1 started (staging provisioned) | two-cookie revocation test green; staging URL |
| 5–7 | CP-04 (role matrix, visibility predicate, backfill, gates) | privacy matrix test green; the 14 October AH-09 probe returns 403; ISO-01 returns 404 |
| 8–10 | CP-02 (link path, CSRF exemption, pending state, first-run gating, category seeding); CP-14 first items (rule reference validation, pure dry-run) | verification from a second browser; the 14 October ORG-003 and ORG-004 probes return 400 and unchanged snapshots |

## 7. Risk register

| Risk | Likelihood | Effect | Mitigation |
|---|---|---|---|
| Staging provisioning slips (account, secrets, CA) | medium | every gate from G0 slips by the same days | DEC-21 in week 1; CP-16 step 1 before anything else in lane B |
| New P0 or P1 found on staging | high | 1–3 days each | the 20% reserve; the 21 source-only or not-exercised rows are the likeliest sources |
| CP-08 and CP-09 touch seven repositories and every writer | high | regressions in reports that currently reconcile | property suite first, verifier fixtures as golden values, one owner for the hot files |
| Timestamp migration (DEC-16) on existing data | medium | wrong instants if the session timezone assumption is wrong | migrate on a copy of a sanitised prior-schema database first (CP-21 step 5) |
| Free Claude allowance changes | medium | CP-19 price table and quotas change | DEC-11c recorded; the ledger already supports a non-zero price |
| Professional role matrix disputed later | low | rework in CP-03 and CP-04 | the matrix is one table; the default is read-only plus export |
| Account spend limits on agent sessions | medium | lost work | checkpoint evidence files; small PRs |
| Hook false positives block legitimate edits | medium | wasted turns | avoid asterisks near rate and amount in prose; use the Edit tool for surgical changes |

## 8. Reporting cadence

At the end of each work order: PR merged, register rows updated, PROGRESS note appended in this directory (`PROGRESS.md`, create on first use) with date, work order, rows closed, evidence paths, open items. At each gate: a one-page gate report listing the gate conditions with evidence links and any accepted residual with owner and date.
