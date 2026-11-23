# E. Implementation-ready completion specification (full application)

Revised 14 October 2026 for the owner's current brief: the complete existing application, every advertised feature working, no feature withheld. The 13 October version of this file priced a pilot with Investments, AI, receipts, push and recap withheld; that scope is gone. Hiding a surface is allowed only as temporary containment while its packet is built and never counts as completion.

Twenty-one work packets cover every P0 and P1 in GAPS.md, including the rows adopted from the 11 October package after the cross-read (GAPS.md §1b). Effort is for one developer in working days, low–high. Role: BE (server), FE (client), OPS (deployment), OWN (owner decision). Every packet reuses the existing architecture: modular routes/controllers/services (CLAUDE.md Rule 15), `Money`, `withTransaction` plus `FOR UPDATE`, `BusinessAuditService`, Zod validation, real-DB HTTP tests under `server/**/__tests__/*.realdb.integration.test.ts` and Playwright specs under `e2e/`. Rollback for every packet is a code revert unless a migration is listed.

Conventions: "G/W/T" = Given / When / Then acceptance criteria; "RT" = required runtime evidence (HTTP plus DB read-back) in addition to automated tests.

| Packet | Scope | Days | Depends on |
|---|---|---|---|
| WP-01 | Household isolation, private-data visibility, role guard | 3.5–6 | none |
| WP-02 | E-mail verification from any browser | 1–2 | DEC-02 |
| WP-03 | Safe DTOs, real session revocation, atomic MFA codes | 1.5–2.5 | none |
| WP-04 | Household membership end to end incl. Professional role | 4–6 | WP-02, DEC-03, DEC-12 |
| WP-05 | Import (both paths) and receipts integrity | 4.5–6 | none |
| WP-06 | Transaction entry, rules engine and organisation wiring | 4–7 | none |
| WP-07 | One definition of money across read models | 9–13 | none |
| WP-08 | Recurring and budgets on the reachable path | 3–4 | WP-12 for scheduling |
| WP-09 | Investments and GRZ ledger wiring | 6–8 | DEC-08 |
| WP-10 | Settings that persist what they show | 2–3 | WP-01 |
| WP-11 | Data rights: export, deletion, audit completeness | 3–4 | WP-03 |
| WP-12 | Deployment that runs the product | 4–6 | DEC-05, DEC-06 |
| WP-13 | Rate limits, dependencies, runtime | 2–3 | none |
| WP-14 | Phone layout | 2–3 | none |
| WP-15 | Staging soak, drills, honest e2e, release checklist | 5–6 | WP-12 |
| WP-16 | MFA enrolment UI and credential policy | 2–3 | WP-03 |
| WP-17 | Notifications, push and weekly recap | 3–5 | WP-01, WP-07 |
| WP-18 | Receipts and OCR in production | 2–4 | WP-12 |
| WP-19 | Thandi AI with a real provider layer (Phase A: Claude plus local degraded mode) | 3–5 | WP-01, DEC-11 |
| WP-20 | Accessibility and device completion | 2–4 | WP-14 |
| WP-21 | Integrated acceptance and UAT | 3–5 | all |
| Total | | 69.5–105.5 | |
| Optional Phase B | Gemini failover, spend ledger, cross-instance circuit breaker | 2–4 | DEC-11 enabling a paid provider |

---

## WP-01 Household isolation, private-data visibility, role guard (P0)
Findings: ISO-01, PRIV-01..05, ORG-001 (adopted, source-confirmed 14 Oct), AH-09 (adopted, reproduced 14 Oct), F-SEC-01. Depends on: nothing. Order: first.

Problem/outcome: a member of another household can read goal activity; another member of the same household can see transactions on a private account through goals, tags and recurring; the create API never sets `transactions.is_private`; a `professional` membership passes every `requireRole` gate because the role is absent from the hierarchy; a view-only member can rewrite household-level preferences. Outcome: one visibility policy and one role policy enforced on every read and write path.

In scope: `goals.controller.ts` activity/transactions/summary; `TagRepository.findTransactionsByTag`; recurring list/detail/transactions/history; rule name/amount exposure; `transactions.is_private` set on create from the account's privacy and from an explicit `isPrivate` flag; `requireRole` gains `professional` with an explicit level from DEC-12 and fails closed on any unknown role; declarative `requireRole("member")` on `POST /api/reports/exports`, `POST /api/reports/custom`, weekly-recap `generate`/`feedback`; `PUT /api/settings/preferences` gated owner/admin as household policy (WP-10 adds the per-user route). Out of scope: UI for marking a single transaction private (P2).

Data: no schema change. Backfill migration: `UPDATE transactions t SET is_private = true FROM accounts a WHERE a.id = t.account_id AND a.is_private AND NOT t.is_private` (idempotent, versioned).

API/authorisation: every goal, tag, recurring read goes through `findByIdWithVisibility(id, householdId, userId)`; 404 (not 403) for invisible items (Rule 11); goal activity filters by `householdContext.householdId` and by the viewer's visibility of the linked transaction.

