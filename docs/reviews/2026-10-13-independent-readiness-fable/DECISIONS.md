# H. Decision log, blocked checks, next verification steps

## 1. Assumptions this assessment depends on (owner has not confirmed)

| ID | Assumption | Where it matters | If the owner decides otherwise |
|---|---|---|---|
| ASM-01 | Superseded 14 Oct: there is no fixed launch date; the brief is the complete application (the 11 November target in the original prompt was withdrawn by the owner, as the 11 October package also records) | LAUNCH_PLAN.md is gate-driven with projections only | If a date is reinstated, the gates stay and scope cannot be cut to meet it without a recorded decision |
| ASM-02 | Superseded 14 Oct: the audience is every user of the full product, not an invited pilot; no feature is withheld | Every P0 and P1 in GAPS.md incl. §1b is required; "Hide" dispositions are void; operations items (alerting, log shipping, privacy notice, terms) are in scope | A pilot can still precede public release as a rollout step (LAUNCH_PLAN.md phase 7), but it does not reduce scope |
| ASM-03 | One primary developer, with the owner available for product decisions within 48 hours | Effort ranges and the critical path | A second developer shortens the plan mainly in the parallelisable client fixes; it does not shorten the staging/soak period |
| ASM-04 | Hosting is Render as declared in render.yaml (web service + Postgres + Key Value), single instance | OPS findings and the staging checkpoint | A different host re-opens TLS, disk, cron and health-check decisions |
| ASM-05 | Zambian households, ZMW primary, occasional USD | FX and GRZ findings | Multi-currency breadth beyond USD would need the FX source widened |
| ASM-06 | The product decision that GRZ purchases do not mutate account cash (holdings-only) stands | Investments verifier treats it as intended behaviour, not a defect | If reversed, GRZ purchase becomes a ledger-posting feature with transfer semantics and audit requirements |

## 2. Decisions the owner must make, with the deadline implied by the plan

