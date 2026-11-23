# Domain evidence: Budgets, Goals, Recurring (agent `budgets-goals-recurring`)

Revision main @ 381e943. Audit server http://localhost:5055, audit DB `finance_app_audit_fable_20261013`.
Fixture: jar `a1`, household `266ba1c2-2b83-4296-92e2-1112adbc5588` ("A1 Budgets Household", ZMW). Run date 2026-10-14 (Lusaka, UTC+2).
Harness: `.local/readiness-fable-2026-10-13/scratch-budgets-goals-recurring/h.mjs` (cookie jar + CSRF, read-only SQL with `default_transaction_read_only=on`); scenario scripts `b*.mjs`, `g*.mjs`, `r*.mjs` with raw output in matching `*.out` files in that directory.

Housekeeping note: a previous (cut-off) attempt of this role wrote `state.json` to the repository root (it was untracked, listed in the session-start `git status`). I moved it into the scratch dir; nothing else outside the allowed paths was touched.

Expected values below were computed by hand from the amounts I posted, never by calling the production function.

## 1. Budgets

### 1.1 Setup (HTTP 201 each)
- Accounts: `A1 Checking` ZMW 10000.00, `A1 Savings` ZMW 5000.00, `A1 USD Wallet` USD 1000.00.
- Categories seeded (84 rows; a second `POST /api/categories/seed` returns 409 and leaves the count at 84: idempotent).
- Budgets: `Groceries` 1000.00 ZMW on "Groceries (Home Food)" with `rolloverEnabled:true` (id 56d0a5e7); `Dining` 500.00 on "Restaurants & Dining Out" (id 786fab7e).
- Grocery expenses (ZMW, Checking): 2026-09-01 150.00; 2026-09-30 400.00; 2026-10-01 120.50; 2026-10-14 (today) 230.25; 2026-10-31 99.99; 2026-11-01 77.77; 2026-10-10 a 300.00 split = 200.00 Groceries + 100.00 Dining. (An earlier attempt had already posted a 300.00 split with 100.00 to Dining on 2026-10-10.)

### 1.2 Progress arithmetic (`GET /api/budgets/progress?year=&month=`)

| Month | Expected (hand) | Observed | Result |
|---|---|---|---|
| Sep Groceries | 150.00+400.00 = 550.00 spent, 450.00 remaining, 55% | spent=550.00 rem=450.00 pct=55 | PASS (first and last day of month both counted) |
| Oct Groceries (base) | 120.50+230.25+99.99+200.00(split leg) = 650.74; rem 349.26; 65.07% | spent=650.74 rem=349.26 pct=65.07 | PASS (split parent 300 not double counted; Oct-1, today, Oct-31 included) |
| Oct Dining | 100.00 (earlier split leg) + 100.00 (my split leg) = 200.00 | spent=200.00 rem=300.00 pct=40 | PASS (split legs counted once, to the right category) |
| Nov Groceries | 77.77 | spent=77.77 rem=922.23 | PASS (Nov-1 not leaking into Oct) |
| Oct Groceries after +500.00 on 2026-10-20 (overspend) | 1150.74; rem -150.74; 115.07% | spent=1150.74 rem=-150.74 pct=115.07 | PASS (negative remaining surfaced) |
| Oct Groceries after a USD 50.00 grocery expense (USD account) | no `fx_rates` rows exist, so: either converted at a real rate, or excluded/flagged | spent=1200.74 (+50.00 "ZMW") | **FAIL: BGR-01** |
| Oct Groceries after a 25.00 ZMW *income* refund in Groceries | product rule undocumented; refunds commonly net against spend | spent unchanged 1200.74 | Observation BGR-07 |

### 1.3 Move, recalculate, rollover, periods (script `b3.mjs`, output `b3.out`)

