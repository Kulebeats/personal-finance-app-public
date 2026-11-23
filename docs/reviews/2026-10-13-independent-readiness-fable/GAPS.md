# D. Prioritised gap register

Revision `381e943`. Severity is about damage if shipped. Scope note (14 October): the brief is now the complete application with no feature withheld, so every P0 and P1 row below is required for completion. The "Launch" column was written for the earlier pilot brief and is kept for traceability only: read **Must**, **Should** and **Could** as ordering hints, and read every **Hide** as **Must** (hiding is temporary containment while the packet is built, never completion). Section 1b lists the rows adopted from the 11 October package after the cross-read, with their verification state. Implementation: PRESENT / PARTIAL / MISSING. Verification: SRC, HTTP, DB, BROWSER, TEST. WP = work packet in COMPLETION_SPEC.md. Full reproduction steps, bodies and SQL for each ID are in `evidence/findings-draft.md` (lead) and `evidence/domain-*.md` (verifiers).

## 0. How to read the counts

Counts below are the verifiers' own severity counts from their summaries; the lead's rows are listed individually in sections 1 to 4 (and in `evidence/findings-draft.md`) rather than summed, because several were re-rated after the skeptic pass. ID prefixes: lead F-*; budgets BGR/GOAL/REC; import IMP/RCP/RUL/ORG; investments GRZ/INV; reports RC; security ISO/PRIV/SES/SEC/VAL; settings-notifications-ai SET/DATA/DEL plus SNA-SEC-* and SNA-REC-* (renamed here to avoid collisions with the security and budgets reports, which also use SEC-* and REC-*).

| Verifier | Rows exercised | P0 | P1 | P2 | P3 |
|---|---|---|---|---|---|
| budgets-goals-recurring | 3 modules | 0 | 4 | 5 | 5 |
| import-receipts-organization | 5 modules | 1 | 6 | 4 | 6 |
| investments-grz | 6 route groups | 2 | 13 | 5 | 4 |
| reports-consistency | 20 endpoints | 1 | 8 | 4 | 2 |
| security-privacy | 37 writes, 60+ reads | 2 clusters | 5 | 4 | 2 |
| settings-notifications-ai | 8 settings surfaces + 4 modules | 0 | 5 | 7 | 13 |

Skeptic pass (`evidence/skeptic-pass.md`): ISO-01, PRIV-01/02/03, RC-01 and IMP-01 were independently reproduced live; F-OPS-01 confirmed in source; GRZ-01/02 not re-run (evidence intact). A reconciliation over all 21 audit accounts and 89 transactions found zero balance drift.

No average is published: the P0 rows below individually block a launch regardless of how much else works.

## 1. P0 — release-stopping (security, privacy, money corruption, data loss)

