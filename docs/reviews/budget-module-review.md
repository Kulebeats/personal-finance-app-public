# Budget Module Review (Codex Verification)

## 1) Executive Summary
- Budget progress and alerts are exposed via API but the data contract for `spent` and `remaining` mismatches the client, producing NaN and incorrect UI totals.
- Core budget calculations violate the project Money/Arithmetic rule (parseFloat/Number/Math.round), risking rounding drift and compliance issues.
- Budget `period` values (yearly/custom) are accepted but ignored in progress and forecast logic, so non-monthly budgets are incorrect.
- Budget spend ignores transaction splits and multi-currency conversions, so totals can be materially wrong in common workflows.
- Budget move/rollover operations are not atomic and progress reads cause writes, raising concurrency and performance risks.

## 2) Factuality Review Table
| Report Claim | Status | Evidence (file path + function name + pointer) | Correction / Notes |
| --- | --- | --- | --- |
| getBudgetsWithProgress has N+1 spend queries | Confirmed | `server/repositories/BudgetRepository.ts:384` (getBudgetsWithProgress) | Uses per-budget `calculateSpent`/`calculateGroupSpent` calls inside `Promise.all`. |
| BudgetRepository uses parseFloat/Math.round in financial calculations | Confirmed | `server/repositories/BudgetRepository.ts:243` (calculateSpent), `server/repositories/BudgetRepository.ts:544` (getBudgetsWithProgress) | Violates Money/Arithmetic rule in `CLAUDE.md`. |
| Budget alerts thresholds are hardcoded 75/90 | Partially confirmed | `server/core/calculations/budget/alerts.ts:44` (DEFAULT_THRESHOLDS), `server/services/budget/BudgetCoreService.ts:296` (getBudgetAlerts) | Calculation engine uses defaults, but live alerts use per-budget thresholds (80/100 defaults). |
| createBudget/deleteBudget are not audit logged | Not confirmed | `server/modules/budgets/budgets.controller.ts:134` (create), `server/modules/budgets/budgets.controller.ts:214` (delete) | Audit logging exists in controller; update logging is duplicated (see additional issues). |
| Budgets have no currency and MoneyDto defaults to ZMW | Confirmed | `shared/schema.ts:1111` (budgets table), `server/core/money.ts:242` (toMoneyDto), `server/modules/budgets/budgets.helpers.ts:11` (mapBudgetMoney) | Budget responses always default to ZMW. |
| Budget period values are ignored in progress/forecast | Confirmed | `server/repositories/BudgetRepository.ts:384` (getBudgetsWithProgress), `server/services/budget/BudgetForecastService.ts:20` (getMonthRange) | Monthly range is always used regardless of budget.period. |

## 3) Confirmed Issues Catalog
### BUD-ISSUE-001: Money precision rule violations in budget calculations
- Severity: Critical
- Impact: Budget progress, rollover, and recalculation use float math, risking rounding drift and violating the Money/Arithmetic rule.
- Evidence: `server/repositories/BudgetRepository.ts:243` (calculateSpent), `server/repositories/BudgetRepository.ts:544` (getBudgetsWithProgress), `server/services/budget/BudgetRecalculationService.ts:89` (recalculateBudgets).
- Root cause: Use of parseFloat/Number/Math.round instead of Money/Decimal.
- Proposed fix: Use Money or Decimal for all sums and ratios; avoid parseFloat/Number; compute percentUsed with Decimal and return MoneyDto.
- Risk of change: High (core financial logic).
- Rollback notes: Revert repository/service calculation changes and restore previous output shape.

### BUD-ISSUE-002: Budget progress API contract mismatch breaks client calculations
- Severity: High
- Impact: Budget UI uses `spent` and `remaining` as numbers but receives MoneyDto objects, leading to NaN and incorrect totals.
- Evidence: `server/modules/budgets/budgets.helpers.ts:11` (mapBudgetMoney), `server/modules/budgets/budgets.controller.ts:61` (getProgress), `client/src/hooks/useBudgets.ts:30` (BudgetWithProgress), `client/src/features/budget/hooks/useBudgetPageData.ts:220` (budgetEntry.spent).
- Root cause: Server maps `spent`/`remaining` to MoneyDto while client types assume numbers.
- Proposed fix: Align contract to MoneyDto for `spent`/`remaining` and parse on client, or stop mapping those fields on server.
- Risk of change: Medium (API and UI).
- Rollback notes: Add compatibility adapter or revert to numeric response.

