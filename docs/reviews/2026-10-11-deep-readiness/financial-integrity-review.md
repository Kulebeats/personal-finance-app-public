# Financial integrity assessment — 11 October 2026

Baseline: `main`, `381e9439afabe7c6cf829cb1cbded91d36da44ee`. Scope: read-only assessment of accounts, ledger transactions, transfers, both CSV import paths, budgets/rollover, goals, recurring materialization, investments/GRZ, and financial reports. Current target: the full application must function end to end, with staging verification first and no fixed November deadline or feature cuts. This supersedes the initial invited-household-pilot constraint. No application code, fixtures, database, or environment settings were changed by this reviewer.

## Evidence limits and verdict

**Financial readiness: BLOCK.** Existing transaction/account locking, atomic transfer operations, decimal arithmetic, and real-database regression tests are substantial foundations. They do not establish correctness of the complete user journeys. Current reachable code still contains private-data disclosure, destructive import retries, one-sided transfer deletion during overwrite, incorrect monthly budget calculations, and inconsistent financial projections.

This document records **source-verified findings**, one executed pure-function parser probe, and the coordinating assessment's selected **isolated runtime/database reproductions**. Runtime evidence is in `.local/readiness-2026-10-11/runtime-probes.json`, using synthetic data in PostgreSQL 18 database `finance_app_audit_20261011_browser_test`, `NODE_ENV=test`, SMTP disabled and CSRF disabled by test mode. Those probes do not establish production CSRF or staging readiness. Existing tests cited here were inspected for coverage, not rerun by this reviewer. The coordinator owns full-suite and browser evidence. A green aggregate suite must not close the findings below without the additional acceptance cases.

Historical money/FX/login memory was searched briefly; it did not supply any of the findings below. Current source and current test definitions are the evidence.

## Reachable module coverage

| Module / journey | Implementation and important controls verified in source | Remaining or unverified outcome |
|---|---|---|
| Account creation, adjustment, edit, delete/archive | `accounts.routes.ts` applies household, role, rate, and selected step-up guards; `AccountCoreService` creates balances, routes adjustments through the locked transaction repository; repository applies SQL ownership predicates to ordinary account update/delete | Account currency/type/initial-balance edits do not preserve ledger semantics (FIN-13); CSV import/export divergence (FIN-01, FIN-04); browser and persistence round-trip pending |
| Income/expense creation | `transaction/create.ts:52-90,176-220` enforces visibility, account currency, transfer exclusion, idempotency collision handling; `TransactionRepository.ts:287-356` locks account, writes ledger/splits/audit, applies exact SQL numeric balance delta in one transaction | Mutation of a split parent leaves its children unchanged (FIN-08); goal-linked mutations leave goal progress stale (FIN-09); transaction UPDATE audit is outside commit (FIN-16) |
| Transaction read/filter/edit/delete | SQL filters both account and transaction privacy before pagination (`TransactionQueryRepository.ts:166-190`); date schema rejects nonexistent calendar dates; update locks transaction/account and supports optimistic version check; delete reverses under row lock | Privacy policy is bypassed by alternate exports/goal/investment routes (FIN-01); summary currency/default/rate semantics differ across producers and reports (FIN-05) |
| Transfers create/edit/delete | `TransferService` validates two accessible accounts; `TransactionTransferRepository` and transfer update use transaction/account locking, paired writes and decimal FX; individual transfer-leg monetary changes rejected by `transaction/transferGuard.ts` | Global overwrite import bypasses paired delete invariant (FIN-03); full browser create/edit/delete/cross-currency reconciliation still required |
| Global CSV import | `/api/import/execute`: target-household role check, 5,000-row cap, private-account visibility; parser strict amount validation; transaction/audit batch atomicity; post-import rules and recurring linkage attempted | Overwrite replay erases imported rows (FIN-02); half-transfer deletion (FIN-03); absent persisted currency (FIN-05); date ambiguity and nonexistent dates (FIN-15); deduplication can collapse legitimate same-day rows |
| Account-detail CSV import/export | A distinct UI (`ImportTransactionsModal`) calls `/api/accounts/:id/transactions/import`; export sanitizes cells | Every import row currently gets a non-UUID idempotency key for a UUID column (FIN-04); export exposes private transaction rows and emits unsigned expenses (FIN-01/04); path is not equivalent to global import |
| Budget CRUD, progress, forecasts, recalculate, rollover | Monthly-only period contract, category/group checks; batch split-aware spend queries; recalculation transaction with household serialization; rollover batch write atomicity | Raw-currency aggregation in primary budget progress (FIN-06); historical total written as monthly average (FIN-07); refund/pending/private aggregation policy needs product agreement; actual month-end worker + read-back unverified |
| Goals, contributions, transaction links, assignments | Goal-row locks protect ordinary contribution/link arithmetic; assignment-specific endpoints pass user identity; projection and debt helpers exist | Alternate goal reads expose private detail (FIN-01); monetary link lifecycle not closed under edit/delete/unlink/currency changes (FIN-09); investment contributions are record-only, not cash funding |
| Recurring transactions | `RecurringProcessingService.ts:160-279` locks due rule, rechecks, creates ledger/link/history atomically with deterministic occurrence key; real-DB concurrency tests exist | Materialization omits currency (FIN-05); only one occurrence per rule/run; catch-up after end-date, pending/balance and owner/privacy behavior need explicit acceptance coverage |
| Manual investments, holdings, tax lots | Household isolation and sell overdraft lock; FIFO disposal rows and precision-preserving quantity storage; real-DB sell race test exists | Private accounts lack user filtering (FIN-01); quantity changes do not maintain holding cost basis (FIN-10); record-only cash semantics must be visible to users |
| Investment automation | Due-plan lock and existing-holding lock; T-bill maturity row lock, idempotent income posting, audit in same transaction | Automated stock purchases omit tax lots required by sell path (FIN-11); missed-day/month-end scheduling defects (FIN-12); no current source-owner confirmation of forecast yield fallback semantics |
| GRZ bonds/T-bills/coupons/sales/maturity | Decimal/Money arithmetic now used; holding creation explicitly record-only; coupon/sale race tests exist; maturity interest atomic and keyed | Financial/legal rate and product convention validity not established by code tests; deployed clock/job behavior and cash/report reconciliation unverified; withholding assumptions require authoritative owner validation before enabling |
| Dashboard, account net worth, reports, FX | Report base class and portfolio valuation surface missing rates; report snapshot FX now uses null-on-missing and explicit guard; report family has real-DB FX regression tests | Account net worth catches valuation errors and silently returns partial total (FIN-14); null transaction currency and latest-vs-historical FX policies diverge (FIN-05); transaction summary stays stale after writes (FIN-17); Annual Dashboard monthly trends misparse display labels and lose period totals (FIN-18); each dashboard/report/export requires same-fixture numerical reconciliation |

