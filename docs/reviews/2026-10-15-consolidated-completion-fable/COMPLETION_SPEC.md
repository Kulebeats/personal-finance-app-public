# Consolidated completion specification: work orders CP-00 to CP-21

Each work order is self-contained enough for an agent to execute without reading the assessments, but the register rows it closes point at the full evidence. Conventions: "Closes" lists REGISTER.md rows by Codex and Fable id; "Where" lists files and lines verified at `381e943`; "G/W/T" is Given/When/Then; "RT" is runtime evidence (HTTP plus database read-back) required beyond automated tests; effort is one developer in working days, low–high. Every work order obeys CLAUDE.md: `Money` for arithmetic, `withTransaction` with `FOR UPDATE` for read-then-write, `BusinessAuditService` for financial writes, Zod at boundaries, no `as any`, the LOC ratchet (extract rather than grow), real-DB HTTP tests under `server/**/__tests__/*.realdb.integration.test.ts`, Playwright under `e2e/`. Rollback is a code revert unless a migration is listed; migrations are additive and forward-only.

Summary

| CP | Title | Days | Depends on | Lane |
|---|---|---|---|---|
| 00 | Platform baseline: runtime, dependencies, limiters, test-target guard | 3–5 | none | OPS |
| 01 | Sessions, safe DTOs, credential policy, atomic MFA codes | 3–5 | none | BE |
| 02 | Verification, recovery, first-run | 2–4 | CP-01 | BE+FE |
| 03 | Household lifecycle incl. Professional role | 4–7 | CP-02, CP-04 guard | BE+FE |
| 04 | Privacy and authorisation matrix | 4–6 | none | BE |
| 05 | Settings: profile, preferences split, currency change, named shared views | 4–7 | CP-04 | BE+FE |
| 06 | MFA management UI and policy | 2–4 | CP-01 | FE+BE |
| 07 | Personal-data export, account erasure, audit completeness | 5–8 | CP-01, CP-04 | BE+FE |
| 08 | Ledger invariants: currency, cache, splits, account edits, timestamps | 5–7 | CP-04 | BE |
| 09 | Reports, cash flow, dashboards: FX, liability sign, splits, periods | 5–7 | CP-08 | BE+FE |
| 10 | Import and export on both paths | 4–6 | CP-08 | BE+FE |
| 11 | Budgets: currency, averages, rollover, audit | 3–5 | CP-09 | BE+FE |
| 12 | Goals: reversible links and bounded contributions | 2–4 | CP-08 | BE |
| 13 | Recurring and the job registry | 4–6 | CP-08, CP-16 config | BE+OPS |
| 14 | Organisation and rules: references, pure dry-run, merchants, pickers | 4–7 | CP-04 | BE+FE |
| 15 | Investments and GRZ lifecycle | 6–9 | CP-08, CP-13 | BE+FE |
| 16 | Deployment: durable storage, health, TLS, logging, staging | 4–6 | CP-00 | OPS |
| 17 | Receipts and OCR in production | 3–5 | CP-16, CP-13 | FE+BE |
| 18 | Notifications, push, weekly recap | 3–5 | CP-04, CP-09, CP-13 | BE |
| 19 | Thandi: Claude primary, Gemini fallback, local degraded mode | 4–7 | CP-04, CP-16 | BE+FE |
| 20 | UX, phone layout, accessibility, dead controls | 5–8 | domain flows | FE |
| 21 | Honest e2e, staging soak, drills, UAT, release closure | 8–12 | all | QA+OPS |
| | Total | 87–140 | | |

---

## CP-00 Platform baseline: runtime, dependencies, limiters, test-target guard (P1) — 3–5 days

Closes: DEP-01/F-DEP-01, DEP-02, F-SEC-04b, F-SEC-04c, OPS-011/F-TEST-01 (local part), Playwright blocked. Depends on: none. Lane: OPS. Do first.

Goal: a clean bootstrap on a supported runtime with zero production advisories, limiters that do not throttle ordinary use, and test harnesses that cannot touch a non-test database.

Where: `package.json` `engines`, `.github/workflows/ci.yml` (Node 20, `postgres:16`), `render.yaml`; `server/app.ts` global `generalLimiter` mount and each `server/modules/*/*.routes.ts` that mounts `generalLimiter` again; `server/middleware/rateLimit.ts` (`ipAuthLimiter` 5/min on `/api/auth/*`); `server/vitest.config.ts` (already guards `<dbname>_test`); root `vitest.config.ts` and `playwright.config.ts` (unguarded); `scripts/verify-deploy-readiness.mjs`.

Steps:
1. Run `npm audit --omit=dev --json`; apply `npm audit fix` for the eight fixable advisories; record the `csv-parse` major as a CP-10 task and the `sharp` update here; re-run the server, client and build suites; re-run `npm audit --omit=dev` and require exit 0.
2. Move `engines`, CI matrix and render.yaml runtime to the current Active LTS (DEC-18); run the native dependencies (sharp, the OCR worker build) and the full suites on it; keep Postgres 16 in CI.
3. Mount `generalLimiter` exactly once (in `app.ts`), remove per-router mounts, size it per authenticated user at 600 requests per minute on a 60-second sliding window with the IP key as fallback for anonymous requests; keep `analyticsLimiter`, `expensiveAnalyticsLimiter`, `uploadLimiter`, `strictLimiter` where they are; scope `ipAuthLimiter` to `POST login`, `register`, `forgot-password`, `reset-password`, `resend-verification` only, 10 per minute; `/api/auth/me` and `/logout` are not auth-limited.
4. Guard the root vitest config and the Playwright global setup the way `server/vitest.config.ts` does: refuse any `DATABASE_URL` whose database name is not test-scoped (`_test`, `_e2e`, `_audit_*`), and refuse to reuse a server on the configured port unless it answers a `/healthz` probe with a run marker set by the same setup.
5. Approve and run `npx playwright install chromium` (DEC-09); run `npm run test:e2e:smoke` against a disposable database; record pass and fail per spec (the vacuous specs are rewritten in CP-21, not here).
6. Add an `engines` check and the audit step to `npm run check` or CI so regressions block.

Tests: a limiter test that performs a login plus five dashboard-equivalent request bursts (40 requests each) inside one 60-second window and asserts no 429 and `ratelimit-remaining` at or above 300, and a separate exhaustion test that sends 700 requests in one window and asserts a 429 with `retry-after`; a harness test that points the e2e setup at a non-test database name and asserts it exits before any connection; CI green on the new runtime.

Acceptance (G/W/T): given a fresh clone on the pinned runtime, when `npm ci && npm run check && npm run test:run && npm run test:server:run && npm run build && npm audit --omit=dev` run, then all exit 0. Given a logged-in user, when they load the dashboard, transactions and reports pages in sequence, then no request returns 429. Given `DATABASE_URL` pointing at `finance_app`, when `npx playwright test` starts, then it refuses before connecting.

RT: the Fable browser journey R6 repeated (three page loads, no 429). Done when: CI green on the new runtime with the audit step blocking; the limiter test and harness guard merged; smoke run recorded. Rollback: revert; the dependency bumps are a lockfile revert.

## CP-01 Sessions, safe DTOs, credential policy, atomic MFA codes (P0/P1) — 3–5 days

Closes: AH-01/SES-01 (P0), AH-02/F-AUTH-02, AH-10, AH-12, DEL-01, SNA-SEC-02. Depends on: none. Lane: BE.

Where: `server/routes/security*` or `server/modules/settings/security*` session revoke handlers (delete `user_sessions` only); `server/auth/session-revocation.ts` (correct helper, used only by password change); `server/modules/auth/auth.service.ts` register/login responses; `/api/auth/me` handler; `server/modules/settings/settings.controller.ts` profile response; `HouseholdRepository.ts:163-177` members DTO; MFA verify and backup-code consumption in the auth or security service; account deletion in `settings.account-deletion.service.ts`.