| ID | Journey | Expected (source) | Observed | Impl. | Verif. | Launch | WP |
|---|---|---|---|---|---|---|---|
| ISO-01 | Goals activity | Every read scoped by `householdContext` (CLAUDE.md Rule 11) | Outsider household read `GET /api/goals/:id/activity` → 200 with note "PRIVSECRET", amount 777.77, user ids (`goals.controller.ts:359-369` never uses householdContext) | PARTIAL | HTTP | Must | WP-01 |
| PRIV-01..05 | Private account visibility | Private items invisible to other members on every path | Member sees owner's private-account transactions via `/goals/:id/transactions`, `/goals/:id/activity`, `/goals/summary` (after linking), `/tags/:id/transactions` (`TagRepository.ts:240-245` checks only `transactions.is_private`), `/recurring*` (rule name, amount, private accountId). Root cause: create API never sets `transactions.is_private`, so privacy rests on `accounts.is_private` and every path that does not join accounts leaks; member could also rename a private rule and unlink a private goal link (PRIV-04) | PARTIAL | HTTP+DB | Must | WP-01 |
| IMP-01 | CSV import overwrite | Re-import with "Overwrite & Import" replaces rows atomically | Existing rows soft-deleted, replacements skipped by the idempotency check; balance 1257.50 → 415.00, a 1000.00 salary vanished, response reported success | PARTIAL | HTTP+DB | Must (or Hide the overwrite option) | WP-05 |
| GRZ-01 | GRZ bond principal | Purchase is holdings-only (decision ASM-06); maturity must not fabricate income | Paying the principal row books the full face value (250000.00) as ledger income with no prior cash debit → cash, income and net worth inflated | PARTIAL | HTTP+DB | Must if GRZ enabled, else Hide | WP-09 |
| GRZ-02 | GRZ bond after sale | Sold bond has no further cash flows | Coupons and principal of a sold bond can still be paid, each posting income (14078.12, 250000.00); early pay and pay into another account also accepted (GRZ-04) | PARTIAL | HTTP+DB | Must if GRZ enabled, else Hide | WP-09 |
| RC-01 | Reports ratios/debt | Every aggregate converts with the dated household rate via `fxRateExpr` and fails closed when a rate is missing | `/api/reports/ratios` and the debt analysis perform NO currency conversion at all (corrected after the skeptic pass: rates were present and USD 75 was still added as 75 ZMW; liquidAssets 40202.92 instead of 42115.42 at the stored 26.50 rate) and ignore the private/hidden filters (`AnalyticsRatiosRepository.ts:46-81,185-216`) | PARTIAL | HTTP (reproduced twice) | Must | WP-07 |
| BGR-01 | Budget spend | Spend aggregated in the budget currency with the dated rate | USD 50.00 counted as K50.00 (no currency filter or conversion in `BudgetSpendRepository.ts`); same defect class as RC-01, rated P0 for consistency | PARTIAL | HTTP+DB | Must | WP-07 |
| F-OPS-01 | Background jobs | Recurring, rollover, snapshots, FX refresh run daily | No scheduler calls `/api/cron/*` in the declared deployment; only security report, cleanup and recap run in-process | MISSING | SRC | Must | WP-12 |

## 1b. Rows adopted from the 11 October package after the cross-read (14 October)

The 13 October assessment did not read the 11 October package. After the owner asked for a comparison, every row it contained that had no counterpart here was triaged. Rows marked HTTP+DB or SRC were verified by this package on 14 October (details in `evidence/findings-draft.md`, "14 Oct re-verification"); rows marked "not exercised" are adopted as work items on the strength of the 11 October source citations and must be reproduced inside their packet before being counted as closed. IDs keep the 11 October prefixes so both registers can be read together.