Paths in the table are relative to `server/` unless their location is otherwise stated. This is a module/path ledger, not a claim that every UI state was exercised.

## Findings

### FIN-01 — CRITICAL / P0: private financial data bypasses ordinary account and transaction visibility

Confidence: **99%**, source-verified. Required before any multi-user use, including within one household.

The ordinary transaction list checks both transaction and account privacy. Several alternate reachable paths enforce household membership only:

- `server/modules/goals/goals.extra.controller.ts:105-119` passes no `userId` to `getLinkedTransactions`; `server/services/TransactionGoalLinkService.ts:364-385` returns full transaction rows filtered only by goal and household. An owner can link their private-account income, after which another member/viewer can read the name, amount, notes, account ID, and metadata. `getLinksForTransaction` at line 388 likewise exposes link metadata without visibility. `unlinkTransaction` at line 198 deliberately uses the nonvisibility reader for a user-initiated operation.
- `server/services/goal/GoalQueryService.ts:55-71` returns assigned account name/balance/currency without privacy filtering in the goal-detail response, although the dedicated assignment endpoints do filter. This is alternate-path inconsistency.
- `server/modules/investments/investments.transactions.controller.ts:21-36,59-62` discards actor identity. `investments.service.ts:48-71,340-359,380-411,417-435,481-493` scopes holding/transaction operations to household only. Household members can read private investment details and mutate those holdings. Portfolio valuation at `server/services/PortfolioValuationService.ts:127-145` also ignores account privacy; user-filtered account summary adds this household-wide portfolio result (`AccountReportingService.ts:95-113`).
- `server/services/account/AccountImportService.ts:24-43` checks access to the account but exports all its transactions. `server/repositories/AccountRepository.ts:537-542` has no `transactions.isPrivate` / `ownerUserId` predicate. A shared account containing one member's private transactions exports those rows to another member/viewer.

Reproduction: create a private account and income as member A, link it to a household goal, then read `/api/goals/{goalId}/transactions` as member B. The ordinary transaction endpoint should return not found while the goal endpoint currently returns the row. For account export, seed or mark a private transaction in a shared account and compare list versus `/api/accounts/{id}/transactions/export` as B.

**Runtime-confirmed by coordinator:** `member_direct_private_read` returned 404, while `member_goal_private_read` and `viewer_goal_private_read` both returned 200 including the private account's synthetic transaction name, amount and notes. Cross-household control returned 404. This verifies the goal-linked read leak; other variants above remain source-verified.

Fix: carry actor identity end-to-end, reuse common visibility predicates, recheck authorization in transactional mutations, and filter response relationships. Define whether household aggregates may disclose private totals; do not infer this from owner/admin role. All direct and indirect routes must obey the same declared rule.

Acceptance: A/B/view-only in household H and member C in household J; ordinary reads, exports, goal detail/activity/links/unlinks, holdings/tax lots/portfolio/transactions and writes must not disclose or alter A's private records as B/view-only/C. A still completes the full journey. Test positive and negative outcomes through real HTTP plus database read-back.

### FIN-02 — CRITICAL / P0: replaying an overwrite import deletes the data it previously imported

Confidence: **99%**, source-verified. Required while global CSV overwrite is enabled.

`server/services/ImportService.ts:135-145` soft-deletes visible rows for the import date range before examining row keys. Lines 172-185 then look up `idempotencyKey` without excluding deleted rows. The deterministic key is unchanged for the same CSV. A second identical `prioritize_csv` import therefore deletes its first import, sees those deleted rows as duplicates, skips every replacement, and commits the deletion and balance reversal. `sideEffects.ts:28-30` returns early when no replacements were created, so that deletion-only outcome does not even invalidate transaction caches there.

Minimal synthetic request, sent twice as a member with a funded account:

```json
{"targetAccountId":"<account-uuid>","strategy":"prioritize_csv","mapping":{"date":"Date","amount":"Amount","merchant":"Merchant"},"categoryMapping":{},"rows":[{"Date":"2026-10-01","Amount":"-10.00","Merchant":"Audit import repeat"}]}
```

Expected: stable one active expense and one balance delta. Source predicts the second call returns `imported:0, skipped:1, deleted:1`, restores the original balance, and leaves no active expense.

**Runtime/database-confirmed by coordinator:** `overwrite_first` returned 200 with imported1/deleted0; `overwrite_second` returned 200 with imported0/skipped1/deleted1. `overwrite_database` shows the imported row soft-deleted and balance restored to 100.00. Its persisted currency is also null, corroborating the writer omission in FIN-05.

Fix: design an import batch/row identity and replacement contract before deleting. Reconcile/reuse existing matching rows or transactionally replace them with versioned identity; never simply exclude deleted rows without addressing the unique constraint. Lock the account/batch in a consistent order. Invalidate on every committed deletion or insertion. Preserve audit lineage and concurrent retry semantics.

