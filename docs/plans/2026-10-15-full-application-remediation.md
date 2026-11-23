# Full Application Remediation Implementation Plan

> **SUPERSEDED:** The [Master Completion Specification](2026-10-15-master-completion-spec.md) now contains the governing requirements, register, detailed packets, acceptance and handoff. Do not execute this historical plan as an independent authority.

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task **only after implementation is authorized**. Other agents use the same packet/evidence protocol; missing skill installation does not replace the contracts.
>
> **Current authority: documentation only. Do not start app changes from this plan without a subsequent user instruction.**

**Goal:** Complete every advertised capability with correct persisted outcomes, privacy and production evidence, consolidating both October assessments.

**Architecture:** Retain React/TypeScript, modular Express controllers/services/repositories, PostgreSQL/Drizzle and Money/Decimal. Centralize financial effects, explicit capability/visibility policy, durable job/admission identities and provider-neutral Thandi adapters; integrate incrementally rather than rewrite the app.

**Tech Stack:** React18, TypeScript, Express, PostgreSQL, Drizzle, Redis, Vitest, Playwright, existing SMTP/push/OCR and deployment tooling; versions to be aligned in R00.

---

## Read first and precedence

1. [Package README](../reviews/2026-10-15-consolidated-completion/README.md)
2. [Governing product/data specification](../reviews/2026-10-15-consolidated-completion/SPEC.md)
3. [Remaining-work register](../reviews/2026-10-15-consolidated-completion/REMAINING_WORK.csv)
4. [Thandi contract](../reviews/2026-10-15-consolidated-completion/THANDI_SPEC.md), when relevant
5. [Acceptance catalogue](../reviews/2026-10-15-consolidated-completion/ACCEPTANCE.md)
6. [Agent start/resume protocol](../reviews/2026-10-15-consolidated-completion/AGENT_HANDOFF.md)

Baseline381e9439afabe7c6cf829cb1cbded91d36da44ee, 15 October 2026. All paths below are repository-relative; workspace root at authoring was C:/Dev/personal-finance-app. Existing file targets were checked when writing this plan. Proposed new tests/files are labelled. Re-resolve symbols at the executing SHA; line numbers and historical results are not current runtime proof. Preserve all unrelated changes and historical assessment evidence.

## Estimate and dependencies

**22 packets, 88–145 focused developer-days (approximately 6 engineering hours/day).** Add 20% once:105.6–174 days, rounded up **106–174**, about 22–35 five-day working weeks. This is a newly reconciled planning estimate, not a measured quote or a promised date. It includes the newly discovered financial/UI paths, full settings/roles, durable AI admission and meaningful verification. Do not add the two audit estimates together.

R21 includes integration/UAT engineering effort; the14-day soak is elapsed time with monitoring and may overlap no-change review, not14 extra developer-days. External decisions, provider access, migration reconciliation and staffing can extend elapsed duration. Do not linearly halve estimates for two developers: shared schema/financial/authorization contracts serialize work. Reforecast after G1/G2 using completed packet throughput.

| Packet | Focus | Days | Dependencies |
|---|---|---|---|
| R00 | Reproducible baseline, runtime and dependencies | 2–4 | none |
| R01 | Sessions, public DTOs and credential concurrency | 3–5 | R00 |
| R02 | Registration, verification and recovery | 3–5 | R01 |
| R03 | Membership, ownership and Professional lifecycle | 4–7 | R02, R04 |
| R04 | Complete visibility and capability enforcement | 4–7 | R01 |
| R05 | Persistent settings and shared views | 4–7 | R03, R04 |
| R06 | MFA management and security policy | 2–4 | R01, R02, R05 |
| R07 | Self-service export, leave and erasure | 5–8 | R01, R03, R04, R05, R19 |
| R08 | Ledger invariants across every writer | 6–9 | R04 |
| R09 | One correct import/export workflow | 4–6 | R08 |
| R10 | Budgets and reversible goals | 4–7 | R08, R12 |
| R11 | Rules, tags, merchants and saved organization | 4–7 | R04, R08 |
| R12 | FX ownership and reconciled reports | 5–8 | R04, R08 |
| R13 | Investment, pension and GRZ lifecycle | 7–11 | R08, R12, R14 |
| R14 | Durable recurring and scheduled jobs | 4–6 | R08, R19 |
| R15 | Durable receipts and OCR | 3–5 | R08, R19 |
| R16 | Notifications, push and weekly recap | 3–5 | R04, R12, R14, R19 |
| R17 | Thandi Claude primary and Gemini fallback | 5–8 | R04, R05, R12, R19 |
| R18 | Complete UX, accessibility and date display | 4–6 | R02, R03, R05 |
| R19 | Deployable operations, storage and recovery | 4–7 | R00 |
| R20 | Trustworthy automated and runtime verification | 3–5 | R00 |
| R21 | Integrated acceptance and controlled release | 5–8 | R01, R02, R03, R04, R05, R06, R07, R08, R09, R10, R11, R12, R13, R14, R15, R16, R17, R18, R19, R20 |

The table states completion dependencies. Safe isolated tests/design can begin earlier, but dependent production behavior cannot be declared closed before its prerequisites. R19 and R20 start early after R00. Do not allow the UI sequence to delay R04 privacy fixes.

## Gates and order

| Gate | Required result | Packets/conditions |
|---|---|---|
| G0 Baseline and protected test targets | Supported runtime plan, isolated DB/server guard, honest browser harness, named environment inputs | R00/R20 foundations; R19 staging bootstrap |
| G1 Identity and privacy | Actual revocation, fresh-device verification, role/private/reference denial, member lifecycle | R01–R04; R11 reference/purity slices may land early |
| G2 Money | Exact asset/liability, pair-safe imports, report FX/splits, reversible budget/goal state | R08–R12; affected R14 jobs |
| G3 Complete workflows | Settings/MFA/exit, investments, jobs, receipts, notifications and shared views all functional | R05–R07/R13–R16; deployed R19 foundations |
| G4 AI and usable product | Claude/Gemini/local paths, consent/budget concurrency, phone/accessibility, no inert offered controls | R17/R18 |
| G5 Release candidate | All 101 required register items closed or evidence-refuted, J01–J16, restore/rollback,14-day soak and owner UAT | R19–R21; no unresolved OI dependency for enabled feature |
| G6 Controlled release | Authorized deployment, exact SHA smoke, first real due jobs and72h observation | Separate OI-06 authorization; no scope reduction |

A minimal invited pilot is a rollout stage after applicable full-product gates, not an alternate completion definition. Any discovered defect gets an ID, packet, severity, evidence and acceptance condition before repricing. No new feature is inferred from a source report's suggestion.

## Shared implementation loop for every slice

Each packet contains three implementation slices. Split each into a reviewable commit with these actions, usually small test/code iterations rather than one giant patch:

1. Claim ownership and record baseline/dirty files/dependencies. Read the exact source finding and current call path.
2. Write a failing behavioral regression using the independent oracle listed below. Exercise actual HTTP/persistence for permission/money defects; do not calculate expected values using the production helper.
3. Run the single regression and capture the expected assertion failure. Environment errors are BLOCKED, not a valid red test.
4. Implement the smallest cohesive service/controller/client change; validate at boundaries, transact financial effects, preserve compatibility. Add migration only with explicit schema mapping/backfill proof.
5. Run the focused test to green, then affected adjacent tests and static checks. Test failure, retry, unauthorized and concurrency branches; avoid tests that only mirror implementation.
6. Run the matching protected runtime journey (HTTP/browser/DB/files) on the isolated target and later staging. Save evidence with SHA/config/target and expected-versus-observed values.
7. Review changed code, migration and error paths with an authorized reviewer; resolve findings. If committing is part of the implementation instruction, stage explicit paths and use the suggested packet message; never commit unrelated files or secrets.
8. Update register status honestly. Record incomplete runtime evidence and next action in HANDOFF; do not mark CLOSED from local green alone.

## Commands and target safety

Run from repository root unless noted. These commands are instructions for future authorized implementation; none was run as remediation by this documentation task.

```powershell
git status --short
git rev-parse HEAD
npm run check
npm run test:server:run -- modules/auth/__tests__/completion-r01.realdb.integration.test.ts
npm run test:run -- client/src/pages/settings
npm run build
npm run check:bundle
npm run deploy:verify
```

The focused server example works through the existing script's `cd server && vitest run`; use each packet's relative server test path below. Full suites when integrating a candidate: `npm run test:server:run`, `npm run test:run`, and the guarded Playwright profile. Server Vitest forces NODE_ENV=test: it **cannot** establish production CSRF/CSP/rate behavior.

