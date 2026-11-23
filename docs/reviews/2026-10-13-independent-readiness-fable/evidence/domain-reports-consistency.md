# Domain report: reports-consistency (read models vs ledger)

Agent: `reports-consistency` | Revision: main @ 381e943 | Audit server http://localhost:5055, DB `finance_app_audit_fable_20261013`
Fixture user: jar `a4` (audit_a4_reports, household "A4 Reports Household" 135744ff-..., base currency ZMW). Run date 2026-10-14 (Africa/Lusaka).
Scratch: `.local/readiness-fable-2026-10-13/scratch-reports-consistency/` (seed.mjs, expected.json, raw responses).

Status: COMPLETE (2026-10-14 00:37 Lusaka). Verdict: read models do NOT agree with the ledger — 1 P0, 8 P1, 4 P2, 2 P3 (RC-13 also carries a P2 format issue).

## 1. Fixture (posted via HTTP, read back from DB)

Accounts (initial balance, no opening-balance transaction is created): A4 Checking ZMW 10000.00; A4 Savings ZMW 2000.00; A4 USD (USD) 100.00; A4 Credit Card (type `credit`, ZMW) 500.00 entered positive as the client `AddAccountModal` sends it; A4 Private ZMW 300.00 (`isPrivate:true`, owner a4).
Categories: group Income(income){Salary}; group Living(expense){Groceries, Dining, Utilities, Transport, Entertainment}. Merchants: Shoprite, Zesco, Pizza Inn.

| Key | Date | Type | Account | Amount | Category / merchant |
|---|---|---|---|---|---|
| T1 | 2026-09-01 | income | CHK | 15000.00 | Salary |
| T2 | 2026-09-05 | expense | CHK | 1234.56 | Groceries / Shoprite |
| T3 | 2026-09-12 | expense | CHK | 33.33 | Utilities / Zesco |
| T6 | 2026-09-15 | expense | CC | 45.50 | Dining / Pizza Inn |
| T4 | 2026-09-20 | expense | CHK | 0.01 | Dining / Pizza Inn |
| T5 | 2026-09-30 (last day of last month) | expense | CHK | 250.75 | Transport |
| T7 | 2026-10-01 | income | CHK | 15000.00 | Salary |
| T8 | 2026-10-01 | expense | CHK | 99.99 | Groceries / Shoprite |
| T9 | 2026-10-07 | expense split | CHK | 200.00 = 120.00 Groceries + 80.00 Entertainment | - |
| T13 | 2026-10-09 | expense | PRIV (private acct) | 12.34 | Dining |
| T10 | 2026-10-10 | transfer CHK->SAV (needed password step-up) | | 1000.00 | - |
| T11 | 2026-10-11 | expense | USD | 25.00 USD | Entertainment |
| T12 | 2026-10-14 (today) | expense | CHK | 333.33 | Utilities / Zesco |

Transaction-level `isPrivate` is NOT settable through `POST /api/transactions` (field absent from `createTransactionBaseObjectSchema`, transactions.validation.ts:87-113); privacy is only reachable via a private account, so T13 sits on a private account.