Acceptance: exact repeat, retry after lost response, concurrent repeats, changed mapping/category, overlap with earlier import, failed row, injected failure after delete, and deletion-only batch. Assert active rows, signed balances, audit records, and dashboard read-back.

### FIN-03 — CRITICAL / P0: CSV overwrite deletes a single leg of an account transfer

Confidence: **99%**, source-verified. Required while overwrite is enabled.

`ImportService.ts:279-294` selects all visible transaction types from only the target account; lines 333-352 soft-delete them and reverse only that account's balance. It never calls the paired-transfer deletion path. A transfer into/out of the account in the replacement date range retains its opposite leg and balance effect, violating the otherwise enforced two-row transfer contract.

Fix: implement pair-aware replacement with authorization to both accounts and ordered locks, preserving the transfer/account reconciliation contract. Reject ambiguous or unauthorized replacement with a clear conflict and preview. Do not silently delete the other member's private counterpart to make the pair match.

Acceptance: same-currency and cross-currency transfer, either leg selected, hidden/private opposite account, concurrent edit/delete, and rollback. Surviving pairs must contain both active legs or neither; both account balances and reporting totals must reconcile exactly.

### FIN-04 — HIGH / P1: the account-detail import path cannot import any row and its repair must address sign/balance semantics

Confidence: **99%** for the active blocker; the additional sign/double-balance paths are latent defects currently masked by that blocker.

UI `client/src/components/accounts/ImportTransactionsModal.tsx:164-168` invokes the accounts API, not the global CSV service. `server/services/account/AccountImportService.ts:115` generates `csv_import:{accountId}:{date}:{merchant}:{amount}` as its key. `transaction/create.ts:52-58` queries `transactions.idempotencyKey`, a UUID column (`shared/schema.ts:1306`), with that string. PostgreSQL rejects it. The per-row catch at `AccountImportService.ts:178-185` converts the exception to `skipped`; controller lines 155-168 returns success, and the modal closes. The route tests mock the service, so they do not detect the live UUID mismatch.

**Runtime-confirmed by coordinator:** `account_detail_import` returned HTTP 200 / success true with imported0, skipped1 for a valid synthetic input row. The current source gives the UUID mismatch as the cause; server diagnostic evidence should be retained with the repro before repair.

After the UUID defect is repaired, two additional contract issues must be fixed together: line 146 passes signed negative CSV expense amounts to the positive-amount ledger instead of `abs()`, and lines 191-202 manually add `totalAmount` again even though `createTransaction` already updates account balances. Export at lines 50-61 outputs the unsigned stored `tx.amount` without its transaction type, so an expense exported and reimported becomes income.

Fix: consolidate both import UIs on one tested import contract and define whether historical imports affect current balance. Prefer a preview and explicit reconciliation rather than a second balance update. Export an unambiguous signed amount/type and currency; distinguish duplicates from invalid/error rows. Preserve legitimate repeated transactions.

Acceptance: account-detail UI → HTTP → PostgreSQL → refreshed account; expense and income round-trip, two identical-looking legitimate purchases, duplicate request, tags, malformed rows, and both advertised balance options. With opening 100, expense 10 and income 20 must finish at 110 exactly once when affecting balances. A failed import must remain visible with actionable row results.

### FIN-05 — HIGH / P1: ledger producers lose currency, and summary DTOs label converted totals as ZMW

Confidence: **99%**, source-verified. Required for the full multi-currency and multi-producer ledger contract.

Global import `ImportService.ts:199-215` and recurring materialization `RecurringProcessingService.ts:187-209` call `createWithinTransaction` without `currency`. That repository persists the supplied data without deriving currency from its locked account (`TransactionRepository.ts:287-310`). The transaction currency column is nullable with no DB default (`shared/schema.ts:1257`). Ordinary listing does not add `accountCurrency` (`TransactionQueryRepository.ts:260-297`). `mapTransactionMoney` then defaults to ZMW (`transactions.helpers.ts:26-33`), and transaction summary uses household currency for null values (`transaction/queries.ts:217,238`) rather than source account currency. USD cash changes correctly by its numerical amount while the transaction/report interpretation differs.

Separately, summary calculation uses the household base currency, but `transactions.controller.ts:164-166` calls `toMoneyDto` without `summary.currency`, so a USD household receives ZMW-labeled DTOs even when the aggregate itself is in USD. Summary also uses latest FX rates for old transactions (`transaction/queries.ts:225-228`) while historical reports use on-or-before-date rates; this requires a deliberate, visible policy.

Fix: make ledger currency a writer-enforced invariant using the locked account; reject mismatches and preserve currency through every DTO. Backfill existing null rows using an evidence-based migration; account currency mutability must be closed before relying on that backfill. Define current-value versus historical FX views and show rate dates.

Acceptance: ZMW household with USD account and USD household with ZMW account; manual, global/account import, recurring, receipt and GRZ postings; compare ledger currency, list DTO, summary DTO, account balance, budgets, dashboard and export. Missing FX must return an explicit incomplete/error state, never reinterpret units.

### FIN-06 — HIGH / P1: primary budget progress sums different currencies without conversion

Confidence: **99%**, source-verified.

`BudgetCoreService.ts:85-96` passes household currency to `BudgetQueryRepository`; lines 105-122 of that repository invoke batch spend calculation. `server/repositories/BudgetSpendBatchQueries.ts:32,70,105,143` sum raw transaction/split amounts without account currency, FX rate, or date conversion; lines 188/202 merely wrap the totals in the requested currency. Thus ZMW 100 plus USD 10 is presented as ZMW 110, not the equivalent converted amount. Recalculation (`BudgetRecalculationService.ts:96-178`) has the same raw-unit problem.

Fix: reuse a single split-aware, date-aware, fail-closed FX aggregation contract across budget progress, flex/group budgets, recalculation, rollover, cashflow comparison, report and export. Do not apply FX only to one report and leave the source budget screen incorrect.