Before any DB suite, provision a dedicated database such as `pfa_completion_r08_<run>_test`, bind explicit TEST_DATABASE_URL through the secure environment, and verify its resolved database name/host against the approved target manifest without printing secrets. R00/R20 must add a refusal before mutating a real/unknown DB, including root test commands. The real `finance_app` is excluded. Never rely solely on a name substring or ambient .env. No paid provider/email/push calls in ordinary tests.

R20 creates a **proposed** `playwright.production.config.ts` and guarded launch script that use an explicitly owned HTTPS production-mode server, synthetic DB, fixed run marker and sink/mock providers. Future command: `npx playwright test --config playwright.production.config.ts e2e/completion-r21.spec.ts --project=chromium`. It must not reuse arbitrary localhost:5000. Install the matching browser only when needed for authorized implementation. Run migration commands only with the explicit isolated/staging target; never db:push against production.

## Behavioral test examples

These are intended assertions, not pre-existing test helpers or application patches. Implement fixture/API helpers in the proposed tests using current repository patterns.

```text
Given asset cash1000, post income200 and expense125.50
Assert stored balance = "1074.50"
Transfer100 to empty asset -> balances "974.50" and "100.00"
Replay same operation -> unchanged rows, balances and effect count
Given credit debt500, post purchase45.50
Assert debt = "545.50"; expense = "45.50"; net worth decreases45.50

Given owner private transaction marker SECRET and shared goal link
Member reads goal activity/tag list/recurring/AI/export
Assert no SECRET, private ID, hidden amount or hidden row count
Outsider goal activity ->404; denied mutation leaves DB hash unchanged

Given one budget unit and two simultaneous AI requests on different instances
Release both at a barrier
Assert one paid attempt claimed; total settled plus reserved never over limit
Simulate provider timeout after dispatch -> reservation stays held after restart
Gemini cannot dispatch unless its own reservation fits remaining budget
```

## Detailed packet instructions

### R00 — Reproducible baseline, runtime and dependencies

**Owner:** assign a named implementing agent and reviewer when authorized. **Effort:** 2–4 days. **Completion dependencies:** none.
**Primary register rows:** DEP-01, DEP-02, NEW-08, NEW-39. **Supporting:** none.

**Existing file targets (follow delegates/imports before edits):**
- Modify as needed: `package.json`
- Modify as needed: `.github/workflows/ci.yml`
- Modify as needed: `render.yaml`
- Modify as needed: `server/testing/test-database.ts`
- Modify as needed: `scripts/setup-test-db.mjs`
- Proposed test: `server/testing/__tests__/completion-r00.test.ts`. Create only during implementation; reuse/extend existing equivalent tests when that makes the defect clearer.

**Ordered slices:**
1. **R00.1:** Inventory deployment/runtime/schema identities and pin a currently supported Node/DB combination across local, CI and staging. Apply the shared red -> implementation -> green -> runtime -> review loop before the next slice.
2. **R00.2:** Remediate advisories with targeted upgrades and compatibility tests; do not use an unreviewed major audit fix. Apply the shared red -> implementation -> green -> runtime -> review loop before the next slice.
3. **R00.3:** Introduce explicit disposable target/run-marker validation for all test entrypoints; use versioned migrations, never production db:push. Apply the shared red -> implementation -> green -> runtime -> review loop before the next slice.

**Data/migration contract:** No business-data backfill; compatibility migration only if dependency changes demand one.

**Independent acceptance oracle:** Clean bootstrap and migration; wrong database or server target refused before writes; current dependency report has no unexplained release-blocking item.

**Focused verification:** `npm run test:server:run -- testing/__tests__/completion-r00.test.ts`. Before repair expect a failure on the missing behavior, not setup. After repair expect the selected assertions to pass with the same fixture and explicit negative/race cases. Add the matching J journey from ACCEPTANCE; use production mode for security headers/CSRF/providers/clock checks. Existing green suites do not replace these assertions.

**Closure evidence:** `evidence/R00/RESULT.md` under this package, plus sanitized command outputs, expected/actual rows, migration report if any, and runtime target/revision. No result files exist yet. Suggested commit subject, if commit authorized: `fix(r00): reproducible baseline, runtime and dependencies`.

### R01 — Sessions, public DTOs and credential concurrency

**Owner:** assign a named implementing agent and reviewer when authorized. **Effort:** 3–5 days. **Completion dependencies:** R00.
**Primary register rows:** AH-01, AH-02, AH-10, AH-12. **Supporting:** NEW-38.

**Existing file targets (follow delegates/imports before edits):**
- Modify as needed: `server/services/session-revocation.ts`
- Modify as needed: `server/routes/security.sessions.ts`
- Modify as needed: `server/modules/auth/auth.session.service.ts`
- Modify as needed: `server/modules/auth/auth.mfa.service.ts`
- Modify as needed: `server/modules/settings/settings.account-deletion.service.ts`
- Proposed test: `server/modules/auth/__tests__/completion-r01.realdb.integration.test.ts`. Create only during implementation; reuse/extend existing equivalent tests when that makes the defect clearer.

**Ordered slices:**
1. **R01.1:** Add two-cookie revocation and public DTO sentinel tests before changing endpoints. Apply the shared red -> implementation -> green -> runtime -> review loop before the next slice.
2. **R01.2:** Revoke session store and tracking state consistently; bind step-up to session; prevent delayed session save from resurrecting a revoked identity. Apply the shared red -> implementation -> green -> runtime -> review loop before the next slice.
3. **R01.3:** Allowlist DTOs; atomically consume codes under a user lock/conditional update; enforce one password policy and redact credential material. Apply the shared red -> implementation -> green -> runtime -> review loop before the next slice.

**Data/migration contract:** If needed add monotonic user/session revocation generation with rolling compatibility; avoid deleting unrelated sessions.

**Independent acceptance oracle:** Revoked cookie 401; two concurrent redemptions yield one winner; different backup-code races cannot restore a consumed code; no credential sentinel in any public DTO.

**Focused verification:** `npm run test:server:run -- modules/auth/__tests__/completion-r01.realdb.integration.test.ts`. Before repair expect a failure on the missing behavior, not setup. After repair expect the selected assertions to pass with the same fixture and explicit negative/race cases. Add the matching J journey from ACCEPTANCE; use production mode for security headers/CSRF/providers/clock checks. Existing green suites do not replace these assertions.

**Closure evidence:** `evidence/R01/RESULT.md` under this package, plus sanitized command outputs, expected/actual rows, migration report if any, and runtime target/revision. No result files exist yet. Suggested commit subject, if commit authorized: `fix(r01): sessions, public dtos and credential concurrency`.

### R02 — Registration, verification and recovery

**Owner:** assign a named implementing agent and reviewer when authorized. **Effort:** 3–5 days. **Completion dependencies:** R01.
**Primary register rows:** AH-03, AH-04, UX-01, NEW-07. **Supporting:** NEW-08.

**Existing file targets (follow delegates/imports before edits):**
- Modify as needed: `server/modules/auth/auth.email.service.ts`
- Modify as needed: `server/modules/auth/auth.controller.ts`
- Modify as needed: `server/modules/auth/auth.routes.ts`
- Modify as needed: `server/routes/security.email.ts`
- Modify as needed: `client/src/App.tsx`
- Proposed test: `server/modules/auth/__tests__/completion-r02.realdb.integration.test.ts`. Create only during implementation; reuse/extend existing equivalent tests when that makes the defect clearer.

**Ordered slices:**
1. **R02.1:** Create a captured-mail fresh-browser test with real CSRF and limiters, not fixture verification SQL. Apply the shared red -> implementation -> green -> runtime -> review loop before the next slice.
2. **R02.2:** Use canonical real client links; permit token-authenticated verification only under the narrow exemption/anti-replay contract in SPEC. Apply the shared red -> implementation -> green -> runtime -> review loop before the next slice.
3. **R02.3:** Make pending-verification a restricted state with resend/recovery/logout; gate household queries; scope auth throttles to operation and identity without enumeration. Apply the shared red -> implementation -> green -> runtime -> review loop before the next slice.

**Data/migration contract:** Token expiry/consumption must be conditional and atomic; no raw token persistence or logging.

**Independent acceptance oracle:** Register in A, verify exact mail link in B, login; replay/expiry invalid; pending user cannot access finance; reset revokes sessions; ordinary navigation avoids 429.

**Focused verification:** `npm run test:server:run -- modules/auth/__tests__/completion-r02.realdb.integration.test.ts`. Before repair expect a failure on the missing behavior, not setup. After repair expect the selected assertions to pass with the same fixture and explicit negative/race cases. Add the matching J journey from ACCEPTANCE; use production mode for security headers/CSRF/providers/clock checks. Existing green suites do not replace these assertions.