Hand-computed expectations (integer-cent script `expected.mjs`, never the app's code):

| Metric | Sep 2026 | Oct 2026 (to 31st) |
|---|---|---|
| Income ZMW | 15000.00 | 15000.00 |
| Expenses ZMW (excl. USD, excl. transfer) | 1564.15 | 645.66 (+ 25.00 USD x rate) |
| Net | 13435.85 | 14354.34 (- 25 x rate) |
| Savings rate | 89.5723 % | 95.6956 % (excl. USD) |
| Groceries / Utilities / Dining / Transport / Entertainment | 1234.56 / 33.33 / 45.51 / 250.75 / 0 | 219.99 / 333.33 / 12.34 / 0 / 80.00 + 25 USD |
| Merchants | Shoprite 1234.56, Zesco 33.33, Pizza Inn 45.51, none 250.75 | Shoprite 99.99, Zesco 333.33, none 212.34 ZMW + 25 USD |

Expected balances: CHK 36848.03, SAV 3000.00, USD 75.00, PRIV 287.66 (DB read-back matched all four to the cent). CC: true amount owed after a 45.50 charge is 545.50; the DB holds **454.50** (see RC-03).
Net worth ZMW excl. USD = 40135.69 assets - 545.50 owed = **39590.19** (the app's own arithmetic would give 39681.19).

## 2. Read model vs ledger: reconciliation matrix (after FX rates present)

Raw responses: `scratch-reports-consistency/{nofx,fx_inverse,fx_late,fx}/*.json`. FX state for this matrix: USD->ZMW 25.1234 @2026-10-01 (mine), 26.5432 @2026-10-12 (mine), 26.5000 @2026-10-13 (inserted by ANOTHER audit agent's household seconds before mine — see RC-02). Correct as-of conversion of T11 = 25 x 25.1234 = 628.085 -> 628.09.

| Endpoint | Sep expenses | Oct expenses | Other | vs ledger |
|---|---|---|---|---|
| Hand-computed | 1564.15 | 1273.75 (645.66 + 628.09) | Oct net 13726.25 | - |
| `GET /api/transactions/summary` | 1564.15 (endDate=09-30 inclusive) | **1308.16** (USD @26.50 = latest rate dated 10-13, after the txn) | count 8 includes both transfer legs | Oct WRONG by +34.41 |
| `/api/reports/cashflow` (interval=month) | **1518.65** + `debt` 45.50 | 1273.75 | Oct `savings` **13726.26** (should be 13726.25) | Sep WRONG (CC purchase moved to "debt") |
| `/reports/income`, `/reports/savings-rate` | 1518.65 | 1273.75 | savings-rate Sep 89.57 / Oct 91.51 | same as cashflow |
| `/reports/spending/trend` | **1518.65** | 1273.75 | totals 2792.40 | Sep WRONG (CC excluded) |
| `/reports/spending/breakdown` category | 1564.15 (all 5 categories exact) | 1273.75 (Ent 708.09, Util 333.33, Groc 219.99, Dining 12.34) | splits allocated correctly | MATCH |
| `/reports/spending/breakdown` merchant | "total" **1313.40** | "total" **433.32** | no "no merchant" bucket; percent computed on the partial total | total disagrees with spend (P2) |
| `/reports/cashflow/budget` (Oct) | - | totalActual **1073.75** (Groceries 99.99, Entertainment 628.09) | split T9 (200.00) missing from every category | WRONG by -200.00 |
| `/reports/annual` 2026 | expenses 2792.40 | | `debtPaid` 45.50 (a credit-card PURCHASE labelled debt paid); `savingsContributions` 27162.11 vs `netSavings` 27207.60 | WRONG (CC) |
| `/reports/transactions` Oct | 6 rows Sep OK | **5 rows** — split T9 absent | | WRONG (row missing) |
| `/reports/expenses/classification` Sep-Oct | total 2837.90 | | Groceries 1454.55, Utilities 366.66 | MATCH |
| `/reports/sankey` Oct | | expenses **1073.75**, savings **13926.26** | split omitted; savings off by a further 0.01 | WRONG by -200.00 |
| `/reports/ratios` Oct | | monthlyExpenses 1273.75 | `liquidAssets` **40210.69** = 40135.69 ZMW + **75 USD counted as 75 ZMW**; savingsRate.savings 13726.26 vs netSavingsRate.netSavings 13726.25 in the same payload; `monthlyDebt` 37.88 = 454.50/12 | WRONG — silent FX at 1.0 (P0) |
| `/api/accounts/summary` | | | assets 42123.19 (USD @ latest 26.50), liabilities **454.50**, NW 41668.69 | liabilities WRONG (RC-03); true NW 41577.69 |
| `/reports/net-worth`, `/accounts/net-worth/history` | | | single snapshot point dated **2026-10-13** (UTC) while local date is 2026-10-14; NW 41668.69 | inherits RC-03; no history |
| `/reports/net-worth/changes` | | | totalChange 0.00, periods [] | no ledger-derived history (P2) |
| `/reports/forecast` net-worth 3m | | | flat 41668.69 (1 baseline month) | sane |
| `GET /api/weekly-recap` (with rates) | | week "2026-10-10..2026-10-17" spend 961.42 (628.09 + 333.33) | | numbers match; window is 8 days (RC-09) |
| `GET /api/weekly-recap` (NO rate) | | spending.total **0**, hasData false, netWorth.current **0**, changePercent -100 | HTTP 200 | silently wrong (RC-07) |
| Dashboard "this month" widgets (client range) | | client sends from=**2026-09-30** to=**2026-10-30**: total **1524.50** (= 1273.75 + Sep-30 bus 250.75) | | WRONG (RC-08) |

## 3. Findings

Impl = implementation status of the correct behaviour; Ver = how the defect was verified.

| ID | Surface | Expected (source) | Observed | Impact | Sev | Conf | Impl / Ver |
|---|---|---|---|---|---|---|---|
| RC-01 | `GET /api/reports/ratios` (`liquidAssets`, `currentLiabilities`, emergency fund, burn rate, liquidity) and `/reports/debt` | Every multi-currency aggregate converts or fails closed (CLAUDE.md Rule 1 FX note, SCP-321) | `liquidAssets` **40210.69** = ZMW 40135.69 + USD balance 75.00 added as **75 ZMW** (at the 26.50 latest rate it should be 42123.19). Source: `server/repositories/reports/AnalyticsRatiosRepository.ts:46-62` selects `accounts.balance` with no currency column and sums `moneyFromValue(a.balance, currency)` in household currency, an implicit rate of 1.0; same pattern at :66-81 and in debt analysis :185-216. These queries also apply no `is_private`/`owner_user_id` or hidden filter, so in household scope another member's private accounts enter the ratios (SRC only; single-member fixture). `monthlyDebt` = total liabilities / 12 (37.88), an invented figure. | Silent FX fallback; with a USD 10,000 account the emergency-fund months are off by a factor of ~26 | **P0** | High | MISSING / HTTP+SRC |
| RC-02 | `fx_rates` is global; `POST /api/investments/fx-rates` (role `member`) | A household's reports depend only on that household's data | `fx_rates` has no household column (`shared/schema.ts:2654-2664`); `investments.service.ts:242-255` inserts with no household. Proof: a rate **26.5000 @2026-10-13 inserted by `audit_a3_invest` ("A3 Investments Household")** changed THIS household's `/api/accounts/summary` (USD 75 -> 1987.50) and `/api/transactions/summary` (Oct expenses 1308.16). Any member of any household can rewrite every household's net worth and summaries. | Cross-tenant integrity: one user can falsify all users' totals | **P1** | High | MISSING / HTTP+DB |
| RC-03 | Liability accounts (credit/loan/mortgage) balance sign | A card charge increases the amount owed | Client sends the owed amount positive (`AddAccountModal.tsx:136-143`); `TransactionRepository.calculateBalanceDelta` (:105-123) applies `expense => -amount` regardless of `isAsset`; readers take `abs()` (`AccountReportingService.ts:88-91`, `NetWorthReportRepository.ts:261`). CC 500.00 + 45.50 charge => DB balance **454.50**; accounts summary liabilities 454.50, NW **41668.69** vs true **41577.69** (error 91.00 = 2 x 45.50). | Every card purchase makes the user look richer by twice the purchase | **P1** | High | MISSING / HTTP+DB |
| RC-04 | Cash-flow family: `/reports/cashflow`, `/income`, `/savings-rate`, `/spending/trend`, `/annual`, dashboard CashFlowWidget | One definition of "expenses" across read models | Expenses on liability accounts go to a `debt` bucket (`CashflowReportRepository.ts:143-163`), so Sep "expenses" = **1518.65** vs 1564.15 in `/transactions/summary`, `/spending/breakdown`, `/expenses/classification`. `/annual` labels the 45.50 **purchase** as `debtPaid`. Rows do not foot: Sep income 15000 - expenses 1518.65 = 13481.35 but `savings` = 13435.85. | Card spenders see understated spending; "debt paid" is the opposite of what happened | **P1** | High | PARTIAL / HTTP+SRC |
| RC-05 | Split transactions in `/reports/cashflow/budget`, `/reports/transactions`, `/reports/sankey`, transactions CSV, budget CSV | A split counts once, as its split rows | Split parent excluded by `NOT EXISTS (transaction_splits)` (`BaseReportRepository.ts:283-286`, `TransactionReportRepository.ts:108-111`, `SankeyNodes.ts:63-66`) but these readers never add the split rows. Oct budget actual **1073.75** (missing 200.00: Groceries 99.99 not 219.99, Entertainment 628.09 not 708.09); transactions report + CSV: T9 absent; Sankey expenses 1073.75. `/spending/breakdown` and `/expenses/classification` DO include splits (correct). | Budgets under-report, exports omit real spending | **P1** | High | PARTIAL / HTTP+SRC |
| RC-06 | `GET /api/transactions/summary` FX policy and cache | Same rate-date policy as reports (`rate.date <= txn.date`, `fxRateExpr.ts`); read-after-write | Uses `getLatestFxRates` (`services/transaction/queries.ts:63-96`): T11 (2026-10-11) converted at 26.50 dated 2026-10-13 => Oct expenses **1308.16** vs **1273.75** in every report (diff 34.41). With only a rate dated after the txn it returned 200 while reports failed closed. `withCache` TTL 5 min (`queries.ts:188,276`) is not cleared by `invalidateOnChange` (clears `analyticsCache` only): after posting 7.77 the summary stayed **1308.16** for ~5 min (measured 22:31:05Z -> 22:36:16Z) while reports moved to 1281.52 immediately. | Two headline totals for one month disagree; stale up to 5 min after a write | **P1** | High | PARTIAL / HTTP+SRC |
| RC-07 | `GET /api/weekly-recap` when a read model throws | Surface the error (CLAUDE.md: never swallow) | With no USD rate: HTTP **200**, `spending.total 0, hasData false, netWorth.current 0, changePercent -100`, although 333.33 ZMW + 25 USD were spent that week. `weekly-recap.service.ts:209-212, 264-267, 314-318` catch and return zeros; same data feeds the recap email. | Silently false recap and email | **P1** | High | MISSING / HTTP+SRC |
| RC-08 | Dashboard date ranges (`useCurrentMonthRange`, `useLastNMonthsRange`, `client/src/hooks/use-reports.ts:1118-1180`, 23 call sites) | "This month" = 1st..last day in the user's zone | `new Date(y,m,1).toISOString()` in UTC+2 yields **2026-09-30 .. 2026-10-30** (proved with `TZ=Africa/Lusaka node`). Server answer for that range: **1524.50** (includes the Sep 30 bus 250.75; Oct 31 would be dropped). `useLastNMonthsRange` `to` = UTC date, so 00:00-02:00 local it ends yesterday. | Every month-scoped dashboard widget includes the previous month's last day for all users east of UTC | **P1** | High | MISSING / SRC+HTTP |
| RC-09 | Weekly recap window, net-worth snapshot date | Local calendar dates | `formatDate = toISOString().split('T')[0]` (`weekly-recap.controller.ts:117-119`): week reported **2026-10-10..2026-10-17** (8 days; the Sunday-start week is 10-11..10-17). Net-worth snapshot/history point dated **2026-10-13** while local date is 2026-10-14. | Off-by-one-day windows | P2 | High | PARTIAL / HTTP+SRC |
| RC-10 | Missing-rate error shape | A typed, actionable 4xx | Fails closed (good) but: `/transactions/summary` 400 VALIDATION_ERROR; all `/reports/*` **500 INTERNAL_ERROR** with `debug` text; `/accounts/summary`, `/accounts/net-worth/history` **500 "An internal error occurred"** (CalculationError). One foreign-currency account without a rate takes down the dashboard, net worth and every report. Inverse rows (ZMW->USD 0.04) are never used. | Dashboard outage for any multi-currency household | P2 | High | PARTIAL / HTTP |
| RC-11 | Rounding / footing | Displayed parts sum to totals | Converted rows aggregated unrounded: Oct cash-flow expenses 1273.75 but `savings` **13726.26** (should be 13726.25); `/ratios` returns savings 13726.26 and netSavings 13726.25 in one payload; Sankey savings 13926.26. Per-row 25 x 25.1234 = 628.085 -> 628.09 (half-up, fine). | Penny mismatches | P3 | High | PARTIAL / HTTP |
| RC-12 | Merchant breakdown `total` | Total = period spend, or an explicit "no merchant" bucket | Sep total **1313.40** vs spend 1564.15; Oct **433.32** vs 1273.75; percents computed on the partial total | Misleading percentages | P2 | High | PARTIAL / HTTP |
| RC-13 | `GET /api/accounts/summary/export`, `/api/accounts/:id/transactions/export` | Audited like report exports (CLAUDE.md Rule 9) | 4 downloads, **0** `audit_logs` rows (report exports wrote CREATE + PROCESS). Per-account CSV `Amount` is unsigned with no type column (income 15000.00, expense 333.33, transfer-out 1000.00 all positive), so it cannot be reconciled to the balance; split shown as uncategorised 200.00. | DPA egress unlogged; export useless for reconciliation | P1 (audit) / P2 (format) | High | MISSING / HTTP+DB |
| RC-14 | Net-worth history / changes | Derivable from the ledger, or marked unavailable | Snapshot-only (one point today); `/net-worth/changes` totalChange 0.00, `periods: []`; backdated transactions never alter history | Trend charts flat for imported/backdated data | P2 | Medium | PARTIAL / HTTP |
| RC-15 | Report CSV money format | 2-dp decimal strings | `toNumber()` emits `15000`, `45.5`, `25`; accounts CSV `454.5` | Cosmetic, float in export path | P3 | High | PARTIAL / HTTP |

### Reproduction (all commands from repo root, Git Bash, `MSYS_NO_PATHCONV=1`)
- Seed: `cd .local/readiness-fable-2026-10-13/scratch-reports-consistency && node seed.mjs && node post.mjs && node transfer.mjs && node expected.mjs`
- Read models: `node fetchall.mjs <phase> [keys]` (GAP=4000 to stay under the shared 30/min analytics limiter); FX rows: `node fx.mjs USD ZMW 25.1234 2026-10-01`
- Exports: `node exports.mjs`; cache: `node cache.mjs`; audit: `node ../q.mjs finance_app_audit_fable_20261013 "select action,entity_type from audit_logs where household_id='135744ff-3024-4e5d-87a8-9b3ada40233f'"` (q.mjs must run from repo root)
- Client range: `TZ=Africa/Lusaka node -e "const n=new Date('2026-10-14T10:00:00+02:00');console.log(new Date(n.getFullYear(),n.getMonth(),1).toISOString())"`

### Acceptance tests (one per finding)
- RC-01: household with ZMW 1000 + USD 100 and rate 25 => ratios `liquidAssets` 3500.00; without a rate => fail closed like the other reports.
- RC-02: a rate posted by household B never changes household A's summary (scope `fx_rates` by household, or make it admin/system-only with an audit).
- RC-03: credit account created at 500.00 owed, 45.50 charge => liabilities 545.50 and NW decreases by 45.50 (real-DB HTTP test).
- RC-04/05: one fixture, assert cashflow, trend, annual, budget, sankey, transactions report, both CSVs and breakdown all report the same month expense total, including card purchases and split rows.
- RC-06: summary and cashflow for the same range return the same expense total; summary changes immediately after a POST.
- RC-07: recap returns an error (or `hasData` with a warning) when a dependency throws; never zeros.
- RC-08/09: with `TZ=Africa/Lusaka`, current-month range = `2026-10-01..2026-10-31`; recap week = 7 local days.
- RC-13: each account CSV download writes one `audit_logs` row (entity `data_export` or equivalent).

## 4. What works (same evidence standard)

| Check | Evidence | Ver |
|---|---|---|
| Ledger writes: all 13 fixture rows + transfer persisted; account balances CHK 36848.03, SAV 3000.00, USD 75.00, PRIV 287.66 match the hand computation to the cent; transfer creates two legs (`is_transfer_in` false/true) | DB read-back of `accounts`, `transactions` | HTTP+DB |
| `/reports/spending/breakdown?groupBy=category` reconciles exactly for both months, including awkward cents (0.01, 33.33, 1234.56) and split allocation (Groceries 219.99 = 99.99 + 120.00 split) | `fx/breakdown_cat_*.json` | HTTP |
| `/reports/expenses/classification` total 2837.90 = ledger Sep+Oct incl. card purchase and split | `fx/exp_class.json` | HTTP |
| Report FX is as-of and fails closed: with no USD rate every `/reports/*` errored (no silent 1.0); with rates 25.1234@10-01, 26.5432@10-12, 26.50@10-13 the 2026-10-11 USD row used **25.1234** (latest rate dated on/before the txn) => 628.09, half-up rounding | `nofx/*.json`, `fx_late/*.json`, `fx/*.json`; `fxRateExpr.ts` `rate.date <= txn.date` + `assertFxRatesAvailable` | HTTP+SRC |
| Rate direction is strict: an inverse ZMW->USD row is not misused as USD->ZMW | `fx_inverse/*.json` | HTTP |
| Month bucketing on the server: Sep 30 row in September and Oct 1 / Oct 14 rows in October in cashflow, trend, annual, transactions report (date-only column, `timezone=Africa/Lusaka`) | `fx/cashflow_month.json`, `fx/rep_transactions_*.json` | HTTP |
| `endDate` is **inclusive** on `GET /api/transactions/summary` and `GET /api/transactions` for date-only inputs: endDate=2026-09-30 included the Sep 30 row (6 txns, 1564.15); endDate=2026-10-01 included both Oct 1 rows; endDate=2026-10-14 included today's row. The lead's "exclusive endDate" observation did **not** reproduce with YYYY-MM-DD input (exclusivity may arise only with timestamp input or a client-shifted date, cf. RC-08). | `nofx/txsum_*.json`, list calls | HTTP |
| Report exports: `POST /api/reports/exports` (transactions, budget) completes synchronously, `GET /exports/:id` returns status, `?download=true` streams `text/csv` with attachment filename; `data_exports` row stored with parameters; `audit_logs` CREATE + PROCESS rows written per export (DPA) | `exports/*.csv`, DB rows | HTTP+DB |
| Private-account transaction appears in the owner's report and CSV export; report SQL filters `is_private`/`owner_user_id` for other members (`TransactionReportRepository.ts:159-164`) | `exports/tx.csv` | HTTP (owner) + SRC (non-owner) |
| Reports cache invalidation on transaction write: cashflow and breakdown reflected a new 7.77 expense immediately (1273.75 -> 1281.52); accounts summary moved 42123.19 -> 42115.42 | `cache.mjs` output | HTTP |
| Transfers excluded from income/expense in every read model by default | all payloads | HTTP |
| `/reports/forecast` sane (flat at current NW with one baseline month) | `fx/forecast.json` | HTTP |

## 5. Not exercised / limits

| Item | Reason |
|---|---|
| Transaction-level `isPrivate` | Not settable via `POST /api/transactions` (no field in the schema); only account-level privacy tested |
| Non-owner view of private data in reports/exports/ratios | Single-member fixture household; covered at SRC only (RC-01 notes ratios lack a privacy filter) |
| Net-worth history over Sep-Oct | Snapshots are produced by a worker; not triggered (no cron calls, out of scope) |
| `/reports/debt`, `/reports/subcategory`, `/goals/progress`, custom charts | Not requested; debt shares the RC-01 code path (SRC) |
| Summary cache expiry | Measured: stale 1308.16 from the 22:31:05Z write until 22:35:56Z, fresh 1315.93 at 22:36:16Z (~5 min = `TTL.MEDIUM`). The 7.77 cache-probe expense (2026-10-13, Groceries) remains in the fixture after section 2 was captured |
| FX isolation from other agents | `fx_rates` is global, so another agent's 26.50 row entered my fixture mid-run; numbers above account for it explicitly |
| Shared per-IP 30/min analytics limiter | Several 429s from concurrent agents; affected endpoints were re-fetched with 4 s spacing, all final values come from 200 responses |

## 6. Side observations (outside the core scope, recorded for the lead)
- Account create writes **two** `audit_logs` CREATE rows per account (10 rows for 5 accounts).
- `fx_rates.created_at` / `data_exports` timestamps are returned as local wall-clock with a `Z` suffix (e.g. `createdAt "2026-10-14T00:22:11Z"` at 22:22Z): `timestamp without time zone` + `defaultNow()` under a UTC+2 server.
- Transaction names are rewritten on create when a merchant is set (posted "Shoprite Sep" became "Shoprite"; "Bus Sep 30 (last day)" became "BUS SEP Last DAY").
- `transactionCount` in `/transactions/summary` counts both transfer legs (Oct: 8 = 6 + 2).