Acceptance: independent fixture with ZMW 100 expense and USD 10 at dated USD/ZMW 20 yields ZMW 300 spent; repeat with split parent and children, missing FX, refund, excluded/pending rows and month rollover. Every screen/export must agree, or explicitly label an intentionally different basis.

### FIN-07 — HIGH / P1: “historical averages” writes the entire multi-month total as one monthly budget

Confidence: **99%**, source-verified.

`client/src/features/budget/components/BudgetSettingsModal.tsx:66,223` promises historical averages. `BudgetRecalculationService.ts:18-36` selects the prior `monthsBack` months, sums them, and lines 345-365 / 374-394 persist that total as the monthly budget. There is no division by month count. A three-month history of 100/month becomes 300/month. Transactional/concurrency tests for recalculation establish serialization, not this numerical contract.

Fix: explicitly define denominator (all requested months including zeros, or only active months), compute after FX conversion with decimal arithmetic, round once, preview old/new values, and require explicit confirmation before replacing budgets.

Acceptance: three months 100/100/100 → 100 monthly; 0/100/200 with the approved denominator; partial history, income groups, by-group and flex settings, timezone/month boundary; exact persisted and displayed amount; cancel leaves state unchanged.

### FIN-08 — HIGH / P1: editing a split transaction amount leaves budget/report child totals stale

Confidence: **98%**, source-verified.

`transactions.validation.ts:150-186` permits changing the parent amount. `transaction/service.ts:218-304` validates ordinary transaction changes but does not inspect existing splits; `TransactionRepository.ts:410-544` updates the parent and account balance but not `transaction_splits`. Split validation exists only at create (`transaction/create.ts:97-133`). Budget readers intentionally exclude parent lumps and count child rows (`BudgetSpendBatchQueries.ts:45-49,58-91`). A 100 parent split 60/40 edited to 200 decreases the account by another 100 while budget spend remains 100.

Fix: reject parent monetary changes while splits exist unless an atomic replacement split payload is supplied. One public edit contract must persist parent, split allocations, balance delta, and audit together. Do not silently scale categories without an explicit product decision.

Acceptance: parent 100 with 60/40; edit to 200 without splits rejects, with 120/80 commits; rollback after child failure leaves all old rows/balance intact; concurrent edit/delete and category/group/report totals reconciled.

### FIN-09 — HIGH / P1: goal transaction links do not preserve progress across their full lifecycle

Confidence: **97%**, source-verified; distinct defects within the same goal-link monetary invariant.

- Currency: `TransactionGoalLinkService.ts:40-42,95-105` treats the transaction amount and goal amount as default-currency numbers. `TransactionGoalLinkValidation.ts:40-93` checks type and auto-sync only, not currency or FX. Linking USD 10 to a ZMW goal adds 10 units. An explicit link amount is also not bounded by the underlying transaction amount or total allocations.
- Edit/delete: ledger update/delete (`transaction/service.ts:291-347`, `TransactionRepository.ts:581-671`) never adjusts linked contributions/current goal progress. Only assigned-account auto-sync runs. Searching transaction update/delete event use finds publishers but no consumer reconciling `transactionGoalLinks`. Deleting a linked income leaves the goal contribution counted; linked reads also do not filter soft-deleted transactions.
- Reversal: spending link clamps negative progress to zero (`TransactionGoalLinkService.ts:102-103`), but unlink adds the entire original amount (`lines 251-256`). Starting at 5, linking spending 10 produces 0, then unlink produces 10, not the original 5.

Fix: define allocated amount/currency semantics and derive progress from an auditable contribution ledger or persist the effective delta to reverse. Reject or explicitly convert cross-currency links; bound allocations if they represent actual money. Handle update/delete/unlink in one transaction under ordered goal/transaction locks, with an idempotent repair strategy for existing stale links. Manual “progress adjustment” must be a separately labeled operation if desired.

Acceptance: contribute→edit source→delete source; link→unlink gives the starting state even under overspend; currency mismatch; two goals sharing one source; retry/concurrent link and delete; completed/archived goal; private transaction visibility; read-back of goal, contribution, link and account rows.

### FIN-10 — HIGH / P1: buy/sell updates quantity but leaves the portfolio's cost basis unchanged

Confidence: **99%**, source-verified. Required for the full investment lifecycle.

Manual buy creates a tax lot (`investments.service.ts:558-569`), and sell records allocated lot disposals, but the final holding update (`lines 661-691`) changes only quantity and timestamp. `PortfolioValuationService.ts:75-92` uses `holding.costBasis` for gain/loss. A holding of 1 share at price 10 and basis 10 followed by a buy of 1 share for 10 shows value 20 and basis 10, inventing a 10 gain despite no price change. Sell leaves disposed basis in the holding, likewise corrupting unrealized return.

Fix: use remaining tax-lot basis as canonical, or atomically update aggregate holding basis in the same write transaction. Preserve local and acquired-base-currency basis; reconcile legacy initial holdings to opening tax lots.

Acceptance: buy at unchanged market price gives zero unrealized gain; two lots at different costs, FIFO partial sell and full sell, fractional quantities, fees, FX, concurrent sells/buys. Holding totals must equal remaining lots and portfolio/export read-back.

### FIN-11 — HIGH / P1: automated investment purchases cannot complete the later sell journey

Confidence: **99%**, source-verified.

`server/services/investment/processDueInvestments.ts:244-319` creates an investment buy and increases/creates a holding, but never creates a `taxLots` row (the file has no tax-lot write). Manual sell in `investments.service.ts:571-596` requires sufficient remaining tax-lot quantity and throws `Insufficient tax lot quantity` otherwise. A newly created recurring investment position therefore cannot be sold, and mixed positions may be only partly sellable.

Fix: route automation and manual purchases through the same transaction/holding/tax-lot writer, with system actor/audit and deterministic occurrence identity. Backfill cannot invent acquisition costs without evidence; mark unresolved positions for reconciliation.