| Check | Expected | Observed | Result |
|---|---|---|---|
| `POST /api/budgets/move` 100.00 Groceries to Dining, Oct, `this_month` | Oct periods 900.00 / 600.00, Nov unchanged | 200; `budget_periods` Oct Groceries 900.00 v2, Dining 600.00 v2; Oct progress amt 900/600; Nov 1000/500 | PASS |
| Move 5000.00 (more than available) | reject | 400 `Insufficient budget to move` | PASS |
| 3 concurrent moves of 10.00 Dining to Groceries | 570.00 / 930.00, version +3 | 570.00 / 930.00, version 5 (2+3) | PASS (no lost update) |
| Move to the same budget | 400 or no-op without side effects | 200 success, no period change, but a `TRANSFER` audit row is written (5 TRANSFER rows for 4 real moves) | BGR-08 (P3) |
| 2 concurrent `POST /api/budgets/recalculate` | no duplicate budgets/periods | both 200; `select category_id,count(*) ... having count(*)>1` returns 0 rows; no duplicate periods | PASS (household `FOR UPDATE` anchor works) |
| Recalculate amount = "historical averages" (UI confirm text, `BudgetSettingsModal.tsx:66`; UI sends `months:3`, `Budget.tsx:241`) | Jul+Aug+Sep Groceries = 0+0+550.00, average 183.33 | Groceries base `budgets.amount` set to **550.00** (the 3-month SUM); Dining 500.00 overwritten to 0.00 | **FAIL: BGR-03** |
| Recalculate side effects | only categories with history, positive amounts (create schema rejects 0) | `created: 79` budgets, all `amount 0.00` (one per eligible category) | part of BGR-03 |
| Recalculate audit row | `audit_logs` UPDATE row (controller `budgets.controller.ts:414-425`) | 3 recalcs, **0** UPDATE rows for `budget`; controller uses `entityId: \`bulk:${householdId}\`` but `audit_logs.entity_id` is `uuid` (information_schema), so the insert fails and is swallowed. Same pattern on `clear` (`:449`) | **FAIL: BGR-04** |
| Rollover: Groceries `rolloverEnabled:true`, Sep remaining 450.00 | Oct `rolloverIn` 450.00 (100%) | Oct `rolloverIn` 0.00; `POST /api/cron/budget-rollover` 200 with `processedHouseholds:0, createdCount:0` | **FAIL: BGR-02** |
| Turning on rollover via API | some endpoint writes `household_preferences.auto_rollover_budget` | `PUT /api/settings/preferences {autoRolloverBudget:true}` returns 200 "Preferences updated" but the field is stripped (`settings.validation.ts:25-33` has no such key); DB still `false`. Grep: no server/client writer of `autoRolloverBudget` exists | part of BGR-02 |
| Budget creation audit | CREATE row per budget | 2 CREATE rows | PASS |
| `budget_periods` rows | only for months with overrides | 2 rows (Oct), created on first move; no dupes | PASS |
| Flex budget | create via flex flow | `GET /api/budgets/settings` reports `budgetSystem:"flex"`; create schema has no `isFlexBucket` input (`budgets.validation.ts:57-66` says flex buckets come from "a different flow"); no flex create endpoint found | NOT EXERCISED (no reachable API) |
| Zero-amount budget | reject | 400 | PASS |

### 1.4 Budget findings

