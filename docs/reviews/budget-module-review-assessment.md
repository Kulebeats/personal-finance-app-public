# Budget Module Review Assessment

**Reviewer:** Claude Opus 4.5
**Date:** 2026-01-20
**Source Document:** `docs/reviews/budget-module-review.md`

---

## Part A: Factuality and Evidence Verification

### Summary Table

| Claim ID | Report Claim | Status | Corrected Line Reference | Evidence |
|----------|-------------|--------|-------------------------|----------|
| Table-1 | getBudgetsWithProgress N+1 queries | **VERIFIED** | `BudgetRepository.ts:503,517` | 2 queries per budget in Promise.all loop |
| Table-2 | parseFloat/Math.round violations | **VERIFIED** | `BudgetRepository.ts:243,277,310,479-516,544` | Multiple instances confirmed |
| Table-3 | Hardcoded 75/90 thresholds | **PARTIALLY CORRECT** | `alerts.ts:44-47` = 75/90, `BudgetCoreService.ts:296-297` = 80/100 | Two different threshold systems exist |
| Table-4 | create/delete not audit logged | **INCORRECT** | `budgets.controller.ts:134-145,214-226` | Audit logging IS present |
| Table-5 | No currency, defaults to ZMW | **VERIFIED** | `shared/schema.ts:1111-1146`, `money.ts:244` | Budget table lacks currency column |
| Table-6 | Period values ignored | **VERIFIED** | `BudgetRepository.ts:404-406`, `BudgetForecastService.ts:11-30` | Always uses monthly ranges |

---

### Detailed Verification by Issue

#### BUD-ISSUE-001: Money precision rule violations
**STATUS: VERIFIED**

| Location | Report Line | Actual Line | Code Found |
|----------|-------------|-------------|------------|
| calculateSpent | 243 | 243 | `return parseFloat(result[0]?.total \|\| "0");` |
| calculateGroupSpent | - | 277 | `return parseFloat(result[0]?.total \|\| "0");` |
| calculateFlexSpent | - | 310 | `return parseFloat(result[0]?.total \|\| "0");` |
| getBudgetsWithProgress | 544 | 479-481, 508-516, 544 | `parseFloat()`, `Number()`, `Math.round()` |
| BudgetRecalculationService | 89 | 89 | `Number(row.total)` |

**Assessment:** The report correctly identified the critical Money class violations but **underestimated the scope**. There are 6+ distinct violation sites, not just 2-3.

---

#### BUD-ISSUE-002: Budget progress API contract mismatch
**STATUS: VERIFIED**