### BUD-ISSUE-003: Budget period types are ignored (yearly/custom)
- Severity: High
- Impact: Budgets configured as yearly or custom are calculated against monthly ranges, producing wrong progress and forecast.
- Evidence: `server/repositories/BudgetRepository.ts:384` (getBudgetsWithProgress), `server/services/budget/BudgetForecastService.ts:20` (getMonthRange), `server/modules/budgets/budgets.validation.ts:13` (budgetPeriodSchema).
- Root cause: Period field is validated but unused in calculations.
- Proposed fix: Implement period-aware range calculation and period-specific budgetPeriods; block non-monthly periods until implemented.
- Risk of change: Medium-high.
- Rollback notes: Limit validation to monthly until full support exists.

### BUD-ISSUE-004: Split transactions are not included in budget spend
- Severity: High
- Impact: Budgets undercount or misattribute spending when transactions are split across categories.
- Evidence: `server/repositories/BudgetRepository.ts:216` (calculateSpent uses transactions.amount only), `shared/schema.ts:1012` (transactionSplits table).
- Root cause: Spend queries ignore `transaction_splits`.
- Proposed fix: Use split amounts for budget sums when splits exist (and avoid double counting).
- Risk of change: Medium (query complexity/perf).
- Rollback notes: Revert to transaction-level sums and document split limitations.

### BUD-ISSUE-005: Multi-currency budgets are unsupported; responses default to ZMW
- Severity: High
- Impact: Households with non-ZMW currency see incorrect currency labels and sums based on raw transaction amounts.
- Evidence: `shared/schema.ts:1111` (budgets table lacks currency), `server/modules/budgets/budgets.helpers.ts:11` (toMoneyDto with default currency), `server/core/money.ts:242` (default "ZMW").
- Root cause: No budget currency field or household currency injection in MoneyDto; no conversion logic for transactions.
- Proposed fix: Add currency to budgets/budgetPeriods or derive from household; pass currency to toMoneyDto; convert non-base transactions using fx data.
- Risk of change: High (schema and migration).
- Rollback notes: Keep default currency and document single-currency limitation.

### BUD-ISSUE-006: Move budget amount is not atomic or locked
- Severity: Medium
- Impact: Partial updates or concurrent moves can leave budgets inconsistent or overspent.
- Evidence: `server/services/budget/BudgetForecastService.ts:174` (moveBudgetAmount uses sequential upserts without transaction).
- Root cause: No transaction or row locks around multi-row updates.
- Proposed fix: Wrap move in DB transaction; lock relevant budget_periods rows for the date range.
- Risk of change: Medium (possible lock contention).
- Rollback notes: Revert to non-transactional path if deadlocks occur.

### BUD-ISSUE-007: RecalculateBudgets uses expense totals for all budgets
- Severity: Medium
- Impact: Income budgets are recalculated from expenses, producing incorrect suggested amounts.
- Evidence: `server/services/budget/BudgetRecalculationService.ts:79` (transactions.type fixed to "expense").
- Root cause: Recalc does not branch by category group type.
- Proposed fix: Compute totals separately for income vs expense groups and apply accordingly.
- Risk of change: Medium.
- Rollback notes: Revert recalc changes and disable auto-recalc for income groups.

## 4) Additional Issues Found (Not in the Report)
### BUD-ISSUE-008: N+1 queries and write side effects in getBudgetsWithProgress
- Severity: Medium
- Impact: Progress endpoint issues N+1 queries and writes budget_periods during reads, impacting latency and data consistency.
- Evidence: `server/repositories/BudgetRepository.ts:384` (getBudgetsWithProgress uses per-budget calculations and upsertPeriod).
- Root cause: Per-budget spend queries and rollover upsert in the read path.
- Proposed fix: Batch spend calculations and move upsert to explicit rollover job.
- Risk of change: Medium.
- Rollback notes: Restore current query behavior.

### BUD-ISSUE-009: Budget create/update allows invalid category/group combinations
- Severity: Medium
- Impact: Budgets can be created with both categoryId and categoryGroupId or neither, leading to orphaned or hidden budgets.
- Evidence: `server/modules/budgets/budgets.validation.ts:25` (createBudgetSchema allows both optional), `server/services/budget/BudgetCoreService.ts:111` (createBudget has no exclusivity check).
- Root cause: Missing validation and household scoping checks.
- Proposed fix: Add schema refinement to enforce exactly one of categoryId or categoryGroupId (or isFlexBucket), and verify ownership.
- Risk of change: Low-medium.
- Rollback notes: Remove refinement if it blocks existing data.