| ID | Surface | Expected (source) | Observed | Impact | Repro | Sev | Conf | Recommended action | Acceptance test | Impl / Verif |
|---|---|---|---|---|---|---|---|---|---|---|
| BGR-01 | `GET /api/budgets/progress` | Foreign-currency spend converted to household currency, or fail-closed with a surfaced error (CLAUDE.md Rule 1 "FX silent fallback ... must be a logged, surfaced error") | USD 50.00 grocery expense raised ZMW Groceries spent from 1150.74 to 1200.74 with zero `fx_rates` rows. Source: `BudgetSpendRepository.ts:45,84,121,164,188,231,258,304,327` `SUM(transactions.amount)` with no currency filter or FX join, then `Money.from(total, householdCurrency)` | Any multi-currency household sees wrong spent/remaining (USD 50 counted as K50, roughly 25x understatement at current rates); budget alerts fire on wrong numbers | `b2.mjs` "after usd" block | P1 | High | Reuse the reports `buildFxRateExpr` + `assertFxRatesAvailable` guard in all budget spend queries | Household ZMW, one USD expense, a seeded USD/ZMW rate: spent = amount x rate; with no rate: 4xx/flagged, never 1:1 | PRESENT-wrong / HTTP+DB+SRC |
| BGR-02 | Rollover (progress + `POST /api/cron/budget-rollover`) | Budget/category `rolloverEnabled` carries unspent money forward (`BudgetQueryRepository.ts:183-212`) | Gated by `household_preferences.auto_rollover_budget` (`BudgetQueryRepository.ts:175`, `BudgetCoreService.ts:97`) which defaults `false` (`schema.ts:636`) and has no writer: the settings PUT strips it. Per-budget `rolloverEnabled:true` is accepted, stored and silently ignored; the cron is a no-op for every household | Advertised feature unreachable; users believe surplus rolls over | `b3.mjs` prefs + cron + Oct progress | P1 | High | Add `autoRolloverBudget`/`rolloverPercentage` to the preferences schema (or drop the household gate when the budget flag is set) | Set flag via API, Sep remaining 450 then Oct `rolloverIn` 450.00, and the cron writes `budget_periods.rollover_in` | PARTIAL / HTTP+DB+SRC |
| BGR-03 | `POST /api/budgets/recalculate` | "Recalculate budgets using historical averages" (`BudgetSettingsModal.tsx:66`) | Writes the N-month total as the monthly amount (`BudgetRecalculationService.ts:199-268`, no division by `monthsBack`); overwrites user-set amounts (Dining 500 to 0) and creates 79 zero-amount budgets that the create API would reject | Budgets roughly 3x too high for steady spenders; user's manual budgets destroyed by one click | `b3.mjs` recalc block; DB `select name,amount from budgets where name in ('Groceries','Dining')` gives 550.00 / 0.00 | P1 | High | Divide by months with data (or `monthsBack`), skip zero-history categories, and confirm before overwriting manual amounts | 3 months of 300/600/900 gives 600.00; a category with no history gets no budget | PRESENT-wrong / HTTP+DB+SRC |
| BGR-04 | Recalculate/clear audit | Rule 9: financial bulk writes are audited | `entityId: "bulk:<uuid>"` into a `uuid` column; 0 rows written; the failure is swallowed | DPA audit gap on bulk budget rewrite/delete | `b3.mjs`; `select action,count(*) from audit_logs where household_id='266ba1c2-...' and entity_type='budget' group by 1` gives no UPDATE | P2 | High | Use the household id (or null) as `entity_id`, put `bulk` in details; assert the row in a real-DB test | After recalc, one `audit_logs` UPDATE row exists | PRESENT-broken / DB+SRC |
| BGR-07 | Refunds in budget spend | Product decision (undocumented) | `type:income` 25.00 in Groceries does not reduce spent | Spent overstated by refunds | `b2.mjs` "after refund" | P3 | Med | Decide and document; Monarch nets refunds | n/a | DESIGN / HTTP |
| BGR-08 | Move to same budget | 400 | 200 plus a spurious TRANSFER audit row | Audit noise | `b3.mjs` | P3 | High | Reject `from==to` in `moveBudgetSchema` | 400 | PRESENT / HTTP+DB |

## 2. Goals (scripts `g1.mjs`, `g2.mjs`, `g3.mjs`)

Goals: A "Emergency Fund" target 10000.00, targetDate 2027-10-14; B "Vacation" 3000.00, 2027-04-14; C "Car" 1000.00; D "House" 50000.00.