Invariants: a transaction is visible to user U iff it belongs to U's household and (not private or owner is U). Unknown role → 403 on every mutation.

G/W/T:
- Given household A owner O with private account P and a transaction T on P linked to shared goal G, when member M (same household) calls `/api/goals/G/transactions`, `/goals/G/activity`, `/goals/summary`, `/tags/:id/transactions` (T tagged), `/recurring` (rule on P), then T, its amount, name and P's id never appear and per-item routes return 404.
- Given outsider X, when X calls `/api/goals/G/activity`, then 404.
- Given a membership row with role `professional` (or any value outside the enum), when it calls any `requireRole("member")` route, then the approved matrix applies and unknown values return 403.
- Given view_only member V, when V calls `PUT /api/settings/preferences`, `POST /api/reports/exports`, `POST /api/reports/custom`, `POST /api/weekly-recap/generate`, then 403 and the `household_preferences` row is unchanged.
- Given any new transaction on a private account, then `transactions.is_private = true` in the row.

Tests: extend the `rules.privacy.realdb.integration.test.ts` pattern into `goals.privacy.realdb`, `tags.privacy.realdb`, `recurring.privacy.realdb`; a role matrix test iterating every role value including `professional` and a bogus string over every mutating route; a backfill migration test. RT: re-run the security verifier's scripts in `.local/readiness-fable-2026-10-13/scratch-security-privacy/` plus the 14 Oct AH-09 probe.

Effort: 3.5–6 days (medium uncertainty: recurring surfaces are wide; the role matrix touches several helpers). Role: BE.

## WP-02 E-mail verification that works from any browser (P1, onboarding P0)
Findings: F-AUTH-01, F-AUTH-04, F-AUTH-03 (raised to P1 with AH-04). Depends on: DEC-02. Order: Week 1.

Problem/outcome: emailed link path mismatch and anonymous CSRF make verification impossible outside the registering session; login then locks the user out; meanwhile the registering session itself has full API access while unverified. Outcome: a new user verifies from any device and the policy is consistent between register and login.

In scope: link path → `${APP_URL}/verify-email?token=` (auth.email.service.ts:86,119); add `/api/auth/verify-email` and `/api/settings/security/email/verify` to the CSRF skip list (single-use token-authenticated, like reset-password) or persist an anonymous session before issuing the CSRF token; implement DEC-02: either block unverified users consistently (no session at register; "check your inbox" state with resend and logout) or allow use with a persistent banner and resend control. Out of scope: SMS/OTP.

G/W/T: fresh browser profile → register → open the emailed link → "Email verified" → log in succeeds. Register in browser A, open link in browser B → verified. Resend works at most once per minute and never reveals whether an e-mail exists. Expired/used token → clear message with resend. Under "block" policy an unverified session gets 403 on every household route.

Tests: `auth.verify-email.realdb` over HTTP with a fresh agent (no cookies) using the token hash; e2e `auth.spec` extension. RT: sink e-mail link followed in a new incognito context.

Effort: 1–2 days. Role: BE + FE + OWN.

## WP-03 Safe auth DTOs, real session revocation, atomic MFA codes (P1)
Findings: F-AUTH-02, SES-01, DEL-01, AH-10 (adopted, source-only). Depends on: none. Order: Week 1.

In scope: a `toPublicUserDto()` used by register, login, `/me`, profile, members list; allow-list only display fields; sessions revoke (single and all) and account deletion call the existing `session-revocation.ts` helper to delete `session` rows by user id (and `user_sessions`); step-up state keyed per session; one-time MFA and backup codes consumed under `FOR UPDATE` or a conditional update so two concurrent submissions cannot both succeed.

G/W/T: `GET /api/auth/me` body contains none of `mfaCode, mfaCodeExpiry, mfaBackupCodes, emailVerificationToken, emailVerificationExpiry, failedLoginAttempts, lockedUntil, nrc, salaryRangeEncrypted, passwordHash` (test asserts the key list). Copy a cookie jar, revoke that session from another session, use the copy → 401. Revoke-all → every other cookie 401. Delete account → every cookie 401 and zero `session` rows reference the user. Two parallel submissions of the same backup code → exactly one 200.

Tests: DTO key-list test; `security.sessions.revoke.realdb` with two agents; deletion test extension; MFA race test with a barrier. RT: verifier SES-01 script.

Effort: 1.5–2.5 days. Role: BE.

## WP-04 Household membership end to end, including the Professional role (P1, functional P0)
Findings: F-HH-01, SEC-02, SEC-01, SEC-06, SEC-07, F-HH-03, F-HH-02, AH-06 concurrency (adopted). Depends on: WP-02, DEC-03, DEC-12. Order: Week 1–2.

Problem/outcome: a household cannot gain a second member through the product; the UI offers a role the server rejects; acceptance is unbound to the recipient. Outcome: invite by e-mail → recipient accepts in the app → correct role from the approved matrix → member visible with name.