| ID (11 Oct) | Journey | Observed | Sev. | Verif. (this package) | WP |
|---|---|---|---|---|---|
| ORG-003 | Rule actions | Member created a rule whose categorize and add_tags values were a category and a tag belonging to household A4; the next matching transaction in A5 was stored with A4's category id and linked to A4's tag; A4's tag usage count rose | P0 | HTTP+DB (reproduced 14 Oct) | WP-06 |
| ORG-004 | Rule dry-run | `POST /rules/:id/dry-run` with an add_tags action wrote a `transaction_tags` row and bumped `usage_count`; with a split_transaction action it created two `transaction_splits` rows; the response reported no such change. The 13 Oct verifier had only exercised a set_category action, which is pure | P1 | HTTP+DB (reproduced 14 Oct) | WP-06 |
| AH-09 | Household preferences | A view_only member's `PUT /api/settings/preferences` wrote the household-level `household_preferences` row (seen by the admin). Supersedes the 13 Oct F-SEC-01 note that called this write per-user; F-SEC-01 returns to P1 | P1 | HTTP+DB (reproduced 14 Oct) | WP-01 |
| ORG-001 | Role guard | `requireRole` hierarchy lacks `professional`; `undefined < level` is false so the guard passes for that role (and for any unknown value) | P1 (P0 once a professional membership can be created) | SRC (confirmed 14 Oct, `validateEntity.ts:266-301`) | WP-01, WP-04 |
| FIN-03 | Account-level CSV overwrite | Deletes transactions of one account only; a transfer in the range loses one leg and only one balance is adjusted | P0 (IMP-01 cluster) | SRC (confirmed 14 Oct, `ImportService.ts:279-352`) | WP-05 |
| OPS-008 | Push subscribe | Any HTTPS endpoint is stored; with VAPID configured the server later connects to it (SSRF class). The 13 Oct settings verifier observed the accept-anything behaviour and did not rate it | P0 when push is enabled | HTTP (accept observed 13 Oct); egress not probed | WP-17 |
| FIN-05 | Ledger currency | Import and recurring persist `currency = NULL`; DTOs default to ZMW. Raised from the 13 Oct X-01 (P3) | P1 | DB (observed 13 Oct) | WP-07 |
| AH-04 | Unverified session | Registration session has full API access while `email_verified=false`. Raised from the 13 Oct F-AUTH-03 (P2) because with F-AUTH-04 no verification policy can be enforced at all | P1 | DB+SRC (13 Oct) | WP-02 |
| FIN-04 | Account-detail import | Valid row skipped (uuid type mismatch); response 200 "imported 0" | P1 | not exercised | WP-05 |
| FIN-08 | Split edit | Editing a split parent's amount leaves child totals stale | P1 | not exercised | WP-07 |
| FIN-09 | Goal links | Link edit/delete/unlink does not reverse progress consistently | P1 | not exercised | WP-07 |
| FIN-13 | Account edits | Currency, type and opening balance can change under existing ledger rows without reconciliation | P1 | not exercised | WP-07 |
| FIN-14 | Valuation | Holding valuation errors are caught and net worth returned without the holdings and without a completeness flag | P1 | not exercised | WP-07 |
| AH-06 | Invite concurrency | One-household check outside the acceptance transaction; two accepts can both pass | P1 | not exercised (recipient check reproduced as SEC-01) | WP-04 |
| AH-10 | MFA codes | One-time code consumption is not atomic | P1 | not exercised | WP-03 |
| AH-12 | Password policy | Password change bypasses the registration/reset policy | P2 | not exercised | WP-16 |
| OPS-004 | Receipt OCR | OCR worker assets conflict with the production CSP | P1 | not exercised (CSP only active in production mode) | WP-18 |
| OPS-010 | Notifications | Delivery status and dedupe do not reflect per-channel outcomes | P1 | not exercised | WP-17 |
| OPS-013 | Scheduler locks | Locks expire without renewal and carry no scheduled-date identity; coordination keys share the `allkeys-lru` namespace | P1 | SRC (inventory noted the namespace) | WP-12 |
| ORG-005 | Rule splits | Split allocations can exceed the parent amount | P1 | not exercised | WP-06 |
| ORG-007, ORG-008 | Merchants | Delete options disagree with server behaviour; undo adjusts counts from the snapshot rather than restored rows | P2 | not exercised | WP-06 |
| DEP-02 | Runtime | Node 20 pinned in `engines`, CI and Render; end-of-life | P1 | SRC (pin confirmed 13 Oct) | WP-13 |
| QA-01 | e2e suite | Several Playwright specs fill forms without submitting or assert nothing; one skips its populated state | P1 | not exercised (smoke blocked locally) | WP-15 |
| OPS-011 | Local e2e | Browser suites can run against the dev database and bypass production protections | P1 (was F-TEST-01 P2) | SRC (13 Oct) | WP-15 |

## 2. P1 — required behaviour incomplete or unreliable

### 2a. Onboarding, authentication, household (functionality)