| Check | Expected (hand) | Observed (HTTP / DB) | Result |
|---|---|---|---|
| Create, `monthlyProjection` A | 10000/12 months = 833.33 | 833.33 | PASS |
| Contribute 500.00 to A | `current_amount` 500.00; required monthly 9500/12 = 791.67 | DB 500.00; API 791.67; `goal_contributions` row 500.00 | PASS |
| Over-contribute 1,000,000.00 to A (target 10000, household cash about 12,093) | reject, or at least flag | 201; `current_amount` 1000500.00, auto `status=completed`; summary `overallProgress: 7214` | GOAL-01 |
| Reverse/delete a manual contribution | an endpoint exists | No route (`goals.routes.ts` has only `POST /:id/contribute` and `GET /:id/contributions`); the update schema has no `currentAmount` | GOAL-01 |
| Link a 300.00 income txn as contribution | +300.00, one link, one contribution row with `transaction_id` | `current_amount` 1000800.00; `transaction_goal_links` 1 row 300.00; contribution row has_tx=true | PASS |
| Link the same txn twice | reject | 400 "Transaction is already linked to this goal" | PASS (409 would be more accurate, P3) |
| Unlink | -300.00, link and its contribution row removed, audit | 1000500.00; links 0 rows; contribution rows only the 2 manual ones; audit `UNLINK` 1 row | PASS |
| Assign Savings partial 2000 with schema default `autoUpdate` | 201 | 400 "Partial assignments cannot auto-update" because `assignAccountSchema` defaults `autoUpdate:true` (`goals.validation.ts:168`) | GOAL-03 (P3, contract trap) |
| Assign Savings partial 2000 to B (`autoUpdate:false`) | 201; B current 2000.00 | 201; DB 2000.00 | PASS |
| Assign same account to same goal again | 409 | 409 CONFLICT | PASS |
| Partial 4000 to C when 3300 unassigned | reject | 400 "Insufficient available balance. Available: 3300.00" (5300-2000) | PASS |
| Full-balance Checking to C, then to B | second rejected | 400 "Account already fully assigned to another goal" | PASS |
| `available-funds` | Checking 6792.98 (10000 - 1378.51 + 25 - 1878.51 + 25, hand), assigned 6792.98, avail 0; Savings 5300 / 2000 / 3300; USD 900 | exactly these values | PASS |
| Transfer 200 B to C | B 2600 to 2400, C +200, one `goal_transfers` row, audit | B 2400.00, C 6992.98; 1 row; audit `goal_transfer CREATE` | PASS |
| Transfer more than balance / to self / from completed goal | reject | 400 x3 with clear messages | PASS |
| 3 concurrent transfers of 1000 from B (2400) to D | exactly 2 succeed | 201, 400, 201; B 400.00, D 2000.00; 2 transfer rows | PASS (no overdraft race) |
| 5 concurrent contributions of 11.11 | +55.55 | D 2055.55; 5 rows sum 55.55 | PASS |
| `GET /api/goals/:id/projection` B (current 2400, target 3000, 6 calendar months) | monthly 600/6 = 100.00; completion at 100/30 per day: 180 days after 2026-10-13 = 2027-04-11 | `monthlyProjection:100`, `projectedCompletionDate:"2027-04-11"`, `monthsRemaining:6` | PASS (matches the model, but see GOAL-04) |
| Complete / archive / unarchive C | flags toggle, activity rows | `completed_at` set; `is_archived` true then false; activity log rows for each | PASS |
| Contribute to completed goal | reject | 400 "Goal is already completed" | PASS |
| Audit rows | create/update/link/unlink/transfer | goal CREATE 3, UPDATE 8, LINK 1, UNLINK 1, goal_transfer CREATE 1 | PASS |

### Goal findings