**Closure evidence:** `evidence/R02/RESULT.md` under this package, plus sanitized command outputs, expected/actual rows, migration report if any, and runtime target/revision. No result files exist yet. Suggested commit subject, if commit authorized: `fix(r02): registration, verification and recovery`.

### R03 — Membership, ownership and Professional lifecycle

**Owner:** assign a named implementing agent and reviewer when authorized. **Effort:** 4–7 days. **Completion dependencies:** R02, R04.
**Primary register rows:** AH-05, AH-06, AH-13, NEW-12. **Supporting:** none.

**Existing file targets (follow delegates/imports before edits):**
- Modify as needed: `server/modules/household/invitations.controller.ts`
- Modify as needed: `server/modules/household/members.controller.ts`
- Modify as needed: `server/repositories/HouseholdRepository.ts`
- Modify as needed: `server/modules/household/household.validation.ts`
- Modify as needed: `client/src/pages/settings/sections/MembersSection/index.tsx`
- Proposed test: `server/modules/household/__tests__/completion-r03.realdb.integration.test.ts`. Create only during implementation; reuse/extend existing equivalent tests when that makes the defect clearer.

**Ordered slices:**
1. **R03.1:** Wire invitation create/list/resend/revoke/accept with safe login continuation and flat member DTOs. Apply the shared red -> implementation -> green -> runtime -> review loop before the next slice.
2. **R03.2:** Serialize membership create/accept/leave/transfer around household and actor locks; reject self-transfer and role-based owner creation; enforce exactly one owner. Apply the shared red -> implementation -> green -> runtime -> review loop before the next slice.
3. **R03.3:** Support Professional as shared-data read-only under SPEC; implement leave/removal and state-based entitlement/shared-view UI instead of fake billing copy. Apply the shared red -> implementation -> green -> runtime -> review loop before the next slice.

**Data/migration contract:** Preflight duplicate memberships/owners; produce repair report; add constrained uniqueness only after approved repair, never choose an owner silently.

**Independent acceptance oracle:** Two-browser invited recipient joins; wrong verified email denied; concurrent different-household accepts leave one membership; ownership always one; removal immediately revokes household access.

**Focused verification:** `npm run test:server:run -- modules/household/__tests__/completion-r03.realdb.integration.test.ts`. Before repair expect a failure on the missing behavior, not setup. After repair expect the selected assertions to pass with the same fixture and explicit negative/race cases. Add the matching J journey from ACCEPTANCE; use production mode for security headers/CSRF/providers/clock checks. Existing green suites do not replace these assertions.

**Closure evidence:** `evidence/R03/RESULT.md` under this package, plus sanitized command outputs, expected/actual rows, migration report if any, and runtime target/revision. No result files exist yet. Suggested commit subject, if commit authorized: `fix(r03): membership, ownership and professional lifecycle`.

### R04 — Complete visibility and capability enforcement

**Owner:** assign a named implementing agent and reviewer when authorized. **Effort:** 4–7 days. **Completion dependencies:** R01.
**Primary register rows:** FIN-01, OPS-005, ORG-001, ORG-002, ORG-003, AH-09, NEW-01, NEW-33. **Supporting:** NEW-02, NEW-13.

**Existing file targets (follow delegates/imports before edits):**
- Modify as needed: `server/middleware/validateEntity.ts`
- Modify as needed: `server/middleware/householdGuard.ts`
- Modify as needed: `server/modules/goals/goals.controller.ts`
- Modify as needed: `server/services/GoalActivityLogService.ts`
- Modify as needed: `server/repositories/TagRepository.ts`
- Modify as needed: `server/repositories/RecurringQueryRepository.ts`
- Proposed test: `server/modules/goals/__tests__/completion-r04.realdb.integration.test.ts`. Create only during implementation; reuse/extend existing equivalent tests when that makes the defect clearer.

**Ordered slices:**
1. **R04.1:** Implement explicit capability predicates and fail closed for unknown roles; enumerate every route with actor identity. Apply the shared red -> implementation -> green -> runtime -> review loop before the next slice.
2. **R04.2:** Apply account AND transaction privacy to direct, relational, activity, count, report, export, AI and job inputs; do not trust a copied is_private flag alone. Apply the shared red -> implementation -> green -> runtime -> review loop before the next slice.
3. **R04.3:** Revalidate entity references on reads and writes; separate personal preference endpoints from owner/admin household policy; protect private recurring and goal link mutations. Apply the shared red -> implementation -> green -> runtime -> review loop before the next slice.

**Data/migration contract:** Review legacy ownership/privacy conflicts and quarantine ambiguous rows; default exclusion; no automatic broadened disclosure.

**Independent acceptance oracle:** Owner/member/viewer/Professional/outsider cross-product: no hidden markers or amounts, no unauthorized DB mutation; foreign goal activity 404; view-only shared preference write 403.

**Focused verification:** `npm run test:server:run -- modules/goals/__tests__/completion-r04.realdb.integration.test.ts`. Before repair expect a failure on the missing behavior, not setup. After repair expect the selected assertions to pass with the same fixture and explicit negative/race cases. Add the matching J journey from ACCEPTANCE; use production mode for security headers/CSRF/providers/clock checks. Existing green suites do not replace these assertions.

**Closure evidence:** `evidence/R04/RESULT.md` under this package, plus sanitized command outputs, expected/actual rows, migration report if any, and runtime target/revision. No result files exist yet. Suggested commit subject, if commit authorized: `fix(r04): complete visibility and capability enforcement`.

### R05 — Persistent settings and shared views

**Owner:** assign a named implementing agent and reviewer when authorized. **Effort:** 4–7 days. **Completion dependencies:** R03, R04.
**Primary register rows:** AH-07, NEW-11, NEW-16, NEW-26. **Supporting:** AH-01, AH-09, AH-10, AH-13, NEW-28, NEW-31, NEW-37.

**Existing file targets (follow delegates/imports before edits):**
- Modify as needed: `server/modules/settings/settings.routes.ts`
- Modify as needed: `server/modules/settings/settings.controller.ts`
- Modify as needed: `server/modules/settings/settings.validation.ts`
- Modify as needed: `server/routes/settings.report-widgets.ts`
- Modify as needed: `client/src/pages/settings/SettingsLayout.tsx`
- Proposed test: `server/modules/settings/__tests__/completion-r05.realdb.integration.test.ts`. Create only during implementation; reuse/extend existing equivalent tests when that makes the defect clearer.

**Ordered slices:**
1. **R05.1:** Build UI/API/storage field inventory, including null clearing, independent recap/widget settings and per-user preferences. Apply the shared red -> implementation -> green -> runtime -> review loop before the next slice.
2. **R05.2:** Implement named saved shared views as filters over already authorized data; support Mine/Shared/All defaults, reset defaults and truthful member/role state. Apply the shared red -> implementation -> green -> runtime -> review loop before the next slice.
3. **R05.3:** Freeze household currency after financial activity; add explicit conflict response; remove fictitious commercial claims without removing advertised settings functionality. Apply the shared red -> implementation -> green -> runtime -> review loop before the next slice.

**Data/migration contract:** Add versioned per-user preferences/view configuration if existing schema cannot express it; minimize sensitive fields and await OI-04 retention parameters before real-user rollout.

**Independent acceptance oracle:** Each offered field saves, reads back and survives reload; clearing works; another user's preferences untouched; shared views never grant access; currency change with history 409.

**Focused verification:** `npm run test:server:run -- modules/settings/__tests__/completion-r05.realdb.integration.test.ts`. Before repair expect a failure on the missing behavior, not setup. After repair expect the selected assertions to pass with the same fixture and explicit negative/race cases. Add the matching J journey from ACCEPTANCE; use production mode for security headers/CSRF/providers/clock checks. Existing green suites do not replace these assertions.

**Closure evidence:** `evidence/R05/RESULT.md` under this package, plus sanitized command outputs, expected/actual rows, migration report if any, and runtime target/revision. No result files exist yet. Suggested commit subject, if commit authorized: `fix(r05): persistent settings and shared views`.

### R06 — MFA management and security policy

**Owner:** assign a named implementing agent and reviewer when authorized. **Effort:** 2–4 days. **Completion dependencies:** R01, R02, R05.
**Primary register rows:** AH-11. **Supporting:** AH-12.