### BUD-ISSUE-010: Duplicate audit logging for budget updates
- Severity: Low
- Impact: Audit logs record duplicate update entries and inconsistent userId ("system" vs actual user).
- Evidence: `server/modules/budgets/budgets.controller.ts:175` (logUpdate), `server/services/budget/BudgetCoreService.ts:217` (businessAuditService.log).
- Root cause: Logging performed in both controller and service.
- Proposed fix: Centralize audit logging in controller or service, and pass userId consistently.
- Risk of change: Low.
- Rollback notes: Restore duplicate logging if audits depend on it.

### BUD-ISSUE-011: Alert threshold range allows values that never trigger
- Severity: Low
- Impact: alertThreshold > 100 is never used because "exceeded" triggers at 100; thresholds are inconsistent across modules.
- Evidence: `server/modules/budgets/budgets.validation.ts:36` (max 200), `server/services/budget/BudgetCoreService.ts:296` (exceeded at 100).
- Root cause: Validation range and alert logic are mismatched.
- Proposed fix: Cap alertThreshold at 100 or make exceeded threshold configurable.
- Risk of change: Low.
- Rollback notes: Restore old validation if needed.

### BUD-ISSUE-012: Flex budget uniqueness is not enforced
- Severity: Low
- Impact: Concurrent calls can create multiple flex budgets for a household.
- Evidence: `server/services/budget/BudgetForecastService.ts:43` (ensureFlexBudget), `shared/schema.ts:1111` (no unique index on isFlexBucket).
- Root cause: No database constraint and non-transactional check-then-insert.
- Proposed fix: Add unique index on (householdId, isFlexBucket) or use an upsert.
- Risk of change: Low.
- Rollback notes: Drop index if it conflicts with existing data.

## 5) Implementation Plan
### P0 Same day
- Goal: Restore budget UI correctness and prevent unsupported period usage.
- Steps:
  - Align `spent`/`remaining` contract (MoneyDto everywhere or numeric everywhere).
  - Update client parsing for `spent`/`remaining` in budget page data transforms.
  - Temporarily reject non-monthly `period` values in create/update until period logic is implemented.
- Acceptance criteria:
  - Budget page totals render without NaN and match API responses.
  - Creating a yearly/custom budget is rejected with validation error.
- Risks and mitigations:
  - Risk: API contract change breaks existing clients; mitigation: add compatibility adapter for one release.

### P1 This week
- Goal: Fix financial correctness for progress, rollover, and recalculation.
- Steps:
  - Refactor BudgetRepository calculations to use Money/Decimal and remove parseFloat/Number/Math.round.
  - Add split-aware budget spend queries.
  - Fix recalc to respect income vs expense group types.
  - Add unit tests covering split transactions and income budgets.
- Acceptance criteria:
  - Progress and alerts match Money/Decimal test vectors.
  - Split transaction budgets match sum of splits.
- Risks and mitigations:
  - Risk: Query performance regression; mitigation: add indexes and compare query plans.

### P2 Later
- Goal: Multi-currency support and performance hardening.
- Steps:
  - Add budget currency fields and conversion rules; update DTOs.
  - Batch spend calculation to avoid N+1; move rollover writes to explicit jobs.
  - Add transactions/locks for moveBudgetAmount and unique flex budget constraint.
- Acceptance criteria:
  - Budgets in non-ZMW households display correct currency and totals.
  - Progress endpoint latency scales with number of budgets.
- Risks and mitigations:
  - Risk: Data migration complexity; mitigation: staged backfill with feature flag.

## 6) Technical Specifications
### Spec 1: Money correctness and precision
- Contract changes: `BudgetWithProgress.spent` and `remaining` return MoneyDto with currency; `percentUsed` allows two decimal places.
- Data model: Keep budget amounts as decimal strings; avoid float conversions; ensure budgetPeriods store amounts as strings.
- Query design: Use SQL SUM as string, wrap with Money/Decimal for arithmetic; no parseFloat/Number; use Decimal for percentages.
- Concurrency: Wrap rollover/move updates in transactions; use row-level locks for budget_periods updates.
- Audit logging: Log before/after amounts using MoneyDto; ensure one audit entry per user action.
- Observability: Add structured logs for budget calculation duration and percentUsed anomalies.