Acceptance: schedule synthetic buy→run worker twice→sell full holding through HTTP→read holdings/lots/disposals; exactly one buy, matching basis, successful one-time sale; include a position combining opening/manual/automated lots.

### FIN-12 — HIGH / P1: investment schedules miss overdue executions and drift past month-end

Confidence: **99%**, source-verified.

`processDueInvestments.ts:28-37` selects only `nextExecutionDate === today`, and the locked guard at line 123 repeats equality. If the service is down or a provider error survives midnight, yesterday's plan is never selected again. `calculateNextDate` at lines 40-70 uses `Date.setMonth` / `setFullYear` without retaining an anchor or clamping; a January 31 monthly execution advances into March, skipping February.

Fix: choose and document catch-up behavior (replay each missed occurrence, one current catch-up, or explicit skipped state), use a due-on-or-before query plus bounded catch-up, preserve calendar anchor/day and timezone, and surface overdue/failed plans with retry controls. Keep per-occurrence lock/key and audit; do not silently backdate real trades.

Acceptance: worker unavailable for one and multiple dates; provider outage crossing midnight; Jan31/Feb28/Feb29, quarterly/annual leap day; two workers racing; pause/end-date; stock versus T-bill path. Approved catch-up policy must produce explainable dates with no duplicate holdings.

### FIN-13 — HIGH / P1: account edits can reinterpret existing money without ledger reconciliation

Confidence: **98%**, source-verified.

`accounts.validation.ts:101-109,134-148` allows partial edits to account type, currency, and initial balance. `AccountCoreService.ts:184-232` rejects only direct `balance`, then forwards the rest. Repository update is a direct set (`AccountRepository.ts:160-213`). Currency therefore relabels a nonempty account without converting balance/history/transactions. Type changes do not recompute `isAsset`, which is calculated only at creation (`AccountCoreService.ts:135-143`), while net-worth classification uses that flag (`AccountReportingService.ts:88-91`). A checking account changed to credit can remain classified as an asset.

Fix: freeze denomination after opening/ledger activity, or create a separately authorized migration/reconciliation operation. Derive liability/asset status from validated type atomically; block unsafe transitions. Opening-balance edits must produce reconciled adjustments or be disallowed once history exists.

Acceptance: USD account with history cannot silently become ZMW; checking→credit either rejects or updates all declared semantics; opening balance edit reconciles balance history; unchanged edits work; version conflicts handled.

### FIN-14 — HIGH / P1: missing portfolio FX returns a successful but understated net worth

Confidence: **99%**, source-verified.

`PortfolioValuationService.ts:57-71` correctly throws when a holding's FX rate is missing. `AccountReportingService.ts:95-122` catches every valuation error and returns account balances without the holdings, T-bills or pensions. The household variant repeats this at lines 194-221. No response completeness flag tells the caller that assets disappeared. Consequently the low-level fail-closed repair is undone by a higher-level success fallback.

Fix: propagate a typed incomplete-valuation state/error with missing currencies and last valid timestamp; do not call a partial total “net worth”. If partial account cash is useful, label it explicitly and keep the total absent. Ensure retry and restored-rate cache invalidation recover the complete number.

Acceptance: account cash 100 plus foreign holding worth 200 equivalent; remove FX → explicit incomplete/error state rather than net worth 100; restore FX → 300; provider failure and missing security price handled distinctly. User-private holdings must stay excluded for other members (FIN-01).

### FIN-15 — HIGH / P1: CSV accepts nonexistent dates and silently chooses US ordering for ambiguous dates

Confidence: **100%** for the actual parser behavior, executed pure function at this revision.

`server/services/import/parse.ts:86-126` tries native `new Date(original)` first and only tests that the resulting date exists. It does not round-trip the supplied calendar components, and ambiguous slash dates never reach the `dd/MM/yyyy` fallback when native US parsing succeeds. Direct execution of current `parseRows` with synthetic inputs returned:

```text
input 2026-02-30 / -10 => persisted candidate date 2026-03-02 / 10.00
input 01/02/2026 / -20 => persisted candidate date 2026-01-02 / 20.00
errors: []
```

Probe used `node --import tsx -e` to require `server/services/import/parse.ts` and call `parseRows`; no database/application server was imported or written. Wrong dates affect monthly budgets, imports' destructive replacement windows and report periods.

Fix: explicit date format selection/detection confirmed in preview; reject impossible dates through strict round-trip validation; store date-only values independent of server timezone. Never infer one convention from a single ambiguous row.

Acceptance: ISO valid/invalid, dd/MM and MM/dd selected explicitly, leap days, US and Lusaka server timezones, Excel-like formats if advertised, and clear per-row errors. Overwrite boundaries must come only from valid confirmed rows.

### FIN-16 — MEDIUM / P2: transaction UPDATE audit is not atomic despite its documentation

Confidence: **99%**, source-verified. Durable audit is part of the full completion contract; a documented operational limitation does not establish atomicity or close this finding.

`transaction/service.ts:291-298` waits for `transactionRepository.update` to commit, then logs later at lines 335-347 without `tx`. The comment explicitly says the audit logger catches its own error. A process stop/audit insertion failure between these operations leaves a persisted financial change without an audit row. Method/controller comments nevertheless claim atomic audit. Existing P8b real-DB tests establish ordinary audit presence, not failure rollback.

Fix: generate the before/after diff under the repository's row lock and insert the audit in the same transaction (or durable transactional outbox if asynchronous processing is intentional). Eliminate misleading comments. Failure-injection test must assert both mutation and audit commit/rollback together.

### FIN-17 — HIGH / P1: transaction summary remains stale after successful financial writes

Confidence: **99%** for server causal path; browser outcome observed by coordinator.