**Existing file targets (follow delegates/imports before edits):**
- Modify as needed: `server/routes/security.mfa.ts`
- Modify as needed: `server/routes/security.mfa.login.ts`
- Modify as needed: `server/routes/security.mfa.stepup.ts`
- Modify as needed: `server/modules/auth/auth.mfa-policy.ts`
- Modify as needed: `client/src/pages/settings/sections/SecuritySection/index.tsx`
- Proposed test: `server/modules/auth/__tests__/completion-r06.realdb.integration.test.ts`. Create only during implementation; reuse/extend existing equivalent tests when that makes the defect clearer.

**Ordered slices:**
1. **R06.1:** Add enroll/verify/backup/regenerate/disable UI and recovery behavior using existing endpoints. Apply the shared red -> implementation -> green -> runtime -> review loop before the next slice.
2. **R06.2:** Enforce household mandatory-MFA policy against existing sessions using policy version; expose restricted enrollment state rather than lockout loops. Apply the shared red -> implementation -> green -> runtime -> review loop before the next slice.
3. **R06.3:** Require recent step-up for sensitive management; normalize any high-value threshold in household currency; retain existing financial step-up until a configured replacement is proved. Apply the shared red -> implementation -> green -> runtime -> review loop before the next slice.

**Data/migration contract:** Store policy version/enrollment state additively if needed; hash recovery material and show raw backup codes only at generation.

**Independent acceptance oracle:** Enable then login with code; backup reuse fails; regeneration invalidates old codes; policy change restricts old session; provider outage yields safe recovery state.

**Focused verification:** `npm run test:server:run -- modules/auth/__tests__/completion-r06.realdb.integration.test.ts`. Before repair expect a failure on the missing behavior, not setup. After repair expect the selected assertions to pass with the same fixture and explicit negative/race cases. Add the matching J journey from ACCEPTANCE; use production mode for security headers/CSRF/providers/clock checks. Existing green suites do not replace these assertions.

**Closure evidence:** `evidence/R06/RESULT.md` under this package, plus sanitized command outputs, expected/actual rows, migration report if any, and runtime target/revision. No result files exist yet. Suggested commit subject, if commit authorized: `fix(r06): mfa management and security policy`.

### R07 — Self-service export, leave and erasure

**Owner:** assign a named implementing agent and reviewer when authorized. **Effort:** 5–8 days. **Completion dependencies:** R01, R03, R04, R05, R19.
**Primary register rows:** AH-08. **Supporting:** NEW-32.

**Existing file targets (follow delegates/imports before edits):**
- Modify as needed: `server/modules/settings/settings.account.controller.ts`
- Modify as needed: `server/modules/settings/settings.account-deletion.service.ts`
- Modify as needed: `server/modules/settings/settings.account-deletion.files.ts`
- Modify as needed: `server/modules/reports/reports.export.service.ts`
- Modify as needed: `shared/schema.ts`
- Proposed test: `server/modules/settings/__tests__/completion-r07.realdb.integration.test.ts`. Create only during implementation; reuse/extend existing equivalent tests when that makes the defect clearer.

**Ordered slices:**
1. **R07.1:** Implement durable export jobs with authorized manifests/download/expiry and a discoverable self-service UI. Apply the shared red -> implementation -> green -> runtime -> review loop before the next slice.
2. **R07.2:** Define deletion state machine for household-free, last-owner and shared-member cases; revoke identity first, then delete/pseudonymize rows and files with retries. Apply the shared red -> implementation -> green -> runtime -> review loop before the next slice.
3. **R07.3:** Retain other members' legitimate shared financial history with pseudonymous attribution; enforce deletion markers on backup restoration; complete security notices without sensitive payloads. Apply the shared red -> implementation -> green -> runtime -> review loop before the next slice.

**Data/migration contract:** Add durable export/erasure job state and manifests; retention/legal holds supplied via OI-04; never infer a statutory retention duration.

**Independent acceptance oracle:** Export visible-only row counts and money reconcile; interrupted/retried erasure completes; stale cookies/tokens/files fail; remaining household audit survives; restoring backup reapplies erasures.

**Focused verification:** `npm run test:server:run -- modules/settings/__tests__/completion-r07.realdb.integration.test.ts`. Before repair expect a failure on the missing behavior, not setup. After repair expect the selected assertions to pass with the same fixture and explicit negative/race cases. Add the matching J journey from ACCEPTANCE; use production mode for security headers/CSRF/providers/clock checks. Existing green suites do not replace these assertions.

**Closure evidence:** `evidence/R07/RESULT.md` under this package, plus sanitized command outputs, expected/actual rows, migration report if any, and runtime target/revision. No result files exist yet. Suggested commit subject, if commit authorized: `fix(r07): self-service export, leave and erasure`.

### R08 — Ledger invariants across every writer

**Owner:** assign a named implementing agent and reviewer when authorized. **Effort:** 6–9 days. **Completion dependencies:** R04.
**Primary register rows:** FIN-05, FIN-08, FIN-13, FIN-17, ORG-005, FIN-16, NEW-05, NEW-28, NEW-32, NEW-35. **Supporting:** NEW-03, NEW-18, NEW-24.

**Existing file targets (follow delegates/imports before edits):**
- Modify as needed: `server/services/transaction/create.ts`
- Modify as needed: `server/services/transaction/service.ts`
- Modify as needed: `server/services/transaction/delete.ts`
- Modify as needed: `server/repositories/TransactionRepository.ts`
- Modify as needed: `server/services/TransferService.ts`
- Modify as needed: `server/services/account/AccountCoreService.ts`
- Proposed test: `server/modules/transactions/__tests__/completion-r08.realdb.integration.test.ts`. Create only during implementation; reuse/extend existing equivalent tests when that makes the defect clearer.

**Ordered slices:**
1. **R08.1:** Write independent asset/liability/create/edit/delete/split/transfer oracles with concurrent writers. Apply the shared red -> implementation -> green -> runtime -> review loop before the next slice.
2. **R08.2:** Centralize signed account effects, immutable source currency, allocation validation and ordered locks; all producers use one transaction executor for financial effects and audit/outbox. Apply the shared red -> implementation -> green -> runtime -> review loop before the next slice.
3. **R08.3:** Freeze denomination/type/opening balance after activity except an explicit reconciled adjustment; make retries idempotent and invalidate cache dependencies after commit. Apply the shared red -> implementation -> green -> runtime -> review loop before the next slice.

**Data/migration contract:** Backfill null currencies only with proven denomination history; produce review list for ambiguous rows. Preserve original values and migration provenance; never blindly recompute all balances.

**Independent acceptance oracle:** Asset 1000+200-125.50=1074.50; card debt 500+45.50=545.50; transfer has two legs; split100=60+40; edit/delete reverses dependent effects without drift.

**Focused verification:** `npm run test:server:run -- modules/transactions/__tests__/completion-r08.realdb.integration.test.ts`. Before repair expect a failure on the missing behavior, not setup. After repair expect the selected assertions to pass with the same fixture and explicit negative/race cases. Add the matching J journey from ACCEPTANCE; use production mode for security headers/CSRF/providers/clock checks. Existing green suites do not replace these assertions.

**Closure evidence:** `evidence/R08/RESULT.md` under this package, plus sanitized command outputs, expected/actual rows, migration report if any, and runtime target/revision. No result files exist yet. Suggested commit subject, if commit authorized: `fix(r08): ledger invariants across every writer`.

### R09 — One correct import/export workflow

**Owner:** assign a named implementing agent and reviewer when authorized. **Effort:** 4–6 days. **Completion dependencies:** R08.
**Primary register rows:** FIN-02, FIN-03, FIN-04, FIN-15, NEW-17. **Supporting:** NEW-14.

**Existing file targets (follow delegates/imports before edits):**
- Modify as needed: `server/services/ImportService.ts`
- Modify as needed: `server/services/account/AccountImportService.ts`
- Modify as needed: `server/services/account/AccountExportService.ts`
- Modify as needed: `server/routes/import.ts`
- Modify as needed: `shared/schema.ts`
- Proposed test: `server/modules/accounts/__tests__/completion-r09.realdb.integration.test.ts`. Create only during implementation; reuse/extend existing equivalent tests when that makes the defect clearer.

**Ordered slices:**
1. **R09.1:** Build global and account-detail fixtures for overwrite, transfer conflicts, sign, UUID, invalid date and duplicate occurrence cases. Apply the shared red -> implementation -> green -> runtime -> review loop before the next slice.
2. **R09.2:** Use immutable import batch/row identity and explicit preview; preserve two legitimate identical purchases; reject replacement sets that intersect transfers until a pair-safe operation is chosen. Apply the shared red -> implementation -> green -> runtime -> review loop before the next slice.
3. **R09.3:** Commit replacement and ledger effects atomically; preserve Notes/date mapping; persist import history and per-row outcomes; reconcile exported signed values and split detail. Apply the shared red -> implementation -> green -> runtime -> review loop before the next slice.