| ID | Journey | Observed | Impl. | Verif. | Launch | WP |
|---|---|---|---|---|---|---|
| F-AUTH-01 | Verify e-mail | Link `/auth/verify-email` → client 404; login refuses unverified users | PARTIAL | BROWSER+DB | Must | WP-02 |
| F-AUTH-04 | Verify from a fresh browser | CSRF token bound to a non-persisted anonymous session id → `POST /api/auth/verify-email` and `/settings/security/email/verify` always 403 outside the registering session (confirmed by settings verifier SEC-01) | PARTIAL | HTTP | Must | WP-02 |
| F-AUTH-02 | `/api/auth/me`, login, register | Raw user row minus password hash: `mfaCode`, `mfaBackupCodes`, verification token hash, `nrc`, `salaryRangeEncrypted`, lockout counters | PARTIAL | HTTP | Must | WP-03 |
| F-HH-01 / SEC-02 | Add member / invite | UI posts to non-existent `POST /api/household/members` (404 HTML, JSON-parse toast); invite e-mail links to `/invite/:code`, a route that does not exist, and no client code calls accept → a real household cannot gain a member | MISSING (UI path) | BROWSER+HTTP | Must | WP-04 |
| SEC-01 | Invite acceptance | Recipient e-mail not checked; member accepted an invite addressed to nobody@ and joined as admin | PARTIAL | HTTP+DB | Must | WP-04 |
| SEC-06 / SEC-07 | Transfer ownership, co-owner | Transfer to own id → 200, household left with no owner, unrecoverable via API; a second owner can be created and can demote the original owner (SEC-07, raised from P2 to sit with SEC-06) | PARTIAL | HTTP+DB | Must | WP-04 |
| SES-01 | Revoke session(s) | Deletes `user_sessions` rows only; express `session` row survives and the revoked cookie still gets 200 on `/me`; correct helper `session-revocation.ts` used only by password change | PARTIAL | HTTP+DB | Must | WP-03 |
| F-SEC-05 | MFA | No enrolment/disable UI although server supports it | PARTIAL | BROWSER+SRC | Should (pilot) / Must (public) | WP-16 |
| F-HH-03 | Members list | Every member shows "Unknown User" (client reads `member.user.fullName`, API returns flat `name`) | PARTIAL | BROWSER+HTTP | Should | WP-04 |

### 2b. Core ledger and money (functionality and correctness)