| ID | Surface | Expected (source) | Observed | Impact | Repro | Sev | Conf | Recommended action | Acceptance test | Impl / Verif |
|---|---|---|---|---|---|---|---|---|---|---|
| GOAL-01 | Manual contributions | A mistaken contribution can be corrected, and implausible amounts are guarded | 1,000,000.00 accepted against a 10,000 target (household cash about 12k); goal auto-completes; there is no endpoint to delete/reverse a contribution and the update schema cannot set `currentAmount`. The only recovery is deleting the goal | One typo permanently corrupts goal progress, summary totals and completion status | `g1.mjs` "contribute 1,000,000 A" | P2 | High | Add `DELETE /api/goals/:id/contributions/:cid` (atomic decrement + audit); optionally warn when contribution > remaining | Contribute, reverse, `current_amount` returns to prior value and audit row written | PARTIAL / HTTP+DB+SRC |
| GOAL-02 | `GET /api/goals/summary`, `GET /:id/contributions` | Rule 4.1/18: money as MoneyDto | `totalSaved: 1009892.98` (JS number), `overallProgress` computed through `Math.round(...toNumber())`; contributions list returns `amount:"1000000.00"` bare string | Contract inconsistency; float exposure in summary | `g2.mjs` summary | P3 | High | Return MoneyDto | Client contract test | PRESENT / HTTP |
| GOAL-03 | `POST /:id/assign-account` | Schema defaults should produce a valid request | `autoUpdate` defaults to `true`, and partial + autoUpdate is rejected, so a minimal partial request always 400s | API trap (the UI may send `false`; not verified) | `g1.mjs` assign block | P3 | High | Default `autoUpdate` to `false` for partial | Minimal partial request gives 201 | PRESENT / HTTP |
| GOAL-04 | Projection dates | Projected completion when contributing exactly the required monthly amount = target date | Uses 30-day months (`goalCalculations.ts:214-220`), so it projects 3-5 days before the target (A: 2027-10-09 vs 2027-10-14). "Today" is UTC (`toISOString`, `:201`) while the user is in Lusaka (+2): goal `startDate` defaulted to 2026-10-13 at 00:22 local on the 14th; a completed goal shows `monthsRemaining:12` | Cosmetic date drift; wrong day between 00:00 and 02:00 local | `g1.mjs`/`g2.mjs` | P3 | High | Use calendar-month stepping and the user's timezone consistently | Projection with exact monthly amount = target date | PRESENT / HTTP+SRC |

## 3. Recurring (scripts `r1.mjs`, `r2.mjs`)