**Data/migration contract:** Add batch identity/row ordinal/fingerprint and mapping version where absent; never repurpose soft-deleted transaction idempotency keys as a blanket skip rule.

**Independent acceptance oracle:** Exact batch replay no new effects; overwrite repeated stable; same-day equal purchases both retained; Feb30 rejected; ambiguous slash date needs chosen format; no partial pair deletion.

**Focused verification:** `npm run test:server:run -- modules/accounts/__tests__/completion-r09.realdb.integration.test.ts`. Before repair expect a failure on the missing behavior, not setup. After repair expect the selected assertions to pass with the same fixture and explicit negative/race cases. Add the matching J journey from ACCEPTANCE; use production mode for security headers/CSRF/providers/clock checks. Existing green suites do not replace these assertions.

**Closure evidence:** `evidence/R09/RESULT.md` under this package, plus sanitized command outputs, expected/actual rows, migration report if any, and runtime target/revision. No result files exist yet. Suggested commit subject, if commit authorized: `fix(r09): one correct import/export workflow`.

### R10 — Budgets and reversible goals

**Owner:** assign a named implementing agent and reviewer when authorized. **Effort:** 4–7 days. **Completion dependencies:** R08, R12.
**Primary register rows:** FIN-06, FIN-07, FIN-09, NEW-29. **Supporting:** FIN-05, NEW-16.

**Existing file targets (follow delegates/imports before edits):**
- Modify as needed: `server/repositories/BudgetSpendRepository.ts`
- Modify as needed: `server/services/budget/BudgetRecalculationService.ts`
- Modify as needed: `server/services/TransactionGoalLinkService.ts`
- Modify as needed: `server/services/GoalAccountAssignmentService.ts`
- Modify as needed: `server/modules/goals/goals.validation.ts`
- Proposed test: `server/modules/goals/__tests__/completion-r10.realdb.integration.test.ts`. Create only during implementation; reuse/extend existing equivalent tests when that makes the defect clearer.

**Ordered slices:**
1. **R10.1:** Count authorized split/refund/posting activity with historical FX; preview historical averages and preserve manual budgets. Apply the shared red -> implementation -> green -> runtime -> review loop before the next slice.
2. **R10.2:** Expose working rollover preference and audit batch identity; preserve period uniqueness and closing balance across retries. Apply the shared red -> implementation -> green -> runtime -> review loop before the next slice.
3. **R10.3:** Make contributions, links, assignments and their reversals explicit; prevent double counting assigned balances plus links; distinguish progress-only records from real transfers; enforce bounded valid amounts and correction UI. Apply the shared red -> implementation -> green -> runtime -> review loop before the next slice.

**Data/migration contract:** Record goal progress provenance and correction links; no silent clamping that prevents exact reversal; report legacy ambiguous progress for reconciliation.

**Independent acceptance oracle:** 550/3 shows183.33; 450 unspent carries once; link/unlink restores prior progress; edit/delete reverses; two concurrent contributions reconcile; no irreversible mistaken contribution.

**Focused verification:** `npm run test:server:run -- modules/goals/__tests__/completion-r10.realdb.integration.test.ts`. Before repair expect a failure on the missing behavior, not setup. After repair expect the selected assertions to pass with the same fixture and explicit negative/race cases. Add the matching J journey from ACCEPTANCE; use production mode for security headers/CSRF/providers/clock checks. Existing green suites do not replace these assertions.

**Closure evidence:** `evidence/R10/RESULT.md` under this package, plus sanitized command outputs, expected/actual rows, migration report if any, and runtime target/revision. No result files exist yet. Suggested commit subject, if commit authorized: `fix(r10): budgets and reversible goals`.

### R11 — Rules, tags, merchants and saved organization

**Owner:** assign a named implementing agent and reviewer when authorized. **Effort:** 4–7 days. **Completion dependencies:** R04, R08.
**Primary register rows:** ORG-004, ORG-006, ORG-007, ORG-008, ORG-009, ORG-010, NEW-09, NEW-19, NEW-27, NEW-36. **Supporting:** ORG-003, ORG-005.

**Existing file targets (follow delegates/imports before edits):**
- Modify as needed: `server/services/rule/actions.ts`
- Modify as needed: `server/services/rule/service.ts`
- Modify as needed: `server/modules/rules/rules.controller.ts`
- Modify as needed: `server/repositories/TagRepository.ts`
- Modify as needed: `server/modules/merchants/merchants.routes.ts`
- Modify as needed: `server/modules/filter-presets/filter-presets.service.ts`
- Proposed test: `server/modules/rules/__tests__/completion-r11.realdb.integration.test.ts`. Create only during implementation; reuse/extend existing equivalent tests when that makes the defect clearer.

**Ordered slices:**
1. **R11.1:** Separate pure rule planning from effect execution; validate references at authoring and execution and include all actions in preview. Apply the shared red -> implementation -> green -> runtime -> review loop before the next slice.
2. **R11.2:** Repair tag merge, canonical names/counts, repeated removal; implement missing merchant detail/alias/logo/test routes and accurate archive/delete/undo behavior. Apply the shared red -> implementation -> green -> runtime -> review loop before the next slice.
3. **R11.3:** Apply saved default presets; respect includeArchived; fix category picker contract and ownership selector; provide idempotent seeding and useful uncategorized state. Apply the shared red -> implementation -> green -> runtime -> review loop before the next slice.

**Data/migration contract:** Preflight cross-household rules and duplicate tags before scoped uniqueness; preserve original IDs in migration map and audit actual affected rows.

**Independent acceptance oracle:** Dry-run tag/alias/split snapshots unchanged; foreign IDs rejected and legacy rules quarantined;60+60 split rejected; merge/undo preserves actual row counts; every merchant control persists.

**Focused verification:** `npm run test:server:run -- modules/rules/__tests__/completion-r11.realdb.integration.test.ts`. Before repair expect a failure on the missing behavior, not setup. After repair expect the selected assertions to pass with the same fixture and explicit negative/race cases. Add the matching J journey from ACCEPTANCE; use production mode for security headers/CSRF/providers/clock checks. Existing green suites do not replace these assertions.

**Closure evidence:** `evidence/R11/RESULT.md` under this package, plus sanitized command outputs, expected/actual rows, migration report if any, and runtime target/revision. No result files exist yet. Suggested commit subject, if commit authorized: `fix(r11): rules, tags, merchants and saved organization`.

### R12 — FX ownership and reconciled reports

**Owner:** assign a named implementing agent and reviewer when authorized. **Effort:** 5–8 days. **Completion dependencies:** R04, R08.
**Primary register rows:** FIN-18, NEW-02, NEW-06, NEW-13, NEW-14, NEW-15, NEW-34. **Supporting:** FIN-05, FIN-14, FIN-17, NEW-21, NEW-22, NEW-35.

**Existing file targets (follow delegates/imports before edits):**
- Modify as needed: `server/repositories/reports/AnalyticsRatiosRepository.ts`
- Modify as needed: `server/repositories/reports/fxRateExpr.ts`
- Modify as needed: `server/repositories/reports/CashflowReportRepository.ts`
- Modify as needed: `server/repositories/reports/TransactionReportRepository.ts`
- Modify as needed: `server/services/account/AccountReportingService.ts`
- Modify as needed: `server/modules/investments/investments.fx.controller.ts`
- Proposed test: `server/modules/reports/__tests__/completion-r12.realdb.integration.test.ts`. Create only during implementation; reuse/extend existing equivalent tests when that makes the defect clearer.

**Ordered slices:**
1. **R12.1:** Separate read-only global market data from household overrides; owner/admin edit only own override with immutable provenance. Apply the shared red -> implementation -> green -> runtime -> review loop before the next slice.
2. **R12.2:** Unify dated-flow and as-of valuation policies, splits/card spend/refunds/Uncategorized/Unassigned, money DTOs and rounding; propagate incomplete FX explicitly. Apply the shared red -> implementation -> green -> runtime -> review loop before the next slice.
3. **R12.3:** Repair both cache families, client invalidation, local dates/chart labels/quarter grouping and historical net-worth/recap semantics; mark snapshots without inventing history. Apply the shared red -> implementation -> green -> runtime -> review loop before the next slice.

**Data/migration contract:** Add household-scoped FX/security override identity, precision and validity metadata; quarantine ambiguous legacy global manual rows rather than assigning them arbitrarily.