Steps:
1. Create `toPublicUserDto(user)` in `server/modules/auth/auth.dto.ts` with an explicit allow-list (`id, username, email, emailVerified, fullName, firstName, lastName, displayName, timezone, profilePictureUrl, bannerUrl, bio, createdAt, lastLoginAt, mfaEnabled, mfaMethod`); use it in register, login, `/me`, profile GET and PUT responses, members list and any audit `details` that embeds a user. Add a test that asserts the exact key set and that none of `passwordHash, mfaCode, mfaCodeExpiry, mfaBackupCodes, mfaBackupCodesGeneratedAt, emailVerificationToken, emailVerificationExpiry, failedLoginAttempts, lockedUntil, lastFailedLoginAt, nrc, salaryRangeEncrypted` appears at the HTTP boundary.
2. Route single-session revoke, revoke-all, password reset, password change and account deletion through `session-revocation.ts`, which deletes matching rows from the express `session` table (by `sess->'passport'->>'user'` or the user-id index already present) and from `user_sessions` in one transaction; scope the supplied tracking id to the actor; defeat a session save racing the revoke with a per-user `sessionGeneration` (or `revokedAt`) on the user row that the deserialiser checks on every request, so a late save of an old session cannot resurrect it; test a save issued after the revoke.
3. Consume MFA codes and backup codes with a single conditional `UPDATE ... WHERE code_hash = $1 AND used_at IS NULL RETURNING` (or `FOR UPDATE` on the user row) so two concurrent submissions yield one success.
4. Extract one `passwordPolicySchema` used by register, change and reset.
5. On e-mail change and password change write a `security_audit_logs` row and send the existing security notification template.

Data: none new. Tests: `security.sessions.revoke.realdb.integration.test.ts` with two agents (revoke one, revoke all, delete account; the revoked jar gets 401 on `/me`); DTO key-set test; MFA race test with a barrier (two parallel verifies of one code → one 200, one 401); password policy parity test; deletion leaves zero `session` rows for the user.

Acceptance: given two logged-in jars for one user, when jar A revokes jar B's session, then jar B's next `/api/auth/me` is 401 and no `session` row carries B's sid. Given a used backup code, when it is replayed concurrently, then exactly one request succeeds. Given `GET /api/auth/me`, then the body has exactly the allow-listed keys.

RT: the Fable security verifier's SES-01 script in `.local/readiness-fable-2026-10-13/scratch-security-privacy/` re-run. Done when: tests merged and green in CI; RT recorded in the register row.

## CP-02 Verification, recovery, first-run (P1, onboarding blocker) — 2–4 days

Closes: AH-03/F-AUTH-01, F-AUTH-04, AH-04/F-AUTH-03, UX-01/F-UX-01, F-ONB-01. Depends on: CP-01 (DTO), DEC-02 default. Lane: BE+FE.

Where: `server/modules/auth/auth.email.service.ts:86,119` (link path `/auth/verify-email`); `client/src/App.tsx:106` (route `/verify-email`); `server/app.ts:173-216` CSRF configuration and skip list (token bound to `req.sessionID`, `saveUninitialized: false`); `auth.service.ts:170-171` (session created at register), `:278` (login refuses unverified); `server/middleware/auth.ts` `householdGuard`; `server/modules/categories` seed endpoint; client query hooks that run before membership exists (dashboard, accounts, notifications).

Steps:
1. Point every emailed link at `${APP_URL}/verify-email?token=` and `${APP_URL}/reset-password?token=`; add a server redirect from `/auth/verify-email` to the client route for links already sent.
2. Add `/api/auth/verify-email` and `/api/settings/security/email/verify` to the CSRF skip list (single-use-token authenticated, like reset-password); `resend-verification` takes an e-mail address, not a token, so it stays CSRF-protected for session callers and gains an anonymous variant limited per IP and per address with an identical response whether or not the address exists; all three under `strictLimiter`.
3. Implement DEC-02: registration still creates a session but marks it pending; a `requireVerifiedEmail` middleware returns 403 `EMAIL_NOT_VERIFIED` on household and financial routers; `/me`, `/logout`, `/resend-verification`, `/verify-email` remain reachable; the client shows a "check your inbox" state with resend and logout.
4. First run: client gates household-dependent queries on `me.householdId`; the empty state shows one "Create your household" action; on household creation seed the default categories (reuse `POST /api/categories/seed` internally, idempotent) so the picker is populated.
5. Resend: at most once per minute per account, identical response whether or not the address exists.

Tests: `auth.verify-email.realdb.integration.test.ts` using a fresh agent with no cookies and the raw token captured from the SMTP sink message (the database stores only the hash; never send the stored hash as the token); resend throttling; `requireVerifiedEmail` matrix (pending session → 403 on `/api/accounts`, 200 on `/me`); client test for the gated first-run state; e2e `auth.spec` extended with register → mail link (sink) → verify → login.

Acceptance: given registration in browser A, when the emailed link is opened in browser B, then "Email verified" and login succeeds. Given a pending session, when it calls `POST /api/accounts`, then 403 `EMAIL_NOT_VERIFIED`. Given a brand-new household, when the owner opens Add Transaction, then the category picker lists the seeded categories. Given a new browser, when it registers, then zero error toasts appear before the household exists.

RT: SMTP sink link followed in a new incognito context (the Fable R2 journey, now passing).

## CP-03 Household lifecycle including the Professional role (P1, functional P0) — 4–7 days

Closes: AH-05/F-HH-01/SEC-02/F-HH-03, AH-06/SEC-01 (recipient and concurrency), SEC-06, SEC-07, AH-13/F-HH-02 (control removal shared with CP-20), VAL-01, DEC-12 default. Depends on: CP-02 (link conventions), CP-04 (role guard lands first). Lane: BE+FE.

Where: `client/src/hooks/use-settings.ts:696-703` (Add Member posts `POST /api/household/members`), `:555-582` (nested `member.user`); `client/src/.../MemberList.tsx:198-227, 280-285`, `AddMemberDialog.tsx:116-123`; `server/modules/household/household.routes.ts:16-33`; `invitations.controller.ts:28,36,174,221,228-285` (link, roles, accept without recipient check, one-household check outside the transaction); `HouseholdRepository.ts:45-51, 163-177, 553-605`; `members.controller.ts:26`; `transfer-ownership` handler; `createWithOwner` advisory lock.

Steps:
1. Client: Add Member calls `POST /api/household/invite {email, role}`; pending invitations list with resend and cancel; new route `/invite/:code` that stores the code, sends the user through login or register (and verification per CP-02), then calls `POST /api/household/invite/accept`; members list reads the flat DTO `{userId, name, email, role, joinedAt}`; leave and transfer-ownership controls call the existing endpoints.
2. Server accept: inside one transaction take the per-user advisory lock used by `createWithOwner`, lock the invitation and household rows, re-check expiry, state, household and that `invitation.email` equals the accepting user's verified e-mail (409 `INVITE_RECIPIENT_MISMATCH` otherwise), re-check the one-household rule, insert the membership, mark the invitation accepted; the invite-create response returns the invitation id only.
3. Ownership: `transfer-ownership` rejects self and non-members (400), runs under `FOR UPDATE` on `households` and both membership rows, demotes the old owner to admin and promotes the new one in the same statement; role-change refuses to assign `owner` and refuses to change the current owner's role; a database check or partial unique index guarantees one owner per household.
4. Professional (DEC-12 default): the invite and role-change schemas accept `professional`; the matrix in CP-04 gives it read access to authorised shared data and no financial or report export jobs; UI copy "Professional (read-only)".
5. Escape all user-controlled strings in invitation and household e-mail templates (shared helper with CP-18).
6. Remove the "Household Premium" panel (ENH-13). "Configure shared views" is not removed: it becomes the named household saved views feature in CP-05 (DEC-24).

Tests: `household.invite.realdb.integration.test.ts` (invite, wrong recipient, correct accept, duplicate accept, two concurrent accepts for one user through a barrier → one membership and one 409, create-vs-accept race, revoke, expiry); `household.ownership.realdb` (self-transfer 400, transfer, attempt to create a second owner 409, attempt to demote the owner 403); client tests for the dialog payload and the members list; e2e `organization.spec` invite flow with the sink.