`server/services/transaction/queries.ts:188-281` caches summary in the core cache under a custom `txn-summary:{household}:...` key for `TTL.MEDIUM` (five minutes). Transaction mutation calls `invalidateOnChange`, but `server/services/CacheInvalidation.ts:13-28,74-78` invalidates only the distinct `AnalyticsCache`. `server/services/AnalyticsCache.ts:157-167` targets `analytics:{endpoint}:...` and immediately returns when Redis is absent. It cannot remove the core summary entry. A repository-wide search found no call to core `invalidateTag`/`invalidateTags`/`invalidatePrefix` outside their definitions/exports.

The coordinator also identified a client mismatch: the page query key is `['transactionSummary', ...]` (`client/src/pages/Transactions/index.tsx:173`), while transaction mutation invalidation targets `['transactions']`. In its fresh browser household, a successfully created 125.50 expense appeared in the transaction list, while the summary still showed zero expenses/zero transactions after reload. This observed behavior is consistent with the separate server cache surviving reload until its TTL.

Fix: centralize client financial query keys and invalidate all affected views after commit; centralize server mutation-to-cache invalidation across both cache families, await completion, and make it work across instances and without Redis. Merely refetching the client summary still retrieves stale server data. Prefer generation/version-based household cache keys or a shared invalidation mechanism over process-local tag registries for distributed deployment.

Acceptance: fetch zero summary; create125.50 expense; immediately list+summary+dashboard must agree; repeat for edit/delete/import/transfer/category and pending-filter changes. Run with no Redis, Redis, and two application instances. Do not wait five minutes in the test or disable caches to make it pass.

### FIN-18 — HIGH / P1: Annual Dashboard monthly trends misparse the API's month label and lose grouped values

Confidence: **99%**, source-verified; repeated `Invalid Date` labels independently observed by the coordinator in the real browser journey.

`server/repositories/reports/CashflowReportRepository.ts:254-259` emits an ISO `periodStart` separately from a display `label`, such as `Jan 2026`. `CompositeReportRepository.ts:164-182` maps that display label to the annual DTO's `month` and provides a separate numeric `monthIndex`. `shared/reports.ts:53-55` declares both fields. The normal `useReportsAnnual` hook forwards this response unchanged (`client/src/hooks/use-reports.ts:438-455`). But `client/src/components/reports/MonthlyTrendsWidget.tsx:11-13,32-37` splits `month` as if it were ISO `YYYY-MM-DD` and calls `new Date` with nonnumeric/missing parts, producing `Invalid Date` and `NaN` month indexes.

This affects financial interpretation as well as labels. Quarterly and biannual grouping filters at widget lines 59-84 match no `NaN` indexes and show zero for every group, although the raw annual data contains expenses/income. Monthly line and area modes deduplicate x-values and choose the first matching point (`MonthlyTrendsChart.tsx:112-118`): all twelve identical `Invalid Date` labels collapse to the first month's values. Annual sum mode uses raw amounts and is not subject to the month-index failure. The coordinator's fresh household showed a correct annual expense of 125.50 and net worth of 874.50 but repeated invalid month labels; the zero grouped totals and collapsed series are source-confirmed consequences, not separately claimed browser observations.

Fix: use the explicit, validated `monthIndex` with the report year, or add a typed ISO period key to the annual DTO. Keep period identity separate from localized display labels, and preserve distinct period keys in chart transformations. Avoid locale-dependent parsing. The dashboard unit test mocks this widget (`client/src/components/reports/__tests__/AnnualDashboard.test.tsx:71`); the test named `annualDashboard.e2e.test.tsx` uses mocked data with `Jan`/`Feb`/`Mar` strings at lines 38/50/62. Neither substitutes for exercising the real producer-to-widget contract.

Acceptance: seed independently known income/expense/savings in January, October and December; use the actual `/api/reports/annual` response through `/reports`. All 12 labels must be valid and distinct; bar, line and area modes must retain all months; Q1-Q4, H1-H2 and annual totals must match independent expected sums. Assert an October 125.50 expense appears in October, Q4, H2 and annual totals, including when January is zero. Repeat around year boundaries and in at least two browser timezones; no `Invalid Date`, duplicate period identity, or zeroed grouping is acceptable.

## Additional product contracts and verification gaps

These are not counted as confirmed defects without an approved expectation:

- **Global deduplication:** `import/dedupe.ts:21-24` intentionally treats any same-date/type/amount row as the same transaction in `prioritize_coppercoin`, ignoring merchant/notes. Characterization tests preserve this behavior. Two legitimate 20-unit purchases at different merchants can collapse. Decide statement-ID/multiset matching and provide reviewable duplicate decisions; changing frozen keys requires migration/compatibility design.
- **Imports with invalid rows:** global overwrite proceeds with valid rows while reporting invalid ones. A user expecting file-level replacement can lose an existing record corresponding to a rejected CSV row. The completion specification should require preview + explicit partial-import confirmation, and no destructive replacement until all relevant rows are resolved.
- **Budget privacy and pending semantics:** current budget queries are household-wide, lack account/private filtering, and include pending amounts; a private-data aggregation policy must be explicit. Current totals can disclose private spending by difference. If household budgeting intentionally includes private totals, this needs clear user consent and consistent route boundaries, not accidental query behavior.
- **Goal semantics:** free-standing contribution is a progress record, not a bank transfer. Investment-goal contribution writes an investment `transfer_in` without buying holdings; the UI and explanation must make that distinction clear. Do not treat missing cash debit as a defect until the product contract chooses one.
- **GRZ holding creation:** current requirement explicitly says record-only at `docs/features/requirements/investment-requirements-v2.md:355`. Preserve that decision. Coupon/maturity income is separate. Do not “repair” record-only creation by debiting cash twice.
- **Investment yield fallback:** automated T-bill rollover in `processDueInvestments.ts:160-179` uses 15% when no live auction yield is available and creates an active recorded bill. A logged fallback is not sufficient user disclosure. Decide whether automation records an estimate pending confirmation or must fail until an actual trade yield exists.
- **Refund convention:** the public ledger uses positive absolute amounts plus income/expense type. Define refunds as expense reversals versus income and test budgets/cashflow accordingly; do not silently invent a new accounting convention during remediation.
- **Retention and deletion:** source confirms soft deletion for ledger and accounts. Existing synthetic data, restored backups, exports and linked goal/investment records need explicit lifecycle tests before retention/deletion claims.
- **Receipt/OCR transaction creation:** owned by the broader assessment; it must feed the same account currency, sign, visibility, deduplication, audit and balance acceptance fixture, not only test text extraction.
- **Fixed/variable classification coverage:** `CashflowReportRepository.ts:406-413,474-489` classifies category breakdown items. The category path uses inner category/group joins (`SpendingReportRepository.ts:160-162`), so uncategorized expenses contribute no classification item even though the separate monthly query retains an `uncategorized` bucket. `ExpenseClassificationWidget.tsx:122,137,205-207` labels zero classified total as “No expense data” and suggests adding transactions. This explains the coordinator's 125.50 uncategorized expense appearing in annual totals while classification is empty; it is not counted as a confirmed classification arithmetic defect without a policy for uncategorized data. Decide whether to include an explicit unclassified segment or state “No classified expenses” with a categorization action. Acceptance must distinguish zero overall expenses from nonzero uncategorized expenses and reconcile classified plus unclassified coverage to the eligible total.