**Independent acceptance oracle:** ZMW100+USD10@20=300; USD75@26.5=1987.50; foreign rate write cannot change another household; all comparable report totals foot; immediate summary sees write; missing FX422 or explicit incomplete valuation.

**Focused verification:** `npm run test:server:run -- modules/reports/__tests__/completion-r12.realdb.integration.test.ts`. Before repair expect a failure on the missing behavior, not setup. After repair expect the selected assertions to pass with the same fixture and explicit negative/race cases. Add the matching J journey from ACCEPTANCE; use production mode for security headers/CSRF/providers/clock checks. Existing green suites do not replace these assertions.

**Closure evidence:** `evidence/R12/RESULT.md` under this package, plus sanitized command outputs, expected/actual rows, migration report if any, and runtime target/revision. No result files exist yet. Suggested commit subject, if commit authorized: `fix(r12): fx ownership and reconciled reports`.

### R13 — Investment, pension and GRZ lifecycle

**Owner:** assign a named implementing agent and reviewer when authorized. **Effort:** 7–11 days. **Completion dependencies:** R08, R12, R14.
**Primary register rows:** FIN-10, FIN-11, FIN-12, FIN-14, NEW-03, NEW-04, NEW-20, NEW-21, NEW-22, NEW-23, NEW-24, NEW-25. **Supporting:** NEW-35.

**Existing file targets (follow delegates/imports before edits):**
- Modify as needed: `server/routes/grz-securities.ts`
- Modify as needed: `server/services/grz-service.ts`
- Modify as needed: `server/services/investment/processDueInvestments.ts`
- Modify as needed: `server/services/investment/processTBillMaturities.ts`
- Modify as needed: `server/modules/investments/investments.service.ts`
- Modify as needed: `client/src/pages/Investments.tsx`
- Proposed test: `server/modules/investments/__tests__/completion-r13.realdb.integration.test.ts`. Create only during implementation; reuse/extend existing equivalent tests when that makes the defect clearer.

**Ordered slices:**
1. **R13.1:** Implement lots/basis and positive-quantity constraints for manual/automated/opening holdings; compute currency conversions and validate pension contributions. Apply the shared red -> implementation -> green -> runtime -> review loop before the next slice.
2. **R13.2:** Preserve record-only purchase entry; implement asset-to-cash settlement linkage, disposal basis and principal-versus-income classification under SPEC; block payable rows after disposal. Apply the shared red -> implementation -> green -> runtime -> review loop before the next slice.
3. **R13.3:** Validate dates/rates/fees/zero-interest maturity; persist calculation convention and approved withholding version; reconcile tax exports and local year boundaries; expose all tabs without equity holdings. Apply the shared red -> implementation -> green -> runtime -> review loop before the next slice.

**Data/migration contract:** Introduce settlement/provenance links and versioned policy fields where needed; migrate legacy payments via reconciliation report, never automatic duplicate credits; OI-03 blocks real tax-labelled outputs until verified.

**Independent acceptance oracle:** Two equal-price buys have no invented gain; negative sell400; sale consumes FIFO lots; sold bond pay409; principal not ordinary income; zero-interest bill matures; actual cash receipt linked once; tax counts Dec31 once.

**Focused verification:** `npm run test:server:run -- modules/investments/__tests__/completion-r13.realdb.integration.test.ts`. Before repair expect a failure on the missing behavior, not setup. After repair expect the selected assertions to pass with the same fixture and explicit negative/race cases. Add the matching J journey from ACCEPTANCE; use production mode for security headers/CSRF/providers/clock checks. Existing green suites do not replace these assertions.

**Closure evidence:** `evidence/R13/RESULT.md` under this package, plus sanitized command outputs, expected/actual rows, migration report if any, and runtime target/revision. No result files exist yet. Suggested commit subject, if commit authorized: `fix(r13): investment, pension and grz lifecycle`.

### R14 — Durable recurring and scheduled jobs

**Owner:** assign a named implementing agent and reviewer when authorized. **Effort:** 4–6 days. **Completion dependencies:** R08, R19.
**Primary register rows:** OPS-003, OPS-013, NEW-10, NEW-30. **Supporting:** FIN-11, FIN-12, NEW-16, NEW-33.

**Existing file targets (follow delegates/imports before edits):**
- Modify as needed: `server/routes/cron.ts`
- Modify as needed: `server/services/recurring/RecurringProcessingService.ts`
- Modify as needed: `server/services/recurring/materializationKey.ts`
- Modify as needed: `server/services/investment/investmentCronKeys.ts`
- Modify as needed: `server/modules/recurring/recurring.controller.ts`
- Proposed test: `server/modules/recurring/__tests__/completion-r14.realdb.integration.test.ts`. Create only during implementation; reuse/extend existing equivalent tests when that makes the defect clearer.

**Ordered slices:**
1. **R14.1:** Wire recurring form required fields and errors; preserve monthly anchor, timezone, end/pause and bounded catch-up semantics. Apply the shared red -> implementation -> green -> runtime -> review loop before the next slice.
2. **R14.2:** Create registry and durable due-item identity, lease fencing, retries and run history for every financial and notification job. Apply the shared red -> implementation -> green -> runtime -> review loop before the next slice.
3. **R14.3:** Connect declared scheduler, authenticated cron and receipt/outbox workers; repair detection endpoint; expose operator stale/failure indicators. Apply the shared red -> implementation -> green -> runtime -> review loop before the next slice.

**Data/migration contract:** Add unique(job,household,dueIdentity), claim generation/lease/state/outcome; DB uniqueness is authority, Redis cache expiry is not.

**Independent acceptance oracle:** Aug31->Sep30->Oct31; three missed periods caught up once each; no future member-forced posting; two workers and restart yield one financial effect; scheduled staging ticks observed.

**Focused verification:** `npm run test:server:run -- modules/recurring/__tests__/completion-r14.realdb.integration.test.ts`. Before repair expect a failure on the missing behavior, not setup. After repair expect the selected assertions to pass with the same fixture and explicit negative/race cases. Add the matching J journey from ACCEPTANCE; use production mode for security headers/CSRF/providers/clock checks. Existing green suites do not replace these assertions.

**Closure evidence:** `evidence/R14/RESULT.md` under this package, plus sanitized command outputs, expected/actual rows, migration report if any, and runtime target/revision. No result files exist yet. Suggested commit subject, if commit authorized: `fix(r14): durable recurring and scheduled jobs`.

### R15 — Durable receipts and OCR

**Owner:** assign a named implementing agent and reviewer when authorized. **Effort:** 3–5 days. **Completion dependencies:** R08, R19.
**Primary register rows:** OPS-001, OPS-004, NEW-18. **Supporting:** ORG-006, NEW-39.

**Existing file targets (follow delegates/imports before edits):**
- Modify as needed: `server/modules/receipts/receipts.controller.ts`
- Modify as needed: `server/modules/receipts/receipts.service.ts`
- Modify as needed: `server/repositories/ReceiptRepository.ts`
- Modify as needed: `server/services/ReceiptService.ts`
- Modify as needed: `server/middleware/uploadsAuth.ts`
- Proposed test: `server/modules/receipts/__tests__/completion-r15.realdb.integration.test.ts`. Create only during implementation; reuse/extend existing equivalent tests when that makes the defect clearer.

**Ordered slices:**
1. **R15.1:** Self-host/pin OCR worker assets compatible with production CSP; exercise real upload/scan/correct/match UI. Apply the shared red -> implementation -> green -> runtime -> review loop before the next slice.
2. **R15.2:** Make receipt-to-ledger one atomic idempotent transition; reject nonpositive amount and cross-household match; retry same request returns original result. Apply the shared red -> implementation -> green -> runtime -> review loop before the next slice.
3. **R15.3:** Move files under durable storage manifest and safe authenticated retrieval; remove server paths from DTO; support deletion/restart/restore and legacy file migration. Apply the shared red -> implementation -> green -> runtime -> review loop before the next slice.

**Data/migration contract:** Add receipt version/idempotency and durable storage object metadata if absent; pending-file state handles DB/object failures without false success.

**Independent acceptance oracle:** Second create produces no second charge; negative amount400; corrected OCR persists; unauthorized file denied; restart and restore retain valid files; abandoned uploads cleaned safely.

**Focused verification:** `npm run test:server:run -- modules/receipts/__tests__/completion-r15.realdb.integration.test.ts`. Before repair expect a failure on the missing behavior, not setup. After repair expect the selected assertions to pass with the same fixture and explicit negative/race cases. Add the matching J journey from ACCEPTANCE; use production mode for security headers/CSRF/providers/clock checks. Existing green suites do not replace these assertions.