In scope: FE "Add member" calls `POST /api/household/invite` (email + role) and shows pending invitations with resend/revoke; new client route `/invite/:code` that logs in or registers then calls `POST /api/household/invite/accept`; server checks the invitation's recipient e-mail equals the accepting user's verified e-mail (409 otherwise); the one-household rule and acceptance run under the same per-user advisory lock used by `createWithOwner`, so create-vs-accept and two invitations cannot both succeed; `transfer-ownership` rejects self-transfer and non-members and runs in one transaction with `FOR UPDATE` on `households`; exactly one owner per household (the `owner` role is reachable only through transfer, no other role can demote the owner); the invite response returns an invitation id, never the raw code; members list DTO `{ userId, name, email, role, joinedAt }` and client reads those fields; `professional` implemented end to end per DEC-12 (schema already has it; invite and role-change controllers accept it; permissions per matrix) or removed from the UI if DEC-12 says so; remove the fake plan panel and "Configure shared views" (ENH-13); escape names in invitation HTML (VAL-01); client callers for leave and transfer-ownership.

G/W/T: owner invites m@x → sink e-mail → m opens `/invite/<code>` in a fresh browser → registers/logs in → accepts → `household_members` row role=member, members page shows "M Name". Outsider with the code → 403/409. Owner transfers to self → 400; to member → exactly one owner remains (DB assertion). Two accepts for one household-free user released through a barrier → one membership, one 409. Used/expired code → clear message. Professional member gets exactly the matrix permissions.

Tests: `household.invite.realdb` lifecycle (invite, wrong recipient, accept, duplicate accept, concurrent accept, revoke, transfer self/other); role matrix test shared with WP-01; e2e `organization.spec` extension. RT: two-browser acceptance in the sink environment.

Effort: 4–6 days. Role: FE + BE + OWN.

## WP-05 Import (both paths) and receipts integrity (P0/P1)
Findings: IMP-01, FIN-03 (adopted, source-confirmed 14 Oct), FIN-04 (adopted), IMP-02, IMP-03, RCP-01, RCP-02. Depends on: none. Order: Week 1–2 (IMP-01 and FIN-03 first).

In scope: overwrite mode (global and account-level) runs in one `withTransaction`: lock the existing rows, hard-replace or update-in-place by idempotency key (never soft-delete then skip); account-level overwrite is pair-aware: a transfer in the replacement range is deleted through the paired-transfer path with both accounts locked in id order, or the import is rejected with a preview listing the affected transfers (never one leg); report created/updated/skipped/failed counts and row numbers; account-detail import fixed so a valid row imports (uuid type mismatch) with explicit sign/balance semantics per account type; dedupe key extended to date+type+amount+normalised description+accountId (configurable "treat same-day equal amounts as duplicates"); date parsing via the existing `validDateSchema` with explicit format detection (reject impossible dates, declare the detected format in the preview); write `data_imports` rows; receipts `create-transaction` guarded by `FOR UPDATE` on the receipt and a 409 when `matched_transaction_id` is set; `positiveMoneyDtoSchema` on receipt amounts.

Invariants: after any import, `sum(account deltas) == sum(inserted) − sum(replaced)` to the cent across all touched accounts; no soft-deleted row without a replacement; surviving transfer pairs have both legs or neither; one ledger row per receipt.

G/W/T: import file F (3 rows) → balance +X; import F again with Overwrite → balance still +X, 3 rows live, 0 orphan soft-deletes; a transfer in the range with account-level overwrite → both legs replaced or the import refused, both balances reconcile; account-detail import of one valid row → imported 1; two same-day 25.00 purchases with different descriptions both import; `2026-02-30` rejected with row number; receipt create-transaction twice → second 409 and one row; `-30.00` → 400.

Tests: extend `import.execute.realdb.integration.test.ts` (overwrite twice, transfer in range, account path, dedupe, invalid date); `receipts.create-transaction.realdb` (replay, negative). RT: re-run the import verifier's CSVs.

Effort: 4.5–6 days. Role: BE (+ small FE for the preview).

## WP-06 Transaction entry, rules engine and organisation wiring (P0/P1)
Findings: F-TXN-02, F-ACC-01, ORG-01, ORG-02, F-CLIENT-01, F-TXN-03, ORG-003 (adopted, reproduced 14 Oct), ORG-004 (adopted, reproduced 14 Oct), ORG-005, ORG-007, ORG-008, ORG-009 (adopted, source-only). Depends on: none. Order: Week 1–2 (ORG-003/004 first).

In scope: rules — every action value that is an id (category, tag, member, goal, split category, merchant) is resolved against the actor's household and visibility at create, update and execution, with 400 on foreign or missing references and a one-off migration report listing stored rules that reference foreign ids; dry-run and preview run the evaluator in a planning mode that returns proposed changes and never calls a repository write (tags, usage counts, aliases, splits); split allocations validated to sum to the parent amount (percentages to 100, amounts to the parent) at create and execution; transaction entry — category picker derives type from `groups` (both `useCategories` hooks return `groupType` or the picker filters by group id); Accounts page default owner filter "All" (persist per user); honour `ownerUserId: null` as shared on create (create.ts:186); organisation — `POST /api/tags/merge` uuid cast fix; implement the merchant detail endpoints the UI calls (`/:id/analytics`, `/:id/transactions`, aliases add/delete, logo upload/delete) on the existing `merchant_aliases` and `merchant_logo_uploads` tables and `POST /rules/:id/test`; merchant delete options match server behaviour; undo adjusts counts from rows actually restored; repeated tag removal is idempotent on `usage_count`.