| ID | Journey | Observed | Impl. | Verif. | Launch | WP |
|---|---|---|---|---|---|---|
| F-TXN-02 | Add transaction | Category picker lists only Uncategorized (form filters on a `groupType` the API never returns) | PARTIAL | BROWSER+SRC | Must | WP-06 |
| F-TXN-01 / RC-06 / RC-08 | Month totals | 5-minute summary cache never invalidated on write; summary uses latest FX rate not the dated rate (1308.16 vs 1273.75); client builds "this month" in UTC (Lusaka sends 09-30..10-30) | PARTIAL | BROWSER+HTTP | Must | WP-07 |
| F-ACC-01 | First account | Accounts page defaults to `ownerUserId=shared` and shows "No accounts yet" after the user's first account | PARTIAL | BROWSER | Must | WP-06 |
| F-REC-01 / REC-01 | Create recurring (UI) | UI omits `frequency`/`nextDueDate` → 400 with no message; rules cannot be created from the product | MISSING (UI path) | BROWSER | Must | WP-08 |
| BGR-02 | Budget rollover | Rollover gated on `household_preferences.auto_rollover_budget`, which nothing can set (preferences PUT drops it); cron created nothing | MISSING (reachable path) | HTTP+DB | Should (or Hide rollover toggle) | WP-08 |
| BGR-03 | Budget recalculate | Saves 3-month sums as monthly budgets (550.00 where average is 183.33), overwrites manual budgets, creates 79 zero budgets | PARTIAL | HTTP+DB | Must (or Hide the button) | WP-08 |
| RC-03 / RC-04 | Credit card accounting | Card purchase reduces the amount owed (net worth 41668.69 vs correct 41577.69; the skeptic's reconciliation confirms liabilities are stored with the asset sign); card spending moved to a "debt" bucket and excluded from expenses | PARTIAL | HTTP+DB | Must if liability accounts are offered in the pilot, otherwise Should | WP-07 |
| RC-05 | Split transactions | Missing from budget comparison, transactions report, Sankey and both CSV exports (October budget actual 1073.75 vs 1273.75) | PARTIAL | HTTP | Must | WP-07 |
| RC-02 / INV-06 | FX rates and securities are global | Any member of any household can write `fx_rates`/`securities`; a rate posted by one household changed another's net worth | PARTIAL | HTTP+DB | Must | WP-07 |
| RC-07 | Weekly recap | Missing FX → 200 with zero spending/net worth (errors swallowed); feeds the e-mail | PARTIAL | HTTP | Should (or Hide recap) | WP-07 |
| IMP-02 / IMP-03 | Import dedupe and dates | Dedupe key is date+type+amount (two 25.00 cafés on one day merge); `2026-02-30` saved as 2026-03-02; slash dates parsed inconsistently | PARTIAL | HTTP+DB | Must | WP-05 |
| RCP-01 / RCP-02 | Receipts | `create-transaction` can be repeated (double charge 88.40) and accepts a negative amount that raises the balance | PARTIAL | HTTP+DB | Should (or Hide receipts) | WP-05 |
| ORG-01 | Tag merge | `POST /api/tags/merge` → 500 (uuid vs text in SQL) | PARTIAL | HTTP | Should | WP-06 |
| ORG-02 / F-CLIENT-01 | Merchant detail | Six client-called endpoints (analytics, transactions, aliases add/delete, logo upload/delete) return 404; `POST /rules/:id/test` 404 | MISSING | HTTP+SRC | Should | WP-06 |
| F-SEC-01 | view_only role | Re-rated to P2 after the skeptic pass, then back to P1 on 14 Oct: the preferences write that view_only could perform is the household-level `household_preferences` row, not a per-user row (AH-09 in §1b, reproduced with DB read-back). Report exports and `POST /api/weekly-recap/generate` also lack a role gate. Make every guard declarative with `requireRole` and gate household policy owner/admin | PARTIAL | HTTP+DB | Must | WP-01 |
| F-DEP-01 | Dependencies | 9 advisories incl. critical `proxy-addr`; CI audit step would fail | PARTIAL | RUNTIME | Must | WP-13 |

### 2c. Investments and GRZ (only if the feature is enabled)

| ID | Observed | Launch | WP |
|---|---|---|---|
| GRZ-03 | Selling a bond computes no gain/loss, credits no cash, absent from tax reports | Hide or Must | WP-09 |
| GRZ-05 | Bond create accepts couponRate "14" (coupons of 70000 on 10000 face), negative face, maturity before purchase | Hide or Must | WP-09 |
| GRZ-06 | `Money.isPositive()` true for zero → T-bill bought at/above face makes every maturity cron run fail; cron response echoes SQL with ids | Hide or Must | WP-09 |
| INV-01/02/03 | Buys never update `holdings.cost_basis`; negative-quantity sell adds phantom shares; holdings via POST and SIP buys have no tax lot so selling returns 409 | Hide or Must | WP-09 |
| INV-04 | `amount_zmw` never computed from posted FX (180 USD gain reported as 180.00 ZMW) | Hide or Must | WP-09 |
| INV-07/08 | Tax summary shows 0.00 interest income and ZRA export empty despite WHT taken; 31 Dec dividend counted in two tax years (UTC year start) | Hide or Must | WP-09 |
| INV-10 / pension | Pension contributions unvalidated, unaudited, no transaction; SIP with past next-date never runs | Hide or Must | WP-09 |
| F-INV-01 | GRZ/tax/pension tabs unreachable without an equity holding | Hide or Must | WP-09 |
| WHT rate | Flat 15% applied to every GRZ coupon and T-bill discount — needs confirmation against the current ZRA rule by a qualified person (DEC-08) | Decision | — |

### 2d. Settings, data rights, operations

| ID | Observed | Impl. | Verif. | Launch | WP |
|---|---|---|---|---|---|
| SET-01 | `PUT /api/settings/profile` drops 14 of ~22 form fields and returns "Profile updated" | PARTIAL | HTTP+DB | Should (misleading, not unsafe) | WP-10 |
| SET-02 | Preferences section saves to household preferences; no route writes `user_preferences`; every save returns 200 | MISSING | HTTP+DB | Should | WP-10 |
| DATA-01 / F-SEC-02 | Personal data export is a stub (fake id, no row, no file, no audit, no UI) | MISSING | HTTP+DB | Must for DPA, Should for pilot | WP-11 |
| DEL-01 / DEL-02 | Account deletion leaves an express session row for the deleted user (cookie would be accepted via the tombstone) and keeps e-mail/IP in `security_audit_logs` and the password hash on the tombstone; also deletes the household's audit history | PARTIAL | DB+SRC | DEL-01 Must (fixed in WP-03); DEL-02 Should for the pilot (deletion has no UI and is handled manually), Must for public launch | WP-03 / WP-11 |
| F-MOB-01 | Phone viewport: sidebar covers and clips content | PARTIAL | BROWSER | Must | WP-14 |
| F-SEC-04c / F-SEC-04b | Self-inflicted 429 within three page loads (double-counted general limiter); 5/min per-IP auth limiter blocks ordinary flows | PARTIAL | BROWSER+HTTP | Must | WP-13 |
| F-OPS-02 | Uploads on ephemeral local disk; 30 user files tracked in git | MISSING | SRC | Must (or Hide uploads) | WP-12 |
| F-OPS-06 | DB TLS certificate verification off by default | PARTIAL | SRC | Must (staging gate) | WP-12 |
| F-OPS-07 | No backup/restore drill, no rollback rehearsal | MISSING | SRC | Must (go/no-go) | WP-15 |
| F-AI-01 / AI-01 | Provider failure or no provider → 200 with an empty or irrelevant answer, quota consumed, no error shown | PARTIAL | BROWSER+DB | Hide (pilot) | WP-16 |
| RC-13 / server-surface F4 | Account CSV exports and several money writes (pension, SIP, market refresh, budget settings, attachments, cron ledger writes) write no audit row | PARTIAL | HTTP+DB | Should | WP-11 |

## 3. P2 — worthwhile, non-blocking (fix in the stabilisation weeks or after launch)

F-AUTH-03 register signs in unverified; F-ACC-02 double audit rows on account create; F-TXN-03 owner selector ignored (creator always owner); F-DATE-01/01b/01c and verifier notes (naive timestamps serialised as UTC: UI shows +2h, future-tense notifications, invites "accepted before created", tax-year boundary in UTC); F-UX-02 `staleTime: Infinity` (other members' writes invisible until reload); F-ONB-01 no categories seeded on household creation; F-HH-02 fake "Household Premium" panel; F-REP-01 "InvalidDate" axis; F-CF-01 averages over future months; BGR-04 recalc/clear audit rows fail silently (`entityId "bulk:<uuid>"` into uuid column); GOAL-01 contribution of 1,000,000 accepted and irreversible; REC-02 monthly rule drifts after a short month (day capped at 28); REC-03 one missed occurrence per run; REC-04 member can post future-dated occurrences via `asOfDate`; IMP slash-date inconsistency and dropped Notes mapping; rules accept non-existent action values and apply silently; RC-09/10/11/12/14 (8-day recap week, missing-rate 500s, penny footing, merchant total excludes unassigned, snapshot-only net-worth history); SET-05 currency change with ledger → 500s and zeroed recap; SNA-REC-01 recap settings cross-writes (recap day overwrites first-day-of-week; widget save resets recap toggles); SNA-REC-03 recap e-mail labels ZMW as "$"; SNA-REC-04 recap history shows current net worth for every week; SNA-SEC-02 (settings report) e-mail/password change send no notice and write no security event; VAL-01 unescaped names in invite HTML; `/recurring/detect` 500; malformed UUIDs → 500; F-OPS-03/04/05 (shallow health, logger drops context, dormant outbox/job workers); F-DATA-01 (long FK names, no tag uniqueness, admin route on a missing table); F-TEST-01 (unguarded root vitest config, Playwright against dev DB locally, stale tracked coverage); GRZ 360 vs 365-day bases, unrounded-vs-stored rate, tenor/maturity disagreement, fees dropped, portfolio values as floats, coupon rows unnamed/uncategorised.

## 4. P3 — polish

F-UX-01 login-page error toasts; F-TXN-04 transfer legs indistinguishable; F-GOAL-UX-01 silent wizard validation; login-noise notifications; dead TopBar radios, disabled "Reset Defaults", `/investments/tax` broken link, toast-only "Copy balance history"; native `confirm()` dialogs; tag names case/whitespace duplicates; stale usage counts; `data_imports` never written; receipt details expose server paths; `includeArchived=false` ignored; goal summary and portfolio amounts as plain numbers; "Good morning, User" greeting.

## 5. What verifiably works (so the register is not read as "nothing works")

- Ledger core: account balances, income/expense posting, paired transfers, step-up on money moves, idempotent creates, FOR UPDATE under 3-way concurrent goal transfers (exactly 2 of 3 succeed), 5 concurrent contributions summing exactly, no duplicate budget periods under concurrent recalculates, recurring materialisation exactly once per period with no duplicates on overlapping runs.
- Money math: Money class, budget spent/remaining to the ngwee for single-currency spend including month boundaries and splits, GRZ coupon/WHT schedule, T-bill maturity interest, FIFO tax lots, all four GRZ calculators, report FX conversion with the dated rate when a rate exists, category breakdown and expense classification exact.
- Security that held: private items 404 on direct reads, 33 of 37 probed view_only writes denied (the 4 that succeeded were report exports, recap generate and per-user preferences, none on shared financial data), outsider 404/403 on every id-based endpoint except ISO-01, `/uploads` auth and traversal guard, CSRF on mutations, admin endpoints 403, lockout after 5 failures for 15 minutes, password reset revokes all sessions, step-up gates, upload extension derived from mimetype.
- Platform: `npm run check`, 2660 server tests, 1384 client tests and the build are green; versioned migrations apply from empty and match push-built schema exactly; receipts upload idempotency and image-hash dedupe; report exports audited; AI consent gate and honest `ai_query` audit rows; weekly recap respects the e-mail toggle and consent. Read in source only, not exercised at runtime: every limiter uses the Redis store when `REDIS_URL` is set; all 12 AI tools route through the sanitiser.

## 6. Residual risks the package could not test (from the skeptic pass)

1. The audit host and database run in Africa/Lusaka while Render runs in UTC, so the +2h date findings (F-DATE-01 family, RC-08, tax-year boundary) will present differently in production; re-check on staging rather than assume them fixed or absent.
2. Hiding Investments (WP-09h) also hides the only UI that writes FX rates; WP-07 must provide an owner-facing or scheduled FX entry or multi-currency households lose conversion.
3. Transaction edit and delete paths were not reconciled against balances by any verifier (creates, transfers and imports were); WP-07's property suite must include them.
4. The double-counted limiter may persist once Redis is configured because both mounts share the store; verify after WP-13 with Redis on.
5. `POST /api/household/invite` returns the raw invite code to the caller, which weakens the recipient check if the response is exposed; WP-04 returns only an invitation id.