Acceptance: given owner O invites m@x, when M opens the emailed link in a fresh browser, registers, verifies and accepts, then `household_members` has one row for M with the chosen role and the members page shows M's name. Given outsider X with the code, when X accepts, then 403 or 409 and no row. Given O transfers to self, then 400 and O remains owner. Given two concurrent accepts for one household-free user into two households, then exactly one membership exists.

RT: two-browser acceptance against the SMTP sink; the Fable SEC-01, SEC-06 and SEC-07 probe commands re-run and refused.

## CP-04 Privacy and authorisation matrix (P0) — 4–6 days

Closes: FIN-01/PRIV-01..05, ORG-002, OPS-005 (query side), ISO-01, ORG-001, AH-09/F-SEC-01 (gate side), FIN-01 investments and export variants (verification inside this order). Depends on: none. Lane: BE. Ships before CP-03 enables the Professional role.

Where: `server/middleware/validateEntity.ts:266-301` (`requireRole` hierarchy without `professional`); `server/middleware/householdGuard.ts:105` (cast without validation); `server/modules/goals/goals.controller.ts:359-369` (activity ignores householdContext); `goals.extra.controller.ts:105-119` and `TransactionGoalLinkService.ts:364-388` (no userId); `GoalQueryService.ts:55-71`; `TagRepository.ts:240-245` (checks only `transactions.is_private`); `RecurringRepository.ts:133-161` (no visibility predicate); `RecurringBaseService.ts:41-45`; `investments.transactions.controller.ts:21-36,59-62`, `investments.service.ts:48-71,340-359,380-411,417-435,481-493`, `PortfolioValuationService.ts:127-145`, `AccountReportingService.ts:95-113`; `AccountImportService.ts:24-43`, `AccountRepository.ts:537-542` (export without privacy predicate); `server/services/transaction/create.ts` (never sets `is_private`); `settings.routes.ts:113-118` (preferences without a role gate); reports exports and weekly-recap `generate`/`feedback` routes without `requireRole`.

Steps:
1. Role matrix: one `ROLE_LEVELS` map `{owner: 5, admin: 4, member: 3, professional: 2, view_only: 1}` and a `can(role, capability)` table matching the capability matrix: professional and view_only read authorised shared data, run no financial or report export jobs and make no mutations; the personal privacy export is open to every role. `requireRole` throws 403 for any role not in the map. `householdGuard` validates the stored role against the enum and fails closed.
2. Visibility predicate: one shared SQL fragment `visibleTransactionPredicate(userId)` = household membership AND account visible (`a.is_private = false OR a.owner_user_id = userId`) AND transaction visible (`t.is_private = false OR t.owner_user_id = userId`), joined to accounts, the two privacy facts kept independent and tested with mismatched-owner and account-private/transaction-public fixtures, used by goal links, goal activity, goal summary, tag transactions, recurring list/detail/transactions/history, recap recurring reads, account export, investments holdings/transactions/portfolio and AI tool queries. Goal activity additionally filters by `householdContext.householdId`.
3. Writes: `transactions.is_private` set on create only from an explicit `isPrivate` flag (default false); account privacy is never copied into it because the predicate enforces it; unlink, rename and delete of private items by non-owners return 404 (Rule 11).
4. No backfill of `transactions.is_private` from account privacy (corrected 15 Oct after the cross-read with the Codex consolidation): account privacy and transaction privacy are distinct facts with their own provenance, and the predicate in step 2 already enforces both. A one-off report listing transactions on private accounts whose flag is false is produced for review, nothing is rewritten.
5. Gates: `requireRole("member")` on `POST /api/reports/exports`, `POST /api/reports/custom`, weekly-recap `generate` and `feedback`, import execute (make the controller check declarative); `PUT /api/settings/preferences` becomes owner/admin (CP-05 adds the per-user route).

Tests: a matrix test that creates households H (owner, admin, member, professional, view_only, plus an unknown role value injected at the `householdGuard` seam through a test double, since the `household_role` enum forbids persisting it) and J (outsider), a private and a shared account with a private and a shared transaction each, links them to a goal, tags them, creates a recurring rule and a holding on the private account, then iterates every read route listed above and every mutating route in the module routers, asserting status and unchanged rows; `goals.privacy.realdb`, `tags.privacy.realdb`, `recurring.privacy.realdb`, `investments.privacy.realdb`, `accounts.export.privacy.realdb`; a test that a false transaction flag on a private account does not leak through any listed route.

Acceptance: given member M, when M calls `/api/goals/G/transactions`, `/goals/G/activity`, `/goals/summary`, `/tags/:id/transactions`, `/recurring`, `/recurring/:id/history`, `/api/accounts/:shared/transactions/export`, `/api/investments/holdings`, then no row, amount, name or account id from O's private account appears. Given outsider X, when X calls `/api/goals/G/activity`, then 404. Given role `professional` or `bogus`, when it calls any mutating route, then 403 and rows unchanged. Given view_only V, when V calls `PUT /api/settings/preferences`, then 403.

RT: the Fable security verifier scripts and the 14 October AH-09 probe re-run.

## CP-05 Settings: profile, preferences split, currency change, named shared views (P1) — 4–7 days

Closes: AH-07/SET-01, SET-02, SET-05, SNA-REC-01 (settings side). Depends on: CP-04. Lane: BE+FE.

Where: `settings.controller.ts` `updateProfile` and `updatePreferences` (`:364-396`), `settings.validation.ts` (`updateProfileSchema`, `updatePreferencesSchema:31-32`), `settings.routes.ts:105-118`; `user_preferences` table (no writer); client `pages/settings/sections/*` (profile form field list, preferences, recap and widget sections).

Steps:
1. Generate the profile schema from the field list the form sends (about 22 fields: names, display name, birthday and hide-year, gender, phones, address, occupation, company, timezone, bio, social links, nrc, annual income, income frequency, employment status, investment goal, risk tolerance); explicit null clearing; system, credential and computed fields excluded; retention note per DEC-10 in the form copy.
2. Split preferences: `PUT /api/settings/preferences` writes `household_preferences` and is owner/admin; new `GET/PUT /api/settings/user-preferences` writes `user_preferences` for the caller; the client Preferences section calls the right one; add `auto_rollover_budget` to the household schema (CP-11 uses it).
3. Currency change on a household with any transaction returns 409 `LEDGER_NOT_EMPTY` with guidance; the client disables the control with the reason.
4. Recap settings and widget settings write disjoint columns; one contract test compares each settings form's field names with its Zod schema keys and fails on drift.
5. Named household saved views (DEC-24, replaces the dead "Configure shared views" control): table `household_saved_views` (id, household_id, name, filter json, created_by, timestamps); owner and admin create, edit and delete; every member can apply one; a saved filter can only narrow, never widen, the CP-04 visibility predicate; the Settings control lists, edits and applies them.
6. Notification preference partial updates preserve omitted fields and validate the notification type against the enum (settings verifier SET-04).

Tests: `settings.profile.realdb` (PUT all fields → GET returns all; clear one → null); `settings.preferences.split.realdb` (member writes user prefs 200, household prefs 403; owner writes household prefs 200); currency 409; schema-vs-form contract test in the client suite.

Acceptance: given the profile form filled completely, when saved and reloaded, then every field shows the saved value. Given a member, when they save Preferences, then a `user_preferences` row changes and `household_preferences` does not. Given a household with one transaction, when the currency is changed, then 409 and no change.

## CP-06 MFA management UI and policy (P1) — 2–4 days

Closes: AH-11/F-SEC-05, DEC-13. Depends on: CP-01. Lane: FE+BE.