| ID | Decision | Options | Needed by |
|---|---|---|---|
| DEC-01 | Confirm the brief: full application, nothing withheld, no fixed date (ASM-01/02 as revised 14 Oct); name the engineering, operations, QA and product owners | start of Week 1 (15 Oct) |
| DEC-02 | Email verification policy | (a) block app use until verified (today's login behaviour), (b) allow use but nag; "no verification" is not an option for the full product | Week 1, because it decides how F-AUTH-01/03/04 and AH-04 are fixed |
| DEC-03 | Household membership | the invitation flow is restored end to end (email + accept page + recipient binding); decide whether a user may belong to more than one household (today's rule is one) | Week 1 |
| DEC-04 | Order of delivery only (no feature is withheld) | confirm the phase order in LAUNCH_PLAN.md §3 or re-order packets; any temporary containment of a broken surface is recorded here with its removal date | Week 1 |
| DEC-05 | Scheduler for background jobs on Render | Render cron service(s) calling `/api/cron/*` with `CRON_SECRET`; or in-process node-cron for all jobs on the single instance | Week 1 (deployment dependency) |
| DEC-06 | Upload storage | Render persistent disk (single instance) or object storage (S3-compatible) | Week 1 |
| DEC-07 | Dependency remediation | run `npm audit fix` for the 8 fixable advisories now; decide on `csv-parse` major | Week 1 |
| DEC-08 | GRZ withholding-tax rate and T-bill conventions | confirm against the current Zambia Revenue Authority rule with a qualified person; software can only implement what the owner specifies | before enabling GRZ for the pilot |
| DEC-09 | Playwright browser install on the development machine | approve `npx playwright install chromium` so the e2e smoke can run locally | Week 1 |
| DEC-10 | Privacy notice and terms | full DPA-compliant notice, retention periods for nrc/income fields, export and deletion wording | before WP-11 and before any real user |
| DEC-11 | Thandi provider policy (see THANDI_SPEC_ASSESSMENT.md §6) | recommended: Claude as the single external provider plus the local degraded mode (Phase A), Gemini failover and the spend ledger deferred to Phase B on staging evidence; alternative: the 11 October spec as written. Also record DEC-11b the free allowance's limits and expiry, DEC-11c the model id, DEC-11d Anthropic retention terms for the consent text, DEC-11e what happens when the free allowance ends | before WP-19 |
| DEC-12 | Professional role | approve a permission matrix for `professional` (read-only across the household, advisory writes, or equal to member) or remove the role from the UI and schema enum | before WP-01 and WP-04 |
| DEC-13 | MFA policy | mandatory-MFA scope, re-authentication rule for existing sessions when policy changes, high-value step-up threshold in household currency | before WP-16 |
| DEC-08b | GRZ principal convention | under holdings-only purchases, principal at maturity posts nothing (or a memo) vs purchases debit cash and principal posts a transfer | before WP-09 |
| DEC-08c | Automated T-bill rollover yield | refuse the run when no live yield exists, or record an estimate explicitly marked pending confirmation | before WP-09 |

## 3. Decisions taken by the assessor (reversible, recorded)

| ID | Decision | Rationale |
|---|---|---|
| ADM-01 | Did not read the 2026-10-11 package or older assessments | Owner asked for an independent assessment to compare against |
| ADM-02 | Verified fixture users directly in the audit database instead of through the API | The API path is blocked for fresh sessions by F-AUTH-04; the real path was still exercised once in the browser (R2) |
| ADM-03 | Ran the audit server in development mode (limiters and CSRF active) rather than test mode | Test mode disables CSRF, limiters and email, which would have hidden F-AUTH-04, F-SEC-04 and the email findings |
| ADM-04 | Pointed SMTP at a local sink and emptied the Gemini key | No real email or paid provider calls were allowed; one accidental Gemini call happened before the key fix (it failed at the provider) |
| ADM-05 | Did not download a Playwright browser build | Downloads need owner approval; recorded as blocked |
| ADM-06 | Added an `audit` entry to the untracked `.claude/launch.json` | Needed to run the app against the audit DB; the file was already untracked local config |
| ADM-07 | Delegated six domains to Opus 5.5 verifiers after the owner asked for that model; relaunched them after an account spend limit cut the first run | Owner instruction; the relaunch is recorded in PROGRESS.md |

## 4. Blocked checks and exactly how to unblock them

| Check | Blocked by | Procedure |
|---|---|---|
| Playwright smoke (9 specs) locally | browser build mismatch | `npx playwright install chromium`; then `DATABASE_URL=<audit e2e db> SMTP_HOST=127.0.0.1 SMTP_PORT=2525 npm run test:e2e:smoke`; expect 71 tests; record pass/fail per spec |
| Staging verification (W9-style) | no Render deployment | provision from render.yaml; set SMTP_*, CRON_SECRET, VAPID_*, DATABASE_SSL_REJECT_UNAUTHORIZED=true with CA; run `npm run smoke:staging:health --json`; register, verify by real email, log in, create account + transaction, read back via `/api/accounts/summary` |
| Backup restore drill | no deployment | take a Render Postgres backup, restore to a new instance, point a staging app at it, run the smoke; record elapsed time and data loss window |
| Job scheduling in production | DEC-05 | after deployment, trigger each `/api/cron/*` endpoint once with the secret, read `recurring_transaction_history`, `budget_periods`, `net_worth_snapshots`, `fx_rates` rows; then observe one scheduled run |
| Real email deliverability | staging SMTP | send verification and reset emails to a real mailbox; confirm links open the correct client routes after F-AUTH-01 is fixed |
| External AI call | quota-bearing key | on staging, after WP-19: one `POST /api/ai/chat` with Claude healthy (audit row provider = claude, model id recorded, non-empty reply); one with a forced eligible Claude failure (labelled local degraded answer, failed attempt audited); one with no provider configured (unavailable state, no `ai_query` row) |
| Linear status | connector authorisation | authorise the connector or export the issues; reconcile against GAPS.md IDs |
| Mobile on real devices | pilot | after F-MOB-01 fix, test dashboard, transactions, add-transaction, settings on at least one Android and one iOS phone |

## 5. Exact next verification steps after remediation (acceptance checks per blocker)

P0 acceptance checks (one per GAPS.md §1 row):
- ISO-01: outsider jar `GET /api/goals/<owner goal>/activity` → 404; test iterates every goal sub-route.
- PRIV-01..05: member jar sees no row referencing the owner's private account via `/goals/:id/transactions`, `/goals/:id/activity`, `/goals/summary`, `/tags/:id/transactions`, `/recurring`, `/recurring/:id`, `/recurring/:id/transactions`, `/recurring/:id/history`; `SELECT count(*) FROM transactions WHERE account_id IN (private accounts) AND NOT is_private` = 0 after backfill.
- IMP-01: import file F then overwrite with F → row count unchanged, balance unchanged, zero soft-deleted rows without a replacement; response counts reconcile.
- GRZ-01: principal payment posts no income under the holdings-only decision (or the owner's chosen alternative); net worth before and after maturity differs only by the coupon.
- GRZ-02: `POST /api/grz/payments/:id/pay` on a sold or matured bond → 409; early or wrong-account pay → 400/409.
- RC-01 and BGR-01: `/api/reports/ratios` with a USD 75 balance and a 26.50 rate includes 1987.50; a ZMW budget with a USD 50.00 expense shows the converted spend; with no rate both return 422.
- F-OPS-01: on staging, two consecutive days of `recurring_transaction_history`, `net_worth_snapshots` and `fx_rates` rows produced by the scheduler.

Launch-blocking P1 acceptance checks:

1. F-AUTH-01/04: fresh browser profile → register → open the emailed link → expect "Email verified" without any prior session; then log out and log in.
2. F-HH-01: owner invites by email → invitee opens the link in a fresh browser → accepts → appears in `GET /api/household/members` with a readable name (also closes F-HH-03).
3. F-TXN-01: create a transaction dated today → `GET /api/transactions/summary?startDate=<month start>&endDate=<today>` counts it; dashboard "This month" agrees with Reports and Cash Flow.
4. F-TXN-02: Add Transaction → category picker lists the seeded categories grouped by type; saved transaction has `category_id` set.
5. F-REC-01: create a monthly rule from the UI → 201; `recurring_transactions.frequency='monthly'`, `next_due_date` set; `POST /api/cron/recurring` materialises exactly one transaction.
6. F-ACC-01: new user's first account appears on the Accounts page without changing a filter.
7. F-MOB-01: at 375px the sidebar is collapsed by default and the content fills the width; no clipped headings.
8. F-SEC-04c: a login plus five page loads never returns 429; `ratelimit-remaining` stays above 50 after a dashboard load.
9. F-OPS-01: on staging, each cron endpoint is called on schedule (logs or `recurring_transaction_history` rows on two consecutive days).
10. F-DEP-01: `npm audit --omit=dev` exits 0 in CI.
11. F-AUTH-02: `GET /api/auth/me` returns a DTO with no `mfa*`, `emailVerification*`, `failedLoginAttempts`, `lockedUntil`, `nrc`, `salaryRangeEncrypted` fields (test asserts the key list).
12. F-DATE-01: `createdAt` from the API equals the database instant; UI shows today's date for a row created today in Africa/Lusaka.