| Check | Expected | Observed (HTTP / DB) | Result |
|---|---|---|---|
| Create without `frequency`/`nextDueDate` (what the lead saw the UI send) | API contract decides | 400 `frequency Required`, `nextDueDate Required` (`recurring.validation.ts:63,70`). So a UI that omits them cannot create rules | Confirms the lead's UI finding: REC-01 |
| Create monthly Rent 250.00, `dayOfMonth:10`, `nextDueDate:2026-07-10` | 201 | 201, `startDate` defaulted to nextDueDate | PASS |
| `POST /api/recurring/process {dryRun:true}` | lists due rule, creates nothing | `processed:1, created:0, dueRules:[Rent 2026-07-10]` | PASS |
| Process run 1, run 2, then `POST /api/cron/recurring` | one transaction per due period, dated at the occurrence | Jul-10, Aug-10, Sep-10 created one per call; `next_due_date` advanced each time; `total_occurrences` 1,2,3 | PASS (dates/amounts) |
| Catch-up of missed months in one run | all 4 due periods (Jul-Oct) in one run, or documented | **one occurrence per rule per run** (`RecurringProcessingService.ts:137-260` processes `nextDueDate` once). With a daily cron, N missed periods take N days | REC-03 (P2) |
| 2 concurrent `process` calls | no duplicate | `created:1` and `created:0`; Oct-10 exists once; each txn has a deterministic `idempotency_key` | PASS |
| Run after caught up | nothing | `processed:0` | PASS |
| Balance effect | Checking -4 x 250.00 = -1000.00 | 6792.98 to 5792.98 (txns `is_pending:true`, still hit balance, and count in the Dining budget: Oct Dining 200 + 250 = 450.00 observed) | PASS (consistent) |
| Links / history / audit | 4 links, history rows, audit per materialization | 4 `recurring_transaction_links` `linked`; history `processed` rows; `audit_logs` transaction CREATE x4 with `recurring_materialization`, `recurring_rule` CREATE x1, `recurring_batch` PROCESS x5 | PASS |
| Month-end rule: monthly from 2026-08-31, no dayOfMonth | Aug-31, Sep-30, **Oct-31** | Aug-31, Sep-30, then `next_due_date` **2026-10-30** (and Oct-30 later materialized) | **FAIL: REC-02** |
| `process {asOfDate:"2027-01-01"}` by a member | reject future dates, or never post future ledger rows | 200 `created:3`: Rent **2026-11-10**, Gym 2026-10-27, EOM 2026-10-30 posted now as pending ledger rows; Checking 5792.98 to 5462.98 (-250 -80), Savings +12.34 | **FAIL: REC-04** |
| Skip (weekly Gym, next 2026-10-20) | next 2026-10-27, no txn | next 2026-10-27, 0 txns, history `skipped` | PASS |
| Pause, then process as of 10-28 | nothing created | `is_paused:true`, `processed:0` | PASS |
| Resume | active, same next date | `is_paused:false`, next 2026-10-27 | PASS |
| End with `endDate:2026-11-01` | no occurrences after end | `is_active:false`, `end_date` 2026-11-01; process creates nothing | PASS (note: deactivates immediately even though endDate is in the future; any occurrence between now and endDate would be lost. Not exercised further) |
| `GET /api/recurring/upcoming` | rules due soon | returned Gym (due in 6 days); Rent (27 days) and EOM (16 days) not listed, consistent with a short window | PASS (window not documented) |

### Recurring findings

| ID | Surface | Expected (source) | Observed | Impact | Repro | Sev | Conf | Recommended action | Acceptance test | Impl / Verif |
|---|---|---|---|---|---|---|---|---|---|---|
| REC-01 | Create-rule UI vs API | UI create succeeds | API requires `frequency` and `nextDueDate`; per the lead the UI omits them, so the reachable UI path gets 400 | Users cannot create recurring rules from the UI (the API itself is correct) | `r1.mjs` "create without frequency/nextDueDate" | P1 (UI path) | High for API half; UI half per lead | Send both from the form (or default `nextDueDate`=start date server-side) | E2E: create a rule from the form, row exists | API PRESENT / HTTP |
| REC-02 | `calculateNextDate` monthly | Month-end anchor kept: Aug-31, Sep-30, Oct-31, Nov-30 | Drifts to the clamped day: next after Sep-30 is Oct-30; after February it would stick to the 28th. `dayOfMonth` is capped at 28 (`recurring.validation.ts:71`), so users cannot pin 29-31 | Salary/rent on the last day posts 1-3 days early every month after a short month; budgets/forecasts slightly off | `r2.mjs` EOM block | P2 | High | Keep the original anchor day (`startDate` day) and clamp per month | Monthly from Jan-31 gives Feb-28, Mar-31, Apr-30 | PRESENT-wrong / HTTP+DB |
| REC-03 | Catch-up | All missed periods materialized in one run (or documented skip) | One occurrence per rule per run | After downtime, balances/budgets lag by days; a monthly cron would never catch up | `r1.mjs` | P2 | High | Loop while `nextDueDate <= today` inside the lock (bounded) | Rule 3 months overdue gives 3 txns after one run | PARTIAL / HTTP+DB+SRC |
| REC-04 | `POST /api/recurring/process` `asOfDate` | Processing date cannot exceed today (schema describes it as "rules due as of this date") | Any member can pass a future `asOfDate` and post future-dated ledger rows that immediately change balances | Balances/budgets show money that has not moved; Nov rent appears in Oct balance | `r2.mjs` "process asOf FUTURE" | P2 | High | Reject `asOfDate > today` (household timezone) or restrict it to dryRun | 400 for a future asOfDate; no rows created | PRESENT-unsafe / HTTP+DB |
| REC-05 | "Today" for due-ness | Household-local date (Lusaka, UTC+2) | `new Date().toISOString()` (UTC) in `RecurringProcessingService.ts:110`; between 00:00 and 02:00 local, items due "today" are not yet due | Off-by-one-day processing around midnight | SRC | P3 | Med | Use household timezone | n/a | PRESENT / SRC |