## Historical reconciliation

| Prior finding / claim | Current evidence | Reconciliation |
|---|---|---|
| July W1: view-only global import allowed, private target writable, unbounded rows, invalid numeric parsing, no balance/audit | `routes/import.ts:14,35-36,136-163`; `import/parse.ts:26-78`; `ImportService.ts:199-257`; `routes/__tests__/import.execute.realdb.integration.test.ts` | Original specific controls are present; source-resolved, current execution result must come from coordinator. W1 is **not** whole-import correctness: FIN-02/03/04/05/15 remain |
| Historical transfer race/double delete and account overdraft risks | `TransactionRepository` ordered account locks/conditional reversal; transfer pair transaction; real-DB transaction and race suites | Meaningful source repair and test coverage exist. Import bypass reopens pair invariant through a different caller (FIN-03) |
| Historical recurring materialization race/nonatomic create/link/advance | `RecurringProcessingService.ts:160-279`; `processRecurring.materialization.realdb.integration.test.ts:222,260,293` | Source-resolved for overlapping same occurrence, tests defined; not proof of currency/catch-up/owner behavior |
| Historical GRZ raw float monetary path and no audit | `grz-service.ts` uses Money/Decimal; atomic maturity and route audit paths; `grz-money`, `grz-audit`, `grz-record-only`, `grz-securities.sell-race` tests | Former broad statement is superseded by code improvements. External tax/convention validation and deployed worker outcomes still unverified |
| July W4 GRZ holding cash decision | Requirement line 355 and real-DB `grz-record-only` test | Record-only is recorded product contract, not unfinished debit logic |
| Historical FX `rate=1` fallback | `BaseReportRepository.ts:78-90,162-260`, `PortfolioValuationService.ts:57-71`, net-worth snapshot guard | Several exact low-level paths repaired; FIN-05/06 raw-unit callers and FIN-14 outer catch remain. Do not claim global FX closure |
| Historical budget recalculation nonatomic writes/race | `BudgetRecalculationService.ts:278-396` writes in a transaction with household lock; atomicity and race tests exist | Atomicity repair present; numerical monthly-average and FX contract still wrong (FIN-06/07) |
| Prior “transactions UPDATE audit atomic” assertion | `transaction/service.ts:291-347` calls audit after repository returns | Refuted at current source; FIN-16 |
| Prior positive investment sell quantity/household tests | `investments.sell-overdraft.realdb.integration.test.ts:273`, holdings ownership and sell lock in service | Useful but narrower than whole lifecycle: private-account access, cost-basis reconciliation and automated-buys-to-sell missing (FIN-01/10/11) |

## Completion work packets

All estimates below are **primary-developer working days**, include focused tests and review, and exclude environment/deployment work and calendar waiting. They are ranges, not a promise. Parallel execution would need explicit ownership and integration capacity. No remediation is authorized by this assessment.