G/W/T: member creates a rule whose category id belongs to another household → 400; a stored rule with a foreign id applies nothing and is listed in the migration report; dry-run of a rule with add_tags, add_merchant_alias and split_transaction actions → `transaction_tags`, `tags.usage_count`, `merchant_aliases`, `transaction_splits` unchanged (row hash before equals after) while `proposedUpdates` lists all three; a split config of 60/60 percent → 400; new household after seed → picker shows the seeded categories grouped Income/Expenses; saved transaction has `category_id`; first account visible without touching filters; tag merge → 200 and `transaction_tags` repointed; every merchant-detail control works (200 plus persisted row).

Tests: `rules.references.realdb` (foreign category, tag, member, goal; stored legacy rule); `rules.dryrun.purity.realdb` (snapshot assertions for each mutating action); split bound test; client test for picker options; `tags.merge.realdb`; merchant endpoint realdb tests; e2e `transactions.spec` adds a categorised expense. RT: 14 Oct probe commands re-run (expect 400 and unchanged snapshots).

Effort: 4–7 days. Role: BE + FE.

## WP-07 One definition of money across read models (P0/P1)
Findings: RC-01, RC-02/INV-06, RC-03, RC-04, RC-05, RC-06, RC-08, F-TXN-01, BGR-01, RC-07, RC-13 audit, FIN-05 (adopted, raised from X-01 P3), FIN-08, FIN-09, FIN-13, FIN-14 (adopted, source-only). Depends on: none; coordinate with WP-05 for splits. Order: Week 2–4 (largest packet).

In scope:
1. FX: `fx_rates` and `securities` become household-scoped for writes (add `household_id` nullable plus unique per household/pair/date; global rows read-only seeded by the market job); all aggregations use the dated rate via the shared `fxRateExpr`; the ratios and debt repositories currently perform no conversion at all (RC-01) and are rewritten on `fxRateExpr` plus the private/hidden filters, then guarded by `assertFxRatesAvailable`; missing rate → 422 with the missing pair/date (not 500, never 1.0); an owner-facing FX entry in Settings in addition to the scheduled market job.
2. Ledger currency invariant: every writer (manual, import, recurring, receipt, rule, GRZ) persists `transactions.currency` from the locked account; the repository rejects a mismatch; a versioned backfill sets null rows from their account; DTOs carry the currency through list, summary and export.
3. Liability sign: a purchase on a credit/loan account increases the amount owed; net worth = assets − liabilities with liabilities positive magnitude; card purchases are expenses in cashflow/income/savings/annual (the "debt" bucket only for principal repayments).
4. Splits: every aggregation counts split children exactly once (shared query helper; property test); editing a split parent's amount re-validates and re-materialises children in the same transaction (FIN-08).
5. Summary: invalidate the `txn-summary:*` cache on transaction create/update/delete across both cache families, with and without Redis; use the dated FX rate.
6. Client date ranges: one `monthRange(timezone)` helper used by all 23 call sites; server receives dates in the household timezone.
7. Budgets: `BudgetSpendRepository` converts non-base currency with the dated rate or excludes with a visible "unconverted" marker (owner choice, default convert).
8. Weekly recap and valuation: missing-rate errors propagate as a degraded state with an explicit `complete: false` flag, never zeros and never an understated net worth that silently drops holdings (FIN-14).
9. Goal links: link, edit, unlink and transaction delete adjust goal progress reversibly under ordered goal/transaction locks (FIN-09).
10. Account edits: currency, asset/liability type and opening balance are frozen once ledger activity exists, or changed only through an explicit reconciliation operation that posts an adjustment (FIN-13).
11. Audit rows for `GET /api/accounts/summary/export` and `/:id/transactions/export` (reuse the `reports-export-audit` pattern).

Invariants (property-tested with random fixtures that include edits and deletes): income − expenses = net flow; sum of category buckets incl. Uncategorised = total expenses; dashboard month = transactions summary month = cashflow month = annual month for the same range; net worth = Σ asset balances − Σ liability balances; converted amounts use the latest rate dated ≤ transaction date; a USD amount is never summed into a ZMW total unconverted (ratios, debt, budgets); no transaction row has null currency; goal `current_amount` equals the sum of its live links and contributions.