REC-02 root cause: `server/core/calculations/recurring/dates.ts:47-48` steps from the previous occurrence (`applyMonthJump(date, 1, options?.dayOfMonth)`) with no original anchor when `dayOfMonth` is null, so a clamp is permanent.

## 4. What works (verified, HTTP + DB read-back)

- Budget spent/remaining/percent arithmetic for single-currency spend, including first/last day of month, today, adjacent months, overspend (negative remaining), and split transactions (each leg counted once, parent excluded).
- Budget move: correct period overrides, `version` optimistic counter, insufficient-funds guard, and no lost update under 3 concurrent moves.
- Recalculate concurrency: household `FOR UPDATE` anchor; 2 concurrent runs leave no duplicate budgets or periods.
- Category seed is idempotent (409 on repeat, count unchanged).
- Goals: contributions, link/unlink with contribution rows, account assignment conflict and over-allocation guards, `available-funds` (matches hand-computed balances to the ngwee), goal transfers with balance guard and a correct concurrency outcome (2 of 3), concurrent contributions sum exactly, complete/archive/unarchive, completed-goal guards, audit rows for create/update/link/unlink/transfer, projection matches its documented model.
- Recurring: strict API contract, dry run, one transaction per period with deterministic idempotency key, row lock (no duplicate under concurrent processing), links, history, audit per materialization, skip/pause/resume/end semantics, balances move by exactly the posted amounts.

## 5. Not exercised / limits

| Item | Reason |
|---|---|
| Flex budget create | No reachable API: create schema has no `isFlexBucket`; household `budgetSystem` is already `flex`, but no flex create endpoint found |
| Rollover arithmetic itself (`prevRolloverIn + prevBudget - prevSpent`, percentage) | Unreachable because of BGR-02; source read only (`BudgetQueryRepository.ts:183-212`) |
| `POST /api/budgets/clear` | Destructive; audit defect inferred from the same `bulk:` entityId pattern (`budgets.controller.ts:449`), not executed |
| Pay-down / investment goals, payoff scenarios, debt strategy | Out of time budget; `calculatePayoffSchema`/`debtStrategySchema` use `z.coerce.number()` (float) inputs, worth a follow-up money review |
| Goal ↔ transaction privacy (linking another member's private txn) | Single-user fixture; belongs to the security/privacy verifier |
| UI half of REC-01 and GOAL-03 | API-only run; UI behaviour taken from the lead |
| Production cron auth | `CRON_SECRET` unset in this environment, so `POST /api/cron/*` was open by design here |

## 6. Severity roll-up

| Sev | IDs |
|---|---|
| P1 | BGR-01 (FX 1:1 in budget spend), BGR-02 (rollover unreachable), BGR-03 (recalculate writes 3-month sums as monthly budgets, overwrites manual amounts), REC-01 (UI cannot create recurring rules; API contract confirmed) |
| P2 | BGR-04 (bulk budget audit rows never written), GOAL-01 (no contribution reversal, no guard), REC-02 (month-end drift), REC-03 (one catch-up per run), REC-04 (future `asOfDate` posts future ledger rows) |
| P3 | BGR-07, BGR-08, GOAL-02, GOAL-03, GOAL-04, REC-05 |

No P0 found in this domain: every amount that was persisted matched the posted values, and no concurrency test produced a duplicate or lost update.