**Closure evidence:** `evidence/R15/RESULT.md` under this package, plus sanitized command outputs, expected/actual rows, migration report if any, and runtime target/revision. No result files exist yet. Suggested commit subject, if commit authorized: `fix(r15): durable receipts and ocr`.

### R16 — Notifications, push and weekly recap

**Owner:** assign a named implementing agent and reviewer when authorized. **Effort:** 3–5 days. **Completion dependencies:** R04, R12, R14, R19.
**Primary register rows:** OPS-008, OPS-006, OPS-009, OPS-010, OPS-007, NEW-31, NEW-38. **Supporting:** OPS-005.

**Existing file targets (follow delegates/imports before edits):**
- Modify as needed: `server/services/NotificationService.ts`
- Modify as needed: `server/services/notification/push.ts`
- Modify as needed: `server/modules/notifications/notifications.controller.ts`
- Modify as needed: `server/modules/weekly-recap/weekly-recap.service.ts`
- Modify as needed: `server/modules/weekly-recap/weekly-recap.email.service.ts`
- Proposed test: `server/modules/notifications/__tests__/completion-r16.realdb.integration.test.ts`. Create only during implementation; reuse/extend existing equivalent tests when that makes the defect clearer.

**Ordered slices:**
1. **R16.1:** Validate push destinations against known service origins and safe resolved addresses; enforce bounded egress without real SSRF probes. Apply the shared red -> implementation -> green -> runtime -> review loop before the next slice.
2. **R16.2:** Implement per-channel status/idempotence/retry and preferences/quiet hours; escape templates; emit security change notices without login noise. Apply the shared red -> implementation -> green -> runtime -> review loop before the next slice.
3. **R16.3:** Make recap viewer-aware and period-exact; honor flags/consent, correct currencies, store period snapshots and display explicit incomplete data. Apply the shared red -> implementation -> green -> runtime -> review loop before the next slice.

**Data/migration contract:** Add unique delivery identity and outcome rows, retry scheduling and recap snapshot version; store no sensitive financial bodies in logs.

**Independent acceptance oracle:** Email failure plus push success stays distinguishable; retry does not duplicate; private recurring markers absent; seven-day period exact; historical recap never substitutes current net worth.

**Focused verification:** `npm run test:server:run -- modules/notifications/__tests__/completion-r16.realdb.integration.test.ts`. Before repair expect a failure on the missing behavior, not setup. After repair expect the selected assertions to pass with the same fixture and explicit negative/race cases. Add the matching J journey from ACCEPTANCE; use production mode for security headers/CSRF/providers/clock checks. Existing green suites do not replace these assertions.

**Closure evidence:** `evidence/R16/RESULT.md` under this package, plus sanitized command outputs, expected/actual rows, migration report if any, and runtime target/revision. No result files exist yet. Suggested commit subject, if commit authorized: `fix(r16): notifications, push and weekly recap`.

### R17 — Thandi Claude primary and Gemini fallback

**Owner:** assign a named implementing agent and reviewer when authorized. **Effort:** 5–8 days. **Completion dependencies:** R04, R05, R12, R19.
**Primary register rows:** OPS-012. **Supporting:** none.

**Existing file targets (follow delegates/imports before edits):**
- Modify as needed: `server/modules/ai/ai.service.ts`
- Modify as needed: `server/modules/ai/ai.gemini.ts`
- Modify as needed: `server/modules/ai/ai.fallback.ts`
- Modify as needed: `server/modules/ai/ai.controller.ts`
- Modify as needed: `server/modules/ai/ai.conversation.repository.ts`
- Modify as needed: `shared/schema.ts`
- Proposed test: `server/modules/ai/__tests__/completion-r17.realdb.integration.test.ts`. Create only during implementation; reuse/extend existing equivalent tests when that makes the defect clearer.

**Ordered slices:**
1. **R17.1:** Implement canonical provider contracts, direct Claude adapter and configured Gemini adapter with truthful provenance and stage-aware orchestration. Apply the shared red -> implementation -> green -> runtime -> review loop before the next slice.
2. **R17.2:** Version both-provider household consent and owner/admin controls; preserve authorized tools, sanitization/history privacy and deterministic calculations. Apply the shared red -> implementation -> green -> runtime -> review loop before the next slice.
3. **R17.3:** Implement durable request/attempt/budget ledger and cancellation; use bounded eligible failover then labelled local mode; add mocks/evaluation and controlled paid smoke after OI-02. Apply the shared red -> implementation -> green -> runtime -> review loop before the next slice.

**Data/migration contract:** New durable AI request, attempt, reservation and consent version records under schema contracts in THANDI_SPEC; never rely on evictable Redis counters as spending authority.

**Independent acceptance oracle:** At most3 paid attempts, one final conversation result; failure/unknown cost audited; two requests at last budget unit admit only one; revoked consent prevents fallback; forced Claude failure reaches Gemini; both fail gives labelled useful local result or unavailable.

**Focused verification:** `npm run test:server:run -- modules/ai/__tests__/completion-r17.realdb.integration.test.ts`. Before repair expect a failure on the missing behavior, not setup. After repair expect the selected assertions to pass with the same fixture and explicit negative/race cases. Add the matching J journey from ACCEPTANCE; use production mode for security headers/CSRF/providers/clock checks. Existing green suites do not replace these assertions.

**Closure evidence:** `evidence/R17/RESULT.md` under this package, plus sanitized command outputs, expected/actual rows, migration report if any, and runtime target/revision. No result files exist yet. Suggested commit subject, if commit authorized: `fix(r17): thandi claude primary and gemini fallback`.

### R18 — Complete UX, accessibility and date display

**Owner:** assign a named implementing agent and reviewer when authorized. **Effort:** 4–6 days. **Completion dependencies:** R02, R03, R05.
**Primary register rows:** UX-02, NEW-37. **Supporting:** UX-01, NEW-09, NEW-10, NEW-11, NEW-15, NEW-25, NEW-27, NEW-33.

**Existing file targets (follow delegates/imports before edits):**
- Modify as needed: `client/src/App.tsx`
- Modify as needed: `client/src/pages/Investments.tsx`
- Modify as needed: `client/src/pages/settings/SettingsLayout.tsx`
- Modify as needed: `client/src/features/accounts/components/AccountFilters.tsx`
- Modify as needed: `client/src/features/recurring/components/RecurringEditModal.tsx`
- Proposed test: `e2e/completion-r18.spec.ts`. Create only during implementation; reuse/extend existing equivalent tests when that makes the defect clearer.

**Ordered slices:**
1. **R18.1:** Fix mobile navigation/clipping, empty/default-filter states and first-run guidance; submit every visible workflow and surface validation. Apply the shared red -> implementation -> green -> runtime -> review loop before the next slice.
2. **R18.2:** Implement functional offered copy/reset/navigation controls and truthful greetings/transfer attribution; remove only fictional commercial claims. Apply the shared red -> implementation -> green -> runtime -> review loop before the next slice.
3. **R18.3:** Standardize dates/locale/decimal display, keyboard/focus/labels/error announcements,320px/200%zoom and loading/error/retry/offline states. Apply the shared red -> implementation -> green -> runtime -> review loop before the next slice.

**Data/migration contract:** Per-user display defaults migrate without overwriting existing choices; no financial changes via presentation conversion.

**Independent acceptance oracle:** Every offered control has an observable result; no unexplained first-run toast cascade; keyboard/screen-reader journeys complete; real phone and browser matrix recorded.

**Focused verification:** `npx playwright test --config playwright.production.config.ts e2e/completion-r18.spec.ts --project=chromium`. Before repair expect a failure on the missing behavior, not setup. After repair expect the selected assertions to pass with the same fixture and explicit negative/race cases. Add the matching J journey from ACCEPTANCE; use production mode for security headers/CSRF/providers/clock checks. Existing green suites do not replace these assertions.

**Closure evidence:** `evidence/R18/RESULT.md` under this package, plus sanitized command outputs, expected/actual rows, migration report if any, and runtime target/revision. No result files exist yet. Suggested commit subject, if commit authorized: `fix(r18): complete ux, accessibility and date display`.

### R19 — Deployable operations, storage and recovery

**Owner:** assign a named implementing agent and reviewer when authorized. **Effort:** 4–7 days. **Completion dependencies:** R00.
**Primary register rows:** OPS-002, OPS-014, OPS-015, QA-02. **Supporting:** OPS-001, OPS-013, NEW-08, NEW-39.