### Spec 2: Multi-currency budgets
- Contract changes: Add `currency` to budget and budgetPeriod DTOs; accept optional currency in create/update or derive from household.
- Data model: Add `currency` columns to budgets and budget_periods (default from household currency).
- Conversion rules: Use `convertedAmount` when transaction currency differs from household; require fx metadata for cross-currency transactions.
- Rounding rules: Use Money/Decimal rounding to 2 decimals; avoid float rounding before comparisons.
- Backfill plan: Populate budget currency from household currency; backfill period currency from related budgets.
- Edge cases: Missing transaction currency, mixed-currency households, income budgets in non-base currency.

### Spec 3: Audit trail completeness
- Event taxonomy: budget.create, budget.update, budget.delete, budget.move, budget.forecast.update, budget.recalculate, budget.clear, budget.rollover.
- Payload schema: { budgetId, categoryId/groupId, amount, currency, period, scope, months, before/after }.
- Where emitted: Controller for user actions; service for cron/system actions with userId "system".
- Validation: Ensure every mutating endpoint emits exactly one audit event; add tests to assert audit counts.

## 7) Detailed To Do List
### Backend
- [ ] Align budget progress/alerts DTOs with client and update mappings.
- [ ] Refactor BudgetRepository calculations to use Money/Decimal end-to-end.
- [ ] Add split-aware spend queries and avoid double counting.
- [ ] Implement period-aware calculations (monthly/yearly/custom).
- [ ] Fix recalc logic to use income vs expense totals.
- [ ] Wrap moveBudgetAmount in transaction and add locks for budget periods.
- [ ] Add validation for categoryId/categoryGroupId exclusivity and household ownership.
- [ ] Remove duplicate audit logging or make it consistent.

### Database
- [ ] Add currency columns to budgets and budget_periods with defaults.
- [ ] Add composite index to support spend queries (householdId, categoryId, date, type).
- [ ] Add unique index for flex budget per household.
- [ ] Add index on budget_periods(budget_id, start_date).

### Frontend
- [ ] Update BudgetWithProgress and BudgetAlert types to use MoneyDto for spent/remaining.
- [ ] Parse MoneyDto for spent/remaining in budget transforms and UI totals.
- [ ] Block or warn on non-monthly budgets until supported.
- [ ] Add UI handling for budget currency display from settings/context.

### QA
- [ ] Add unit tests for progress calculations with Decimal.
- [ ] Add tests for split transaction budget sums.
- [ ] Add tests for yearly/custom budget periods.
- [ ] Add integration tests for moveBudgetAmount atomicity and alerts.

### DevOps/Observability
- [ ] Add logs/metrics for budget progress query latency and error rate.
- [ ] Monitor for duplicate audit events and budget calculation failures.

## 8) QA Test Plan
### Unit tests
- Test: Budget progress uses Money/Decimal precision
  - Validates: No parseFloat/Number usage and correct percentUsed rounding
  - Setup: Mock spent and budget values with decimals
  - Steps: Run calculate progress and compare to expected
  - Expected: Accurate decimal results and correct thresholds

- Test: Split transactions affect budgets
  - Validates: Split sums are included, base transaction amounts are excluded
  - Setup: Transaction with splits across two categories
  - Steps: Call progress endpoint for month
  - Expected: Each category budget reflects split totals

### Integration tests
- Test: Budget progress DTO contract
  - Validates: spent/remaining returned as MoneyDto and parsed by client
  - Setup: Create budget and expense transaction
  - Steps: Fetch /budgets/progress and render budget page
  - Expected: UI totals match API values and no NaN

- Test: Move budget amount atomicity
  - Validates: Both source and target periods update together
  - Setup: Two budgets with periods, simulated failure during second update
  - Steps: Call /budgets/move with transactional failure injected
  - Expected: No partial updates, budgets remain consistent

### Smoke tests
- Test: Create budget and view progress
  - Validates: Basic create, progress, alerts flow
  - Setup: Create monthly budget and one transaction
  - Steps: Fetch progress and alerts
  - Expected: percentUsed and remaining correct

### Critical user journeys
- Journey: Monthly budgeting with rollover
  - Validates: Rollover amounts calculated correctly and stored in budget_periods
  - Steps: Create budget with rollover, add transactions, advance month, view progress
  - Expected: Rollover matches expected carryover and alerts trigger correctly

## 9) Suggested Code Changes
### Change 1
Align budget progress DTOs by returning MoneyDto for `spent`/`remaining` and updating client parsing in `useBudgetPageData`.

### Change 2
Refactor budget spend and rollover calculations to use Money/Decimal and include transaction splits; remove parseFloat/Number/Math.round from budget paths.

### Change 3
Implement period-aware budget calculations and add currency to budgets/budget_periods for multi-currency support.