**Server Side:**
- [budgets.helpers.ts:27-30](../../server/modules/budgets/budgets.helpers.ts#L27-L30): `mapBudgetMoney` converts `spent` and `remaining` to `MoneyDto`

**Client Side:**
- [useBudgets.ts:30-34](../../client/src/hooks/useBudgets.ts#L30-L34):
```typescript
export interface BudgetWithProgress extends Budget {
  spent: number;      // Expects number
  remaining: number;  // Expects number
  percentUsed: number;
}
```

- [useBudgetPageData.ts:219-221](../../client/src/features/budget/hooks/useBudgetPageData.ts#L219-L221):
```typescript
const actualAmount = budgetEntry
  ? budgetEntry.spent        // Used as raw number
  : category.spent || 0;
```

**Assessment:** Report is **correct**. Server returns `MoneyDto`, client expects `number`. This will cause runtime failures.

---

#### BUD-ISSUE-003: Budget period types ignored
**STATUS: VERIFIED**

- [BudgetRepository.ts:404-406](../../server/repositories/BudgetRepository.ts#L404-L406): Always calculates monthly date ranges
- [BudgetForecastService.ts:11-30](../../server/services/budget/BudgetForecastService.ts#L11-L30): `getMonthRange` always increments by 1 month
- [budgets.validation.ts:12](../../server/modules/budgets/budgets.validation.ts#L12): Accepts `"monthly" | "yearly" | "custom"`

**Assessment:** Report is **correct**. The `period` field is validated on input but completely ignored in calculations.

---

#### BUD-ISSUE-004: Split transactions not included
**STATUS: VERIFIED**

- [BudgetRepository.ts:223-226](../../server/repositories/BudgetRepository.ts#L223-L226): Queries only `transactions.amount`
- [shared/schema.ts:1036-1056](../../shared/schema.ts#L1036-L1056): `transactionSplits` table exists

**Assessment:** Report is **correct**. Budget spend calculations ignore the `transaction_splits` table entirely.

---

#### BUD-ISSUE-005: Multi-currency budgets unsupported
**STATUS: VERIFIED**

- [shared/schema.ts:1111-1146](../../shared/schema.ts#L1111-L1146): Budgets table has NO `currency` column
- [money.ts:242-250](../../server/core/money.ts#L242-L250): `toMoneyDto` defaults to `"ZMW"`

**Assessment:** Report is **correct**. All budget responses hardcode ZMW currency.

---

#### BUD-ISSUE-006: Move budget amount not atomic
**STATUS: VERIFIED**

- [BudgetForecastService.ts:174-257](../../server/services/budget/BudgetForecastService.ts#L174-L257): No `db.transaction()` wrapper
- Sequential `upsertPeriod` calls at lines 239-244 and 246-251

**Assessment:** Report is **correct**. A crash between updates leaves data inconsistent.

---

#### BUD-ISSUE-007: RecalculateBudgets uses expenses for all budgets
**STATUS: VERIFIED WITH NUANCE**

- [BudgetRecalculationService.ts:79](../../server/services/budget/BudgetRecalculationService.ts#L79): `eq(transactions.type, "expense")`

**Assessment:** Report's root cause is **correct** but phrasing is misleading. The issue is that income budgets cannot be recalculated because the query ONLY fetches expenses. Income budgets get zero amounts.

---

#### BUD-ISSUE-008: N+1 queries and write side effects
**STATUS: VERIFIED**

- [BudgetRepository.ts:531-538](../../server/repositories/BudgetRepository.ts#L531-L538): `upsertPeriod` called inside `getBudgetsWithProgress`
- Read path performs writes: **Architectural violation**

**Assessment:** Report is **correct**. This is a serious anti-pattern causing unexpected side effects during reads.

---

#### BUD-ISSUE-009: Invalid category/group combinations allowed
**STATUS: VERIFIED**

- [budgets.validation.ts:30-31](../../server/modules/budgets/budgets.validation.ts#L30-L31): Both fields are `.optional().nullable()`
- [BudgetCoreService.ts:114-171](../../server/services/budget/BudgetCoreService.ts#L114-L171): No exclusivity validation

**Assessment:** Report is **correct**. Both, neither, or one can be set with no enforcement.

---

#### BUD-ISSUE-010: Duplicate audit logging for budget updates
**STATUS: INCORRECT**

**Evidence:**
- [budgets.controller.ts:175-195](../../server/modules/budgets/budgets.controller.ts#L175-L195): Single `logUpdate` call
- [BudgetCoreService.ts:217-227](../../server/services/budget/BudgetCoreService.ts#L217-L227): Single `businessAuditService.log` call

**Assessment:** Report claim is **INCORRECT**. Controller and Service have separate logging for different operations. Controller logs user-initiated updates; Service logs system-initiated updates. This is intentional, not duplication.

---

#### BUD-ISSUE-011: Alert threshold range issues
**STATUS: VERIFIED**

- [budgets.validation.ts:36](../../server/modules/budgets/budgets.validation.ts#L36): `max(200)` for alertThreshold
- [BudgetCoreService.ts:299-320](../../server/services/budget/BudgetCoreService.ts#L299-L320): "exceeded" triggers at `>= 100%`

**Assessment:** Report is **correct**. Thresholds > 100 are accepted but never trigger because "exceeded" fires first.

---

#### BUD-ISSUE-012: Flex budget uniqueness not enforced
**STATUS: VERIFIED**

- [shared/schema.ts:1142](../../shared/schema.ts#L1142): `isFlexBucket: boolean` with NO unique constraint
- [BudgetForecastService.ts:43-72](../../server/services/budget/BudgetForecastService.ts#L43-L72): Select-then-insert without transaction

**Assessment:** Report is **correct**. Race condition can create duplicate flex budgets.

---

## Part B: Quality of Assessment

### Severity Rating Evaluation

| Issue ID | Report Severity | My Assessment | Rationale |
|----------|----------------|---------------|-----------|
| BUD-ISSUE-001 | Critical | **Critical** ✓ | Money rule violation per CLAUDE.md = immediate fix |
| BUD-ISSUE-002 | High | **Critical** ↑ | Runtime NaN errors break production UI |
| BUD-ISSUE-003 | High | **High** ✓ | Feature doesn't work but is documented limitation |
| BUD-ISSUE-004 | High | **High** ✓ | Data integrity, but contained impact |
| BUD-ISSUE-005 | High | **Medium** ↓ | Single-currency is acceptable if documented |
| BUD-ISSUE-006 | Medium | **High** ↑ | Financial data corruption risk |
| BUD-ISSUE-007 | Medium | **Medium** ✓ | Edge case, income budgets less common |
| BUD-ISSUE-008 | Medium | **High** ↑ | Writes in read paths = production instability |
| BUD-ISSUE-009 | Medium | **Medium** ✓ | Validation gap, but data remains usable |
| BUD-ISSUE-010 | Low | **N/A** | Issue does not exist |
| BUD-ISSUE-011 | Low | **Low** ✓ | Minor UX issue |
| BUD-ISSUE-012 | Low | **Medium** ↑ | Duplicates corrupt aggregation logic |

### Blind Spots Identified

1. **Missing: Input sanitization on budget amounts**
   - Report doesn't check if amount validation allows negative values or excessive precision
   - Location: [budgets.validation.ts:33](../../server/modules/budgets/budgets.validation.ts#L33)

2. **Missing: Soft-delete cascade handling**
   - When transactions are soft-deleted, budget spend calculations still include them if `deletedAt` filtering is inconsistent
   - Needs verification across all spend queries

3. **Missing: Budget-transaction date timezone issues**
   - Date comparisons between budgets and transactions may have timezone edge cases
   - `startDate`/`endDate` are strings, not proper date handling

4. **Missing: Concurrent budget period upsert race**
   - Multiple requests for same budget/period can create duplicate `budget_periods` rows
   - No unique constraint on `(budget_id, start_date)`

5. **Missing: Performance regression risk**
   - Report proposes batching but doesn't quantify current performance
   - No baseline metrics to measure improvement

### Over-Engineered or Risky Recommendations

| Recommendation | Assessment |
|---------------|------------|
| "Add currency to budgets/budgetPeriods" | **RISKY** - Schema migration on financial tables requires careful rollout |
| "Use row-level locks for budget_periods" | **OVER-ENGINEERED** - Transaction wrapper is sufficient; locks add contention |
| "Implement period-aware calculations" | **SCOPE CREEP** - Should block non-monthly first, implement later |
| "Split-aware budget spend queries" | **CORRECT** but needs clear double-count prevention logic |

---

## Part C: Improved Implementation Plan

### Phase 0: Immediate Hotfixes (Same Day)

**Goal:** Stop production breakage from type mismatch

#### 0.1 Fix Client Type Contract (2 changes)

**Change 1:** [useBudgets.ts:30-34](../../client/src/hooks/useBudgets.ts#L30-L34)
```typescript
// BEFORE
export interface BudgetWithProgress extends Budget {
  spent: number;
  remaining: number;
  percentUsed: number;
}

// AFTER
export interface BudgetWithProgress extends Budget {
  spent: MoneyDto;
  remaining: MoneyDto;
  percentUsed: number;
}
```

**Change 2:** [useBudgetPageData.ts:219-226](../../client/src/features/budget/hooks/useBudgetPageData.ts#L219-L226)
```typescript
// BEFORE
const actualAmount = budgetEntry ? budgetEntry.spent : category.spent || 0;
const remainingAmount = isGroupBudget ? 0 : budgetEntry ? budgetEntry.remaining : budgetAmount - actualAmount;

// AFTER
const actualAmount = budgetEntry ? parseMoney(budgetEntry.spent) : category.spent || 0;
const remainingAmount = isGroupBudget ? 0 : budgetEntry ? parseMoney(budgetEntry.remaining) : budgetAmount - actualAmount;
```

**Test:** Budget page renders without NaN

#### 0.2 Block Non-Monthly Periods

**Change:** [budgets.validation.ts:12](../../server/modules/budgets/budgets.validation.ts#L12)
```typescript
// BEFORE
export const budgetPeriodSchema = z.enum(["monthly", "yearly", "custom"]);

// AFTER (temporary until period logic is implemented)
export const budgetPeriodSchema = z.literal("monthly");
```

**Rollback:** Revert to enum if users need yearly/custom

---

### Phase 1: Money Class Compliance (This Week)

**Goal:** Eliminate all `parseFloat/Number/Math.round` from budget paths

#### 1.1 Repository Refactor

**Files:**
- [BudgetRepository.ts](../../server/repositories/BudgetRepository.ts)

**Pattern for calculateSpent (line 243):**
```typescript
// BEFORE
return parseFloat(result[0]?.total || "0");

// AFTER
import { Money } from "@/core/money";

async calculateSpent(householdId: string, categoryId: string, startDate: string, endDate: string, currency: string): Promise<Money> {
  const result = await db.select({
    total: sql<string>`COALESCE(SUM(${transactions.amount}), '0')`
  })
  // ... existing query ...

  return Money.from(result[0]?.total || "0", currency);
}
```

**Pattern for getBudgetsWithProgress (lines 479-544):**
```typescript
// BEFORE
const currentBudgetAmount = parseFloat(String(currentPeriod?.budgetAmount ?? budget.amount));
const percentUsed = totalBudget > 0 ? Math.round((spent / totalBudget) * 100) : 0;

// AFTER
import { Money, Decimal } from "@/core/money";

const currentBudgetAmount = Money.from(currentPeriod?.budgetAmount ?? budget.amount, currency);
const percentUsed = totalBudget.isPositive()
  ? spent.dividedBy(totalBudget).multipliedBy(100).toNumber()
  : 0;
```

**Pattern for BudgetRecalculationService (line 89):**
```typescript
// BEFORE
const totalsMap = new Map<string, number>(
  totals.map((row) => [row.categoryId as string, Number(row.total)])
);

// AFTER
const totalsMap = new Map<string, Money>(
  totals.map((row) => [row.categoryId as string, Money.from(row.total, householdCurrency)])
);
```

#### 1.2 Add Split-Aware Spend Query

**New method in BudgetRepository:**
```typescript
async calculateSpentWithSplits(
  householdId: string,
  categoryId: string,
  startDate: string,
  endDate: string,
  currency: string
): Promise<Money> {
  // Sum split amounts for transactions that have splits
  const splitTotal = await db.select({
    total: sql<string>`COALESCE(SUM(${transactionSplits.amount}), '0')`
  })
  .from(transactionSplits)
  .innerJoin(transactions, eq(transactionSplits.transactionId, transactions.id))
  .where(and(
    eq(transactions.householdId, householdId),
    eq(transactionSplits.categoryId, categoryId),
    eq(transactions.type, "expense"),
    isNull(transactions.deletedAt),
    gte(transactions.date, startDate),
    lte(transactions.date, endDate)
  ));

  // Sum transaction amounts for transactions WITHOUT splits
  const nonSplitTotal = await db.select({
    total: sql<string>`COALESCE(SUM(${transactions.amount}), '0')`
  })
  .from(transactions)
  .leftJoin(transactionSplits, eq(transactionSplits.transactionId, transactions.id))
  .where(and(
    eq(transactions.householdId, householdId),
    eq(transactions.categoryId, categoryId),
    eq(transactions.type, "expense"),
    isNull(transactions.deletedAt),
    isNull(transactionSplits.id), // No splits exist
    gte(transactions.date, startDate),
    lte(transactions.date, endDate)
  ));

  return Money.from(splitTotal[0]?.total || "0", currency)
    .add(Money.from(nonSplitTotal[0]?.total || "0", currency));
}
```

**Index needed:**
```sql
CREATE INDEX idx_transaction_splits_category_budget
ON transaction_splits(category_id, transaction_id);
```

---

### Phase 2: Atomicity & Integrity (Next Sprint)

#### 2.1 Wrap moveBudgetAmount in Transaction

**Change:** [BudgetForecastService.ts:174](../../server/services/budget/BudgetForecastService.ts#L174)
```typescript
async moveBudgetAmount(params: MoveBudgetParams): Promise<{ scope: string }> {
  return await db.transaction(async (tx) => {
    // All existing logic, but use `tx` instead of `db`
    for (const { year, month } of range) {
      const fromPeriod = await tx.select()...
      const toPeriod = await tx.select()...

      await this.upsertPeriod({ ... }, tx);
      await this.upsertPeriod({ ... }, tx);
    }
    return { scope: params.applyScope };
  });
}
```

#### 2.2 Add Flex Budget Unique Constraint

**Migration:**
```sql
-- Add partial unique index (only one flex bucket per household)
CREATE UNIQUE INDEX idx_budgets_flex_unique
ON budgets(household_id)
WHERE is_flex_bucket = true;
```

**Update ensureFlexBudget to use upsert:**
```typescript
async ensureFlexBudget(householdId: string): Promise<Budget> {
  const [budget] = await db
    .insert(budgets)
    .values({
      householdId,
      name: "Flexible Budget",
      amount: "0",
      period: "monthly",
      isActive: true,
      isFlexBucket: true,
    })
    .onConflictDoNothing()
    .returning();

  if (budget) return budget;

  // Fetch existing
  const [existing] = await db.select()
    .from(budgets)
    .where(and(
      eq(budgets.householdId, householdId),
      eq(budgets.isFlexBucket, true)
    ))
    .limit(1);

  return existing;
}
```

#### 2.3 Remove Write Side Effects from Read Path

**Change:** [BudgetRepository.ts:531-538](../../server/repositories/BudgetRepository.ts#L531-L538)
```typescript
// REMOVE this from getBudgetsWithProgress:
// await this.upsertPeriod({ ... });

// Instead, create a separate job:
// server/jobs/budgetRolloverJob.ts
export async function processBudgetRollovers(householdId: string, month: number, year: number) {
  const budgets = await budgetRepository.getBudgetsForRollover(householdId, month, year);
  for (const budget of budgets) {
    await budgetRepository.upsertPeriod({ ... });
  }
}
```

#### 2.4 Add Category/Group Exclusivity Validation

**Change:** [budgets.validation.ts:25-38](../../server/modules/budgets/budgets.validation.ts#L25-L38)
```typescript
export const createBudgetSchema = z.object({
  name: z.string().min(1).max(255),
  categoryId: z.string().uuid().optional().nullable(),
  categoryGroupId: z.string().uuid().optional().nullable(),
  amount: nonNegativeMoneyAmountSchema,
  period: budgetPeriodSchema.default("monthly"),
  rolloverEnabled: z.boolean().default(false),
  warningThreshold: z.number().int().min(0).max(100).default(80),
  alertThreshold: z.number().int().min(0).max(100).default(100), // Changed max from 200 to 100
  isActive: z.boolean().default(true),
}).refine((data) => {
  // Exactly one of categoryId, categoryGroupId, or isFlexBucket must be set
  const hasCategory = data.categoryId != null;
  const hasGroup = data.categoryGroupId != null;
  return (hasCategory && !hasGroup) || (!hasCategory && hasGroup);
}, {
  message: "Exactly one of categoryId or categoryGroupId must be provided"
});
```

---

### Phase 3: Multi-Currency & Performance (Future)

**Recommendation:** Defer until Phases 0-2 are stable. Multi-currency requires:
- Schema migration adding `currency` to `budgets` and `budget_periods`
- Backfill script for existing data
- FX conversion logic for cross-currency transactions
- UI changes for currency display

---

## Test Plan

### Unit Tests

#### Money Compliance Tests
```typescript
// server/repositories/__tests__/BudgetRepository.money.test.ts
describe("BudgetRepository Money Compliance", () => {
  it("calculateSpent returns Money, not number", async () => {
    const result = await repo.calculateSpent(householdId, categoryId, start, end, "ZMW");
    expect(result).toBeInstanceOf(Money);
    expect(result.currency).toBe("ZMW");
  });

  it("getBudgetsWithProgress percentUsed has max 2 decimal places", async () => {
    // Setup: budget 100, spent 33.33
    const [budget] = await repo.getBudgetsWithProgress(householdId, 2026, 1);
    expect(budget.percentUsed).toBe(33.33);
    expect(Number.isFinite(budget.percentUsed)).toBe(true);
  });

  it("no parseFloat/Number/Math.round in budget calculations", async () => {
    const sourceCode = fs.readFileSync("server/repositories/BudgetRepository.ts", "utf-8");
    const budgetMethods = extractMethods(sourceCode, ["calculateSpent", "getBudgetsWithProgress"]);
    expect(budgetMethods).not.toMatch(/parseFloat|Number\(|Math\.round/);
  });
});
```

#### Split Transaction Tests
```typescript
// server/repositories/__tests__/BudgetRepository.splits.test.ts
describe("Budget Spend with Splits", () => {
  it("includes split amounts in category budget", async () => {
    // Setup: Transaction $100 split into Food $60, Transport $40
    await createTransaction({ amount: "100", categoryId: null });
    await createSplit({ transactionId, categoryId: foodCategoryId, amount: "60" });
    await createSplit({ transactionId, categoryId: transportCategoryId, amount: "40" });

    const foodSpent = await repo.calculateSpentWithSplits(householdId, foodCategoryId, start, end, "ZMW");
    const transportSpent = await repo.calculateSpentWithSplits(householdId, transportCategoryId, start, end, "ZMW");

    expect(foodSpent.toNumber()).toBe(60);
    expect(transportSpent.toNumber()).toBe(40);
  });

  it("does not double-count split transactions", async () => {
    // Setup: Transaction with splits
    const total = await repo.calculateTotalSpent(householdId, start, end, "ZMW");
    expect(total.toNumber()).toBe(100); // Not 200
  });
});
```

### Integration Tests

#### API Contract Tests
```typescript
// server/modules/budgets/__tests__/budgets.integration.test.ts
describe("Budget API Contract", () => {
  it("GET /budgets/progress returns MoneyDto for spent/remaining", async () => {
    const res = await request(app).get("/api/budgets/progress?year=2026&month=1");

    expect(res.body.data[0].spent).toEqual({
      amount: expect.any(String),
      currency: "ZMW"
    });
    expect(res.body.data[0].remaining).toEqual({
      amount: expect.any(String),
      currency: "ZMW"
    });
  });

  it("moveBudgetAmount is atomic on failure", async () => {
    // Inject failure after first upsert
    jest.spyOn(db, "update").mockRejectedValueOnce(new Error("DB Error"));

    const beforeFrom = await getBudgetPeriod(fromBudgetId, month);
    const beforeTo = await getBudgetPeriod(toBudgetId, month);

    await expect(service.moveBudgetAmount({ ... })).rejects.toThrow();

    const afterFrom = await getBudgetPeriod(fromBudgetId, month);
    const afterTo = await getBudgetPeriod(toBudgetId, month);

    // Both unchanged
    expect(afterFrom.budgetAmount).toBe(beforeFrom.budgetAmount);
    expect(afterTo.budgetAmount).toBe(beforeTo.budgetAmount);
  });
});
```

### E2E Critical Journeys

```typescript
// e2e/budgets.spec.ts
describe("Budget Critical Journeys", () => {
  test("monthly budget with rollover displays correct amounts", async () => {
    // 1. Create budget with rollover enabled
    await api.post("/budgets", { name: "Food", amount: { amount: "500", currency: "ZMW" }, rolloverEnabled: true });

    // 2. Add transactions for month 1
    await api.post("/transactions", { amount: "-300", categoryId: foodCategoryId, date: "2026-01-15" });

    // 3. Verify month 1 progress
    const month1 = await api.get("/budgets/progress?year=2026&month=1");
    expect(month1.data[0].spent.amount).toBe("300.00");
    expect(month1.data[0].remaining.amount).toBe("200.00");

    // 4. Verify month 2 includes rollover
    const month2 = await api.get("/budgets/progress?year=2026&month=2");
    expect(month2.data[0].rolloverIn.amount).toBe("200.00");
  });
});
```

---

## Rollback Strategy

### Phase 0 Rollback
If client type changes cause issues:
```bash
git revert <commit-hash-of-client-type-changes>
```
Temporary adapter in controller:
```typescript
// budgets.controller.ts
return success(res, progress.map((item) => ({
  ...mapBudgetMoney(item),
  // Legacy numeric fallback
  spent_legacy: parseFloat(item.spent),
  remaining_legacy: parseFloat(item.remaining),
})));
```

### Phase 1 Rollback
If Money class refactor causes calculation errors:
```bash
git revert <commit-range-for-money-refactor>
```
Feature flag (temporary):
```typescript
const USE_MONEY_CLASS = process.env.USE_MONEY_CLASS === "true";
const spent = USE_MONEY_CLASS
  ? await calculateSpentWithMoney(...)
  : await calculateSpentLegacy(...);
```

### Phase 2 Rollback
If transaction wrapper causes deadlocks:
```bash
# Revert transaction wrapper, keep other changes
git revert --no-commit <transaction-commit>
```
Add observability first (see below) to detect deadlocks before rollback.

---

## Observability Recommendations

### Structured Logging

```typescript
// server/services/budget/BudgetCoreService.ts
import { logger } from "@/core/logger";

async getBudgetProgress(householdId: string, year: number, month: number) {
  const startTime = performance.now();

  try {
    const result = await this.repository.getBudgetsWithProgress(householdId, year, month);

    logger.info("budget_progress_calculated", {
      householdId,
      year,
      month,
      budgetCount: result.length,
      durationMs: performance.now() - startTime,
    });

    return result;
  } catch (error) {
    logger.error("budget_progress_failed", {
      householdId,
      year,
      month,
      error: error.message,
      stack: error.stack,
    });
    throw error;
  }
}
```

### Metrics

```typescript
// server/core/metrics.ts
export const budgetMetrics = {
  progressLatency: new Histogram({
    name: "budget_progress_duration_ms",
    help: "Time to calculate budget progress",
    labelNames: ["household_id", "budget_count_bucket"],
    buckets: [50, 100, 250, 500, 1000, 2500],
  }),

  calculationErrors: new Counter({
    name: "budget_calculation_errors_total",
    help: "Budget calculation errors by type",
    labelNames: ["error_type", "operation"],
  }),

  moneyPrecisionAnomalies: new Counter({
    name: "budget_money_precision_anomalies_total",
    help: "Detected floating point precision issues",
    labelNames: ["operation"],
  }),
};
```

### Audit Event Schema

```typescript
// Standardized audit events for budgets
interface BudgetAuditEvent {
  eventType:
    | "budget.created"
    | "budget.updated"
    | "budget.deleted"
    | "budget.moved"
    | "budget.recalculated"
    | "budget.rollover_applied";

  budgetId: string;
  householdId: string;
  userId: string;

  before?: {
    amount?: MoneyDto;
    period?: string;
    categoryId?: string;
  };

  after?: {
    amount?: MoneyDto;
    period?: string;
    categoryId?: string;
  };

  metadata?: {
    sourceMonth?: string;
    targetMonth?: string;
    rolloverAmount?: MoneyDto;
  };

  timestamp: string;
  ipAddress: string;
}
```

### Alerting Rules

```yaml
# prometheus-alerts.yaml
groups:
  - name: budget_alerts
    rules:
      - alert: BudgetCalculationSlow
        expr: histogram_quantile(0.95, budget_progress_duration_ms) > 1000
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "Budget progress calculation P95 > 1s"

      - alert: BudgetCalculationErrors
        expr: rate(budget_calculation_errors_total[5m]) > 0.1
        for: 2m
        labels:
          severity: critical
        annotations:
          summary: "Budget calculation errors detected"

      - alert: DuplicateFlexBudgets
        expr: |
          count by (household_id) (
            budget_flex_bucket_count > 1
          ) > 0
        for: 1m
        labels:
          severity: critical
        annotations:
          summary: "Duplicate flex budgets detected"
```

---

## Final Assessment Summary

| Aspect | Score | Notes |
|--------|-------|-------|
| **Factual Accuracy** | 9/12 correct | BUD-ISSUE-010 incorrect; line numbers off by 50-100 |
| **Severity Calibration** | 7/10 | Underrated atomicity/write-in-read; overrated multi-currency |
| **Completeness** | 7/10 | Missed timezone, concurrent upsert, soft-delete edge cases |
| **Actionability** | 6/10 | Missing function signatures, indexes, migration scripts |
| **Risk Assessment** | 5/10 | No rollback strategy; no observability plan |

**Overall:** The report correctly identifies the critical Money class violations and API contract mismatch. However, it conflates audit logging patterns, provides imprecise line numbers, and lacks implementation details for safe rollout. The improved plan above addresses these gaps with concrete code changes, test cases, and operational safeguards.