Where: existing MFA endpoints under the security routes (enable, verify, disable, backup codes); `client/src/pages/settings/sections/SecuritySection*`; the inert mandatory-MFA flag (PR #150 context); step-up threshold code in the transfer path.

Steps: Security section with enable that stays disabled until the user proves possession by entering a code delivered to the mailbox (closes the settings verifier's SEC-03 immediate-enable defect), show backup codes once, regenerate, disable with password and step-up; recovery flow on login; policy display; when the mandatory flag is set for owner and admin, existing sessions of those roles are forced to re-authenticate within 24 hours and cannot reach financial routes until enrolled; step-up thresholds compared in household currency with the dated rate and fail-closed when no rate.

Tests: `security.mfa.lifecycle.realdb` (enable → login requires code → backup code once → disable); policy enforcement test; threshold conversion test; e2e `auth.spec` MFA path.

Acceptance: given an owner, when they enable MFA, log out and log in, then a code from the sink mailbox is required; given a backup code, then it works once; given the mandatory flag on, when an admin without MFA logs in, then they are routed to enrolment and `POST /api/transactions` returns 403 until enrolled.

## CP-07 Personal-data export, account erasure, audit completeness (P1) — 5–8 days

Closes: AH-08/DATA-01/F-SEC-02, DEL-02, RC-13 and server-surface F4 audits, FIN-16 (coordinate with CP-08). Depends on: CP-01, CP-04, DEC-10 default. Lane: BE+FE.

Where: export stub in the settings or privacy controller (returns a synthetic id); `data_exports` table with `parameters` jsonb; `settings.account-deletion.service.ts:441-476` (rejects multi-household, retains logs); `security_audit_logs`; upload helpers in `server/core/uploads.ts`; the writers listed in the Fable server-surface inventory F4 (pension, SIP, market refresh, budget settings, attachments, cron ledger writes, account exports).

Steps:
1. Export: `POST /api/settings/privacy/export` creates a `data_exports` row and a job; the job assembles JSON plus CSV for every entity the user can see under the CP-04 predicate (profile, memberships, accounts, transactions, splits, tags, budgets, goals, links, recurring, holdings, receipts metadata, notifications, consent history), zips it under the upload root, records size and hash, audits it; `GET /api/settings/privacy/export/:id` reports status; download is authenticated and expires; UI button and status in Security and Privacy.
2. Erasure for three states (no household; sole owner, which erases the household; shared member, which retains shared rows and reassigns per SCP-332): pseudonymise `security_audit_logs.email` and `ip` for the subject, drop the password hash and tokens from the tombstone, delete uploaded files, revoke sessions (CP-01 helper), keep the household audit log when other members remain, require step-up and a typed confirmation; a UI entry point.
3. Audit rows for every writer in F4, inside the same transaction; move the transaction UPDATE audit into the transaction (FIN-16, with CP-08).

Tests: `privacy.export.realdb` (content includes own and shared rows, excludes another member's private rows; file hash recorded); `account.deletion.states.realdb` (three states; after deletion no row anywhere contains the e-mail except the deletion audit; stale cookie, token and file URL → 401/404); an audit-completeness test that iterates the F4 list and asserts an `audit_logs` row per write.

Acceptance: given a member with private and shared data, when they export, then the archive contains every visible row and no other member's private row. Given a deletion, when any old cookie, reset token or receipt URL is replayed, then 401 or 404. Given each F4 write, then one audit row.

## CP-08 Ledger invariants: currency, cache, splits, account edits, timestamps (P1) — 5–7 days

Closes: FIN-05/X-01, FIN-17/F-TXN-01/RC-06, RC-08, FIN-08, FIN-13, F-DATE-01 family and SEC-04, F-UX-02, F-TXN-03, F-ACC-02, FIN-16, malformed-UUID 500s. Depends on: CP-04. Lane: BE.

Where: `TransactionRepository.ts:287-310` (`createWithinTransaction` persists supplied data, no currency derivation), `:410-465` update, `:683-735` splits; `ImportService.ts:199-215`, `RecurringProcessingService.ts:187-209` (no currency); `transactions.helpers.ts:26-33` (defaults to ZMW); `transaction/queries.ts:176-285` (`withCache` 5 min, latest rate); `CacheInvalidation.ts:13-28,74-78` and `AnalyticsCache.ts:157-167` (invalidate only the analytics family); `client/src/lib/queryClient.ts:175-176` (`staleTime: Infinity`); `client/src/pages/Transactions/index.tsx:173` (query key); the 23 client month-range call sites; `server/services/transaction/create.ts:186` (`ownerUserId: userId`); `transaction/service.ts:291-347` (audit after commit); schema `timestamp without time zone` columns written by DB `now()` and JS `new Date()`.

Steps:
1. Currency invariant: the repository derives `currency` from the locked account on every create and rejects a mismatch; additive migration backfills null rows only where the account's currency has never changed (checked against the account audit history); the remainder go to a reconciliation report for review before any rewrite; DTOs carry currency through list, summary and export.
2. Summary cache: invalidate `txn-summary:*` for the household on create, update, delete, import, transfer and rule application, in both cache families, awaited after commit, with and without Redis; summary converts with the dated rate via `fxRateExpr`.
3. Client: `queryClient` default `staleTime` 30 s with refetch on focus; one `monthRange(timezone)` helper used by all call sites; server receives `startDate`/`endDate` in the household timezone; the summary query key is included in transaction mutation invalidation.
4. Splits: editing a parent amount re-validates and re-materialises children in the same transaction; amounts must sum to the parent; a change without valid replacement splits is rejected.
5. Account edits: once a ledger row exists, currency, asset/liability class and opening balance are read-only unless changed through `POST /api/accounts/:id/reconcile` which posts an adjustment transaction and audits it.
6. Timestamps: migrate the affected `timestamp` columns to `timestamptz` or set the DB session timezone to UTC and write every timestamp from the DB (`now()`); fix the invitation and audit writers that pass JS dates; the API serialises instants in UTC and the client formats in the household timezone; tax-year boundaries use the household timezone.
7. Create honours `ownerUserId: null` as shared; account create writes one audit row; malformed UUIDs return 400 through a shared param validator.
8. Transaction UPDATE audit written inside the transaction.

Tests: `transactions.currency.invariant.realdb` (manual, import, recurring, receipt, rule paths all persist the account currency; mismatch 400); `transactions.summary.cache.realdb` (create → summary reflects within one request, with Redis stub on and off); client test for `monthRange` at Lusaka on the 1st and 31st; `transactions.splits.edit.realdb`; `accounts.edit.freeze.realdb`; timestamp test asserting `created_at` equals the DB instant and an invitation's `accepted_at` is after `created_at`; audit atomicity test (fail the audit insert, assert the update rolled back).

Acceptance: given a USD account, when a recurring rule materialises, then the row's currency is USD. Given a new transaction dated today, when `GET /api/transactions/summary` is called immediately, then it is counted. Given a Lusaka client on 1 October, then the request range is 2026-10-01 to 2026-10-31. Given an account with one transaction, when its currency is changed, then 409. Given an invitation accepted, then `accepted_at` is later than `created_at`.

RT: the Fable journeys R6 and R7 repeated with DB read-back; the reports verifier fixture's September expenses (1564.15) used as the cross-check.

## CP-09 Reports, cash flow, dashboards: FX, liability sign, splits, periods (P0/P1) — 5–7 days

Closes: RC-01 (P0), RC-02/INV-06, RC-03, RC-04, RC-05, FIN-14, FIN-18/F-REP-01, F-CF-01, RC-09, RC-10, RC-11, RC-12, RC-14, DEC-14, DEC-15. Depends on: CP-08. Lane: BE+FE.

Where: `AnalyticsRatiosRepository.ts:46-81,185-216` (no conversion, no privacy filters); `BaseReportRepository.ts:78-90,162-260,283-286` (`fxRateExpr`, `assertFxRatesAvailable`, split-parent exclusion without child inclusion); `TransactionReportRepository.ts:108-111`, `SankeyNodes.ts:63-66`; `AccountReportingService.ts:88-91,95-122,194-221` (abs on liabilities; catch that drops holdings); `NetWorthReportRepository.ts:261`; `TransactionRepository.calculateBalanceDelta:105-123`; `AddAccountModal.tsx:136-143` (owed amount sent positive); `fx_rates` and `securities` tables (global, writable by any member); Annual dashboard chart adapter (month label parsed as ISO); cash-flow averages.

Steps:
1. FX scope: add nullable `household_id` to `fx_rates` and `securities` with a unique index per household, pair and date; global rows (null household) are read-only and written only by the market job; owner and admin writes go to their household (members cannot write rates, DEC-25); readers prefer the household row for the date, then the global row; an owner-facing FX entry in Settings.
2. Ratios and debt: rewrite on `fxRateExpr` plus the visibility predicate from CP-04, guarded by `assertFxRatesAvailable`; missing rate → 422 with pair and date; never 1.0.
3. Liabilities: a liability account stores the amount owed as a positive balance; a purchase increases it; net worth = Σ assets − Σ liabilities; card purchases are expenses in cash flow, income/expense, savings and annual reports; the "debt" bucket is for principal repayments only; client sends and displays accordingly.
4. Splits: a shared query helper counts split children exactly once and excludes the parent, used by budget comparison, transactions report, Sankey and both CSV exports.
5. Periods: report DTOs carry `periodStart` (ISO date) plus a display label; charts never parse labels; 12 months stay distinct; quarterly equals the sum of its months.
6. Completeness: valuation errors produce `complete: false` with the missing pair or price listed, never a silently understated total; recap week is 7 days; cash-flow averages exclude future months; merchant totals include unassigned; penny footing reconciled by summing Money and rounding once at presentation; net-worth history is labelled snapshot-only or incomplete where snapshots are absent and is reconstructed only from sufficient historical evidence, never from today's balances and prices.
7. Uncategorised is an explicit bucket everywhere; private data excluded from household aggregates (DEC-14).

Tests: `reports.consistency.realdb` property suite over random fixtures including edits and deletes asserting income − expenses = net flow, Σ buckets incl. Uncategorised = expenses, dashboard month = summary month = cashflow month = annual month, net worth = assets − liabilities, converted amounts use the latest rate dated on or before the transaction, no unconverted foreign amount in any ZMW total; `reports.ratios.fx.realdb`; `reports.liability.sign.realdb`; `reports.splits.realdb`; chart adapter unit tests; migration tests for FX scoping.

Acceptance (from the Fable reports fixture): `/api/reports/ratios` with a USD 75 balance and a stored 26.50 rate includes 1987.50 in liquid assets; with no rate → 422; net worth 41577.69 with a 500.00 card balance after a 45.50 charge; October budget actual 1273.75 in comparison and CSV; September expenses 1564.15; after another household posts a rate this household's totals are unchanged; Monthly Trends shows twelve named months and no "Invalid Date".

RT: the reports verifier fixture re-run from `.local/readiness-fable-2026-10-13/scratch-reports-consistency/` and compared to its hand values.

## CP-10 Import and export on both paths (P0/P1) — 4–6 days

Closes: FIN-02/IMP-01 (P0), FIN-03 (P0), FIN-04, FIN-15/IMP-03, IMP-02, `data_imports` never written, FIN-01 export variant (with CP-04), `csv-parse` major from CP-00, DEC-19. Depends on: CP-08. Lane: BE+FE.

Where: `ImportService.ts:135-145` (soft-delete before key check), `:172-185` (idempotency lookup ignores deleted rows), `:279-352` (account-level overwrite, one account, no pair), `sideEffects.ts:28-30`; `import/dedupe.ts:21-24`; `import/parse.ts:26-78`; `AccountImportService.ts` (uuid mismatch); `routes/import.ts`; `data_imports` table; export writers in `AccountRepository.ts:537-542` and reports exports.

Steps:
1. Overwrite (both paths) in one `withTransaction`: lock existing rows in the range (`FOR UPDATE`), compute replacements by idempotency key including soft-deleted rows, update in place or hard-replace, never soft-delete then skip; for transfers in range, delete through the paired-transfer path with both accounts locked in id order or reject the import with a preview naming the transfers; response reports created, updated, skipped, failed with row numbers; `data_imports` row written with counts and the file hash.
2. Account-detail import: fix the uuid type mismatch; explicit sign semantics per account class; the same engine as the global path.
3. Identity: each imported row carries a batch fingerprint (file hash plus mapping version) and its row ordinal as the idempotency key, so an exact replay is a no-op and two genuine same-day identical purchases in one file both import; cross-file duplicate candidates (same date, type, amount, account) are shown in the preview as reviewable decisions, never merged automatically.
4. Dates: `validDateSchema` from CLAUDE.md Rule 8 plus explicit format detection declared in the preview; impossible dates rejected with the row number; Notes mapping preserved.
5. Exports: round-trip type, sign, currency and precision; the CP-04 predicate applied; spreadsheet formula cells escaped.
6. `csv-parse` major evaluated and adopted or pinned with a recorded reason.

Tests: extend `import.execute.realdb.integration.test.ts` (overwrite twice → identical rows and balance, zero orphan soft-deletes; transfer in range → both legs replaced or import refused and both balances reconcile; account path imports one valid row; two same-day 25.00 purchases with different descriptions both import; `2026-02-30` rejected; concurrent identical imports → one effect); export round-trip test; privacy export test shared with CP-04.

Acceptance: given file F with three rows, when imported then imported again with Overwrite, then the balance is unchanged, three rows are live and no soft-deleted row lacks a replacement. Given opening 100, expense 10, income 20 (the Codex fixture), when imported once and replayed on a lost response, then the balance is 110 exactly once. Given a transfer in the replaced range on the account path, then both legs are replaced or the import is refused.

RT: the Fable import verifier CSVs re-run; the Codex `overwrite_first`/`overwrite_second` probe reproduced with `deleted: 0`.

## CP-11 Budgets: currency, averages, rollover, audit (P0/P1) — 3–5 days

Closes: FIN-06/BGR-01 (P0), FIN-07/BGR-03, BGR-02, BGR-04, DEC-17. Depends on: CP-09 (`fxRateExpr` and split helper). Lane: BE+FE.

Where: `BudgetSpendRepository.ts` (no currency filter or conversion); `BudgetRecalculation` service (sum instead of mean; overwrites; zero budgets); `household_preferences.auto_rollover_budget` (no writer; CP-05 adds it); recalc and clear audit `entityId "bulk:<uuid>"`; budget rollover cron.

Steps: spend aggregated in the budget currency with the dated rate, splits counted once, pending and refund semantics per DEC-17, private spend excluded per DEC-14; recalculate computes the mean over the chosen N months (zero months included deliberately with a toggle), previews, never overwrites a manual budget without confirmation, skips zero-spend categories; rollover driven by `budgets.rollover_enabled` and the household preference, idempotent per period under the CP-13 registry; audit `entityId` is a uuid with the batch in `details`.

Tests: extend `BudgetSpendRepository` and recalculation tests with the Codex fixture (ZMW 100 plus USD 10 at 20 → ZMW 300; months 100/100/100 → 100 monthly) and the Fable fixture (550.00 over three months → 183.33; Dining 500.00 untouched); rollover across repeated workers → one `rollover_in`; audit row test.

Acceptance: given a ZMW budget with a USD 50.00 expense and a stored rate, when progress is read, then the converted spend shows, never 50.00; given no rate, then 422. Given rollover enabled and 450.00 unspent, when the period closes, then the next period has `rollover_in = 450.00` once.

## CP-12 Goals: reversible links and bounded contributions (P1) — 2–4 days

Closes: FIN-09, GOAL-01, goal privacy variants (predicate from CP-04). Depends on: CP-08. Lane: BE.

Where: `TransactionGoalLinkService.ts:198,364-388`; goal contribution handlers; `GoalQueryService.ts:55-71`.

Steps: persist the effective delta on each link so unlink, edit and source delete restore the exact prior progress under ordered goal and transaction locks; cross-currency links converted with the dated rate or rejected; contributions validated as money (positive, under a sanity cap), overfunding above the target allowed only after explicit confirmation, available cash enforced only when the operation actually moves cash, and every contribution reversible through a recorded adjustment; soft-deleted transactions are not live links; archive, complete and reopen states consistent.

Tests: `goals.links.lifecycle.realdb` (goal 5 → spend 10 linked → unlink returns 5; edit source amount; delete source; concurrent link and unlink); contribution bound test.

Acceptance: given goal progress 5 and a linked 10 spend, when unlinked, then progress is exactly 5. Given a 1,000,000 contribution against a 10,000 target, then 400.

## CP-13 Recurring and the job registry (P0/P1) — 4–6 days

Closes: OPS-003/F-OPS-01 (P0, registry side; CP-16 wires the trigger), OPS-013, F-REC-01/REC-01, FIN-12 (recurring part), REC-02, REC-03, REC-04, F-OPS-05, `/recurring/detect` 500. Depends on: CP-08 for the registry; CP-16 only for the staging cron evidence (implementation may start before CP-16, closure cannot). Lane: BE+OPS.

Where: `server/startup.ts:40`, `server/scheduler.ts:23,83,123-153` (three in-process jobs; 10-minute locks without renewal); `server/routes/cron.ts:34-41,57-440`; `server/config/redis.ts:78-120,158`; `RecurringProcessingService.ts:160-279`; the Add-Transaction recurring section in the client (omits `frequency` and `nextDueDate`); `processDueInvestments.ts:160-179,244-319` (for CP-15); outbox and receipt-matcher workers.

Steps:
1. Job registry: a `job_runs` table (job name, scheduled-for key, started, heartbeat, finished, outcome, error, instance id) with a unique index on (job, scheduled-for); acquiring a run inserts the row or fails; a heartbeat renews the lease while running; a run whose heartbeat is stale can be reclaimed under a new fencing generation, every financial write by a job carries its generation so a stale worker's late commit is rejected, and per-item checkpoints bound the catch-up; results and errors recorded; `last success` per job exposed on `/api/admin/jobs` and the health endpoint; coordination keys outside the cache namespace.
2. Every financial job (recurring, rollover, snapshots, FX refresh, investment automation, goals status, budget alerts, receipt matching, cleanup, recap) registered with trigger, timezone (household timezone for day-based jobs), catch-up policy and output invariant; the in-process scheduler and the `/api/cron/*` endpoints both go through the registry; `CRON_SECRET` required in production with a constant-time compare.
3. Recurring semantics: the UI form sends `frequency`, `nextDueDate` (defaults to the transaction date), `endDate`, `amountType`, reminders and surfaces server field errors; day-of-month preserved after short months (31 → 30 Sep → 31 Oct); missed periods caught up in one run with a cap; `asOfDate` capped at today for members; `/recurring/detect` fixed; pause, end-date and skip explicit.
4. Dormant workers either started under the registry or removed with a recorded decision.

Tests: `jobs.registry.realdb` (two concurrent acquisitions → one run; stale heartbeat reclaimed; crash before commit leaves no financial row; retry after commit deduplicates); `processRecurring` extensions (short month, catch-up three months idempotent, future `asOfDate` 400); client test asserting the recurring payload.

Acceptance: given a monthly rule created in the UI from 31 August, when processed on 30 September and 31 October, then one transaction each. Given two instances ticking together, then one run row and one financial effect. On staging, given two consecutive days, then one `recurring_transaction_history` row per due rule and one `net_worth_snapshots` row per household per day.

RT: the Fable budgets/recurring verifier scripts re-run; staging cron evidence recorded under CP-16.

## CP-14 Organisation and rules: references, pure dry-run, merchants, pickers (P0/P1) — 4–7 days

Closes: ORG-003 (P0), ORG-004, ORG-005, ORG-006/ORG-02/F-CLIENT-01, ORG-007, ORG-008, ORG-009, ORG-010/F-CLIENT-02, ORG-01, F-TXN-02, F-ACC-01, rules accept bogus action values, tag name duplicates, `includeArchived` ignored, ENH-04 default filters. Depends on: CP-04. Lane: BE+FE. ORG-003 and ORG-004 first.

Where: `rules.validation.ts:55-79` (action values untyped); `services/rule/actions.ts:51,62-68,120,143-145,192,204-209`; `services/rule/service.ts:88-95,134-139,286-291` (dry-run and preview call the mutating evaluator); `TransactionRepository.ts:410-465,683-735`; `TagRepository.ts:136-164`; merchant routes lacking `/:id/analytics`, `/:id/transactions`, aliases, logo; `POST /rules/:id/test` absent; `POST /api/tags/merge` uuid cast; `client/src/components/transactions/form/TransactionFormFields.tsx:92,95` (`groupType` filter); both `useCategories` hooks; Accounts page default `ownerUserId=shared`; filter presets apply-on-entry.

Steps:
1. Action values typed per action: ids validated as uuid and resolved against the actor's household and the CP-04 predicate at create, update and execution; 400 `FOREIGN_REFERENCE` otherwise; a migration report lists stored rules with foreign ids and disables them.
2. Dry-run and preview call a planning evaluator that returns proposed tags, aliases, splits, category, merchant and owner changes and performs no repository write; snapshot assertions in tests for every action type.
3. Split configs validated to sum to the parent (percentages to 100, amounts to the parent) at create and execution.
4. Merchant endpoints implemented on the existing `merchant_aliases` and `merchant_logo_uploads` tables with authorisation; delete options match server behaviour (archive keeps history; permanent delete under the retention policy; merge); undo claims its history row atomically and adjusts counts from the rows actually restored; `POST /rules/:id/test` implemented or the control removed.
5. Tags: merge fixed (uuid cast), usage counts recomputed from rows, repeated removal idempotent, unique index on lower(trimmed name) per household after a dedupe migration.
6. Pickers and filters: category picker derives type from the group; Accounts default filter "All", persisted per user, with the Shared/Mine chip (this is the resolution of "shared views"); default filter preset applied on fresh navigation and never over explicit URL filters; `includeArchived` honoured.

Tests: `rules.references.realdb` (foreign category, tag, member, goal, split category → 400; a stored legacy rule applies nothing); `rules.dryrun.purity.realdb` (row hash of transactions, tags, usage counts, aliases and splits identical before and after dry-run for each action type); split bound test; `tags.merge.realdb`; merchant endpoint tests; client tests for picker options and the default filter; the Fable 14 October probe commands re-run (expect 400 and identical snapshots).

Acceptance: given an A5 member and an A4 category id in a rule action, when the rule is created, then 400 and no row. Given a dry-run with add_tags and split_transaction, then `transaction_tags`, `tags.usage_count` and `transaction_splits` are unchanged and `proposedUpdates` lists both. Given a new household after seeding, when Add Transaction opens, then the picker shows the seeded categories grouped Income and Expenses. Given a first account, when the Accounts page loads, then it is visible without changing a filter.

## CP-15 Investments and GRZ lifecycle (P0) — 6–9 days

Closes: GRZ-01, GRZ-02, GRZ-04 (P0), GRZ-03, GRZ-05, GRZ-06, FIN-10/INV-01, FIN-11/INV-02/INV-03, INV-04, INV-07, INV-08, INV-10, F-INV-01, FIN-12 (investment part), FIN-01 investments variant, GRZ P2 items, DEC-08, DEC-08b, DEC-08c. Depends on: CP-08, CP-13 registry. Lane: BE+FE.

Where: `server/services/grz-service.ts` and `server/routes/grz-securities.ts` (payments `pay`, sell, create validation); `investments.service.ts:571-596` (sell requires lots), `:48-71,340-359,380-411,417-435,481-493` (household-only scoping); `processDueInvestments.ts:160-179` (15% fallback yield), `:244-319` (no tax lot); `PortfolioValuationService.ts`; `Money.isPositive()`; tax summary and ZRA export; `client/src/pages/Investments.tsx:83-107` (empty-state gate hides tabs); `/investments/tax` link.

Steps:
1. Bond and T-bill state machine `active → sold | matured`; `pay` rejects when not active (409), when the payment date is in the future (400), when the destination is not an authorised compatible-currency account of the household (400); a confirmed principal receipt retires the holding and posts one asset-to-cash settlement (holding minus face, cash plus face, ordinary income zero; any difference to basis recorded as realised gain or loss), never ordinary income (DEC-08b); coupons remain income with WHT per DEC-08; sell computes gain or loss = proceeds − cost, credits cash, writes a disposal for tax; validation: rate as a decimal fraction within 0 to 1 with a sanity cap, face > 0, maturity after purchase.
2. `Money.isPositive()` strict (zero is not positive); cron responses return counts, never SQL or ids beyond the run id.
3. Holdings: every buy (manual, POST, SIP) creates a tax lot and updates `cost_basis` and `cost_basis_zmw` with the dated FX; sells require 0 < quantity ≤ held; `amount_zmw` computed from the posted FX; valuation errors surface as incomplete (CP-09 flag).
4. Tax: summary includes GRZ interest and WHT; ZRA export populated; tax-year boundary in the household timezone; 31 December dividend counted once.
5. Pension and SIP: `total = employee + employer` validated, audit rows, SIP catch-up for missed days under the CP-13 registry, month-end anchoring, no silent 15% yield (DEC-08c: refuse and record).
6. Privacy: actor identity carried through holdings, transactions, lots and portfolio (CP-04 predicate).
7. UI: GRZ, tax and pension tabs reachable without an equity holding; broken link fixed; record-only labelled.
8. P2 items: one day-count convention per instrument type recorded and tested; stored rate used; fees persisted; portfolio values as Money strings; coupon rows named and categorised.

Tests: extend `grz-money.integration`, `grz-record-only`, `grz-securities.sell-race`, `investments.db.integration`, `investments.sell-overdraft.realdb`; FIFO property test; schedule boundary tests; privacy test shared with CP-04; the Fable hand values from `.local/readiness-fable-2026-10-13/scratch-investments-grz/hand.mjs` as fixtures.

Acceptance: given a sold bond, when `pay` is called on a coupon, then 409 and no transaction. Given a principal row, when paid, then cash rises by the face value, the holding falls to zero, ordinary income is unchanged and net worth is unchanged. Given two purchases at an unchanged price, then zero gain. Given 10 shares bought at 310.50 and 5 sold, then the FIFO gain matches the hand value. Given a T-bill bought at face, when the maturity cron runs, then it succeeds. Given a WHT of 15% on a coupon, then the tax summary interest equals the sum of coupons and the ZRA export lists it.

RT: the investments verifier scripts re-run.

## CP-16 Deployment: durable storage, health, TLS, logging, staging (P0 functional) — 4–6 days

Closes: OPS-003/F-OPS-01 (trigger side), OPS-001/F-OPS-02, OPS-002/F-OPS-03, OPS-014/F-OPS-04, OPS-015/F-OPS-06, F-DATA-01, QA-02 (staging part), DEC-05, DEC-06, DEC-22. Depends on: CP-00. Lane: OPS.

Where: `render.yaml` (no disk, no cron services, TLS comments only, `allkeys-lru` shared); `server/app.ts:256-263` (`/healthz`), `health.controller.ts:71-83`; `server/dbSsl.ts:57-62`; `server/utils/logger.ts:76-108` (fixed field list, `redactSensitive` unused); `server/middleware/uploadsAuth.ts:33`, `receipt/upload.service.ts:87-105` and the other upload writers; 30 tracked files under `uploads/`; `shared/schema.ts` long FK names; the admin route on a missing table; `scripts/verify-deploy-readiness.mjs` (string checks only).

Steps:
1. Render: web service plus Postgres plus Key Value as declared; add a persistent disk mounted at the upload root (DEC-06) and cron services for each registered job calling `/api/cron/<job>` with `CRON_SECRET` (DEC-05); TLS CA mounted and `DATABASE_SSL_REJECT_UNAUTHORIZED=true`; Redis logical db 1 for coordination keys or a second instance with `noeviction`; `APP_URL`, `CLIENT_URL`, `SMTP_*`, `VAPID_*` set from secrets.
2. One storage abstraction (`server/core/storage.ts`) with local-disk and S3-compatible drivers used by receipts, attachments, goal images, profile and banner images, merchant logos; authenticated reads; orphan cleanup job; `uploads/` git-ignored and the tracked files removed (history rewrite per DEC-22).
3. Health: `/healthz` liveness; `/health/ready` performs a DB query and a Redis set/get with bounded timeouts, returns 503 on failure, includes revision and job last-success staleness.
4. Logger: serialise all context keys through `redactSensitive`; errors passed in context survive; job outcomes logged with run id.
5. Schema hygiene: explicit FK names under 63 characters; the admin route on the missing table fixed or removed.
6. Env validation covers every variable the app reads; `deploy:verify` extended with a live `/health/ready` call when a URL is given.
7. Provision staging from the blueprint (G0): first deploy from `main`, `smoke:staging:health` green, cron services visible.

Tests: health tests with a stopped DB and Redis stub; logger tests for redaction and context retention; storage driver tests; `deploy:verify` test.

Acceptance: on staging, given a receipt uploaded before a redeploy, then it downloads after; given the DB stopped, then `/health/ready` is 503 within 2 s; given the CA mounted, then the DB connection verifies; given two consecutive days, then cron evidence rows exist (CP-13); given a job error, then the log line carries its context.

## CP-17 Receipts and OCR in production (P1) — 3–5 days

Closes: RCP-01, RCP-02, OPS-004, F-OPS-05 (matcher), receipt details expose server paths. Depends on: CP-16 (storage), CP-13 (matcher job). Lane: FE+BE.

Where: receipt create-transaction handler and `pendingReceipts.idempotencyKey`; receipt amount schema; OCR worker and WASM assets vs production CSP (`app.ts:56` helmet); receipt DTOs with filesystem paths; the dormant matcher.

Steps: `create-transaction` under `FOR UPDATE` on the receipt; an identical replay returns the existing transaction (200, same id) and a conflicting retry returns 409; `positiveMoneyDtoSchema` on amounts; OCR assets self-hosted under the CSP with `worker-src 'self'` and the WASM directive, or OCR moved server-side; matcher registered in CP-13 and matching later transactions; DTOs expose download URLs only; the full journey upload → scan → correct → match or create → retry → delete on phone and desktop.

Tests: `receipts.create-transaction.realdb` (replay → 409 and one row; negative → 400); production-mode e2e with CSP enabled scanning a known synthetic receipt; matcher test.

Acceptance: given a receipt, when create-transaction is sent twice, then one ledger row. Given production headers, when a receipt is scanned, then OCR completes with no CSP violation in the console. Given a pending receipt and a later matching transaction, then it is matched within one scheduler tick.

## CP-18 Notifications, push, weekly recap (P0 when push is enabled) — 3–5 days

Closes: OPS-008 (P0), OPS-009/VAL-01, OPS-010, OPS-006/RC-07, OPS-007/SNA-REC-01 (recap side), SNA-REC-03, SNA-REC-04, OPS-005 (recap consumer), login-noise notifications. Depends on: CP-04, CP-09. Lane: BE.

Where: `notifications.controller.ts:329-335`, `notification/push.ts:64-99,202-204`; e-mail templates interpolating names; `weekly-recap.service.ts:87-172,273-309`, `weekly-recap.controller.ts:307-350`, `weekly-recap.email.service.ts`; notification delivery records.

Steps: push subscriptions schema-validated and the endpoint origin checked against an allow-list of known push services, with rejection of credentials, non-standard ports and private or loopback resolution, bounded timeouts, and push kept disabled until merged; every template escapes user strings through one helper; per-notification per-channel status (queued, sent, failed, skipped, and unknown when a send may have succeeded but the acknowledgment was lost; unknown is never auto-retried as failed); missing VAPID configuration yields a clear configuration state, not a 500, and alert counters count actual sends with durable dedupe and retry of failed channels only; quiet hours and preferences honoured; recap uses the viewer-aware recurring query, the household currency, a 7-day week, `includeGoals` and `includeRecurring`, the week's net worth, and propagates missing FX as a degraded state; recap e-mail requires per-user consent; login notifications rate-limited to new devices.

Tests: endpoint validation unit tests with DNS resolution stubs; `notifications.delivery.realdb`; recap privacy and currency tests; template escaping test.

Acceptance: given a subscription with endpoint `https://127.0.0.1/` or an unknown origin, then 400 and no row. Given a member, when the recap is generated, then no other member's private rule appears. Given a failed e-mail and a successful in-app delivery, then only the e-mail is retried, once. Given `<b>` in a display name, then it arrives escaped.

## CP-19 Thandi: Claude primary, Gemini fallback, local degraded mode (P1) — 4–7 days

Closes: OPS-012, F-AI-01/AI-01, CHG-AI-01, consent version enforcement, chat idempotency, evaluation suite, retired model id. Depends on: CP-04 (predicate in tools, role guard), CP-16 (secrets, logging, Redis). Lane: BE+FE. Contract: `docs/reviews/2026-10-11-deep-readiness/THANDI_PROVIDER_SPEC.md` as written, with the free-Claude adaptation in DECISIONS.md R1. The Fable assessment in `2026-10-13-independent-readiness-fable/THANDI_SPEC_ASSESSMENT.md` §3 lists the code facts.

Where: `server/modules/ai/ai.gemini.ts:27` (`gemini-2.0-flash`), `:28` (10 s timeout), `:688-700` (promise race), tool definitions in Gemini schema shape, system prompt; `ai.service.ts:204,217,272` (provider touch points), `:385-390` (`used_gemini`, `provider_attempted`, `provider_error`); `ai.fallback.ts:41-45`; `ai.controller.ts:30` (`CURRENT_CONSENT_VERSION`), `:98` (status = configuration); `ai.middleware.ts:60-110` (50 per household per day), `:231-260` (consent check without version); `ai.tracking.ts`; `ai.eval-pack.ts:52`; `ai.conversation.service.ts` (implemented); `client/src/features/ai/*`; `validateEnv.ts:98`; `.env.example`.

Steps:
1. Contracts: `ai.provider.types.ts` with canonical request, bounded history, tool definitions in JSON Schema (generate the Gemini declaration shape from them), tool-call proposals, response, usage (known or unknown), typed failure categories (connection, timeout, overload, throttle, auth, billing, protocol, safety).
2. Adapters: `ai.claude.ts` on the official SDK (`@anthropic-ai/sdk`), configured `ANTHROPIC_MODEL`, `max_tokens` from the remaining budget, tool definitions, text and tool-use blocks, usage per call, abort signal from the request deadline, SDK retries zero, no thinking or signature blocks persisted or forwarded; `ai.gemini.ts` reduced to the contract with `GEMINI_MODEL` configurable.
3. Orchestrator `ai.providers.ts`: stage-aware order per the spec table (Claude analysis → tools → Claude explanation; eligible Claude failure → Gemini for the remaining stages; both fail → local template over validated results or bounded keyword mode; nothing useful → unavailable); no parallel providers; once switched, stay switched for the request; one attempt per provider per stage; three paid calls maximum; 30 s overall deadline with a reserved fallback window; late responses ignored.
4. Admission ledger: `ai_requests` and `ai_attempts` tables keyed by logical request (actor, household, message fingerprint) with atomic admission of the single chat-quota unit, per-attempt claims before dispatch, reservation of conservative maximum usage per attempt against household and app ceilings (both legs at dated list prices; the owner's Claude credit balance is recorded as the Claude provider ceiling with its conditions and expiry, so credit consumption stays visible instead of being priced at zero), idempotent settlement to actual usage, unknown-usage holds retained across restarts, a separate reservation for the Gemini attempt while a Claude hold exists; a replay with the same fingerprint returns the stored outcome; no DB transaction held across a network call.
5. Consent: version bumped to name Anthropic and Google; `consentCheckMiddleware` blocks when `aiConsentVersion` is outdated; owner/admin re-consent flow and role-aware copy; revocation checked before each outbound attempt.
6. Provenance and status: audit row and message DTO carry ordered attempts (provider, model, stage, outcome, failure category, usage known or unknown), final answer mode and provider; `used_gemini` never true for a Claude answer; client labels "Answered using Claude", "Answered using Gemini — backup provider", "Limited local summary"; status endpoint distinguishes unconfigured, configured but unhealthy, degraded, quota-limited; circuit breaker per provider with cooldown and a controlled recovery attempt, state in Redis.
7. Evaluation: 20 to 30 prompts with expected tool calls and golden amounts from a fixed fixture, run in CI against recorded responses for both adapters; a staging smoke with real keys, synthetic messages and a recorded request budget proves Claude healthy, forced eligible Claude failure → Gemini, and both-fail local mode.

Tests: adapter tests on transport stubs for every failure category; orchestrator stage matrix; ledger concurrency tests (two instances competing for the last quota unit; same request on two instances; timeout retains the hold; Gemini needs its own reservation); consent version block; privacy test shared with CP-04 (another member's private account never reaches a tool result); provenance assertions; the evaluation pack in CI.

Acceptance: as the spec's acceptance table, plus: with no external key configured a consented request is served by the local degraded mode, labelled as such, with an `ai_query` row whose provider is local; with consent missing nothing is called and nothing is written; with Claude healthy the audit row shows provider claude and zero Gemini attempts; a forced 529 at analysis yields exactly one Gemini analysis and one Gemini answer with both attempts audited; a replayed request persists one exchange and charges one quota unit; an outdated consent version blocks before dispatch.

RT: the staging smoke recorded with model ids, revision and request count.

## CP-20 UX, phone layout, accessibility, dead controls (P1) — 5–8 days

Closes: UX-02/F-MOB-01, UX-01 (client half, with CP-02), F-GOAL-UX-01, F-TXN-04, AH-13/F-HH-02 (control removal), ENH-11, P3 UI list. Depends on: delivered domain flows. Lane: FE.

Steps: sidebar becomes a drawer below 768 px; content width 100% at 320, 360, 375, 390 and 768 px on Dashboard, Transactions, Add Transaction, Accounts, Budget, Reports, Settings; Reports without horizontal overflow at 1280 px; focus trap in the drawer and dialogs; native `confirm()` replaced by the app dialog; every icon button labelled; keyboard order and skip links on the eight primary pages; form errors associated and announced; wizard validation surfaced; transfer legs labelled; dead TopBar radios, disabled "Reset Defaults", toast-only "Copy balance history", "Good morning, User" fixed or removed; 200% zoom without loss; reduced motion honoured; chart table alternatives.

Tests: Playwright Mobile Chrome layout spec asserting `scrollWidth === innerWidth` and visible headings on the listed pages; axe-core run on the eight pages with no critical or serious issue; keyboard navigation spec for the Add Transaction dialog.

Acceptance: at 375 px the sidebar is collapsed by default and no heading is clipped; axe-core reports zero critical or serious issues; every primary action is reachable by keyboard; no inert control remains on a primary page.

## CP-21 Honest e2e, staging soak, drills, UAT, release closure (gate) — 8–12 days

Closes: QA-01, QA-02, F-OPS-07, OPS-011 (CI part), module assessment refresh. Depends on: all. Lane: QA+OPS.

Steps:
1. Rewrite every Playwright spec so each journey submits and asserts a persisted outcome through the API or database; remove `if (control)` guards that pass silently; seed deterministic populated fixtures so no populated state is skipped; add a mutation check in CI that skips each spec's submit and expects red.
2. Acceptance catalogue J01–J16 (ACCEPTANCE_CATALOGUE.md) executed on production-mode staging at the candidate SHA with the recorded oracles; both Fable verifier script sets and the Codex probe harness re-run.
3. Drills: backup restored to a fresh instance with the smoke run against it and timings recorded; rollback to the previous release rehearsed with the forward-only migration check; failed-migration recovery; DB and Redis outage with recovery; load test against DEC-20 targets.
4. 14-day soak with synthetic households; owner UAT across every module; independent reviewer sign-off on evidence quality.
5. Refresh the module assessment metadata, W9/W10 coverage, CLAUDE.md stale statements (conversation stubs, LOC scope, status docs) and release notes from completed evidence only; every register row closed with commit, test, environment and evidence link; residual limitations accepted by the owner with a date.

Acceptance: every J01–J16 journey recorded as passed at the candidate SHA; every row in REGISTER.md closed per the closure rule (all severities are required for completion unless the owner records a scope change against a specific row); restore under 4 hours with at most 24 hours of loss (or the ratified targets); rollback rehearsal recorded; soak without P0 or P1; UAT signed.