G/W/T (from the reports verifier's fixture): September expenses 1564.15 (not 1518.65); net worth 41577.69; October budget actual 1273.75 in budget comparison and CSV; `/ratios` with a USD 75 balance and a stored 26.50 rate → liquidAssets includes 1987.50; `/ratios` with a USD account and no rate → 422; a ZMW budget with a USD 50.00 expense shows the converted spend; after another household posts a rate, this household's totals unchanged; summary reflects a new transaction within one request; Lusaka client on 1 Oct requests 2026-10-01..2026-10-31; a recurring materialisation on a USD account stores currency USD; unlinking a goal link restores the prior `current_amount`; changing an account's currency after a transaction exists → 409.

Tests: `reports.consistency.realdb` property suite; `transactions.summary.cache.realdb`; `transactions.currency.invariant.realdb`; `goals.links.lifecycle.realdb`; `accounts.edit.freeze.realdb`; migration tests for fx scoping and the currency backfill. RT: re-run the reports verifier's fixture and compare its hand values.

Effort: 9–13 days (high uncertainty: touches seven repositories and every writer). Role: BE + FE.

## WP-08 Recurring and budgets on the reachable path (P1)
Findings: F-REC-01/REC-01, BGR-02, BGR-03, BGR-04, REC-02, REC-03, REC-04. Depends on: WP-12 for production scheduling. Order: Week 2.

In scope: Add-Transaction recurring section sends `frequency`, `nextDueDate` (= transaction date), `endDate`, `amountType`, reminders; server error fields surface in the form; `auto_rollover_budget` exposed in the household policy schema (WP-10) or rollover driven by `budgets.rollover_enabled` alone; recalculate computes the mean of the last N months, previews before saving, never overwrites manual budgets without confirmation, skips zero-spend categories; recalc/clear audit `entityId` must be a uuid; `asOfDate` capped at today for members; missed periods catch up in one run with a cap; day-of-month preserved after short months; end-date and pause semantics explicit.

G/W/T: UI monthly rule → 201 with correct `next_due_date`; rule from 31 Aug runs 30 Sep then 31 Oct; three missed months materialise in one `/process` run, idempotent on rerun; budget with rollover leaves 450.00 unspent → next period `rollover_in = 450.00`; recalc preview shows 183.33 for a 550.00/3 history and does not touch Dining 500.00; `asOfDate=2027-01-01` → 400 for member.

Tests: extend `processRecurring.materialization.realdb`, `BudgetRecalculation` tests, client form test asserting the payload. RT: budgets verifier scripts.

Effort: 3–4 days. Role: FE + BE.

## WP-09 Investments and GRZ ledger wiring (P0)
Findings: GRZ-01..06, INV-01..10, F-INV-01, WHT decision, FIN-12 (adopted: overdue and month-end scheduling). Depends on: DEC-08. Order: Week 3–5. The former WP-09h (hide) is withdrawn; the feature ships complete.

In scope:
- Principal payment: at maturity post principal as a transfer from "GRZ holdings" to cash only if the purchase debited cash; under the holdings-only decision post nothing for principal (or a zero-income memo); the owner must choose (DEC-08b); coupon postings remain income.
- Bond state machine: `active → sold | matured`; `pay` rejects when not active, when payment date is in the future, and when the account differs from the bond's account; sell computes gain/loss = proceeds − cost, credits cash, writes a disposal for tax; validation: rate as a decimal fraction with range check, face > 0, maturity > purchase.
- `Money.isPositive()` strict; cron response sanitised.
- Holdings: buys update `cost_basis`/`cost_basis_zmw` with the dated FX; sells require quantity ≤ held and > 0; holdings created by POST or SIP create tax lots; `amount_zmw` computed.
- Tax summary includes GRZ interest and WHT; tax-year boundary in household timezone; ZRA export populated.
- Pension and SIP: validation (`total = employee + employer`), audit rows, SIP catch-up for missed days, month-end anchoring (31st → last day), no silent 15% assumed yield on automated T-bill rollover (estimate flagged pending confirmation or run refused, DEC-08c).
- UI: GRZ, tax and pension tabs reachable without an equity holding; `/investments/tax` link fixed.

G/W/T: the investments verifier's hand values (`scratch-investments-grz/hand.mjs`) reproduced; sold bond `pay` → 409; matured T-bill at face → cron succeeds; sell 5 of 10 shares bought at 310.50 → gain per FIFO; tax summary interest = Σ coupons; SIP past due runs once; SIP anchored on the 31st runs on 30 Sep and 31 Oct; automated rollover with no live yield records an estimate marked as such or refuses, per DEC-08c.

Tests: extend `grz-money.integration`, `grz-record-only`, `investments.db.integration`; property test for FIFO; schedule boundary tests. RT: verifier scripts.

Effort: 6–8 days (high uncertainty). Role: BE + FE + OWN.

## WP-10 Settings that persist what they show (P1)
Findings: SET-01, SET-02, SET-05, SNA-REC-01, AH-07 (same defect). Depends on: WP-01 for the policy split. Order: Week 2.

In scope: `updateProfileSchema` covers every form field the UI sends, with explicit clearing semantics and documented retention for sensitive fields (nrc, income); `PUT /api/settings/preferences` becomes household policy (owner/admin) and a new `PUT /api/settings/user-preferences` writes `user_preferences`; currency change on a household with transactions → 409 with guidance (no conversion in this release) or the WP-07 reconciliation path; recap settings and widget settings write disjoint columns; a contract test compares each form's field list with its Zod schema keys.

G/W/T: PUT profile with all 22 fields → GET returns all 22; clearing a field persists null; preferences save → `user_preferences` row; currency change with ledger → 409; recap day save leaves `first_day_of_week` unchanged.

Effort: 2–3 days. Role: BE + FE.

## WP-11 Data rights: export, deletion, audit completeness (P1)
Findings: DATA-01/F-SEC-02, DEL-01, DEL-02, RC-13, server-surface F4, AH-08 (same defect). Depends on: WP-03. Order: Week 3.

In scope: real personal-data export (JSON plus CSV bundle of the data the user can see, generated asynchronously, `data_exports` row, audit row, authenticated download, UI button in Security/Privacy, truthful progress and errors); deletion for no-household, sole-owner and shared-member states: erases or pseudonymises `security_audit_logs.email/ip` for the subject, drops the password hash from the tombstone, retains the household audit log when other members remain (SCP-332 semantics), deletes uploaded files, revokes sessions (WP-03), with re-authentication and self-service discoverability; audit rows on pension/SIP/market-refresh/budget-settings/attachment/cron ledger writes and account exports.

G/W/T: export → file lists every account/transaction visible to the user and nothing private to others; deletion → no row anywhere contains the user's e-mail except the audit of the deletion itself; stale cookie, token and file URL replay after deletion → 401/404; every write enumerated in server-surface F4 produces an `audit_logs` row (test iterates the list).

Effort: 3–4 days. Role: BE + FE + OWN (retention text).

## WP-12 Deployment that runs the product (P0 functional)
Findings: F-OPS-01, F-OPS-02, F-OPS-03, F-OPS-04, F-OPS-06, uploads in git, OPS-013 (adopted: lock lease and run identity). Depends on: DEC-05, DEC-06. Order: Week 1 (decisions) → Week 2 (staging).

In scope: scheduling — Render cron jobs (or in-process node-cron on the single instance) for snapshots (daily), recurring (daily), budget rollover (daily, idempotent), budget alerts, goals status/deadlines, market-data (daily), investment automation, receipt matching; `CRON_SECRET` set, constant-time compare; a job registry with trigger, timezone, due identity (scheduled date key), lease renewal while running, retry and catch-up policy, last-success timestamp per job, so two instances or a delayed tick cannot both run the same due item and a run longer than the lease cannot overlap; coordination keys kept out of the `allkeys-lru` cache namespace (separate Redis logical db or `noeviction` policy); uploads — Render persistent disk mounted at `uploads/` (single instance) or S3-compatible storage behind the existing path helpers; `.gitignore` uploads and remove the 30 tracked files; health — `/healthz` pings DB and Redis (read and write) and returns 503 when either fails; DB TLS — CA provided and `DATABASE_SSL_REJECT_UNAUTHORIZED=true`; env schema covers `APP_URL`, `SMTP_*`, `VAPID_*`, `CRON_SECRET`; `redactSensitive` wired into the logger serialiser and context keys preserved.

G/W/T: on staging, two consecutive days show one `recurring_transaction_history` row per due rule, one `net_worth_snapshots` row per household per day, a fresh `fx_rates` row; two instances started with the same tick → one run; a job killed mid-run is retried once the lease expires and produces no duplicate financial row; a receipt uploaded before a redeploy is downloadable after it; `/healthz` returns 503 when the DB or Redis is stopped; TLS verification on with the CA; a job error appears in logs with its context.

Effort: 4–6 days (medium: Render specifics). Role: OPS + OWN.

## WP-13 Rate limits, dependencies, runtime (P1)
Findings: F-SEC-04b/c, F-DEP-01, DEP-02 (adopted). Order: Week 1.

In scope: mount `generalLimiter` once (remove per-router duplicates) with a per-user limit sized for about 40 requests per page load (e.g. 300/min per user) and keep stricter limits on auth/analytics; `ipAuthLimiter` scoped to `login`, `register`, `forgot-password`, `reset-password`, `resend-verification` only, 10/min; `npm audit fix` for the 8 fixable advisories, evaluate `csv-parse` 7 and `sharp`; CI stays blocking; move `engines`, CI and Render to a supported Node LTS, re-run the native dependencies (sharp, OCR worker) and the full suites on that matrix.

G/W/T: login plus 10 page loads never 429; `ratelimit-remaining` after a dashboard load ≥ 200; `npm audit --omit=dev` exit 0 in CI; CI green on the new Node version with Postgres 16; the limiter behaves the same with `REDIS_URL` set.

Effort: 2–3 days. Role: BE/OPS.

## WP-14 Phone layout (P1)
Findings: F-MOB-01, UX-02 (same defect), ENH-06 (collapse). Order: Week 2.

In scope: sidebar collapsed into a drawer below 768 px; content width 100%; test at 320, 360, 375 and 390 px for Dashboard, Transactions, Add Transaction, Accounts, Budget, Reports, Settings; no clipped headings; no horizontal page scroll; focus trap in the drawer; Reports at 1280 px without horizontal overflow.

G/W/T: Playwright Mobile Chrome project passes a layout spec asserting `scrollWidth === innerWidth` and visible page headings on those pages.

Effort: 2–3 days. Role: FE.

## WP-15 Staging soak, drills, honest e2e, release checklist (gate)
Findings: F-OPS-07, QA-01 (adopted), OPS-011 (adopted), DECISIONS §4. Depends on: WP-12. Order: Week 3 onward, continuous.

In scope: staging deployed from `main` in production mode (HTTPS, secure cookies, CSRF, limiters, CSP, real SMTP to a controlled inbox); e2e specs rewritten so each journey submits and asserts a persisted outcome (no `if (control)` guards that pass silently, no skipped populated states); the local e2e harness binds to an explicit disposable DB and port and refuses unknown servers; backup taken, restored to a second instance, smoke run against it (record time and loss window); rollback rehearsal; 14-day soak with synthetic households; incident contacts and a status note template; `smoke:staging:health` in CI post-deploy.

G/W/T: every e2e spec fails when its asserted row is absent (mutation test: skip the submit, spec goes red); documented restore under 60 minutes with ≤ 24 h data loss (or the owner's accepted targets); rollback rehearsal recorded; soak without P0/P1.

Effort: 5–6 days of calendar-spread work. Role: OPS + QA + OWN.

## WP-16 MFA enrolment UI and credential policy (P1)
Findings: F-SEC-05, AH-11, AH-12 (adopted). Depends on: WP-03. Order: Week 3.

In scope: Security section enrol/disable MFA with backup codes shown once and regenerable, recovery flow, policy display; the mandatory-MFA flag honoured for existing sessions under an agreed re-authentication rule (DEC-13); one password policy shared by register, change and reset; high-value step-up thresholds compared in the household currency with fail-closed missing FX.

G/W/T: owner enables MFA, logs out, logs in with a code from the mailbox; backup code works once; disable requires password; password change rejects a password that registration would reject; a USD transfer above the ZMW threshold prompts step-up.

Effort: 2–3 days. Role: FE + BE + OWN.

## WP-17 Notifications, push and weekly recap (P0 when push is enabled, else P1)
Findings: OPS-008 (adopted; accept-any endpoint observed by the Fable settings verifier), OPS-009, OPS-010 (adopted), RC-07, SNA-REC-01, SNA-REC-03, SNA-REC-04, recap consent gate. Depends on: WP-01, WP-07. Order: Week 4–5.

In scope: push subscriptions schema-validated (keys, endpoint) and restricted to an allow-list of known push-service origins; reject credentials in URLs, non-standard ports, private or loopback resolution; bounded connect and request timeouts; keep push disabled until this lands; every e-mail template escapes user-controlled strings; per-channel delivery status, retry and dedupe recorded per notification; quiet hours and preferences honoured; recap e-mail uses the household currency, respects `includeGoals`/`includeRecurring`, shows the week's net worth rather than the current one, and goes out only with per-user consent; recap reads use the viewer-aware recurring query from WP-01.

G/W/T: a subscription with endpoint `https://127.0.0.1/` or an unknown origin → 400 and no row; a delivery to a stubbed push transport records sent/failed per channel; a failed e-mail is retried once and marked failed, never duplicated; recap for a member shows no other member's private rule; `<b>` in a name arrives escaped.

Tests: endpoint validation unit tests with resolution stubs; `notifications.delivery.realdb`; recap privacy test shared with WP-01. RT: SMTP sink captures, stubbed push transport.

Effort: 3–5 days. Role: BE.

## WP-18 Receipts and OCR in production (P1)
Findings: OPS-004 (adopted), F-OPS-05 (dormant matcher worker), RCP residue, receipt details exposing server paths. Depends on: WP-12 (durable storage). Order: Week 4.

In scope: OCR worker and WASM assets served under the production CSP (self-hosted assets, `worker-src` and `wasm-unsafe-eval` as required, or server-side OCR); receipt matcher worker started or replaced by a scheduled job; upload, OCR, correct, match, create, retry and delete journey on phone and desktop; DTOs expose download URLs, not filesystem paths; unauthorised access to another household's receipt → 404.

G/W/T: in production mode, scanning a receipt image completes OCR without CSP violations in the console; a pending receipt matches a later transaction within one scheduler tick; after a restart the thumbnail still loads.

Effort: 2–4 days. Role: FE + OPS.

## WP-19 Thandi AI with a real provider layer (P1)
Findings: F-AI-01/AI-01, OPS-012 (adopted), the 11 October THANDI_PROVIDER_SPEC as assessed in THANDI_SPEC_ASSESSMENT.md, provider policy. Depends on: WP-01 (sanitiser inputs and role guard), DEC-11. Order: Week 5–6. Revised 15 Oct: the owner has free Claude API access, so this packet is Phase A of the assessment (Claude as the single external provider plus the local degraded mode); Gemini failover and the spend ledger are Phase B, owner-triggered. Correction: conversation list/get/delete are implemented today (`ai.conversation.service.ts`); the "stub" claim in CLAUDE.md Rule 4 is stale.

In scope: provider-neutral contracts with tool definitions in JSON Schema; a Claude adapter on the official SDK with a configured model id, output bound from the remaining request budget, usage captured per call, abort from a request-level deadline, SDK retries set to zero and errors mapped to the existing typed failure categories; the Gemini adapter reduced to the same seam and disabled by default; the orchestrator keeps the current two-stage flow, degrades to the local mode only on an eligible provider failure, propagates application errors unchanged, and persists one exchange and charges one quota unit per logical request behind an idempotency claim keyed on actor, household and message fingerprint; per-household and per-app daily token counters beside the existing 50-request cap, with operator alerts; consent version bumped to name Anthropic and enforced in the middleware (today only reported); provenance fields `provider`, `model`, stage outcomes and `answer_mode` in the audit row and message DTO, `used_gemini` never set for a Claude answer; client labels "Answered using Claude" and "Limited local summary"; status endpoint distinguishes unconfigured, unhealthy, degraded and quota-limited; an evaluation set of 20–30 prompts with expected tool calls and golden amounts run in CI against recorded responses and live only in the staging smoke; the hard-coded `gemini-2.0-flash` removed.

G/W/T: healthy Claude answers both stages with provenance "claude" and zero Gemini calls; a stubbed 529 at analysis yields a labelled local answer, one exchange, one quota unit and an audit row showing the failed attempt; an invalid key shows a configuration failure to the operator and "unavailable" to the user with no secret logged; an outdated consent version blocks the outbound call before dispatch; a replayed request persists one exchange; a member's private account never appears in another member's tool results; CI makes no provider network call.

Effort: 3–5 days (Phase A). Phase B (Gemini failover, spend ledger, cross-instance circuit breaker) 2–4 days if DEC-11 later enables a paid provider. Role: BE + FE + OWN.

## WP-20 Accessibility and device completion (P1)
Findings: ENH-11 items, UX-01, F-UX-01, F-GOAL-UX-01, native `confirm()` dialogs, unlabeled icon buttons, dead TopBar controls. Depends on: WP-14. Order: Week 5.

In scope: household-dependent queries gated on authenticated membership so first run shows one onboarding state and no error cascade; replace native confirms with the app dialog; label every icon button; keyboard reachability and focus order on the eight primary pages; screen-reader pass on forms; 200% zoom and 320 px without loss; silent wizard validation surfaced; dead controls removed.

G/W/T: axe-core reports no critical or serious issue on the eight primary pages; new browser → register → verify → household → first transaction with zero error toasts; every form error is announced.

Effort: 2–4 days. Role: FE.

## WP-21 Integrated acceptance and UAT (gate)
Findings: none new; closes the loop. Depends on: all. Order: last.

In scope: an acceptance catalogue of end-to-end journeys (identity, household, settings and MFA, ledger, privacy matrix across all roles, imports, organisation, budgets, goals, recurring and jobs, investments and GRZ, reporting, receipts, outbound and AI, portability and exit, operations and devices) each with role, DB oracle, failure case and production-mode evidence; owner UAT across every module on staging with synthetic data; independent reviewer sign-off on evidence quality; re-run of all three verifier script sets and the 14 Oct probes at the candidate SHA; release checklist in LAUNCH_PLAN.md executed.

G/W/T: every journey has a recorded pass at the candidate SHA on staging; no open P0 or P1; verifier scripts green.

Effort: 3–5 days. Role: QA + OWN.

---

## Traceability

| GAPS.md ID | WP | | GAPS.md ID | WP |
|---|---|---|---|---|
| ISO-01, PRIV-*, ORG-001, AH-09, F-SEC-01 | 01 | | F-REC-01, BGR-02/03/04, REC-02/03/04 | 08 |
| F-AUTH-01/03/04, AH-04 | 02 | | GRZ-*, INV-*, F-INV-01, FIN-12 | 09 |
| F-AUTH-02, SES-01, DEL-01, AH-10 | 03 | | SET-01/02/05, SNA-REC-01, AH-07 | 10 |
| F-HH-01/02/03, SEC-01/02/06/07, VAL-01, AH-06 | 04 | | DATA-01, DEL-02, RC-13, F4 audits, AH-08 | 11 |
| IMP-01/02/03, FIN-03, FIN-04, RCP-01/02 | 05 | | F-OPS-01/02/03/04/06, OPS-013 | 12 |
| F-TXN-02/03, F-ACC-01, ORG-01/02, F-CLIENT-01, ORG-003/004/005/007/008/009 | 06 | | F-SEC-04b/c, F-DEP-01, DEP-02 | 13 |
| RC-01..08, BGR-01, F-TXN-01, FIN-05/08/09/13/14 | 07 | | F-MOB-01, UX-02 | 14 |
| F-OPS-07, QA-01, OPS-011 | 15 | | F-SEC-05, AH-11, AH-12 | 16 |
| OPS-008/009/010, RC-07, SNA-REC-x | 17 | | OPS-004, F-OPS-05 | 18 |
| F-AI-01, OPS-012 | 19 | | UX-01, F-UX-01, F-GOAL-UX-01, ENH-11 | 20 |
| acceptance catalogue | 21 | | | |

P2 and P3 rows not mapped above are scheduled in the LAUNCH_PLAN.md hardening phase; none is deferred past release without an owner decision recorded in DECISIONS.md.