**Existing file targets (follow delegates/imports before edits):**
- Modify as needed: `render.yaml`
- Modify as needed: `server/db.ts`
- Modify as needed: `server/utils/logger.ts`
- Modify as needed: `server/routes/cron.ts`
- Modify as needed: `scripts/tools/check-staging-health.mjs`
- Modify as needed: `.github/workflows/ci.yml`
- Proposed test: `server/testing/__tests__/completion-r19.test.ts`. Create only during implementation; reuse/extend existing equivalent tests when that makes the defect clearer.

**Ordered slices:**
1. **R19.1:** Declare staging/prod service identities, CA-verified DB TLS, durable object storage and external scheduler; pin runtime configuration. Apply the shared red -> implementation -> green -> runtime -> review loop before the next slice.
2. **R19.2:** Implement meaningful bounded readiness checks, redacted structured context, job/provider metrics and alert routing; run cache/DB/storage outage scenarios. Apply the shared red -> implementation -> green -> runtime -> review loop before the next slice.
3. **R19.3:** Prepare versioned migration, backups including files, restore/rollback and incident runbooks; enforce explicit owner-configured secrets and access. Apply the shared red -> implementation -> green -> runtime -> review loop before the next slice.

**Data/migration contract:** Durable object manifest and job/AI DB state included in backups; separate test/staging/prod; no deploy or paid service creation authorized by this document.

**Independent acceptance oracle:** Known SHA on HTTPS staging; invalid CA fails; required outage makes readiness fail; restore meets RPO24h/RTO4h target; rollback compatible with migrated data; no secret/raw finance log leakage.

**Focused verification:** `npm run test:server:run -- testing/__tests__/completion-r19.test.ts`. Before repair expect a failure on the missing behavior, not setup. After repair expect the selected assertions to pass with the same fixture and explicit negative/race cases. Add the matching J journey from ACCEPTANCE; use production mode for security headers/CSRF/providers/clock checks. Existing green suites do not replace these assertions.

**Closure evidence:** `evidence/R19/RESULT.md` under this package, plus sanitized command outputs, expected/actual rows, migration report if any, and runtime target/revision. No result files exist yet. Suggested commit subject, if commit authorized: `fix(r19): deployable operations, storage and recovery`.

### R20 — Trustworthy automated and runtime verification

**Owner:** assign a named implementing agent and reviewer when authorized. **Effort:** 3–5 days. **Completion dependencies:** R00.
**Primary register rows:** OPS-011, QA-01. **Supporting:** none.

**Existing file targets (follow delegates/imports before edits):**
- Modify as needed: `playwright.config.ts`
- Modify as needed: `e2e/global-setup.ts`
- Modify as needed: `server/vitest.config.ts`
- Modify as needed: `client/vitest.config.ts`
- Modify as needed: `e2e/transactions.spec.ts`
- Modify as needed: `e2e/investments.spec.ts`
- Proposed test: `server/testing/__tests__/completion-r20.test.ts`. Create only during implementation; reuse/extend existing equivalent tests when that makes the defect clearer.

**Ordered slices:**
1. **R20.1:** Guard all root/server/browser harnesses against real DB or arbitrary reused server; pin browser/runtime identities. Apply the shared red -> implementation -> green -> runtime -> review loop before the next slice.
2. **R20.2:** Replace fill-only or conditional-empty assertions with submit/result/DB-readback and mandatory populated fixture journeys. Apply the shared red -> implementation -> green -> runtime -> review loop before the next slice.
3. **R20.3:** Provide separate production-mode verification profile with CSRF, cookies, CSP, rates, Redis and UTC server/Lusaka actor; use synthetic data and local sinks. Apply the shared red -> implementation -> green -> runtime -> review loop before the next slice.

**Data/migration contract:** No application data migration; fixtures generated per run with exact target identity and scoped cleanup; do not reuse private audit jars.

**Independent acceptance oracle:** Wrong target aborts; mutations actually occur in fixtures; absent required controls fail; no new skip conceals regression; standard tests and protected-runtime probes separately report results.

**Focused verification:** `npm run test:server:run -- testing/__tests__/completion-r20.test.ts`. Before repair expect a failure on the missing behavior, not setup. After repair expect the selected assertions to pass with the same fixture and explicit negative/race cases. Add the matching J journey from ACCEPTANCE; use production mode for security headers/CSRF/providers/clock checks. Existing green suites do not replace these assertions.

**Closure evidence:** `evidence/R20/RESULT.md` under this package, plus sanitized command outputs, expected/actual rows, migration report if any, and runtime target/revision. No result files exist yet. Suggested commit subject, if commit authorized: `fix(r20): trustworthy automated and runtime verification`.

### R21 — Integrated acceptance and controlled release

**Owner:** assign a named implementing agent and reviewer when authorized. **Effort:** 5–8 days. **Completion dependencies:** R01, R02, R03, R04, R05, R06, R07, R08, R09, R10, R11, R12, R13, R14, R15, R16, R17, R18, R19, R20.
**Primary register rows:** Cross-cutting acceptance; closes supported rows only with their primary owner. **Supporting:** QA-02.

**Existing file targets (follow delegates/imports before edits):**
- Modify as needed: `e2e/auth.spec.ts`
- Modify as needed: `e2e/transactions.spec.ts`
- Modify as needed: `e2e/organization.spec.ts`
- Modify as needed: `e2e/reports.spec.ts`
- Modify as needed: `scripts/tools/check-staging-health.mjs`
- Proposed test: `e2e/completion-r21.spec.ts`. Create only during implementation; reuse/extend existing equivalent tests when that makes the defect clearer.

**Ordered slices:**
1. **R21.1:** Execute J01-J16 with independent financial oracles and every resolved finding's evidence at one candidate SHA. Apply the shared red -> implementation -> green -> runtime -> review loop before the next slice.
2. **R21.2:** Run real controlled SMTP/provider/push/device checks, restore/rollback and14-day soak; collect owner UAT and explicit deployment authorization. Apply the shared red -> implementation -> green -> runtime -> review loop before the next slice.
3. **R21.3:** Release canary, observe real scheduled runs and72h health, then expand only after gates; archive final manifests and remaining optional enhancements. Apply the shared red -> implementation -> green -> runtime -> review loop before the next slice.

**Data/migration contract:** No new schema by default; release manifests pin code/config/schema/object and provider identities; a fix resets affected evidence and relevant soak gate.

**Independent acceptance oracle:** No required open item, no unresolved P0/P1, all offered functions pass; continuous14-day soak without P0/P1, restore/rollback/UAT evidence; production smoke and first due runs.

**Focused verification:** `npx playwright test --config playwright.production.config.ts e2e/completion-r21.spec.ts --project=chromium`. Before repair expect a failure on the missing behavior, not setup. After repair expect the selected assertions to pass with the same fixture and explicit negative/race cases. Add the matching J journey from ACCEPTANCE; use production mode for security headers/CSRF/providers/clock checks. Existing green suites do not replace these assertions.

**Closure evidence:** `evidence/R21/RESULT.md` under this package, plus sanitized command outputs, expected/actual rows, migration report if any, and runtime target/revision. No result files exist yet. Suggested commit subject, if commit authorized: `fix(r21): integrated acceptance and controlled release`.

## Initial ten-day allocation, not a promise to finish foundations

- Days1–2: R00/R20 target guard and current baseline; assign OI inputs; R19 staging configuration design.
- Days3–5: R01 actual revocation/DTOs and R02 fresh-browser verification; review in small changes.
- Days6–8: R04 privacy/capabilities; R11 foreign-reference and dry-run regression slices.
- Days9–10: R03 membership/ownership and R08 money oracles. Start R09 overwrite repair only once R08 transaction contract is settled.
- Any unfinished prerequisite carries forward. Do not compress tests or mark a gate passed to preserve the allocation.

Parallel implementation is possible only with explicit ownership: one agent on security, one on financial core, one on UI/harness, with a single coordinator owning shared/schema.ts, package manifests and deployment changes. Do not spawn or message agents merely because this plan describes that option; the execution context must authorize delegation. No two agents edit the same shared contract concurrently without a handoff.

## Stopping and handoff rules

Stop the dependent action on an unknown real data target, missing paid-call limit, ambiguous legacy monetary backfill, unresolved tax/retention input or unauthorized deployment. Keep working on independent authorized tasks. Record concrete blocker, required input, evidence and next safe step. Do not ask the owner to reselect Claude/Gemini or reconfirm the full-product brief.

Before handing off: record exact SHA/branch, claimed files, register statuses, tests actually run, runtime fixtures, migration state and next command. Include links rather than credentials. See AGENT_HANDOFF for the copy/paste prompt and evidence schema.