| Packet | Outcome / dependencies | Files / contract changes | Acceptance and estimate |
|---|---|---|---|
| MONEY-A: one financial visibility policy | Close FIN-01 before multi-user use; owner decides private aggregate policy | Goal read/link/unlink services, investment controllers/service/valuation, account export and repositories; pass actor identity, centralized SQL predicates and transactional write authorization | 3-5 days; A/B/view-only/C matrix over every indirect path; private amount/name never returned; authorized workflow preserved |
| MONEY-B: unified replay-safe import | Close FIN-02/03/04/15; depends on stable currency/account and ledger invariants | Account/global import UI + APIs/services; one strict mapping/preview/sign/date/currency contract; batch identity and exact outcome per row; pair-aware transfer preservation/replacement | 3-5 days; both browser entry points, repeat/concurrent imports, expenses/income, malformed dates, valid duplicates, transfers, rollback, signed export round-trip |
| MONEY-C: ledger denomination and split invariants | FIN-05/08/13; prerequisite for safe backfills | Transaction repository derives/requires locked-account currency; schemas/DTOs carry it; account denomination transition contract; atomic split-edit API; additive backfill/check migration after dry-run | 2-4 days; independent cross-module mixed-currency fixture; amount=sum(splits); balances match signed movements; no unsafe account relabel |
| MONEY-D: budget arithmetic contract | FIN-06/07; depends on MONEY-C and FX policy | Shared split/date/FX aggregate; progress/recalc/flex/rollover/export callers; historical-average denominator and preview | 1.5-3 days; 100/100/100→100; ZMW100+USD10@20→ZMW300; zero months, group/flex, pending/refund/exclusion and month-end |
| MONEY-E: reversible goal progress | FIN-09; privacy MONEY-A and currency MONEY-C first | Link allocation ledger or effective deltas, source edit/delete reconciliation, visibility-safe reads, deterministic repair tool in isolated environment | 2-4 days; contribute/edit/delete, overspend link/unlink returns baseline, two-goal allocation, concurrency, auto-sync versus manual semantics |
| MONEY-F: canonical investment lots/basis | FIN-10/11; depends on MONEY-A/C | Common manual/automation writer, remaining-lot basis, legacy holding reconciliation, tests and user explanation of record-only cash | 2-4 days; buy→automate→sell→report same independent expected basis, fractional/FX/multi-lot/concurrent paths |
| MONEY-G: reliable schedule recovery | FIN-12 and recurring catch-up policy; depends on chosen user-confirmed trade semantics | Due-on-or-before scan, explicit anchor/timezone, bounded catch-up, missed/failure status and retry; shared schedule helper | 1-2.5 days; outages over midnight, Jan31/leap day, two workers, pauses/end dates, no duplicates |
| MONEY-H: complete valuations and durable audit | FIN-14/16; depends on MONEY-A/C | Typed completeness/error UI+API for valuation; audit written with transaction mutation/locked snapshot | 1-2 days; missing FX never yields apparently complete partial net worth; injected audit failure rolls back or leaves durable outbox; restore rate refreshes total |
| MONEY-I: financial read-after-write consistency | FIN-17; implement alongside MONEY-C, exercise every producer | Shared query keys; one cache invalidation contract covering core and analytics stores; distributed/no-Redis behavior | 0.5-1.5 days; immediate summary/list/dashboard agreement after each committed write, including two instances and reload |
| MONEY-J: trustworthy report period grouping | FIN-18; can proceed independently of MONEY-C using an existing same-currency fixture | Annual DTO period identity, MonthlyTrendsWidget transformations and chart keys; real response-to-chart coverage | 0.5-1 day; Jan/Oct/Dec values survive every chart type and monthly/quarterly/biannual/annual aggregation with valid labels |

Full financial repair estimate: **16.5-32 developer-days**, before wider authentication, UX, staging, backups, UAT and release work. This is a financial workstream estimate, not a whole-app delivery date. All packets remain required for the user's full-functionality target. Sequence by dependencies and verified exit gates; use the coordinating completion plan for the overall schedule.

Completion requires accounts, transaction CRUD and splits, same/cross-currency transfers, both import/export entry points, budgets and rollover, goals and transaction links, manual/automated investments, recurring processing, GRZ lifecycles and reports to pass their complete journeys. Hiding or disabling a broken surface does not close this assessment. Existing record-only GRZ creation is a deliberate contract to preserve; implementing actual broker execution or bank settlement would be a separate enhancement, not an inferred requirement. Product decisions above must resolve ambiguous behavior without removing the affected feature.

## Independent acceptance dataset and release proof

Create this only in the coordinating task's verified disposable database. Keep the expected ledger in a separate fixture document/calculator, not generated by the application formula under test.

1. Household H in ZMW, owner A, member B, viewer V; household J/member C; shared checking opening 1,000, shared savings opening 200, A-private account opening 500, and USD account opening USD 100 if multi-currency is enabled.
2. Checking income 300, expense 120 split 70 groceries/50 transport; same-currency checking→savings transfer 100. Expected balances: checking 1,080, savings 300. Income 300 and expense 120; transfer is neither. Categories and budgets see 70/50, never 120+70+50.
3. Edit expense to 150 with 90/60 split: checking 1,050 and spend 150. Delete it: checking 1,200 and spend 0. Delete transfer: checking 1,300 and savings 200. Each reverse happens once under concurrent retries.
4. USD 10 expense at a stored date-specific USD/ZMW rate 20: USD balance 90; ZMW equivalent spending 200. Missing FX never produces 10 ZMW or a complete-looking partial total. Explicit current-value views can use a different rate only if labeled.
5. Same CSV through both entry points twice; opening 100 + income20 - expense10 =110 once. Nonexistent calendar date rejected; ambiguous dates require chosen format; two legitimate equal purchases remain two. Transfer overwrite blocked or pair-reconciled; failed batch has no partial deletion.
6. Goal start5, spending-link10→unlink must return5 under the approved progress semantics. Linked income changed/deleted and mixed-currency link must preserve the declared allocation invariant. All indirect reads checked as B/V/C.
7. Investment 1 share/basis10 at price10; buy1@10 yields value20/basis20/unrealized0. Automation adds1@10 and must create a sellable lot; sell2@12 gives proceeds24, FIFO basis20, realized4, remaining1/basis10. Record-only cash remains explicitly distinct.
8. Restart jobs after a missed day/month end, replay same occurrence, and inject failure between writes. Compare final rows, account balances, lots/links, audit and read-back on dashboard/accounts/transactions/budgets/cashflow/reports/export.

Required evidence for financial go: exact candidate SHA, disposable fixture identity, independent expected values, API responses and database assertions, browser screenshots/results, two-writer probes, no unresolved P0/P1 across the full agreed financial scope, and equivalent staging execution after migration/restore rehearsal. Existing green CI alone does not satisfy this gate.

## Review Summary

| Severity | Count | Status |
|----------|-------|--------|
| CRITICAL | 3 | block |
| HIGH | 14 | warn |
| MEDIUM | 1 | info |
| LOW | 0 | pass |

Verdict: **BLOCK — 3 critical findings and 14 high findings affect enabled financial paths.** Findings are consolidated by invariant, and several span multiple endpoints. Goal-linked privacy disclosure, destructive overwrite replay and failed account-detail import have isolated runtime evidence; the overwrite also has database read-back. Stale transaction summaries and invalid monthly report labels have browser evidence with source-confirmed causes. Other findings need their stated acceptance tests; staging proof remains outstanding.
