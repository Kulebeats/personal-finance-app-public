# Goals + Recurring Modules - Implementation Plan

**Date:** 2026-01-20
**Updated:** 2026-01-29
**Status:** ✅ COMPLETE - All Modules Done
**Completion Date:** 2026-01-29
**Total Time:** Completed in planned timeframe
**Modules:** Goals, Recurring, Shared utilities

---

## Executive Summary

This plan addresses 35+ critical and high-priority issues across Goals and Recurring modules, organized into 5 phases.

**Completion Status:**

### Goals Module: ✅ COMPLETE (100/100 score)
- ✅ All P0 issues fixed (parseFloat violations, race conditions, LOC limits)
- ✅ All P1 issues fixed (validation, rate limiting)
- ✅ All integration tests passing
- ✅ See module-status/goals-module-status-2026-01-23.md for details

### Recurring Module: ✅ COMPLETE (100/100 score)
- ✅ All phases complete (REC-001 through REC-011 fixed)
- ✅ Money handling implemented correctly
- ✅ Type safety achieved
- ✅ Test coverage complete
- ✅ See module-status/recurring-module-status-2026-01-23.md for details

---

## Pre-Implementation Checklist

Before starting ANY phase:

- [ ] Create feature branch: `git checkout -b fix/goals-recurring-combined`
- [ ] Ensure tests pass: `npm run test:run && npm run test:server:run`
- [ ] Ensure type check passes: `npm run check`
- [ ] Document current state:
  ```powershell
  # Save baseline metrics
  grep -rn "parseFloat\|Math\.round" server/services/goal server/jobs server/repositories/RecurringRepository.ts > baseline-money-violations.txt
  grep -rn "as any" server/ client/ --include="*.ts" --include="*.tsx" > baseline-type-casts.txt
  npm run test:server:run -- --coverage > baseline-test-coverage.txt
  ```

---

## PHASE 0: Already Completed ✅

### ISSUE-REC-001: Money Handling in RecurringRepository ✅
- **Status:** FIXED (2026-01-20)
- **Verification:** Confirmed in known-issues.md

### ISSUE-REC-NEW-001: Client-Server Endpoint Mismatches ✅
- **Status:** FIXED (2026-01-20)
- **Verification:** Confirmed in known-issues.md

---

## PHASE 1: Critical Money Precision Fixes (P0)

**Duration:** 1-2 days
**Risk Level:** HIGH (affects financial calculations)
**Dependencies:** None

### Goals for Phase 1
- Eliminate all parseFloat/Math.round in financial code paths
- Fix Money -> Number -> Money antipatterns
- Create shared Money utilities

---

### TASK 1.1: Fix GoalStatusWorker Money Violations ⚠️ CRITICAL

**Issue ID:** GOAL-MONEY-001
**Files:** `server/jobs/goalStatusWorker.ts`
**Lines:** 9, 10, 14, 17, 51, 80, 81
**Time Estimate:** 2 hours

#### Current State (INCORRECT):
```typescript
const previousAmount = parseFloat(String(goal.currentAmount));
const nextAmount = parseFloat(update.currentAmount);

const previousProjection = goal.monthlyProjection
  ? parseFloat(String(goal.monthlyProjection))
  : null;
const nextProjection = update.monthlyProjection
  ? parseFloat(update.monthlyProjection)
  : null;

const currentBalance = parseFloat(String(goal.currentAmount));
```

#### Implementation Steps:

**Step 1.1.1:** Import Money class and add currency parameter
```typescript
// Add to imports
import { Money } from "../core/money";

// Update function signature (line 5)
export async function checkGoalStatusChange(
  goal: any,
  update: any,
  currency: string  // ✅ ADD THIS
): Promise<void>
```

**Step 1.1.2:** Replace all parseFloat with Money operations
```typescript
// Lines 9-10
const previousAmount = new Money(goal.currentAmount, currency);
const nextAmount = new Money(update.currentAmount, currency);

// Lines 14-17
const previousProjection = goal.monthlyProjection
  ? new Money(goal.monthlyProjection, currency)
  : null;
const nextProjection = update.monthlyProjection
  ? new Money(update.monthlyProjection, currency)
  : null;

// Line 51
const currentBalance = new Money(goal.currentAmount, currency);
```

**Step 1.1.3:** Update comparison logic
```typescript
// Line 12 - Replace number comparison with Money.equals()
const hasAmountChanged = !previousAmount.equals(nextAmount);

// Lines 18-20 - Handle projection comparison
const hasProjectionChanged =
  (!previousProjection && nextProjection) ||
  (previousProjection && !nextProjection) ||
  (previousProjection && nextProjection && !previousProjection.equals(nextProjection));
```

**Step 1.1.4:** Update notification payload (lines 80-81)
```typescript
details: {
  goalId: goal.id,
  previousBalance: previousAmount.toString(),  // ✅ String instead of number
  newBalance: nextAmount.toString(),           // ✅ String instead of number
  currency: currency,                          // ✅ Add currency context
},
```

**Step 1.1.5:** Update all callers to pass currency
```bash
# Find all callers
grep -rn "checkGoalStatusChange" server/ --include="*.ts"
```

Expected callers:
- `server/jobs/goalStatusWorker.ts` (main worker loop)
- Add `currency: goal.currency` to all calls

#### Verification Steps:

```powershell
# 1. Type check
npm run check

# 2. Verify no parseFloat remains in goalStatusWorker
grep -n "parseFloat" server/jobs/goalStatusWorker.ts
# Expected: 0 matches

# 3. Run goal-related tests
npm run test:server:run -- goalStatusWorker

# 4. Manual test: Create goal, add transaction, verify notification has currency
# Use API: POST /api/goals/:id/transactions
# Check: audit_logs table should show currency in details JSON
```

#### Rollback Plan:
```bash
git checkout server/jobs/goalStatusWorker.ts
```

---

### TASK 1.2: Audit & Fix SnapshotWorker Money Violations ⚠️ NEW CRITICAL

**Issue ID:** SNAP-001
**Files:** `server/jobs/snapshotWorker.ts`
**Lines:** TBD (needs audit)
**Time Estimate:** 3 hours

#### Step 1.2.1: Audit for violations
```powershell
grep -n "parseFloat\|Math\.round\|\.toNumber()" server/jobs/snapshotWorker.ts
```

Expected output: List of lines with Money violations

#### Step 1.2.2: Read file and assess scope
```bash
# Count total violations
grep -c "parseFloat\|Math\.round" server/jobs/snapshotWorker.ts
```

#### Implementation Pattern (for each violation):
```typescript
// BEFORE
const amount = parseFloat(record.balance);
const total = Math.round(sum * 100) / 100;

// AFTER
const amount = new Money(record.balance, record.currency || "ZMW");
const total = Money.sum(amounts);  // Use Money.sum if available, or loop with .add()
```

#### Step 1.2.3: Update snapshot record creation
```typescript
// Ensure snapshots store Money as strings
await db.insert(accountSnapshots).values({
  accountId: account.id,
  balance: balance.toString(),  // ✅ String, not number
  currency: account.currency,   // ✅ Preserve currency
  snapshotDate: date,
});
```

#### Verification Steps:
```powershell
# 1. Verify no violations remain
grep -n "parseFloat\|Math\.round" server/jobs/snapshotWorker.ts
# Expected: 0 matches (except in comments if TODO removed)

# 2. Run snapshot tests if they exist
npm run test:server:run -- snapshot

# 3. Manual verification: Trigger snapshot creation
# POST /api/accounts/snapshot (if endpoint exists)
# Check: snapshots table has currency column populated
```

---

### TASK 1.3: Create Shared MoneyDto Utilities 🆕 INFRASTRUCTURE

**Issue ID:** MONEY-UTIL-001
**Files:** `client/src/lib/moneyDto.ts` (NEW)
**Time Estimate:** 3 hours

#### Step 1.3.1: Create utility file
```typescript
// client/src/lib/moneyDto.ts
import Decimal from "decimal.js";
import type { MoneyDto } from "@shared/money";

/**
 * Sum multiple MoneyDto amounts with precision
 * Assumes all amounts have the same currency (enforced by UI)
 */
export function sumMoneyDto(amounts: MoneyDto[]): MoneyDto {
  if (amounts.length === 0) {
    return { amount: "0.00", currency: "ZMW" };
  }

  const currency = amounts[0].currency;
  const total = amounts.reduce((sum, moneyDto) => {
    const value = new Decimal(moneyDto.amount.replace(/,/g, ""));
    return sum.plus(value);
  }, new Decimal(0));

  return {
    amount: total.toFixed(2),
    currency,
  };
}

/**
 * Subtract two MoneyDto amounts
 */
export function subtractMoneyDto(a: MoneyDto, b: MoneyDto): MoneyDto {
  if (a.currency !== b.currency) {
    throw new Error(`Currency mismatch: ${a.currency} vs ${b.currency}`);
  }

  const aDecimal = new Decimal(a.amount.replace(/,/g, ""));
  const bDecimal = new Decimal(b.amount.replace(/,/g, ""));
  const result = aDecimal.minus(bDecimal);

  return {
    amount: result.toFixed(2),
    currency: a.currency,
  };
}

/**
 * Compare two MoneyDto amounts
 * Returns: -1 if a < b, 0 if equal, 1 if a > b
 */
export function compareMoneyDto(a: MoneyDto, b: MoneyDto): number {
  if (a.currency !== b.currency) {
    throw new Error(`Currency mismatch: ${a.currency} vs ${b.currency}`);
  }

  const aDecimal = new Decimal(a.amount.replace(/,/g, ""));
  const bDecimal = new Decimal(b.amount.replace(/,/g, ""));

  return aDecimal.comparedTo(bDecimal);
}

/**
 * Multiply MoneyDto by a scalar (for percentages, etc.)
 */
export function multiplyMoneyDto(money: MoneyDto, multiplier: number): MoneyDto {
  const decimal = new Decimal(money.amount.replace(/,/g, ""));
  const result = decimal.times(multiplier);

  return {
    amount: result.toFixed(2),
    currency: money.currency,
  };
}

/**
 * Check if MoneyDto is zero
 */
export function isZeroMoneyDto(money: MoneyDto): boolean {
  const decimal = new Decimal(money.amount.replace(/,/g, ""));
  return decimal.isZero();
}

/**
 * Format MoneyDto for display (delegates to existing formatMoney)
 */
export function formatMoneyDto(money: MoneyDto): string {
  // Import existing formatMoney utility
  const { formatMoney } = require("./money");
  return formatMoney(money);
}
```

#### Step 1.3.2: Add tests
```typescript
// client/src/lib/__tests__/moneyDto.test.ts
import { describe, it, expect } from "vitest";
import {
  sumMoneyDto,
  subtractMoneyDto,
  compareMoneyDto,
  multiplyMoneyDto,
  isZeroMoneyDto,
} from "../moneyDto";

describe("moneyDto utilities", () => {
  it("sums money with precision", () => {
    const result = sumMoneyDto([
      { amount: "0.10", currency: "ZMW" },
      { amount: "0.20", currency: "ZMW" },
    ]);
    expect(result.amount).toBe("0.30"); // Not 0.30000000000000004
  });

  it("handles empty array", () => {
    const result = sumMoneyDto([]);
    expect(result).toEqual({ amount: "0.00", currency: "ZMW" });
  });

  it("subtracts money correctly", () => {
    const result = subtractMoneyDto(
      { amount: "100.00", currency: "ZMW" },
      { amount: "30.50", currency: "ZMW" }
    );
    expect(result.amount).toBe("69.50");
  });

  it("compares money correctly", () => {
    const a = { amount: "100.00", currency: "ZMW" };
    const b = { amount: "50.00", currency: "ZMW" };
    expect(compareMoneyDto(a, b)).toBe(1);
    expect(compareMoneyDto(b, a)).toBe(-1);
    expect(compareMoneyDto(a, a)).toBe(0);
  });

  it("throws on currency mismatch", () => {
    expect(() =>
      subtractMoneyDto(
        { amount: "100.00", currency: "ZMW" },
        { amount: "50.00", currency: "USD" }
      )
    ).toThrow("Currency mismatch");
  });
});
```

#### Verification Steps:
```powershell
# 1. Run tests
npm run test:run -- moneyDto.test.ts

# 2. Type check
npm run check

# 3. Verify exports
# Import in another file to ensure it works
```

---

### TASK 1.4: Fix Money -> Number -> Money Antipattern

**Issue ID:** REC-007
**Files:** `server/services/recurring/RecurringProcessingService.ts:32`
**Time Estimate:** 30 minutes

#### Current Code:
```typescript
const info = {
  id: rule.id,
  amount: toMoney(new Money(rule.amount).toNumber()),  // ❌ Wasteful conversion
  // ...
};
```

#### Fix:
```typescript
const info = {
  id: rule.id,
  amount: toMoney(rule.amount),  // ✅ Direct conversion
  // ...
};
```

#### Verification:
```powershell
# Verify fix applied
grep -n "toNumber()" server/services/recurring/RecurringProcessingService.ts
# Should not appear in financial calculations
```

---

## Phase 1 Verification Checklist

Before proceeding to Phase 2:

- [ ] **Money violations eliminated:**
  ```powershell
  grep -rn "parseFloat\|Math\.round" server/services/goal server/jobs server/repositories/RecurringRepository.ts
  # Expected: 0 matches in financial calculations (OK for percentages with comments)
  ```

- [ ] **Tests pass:**
  ```bash
  npm run test:server:run
  npm run test:run -- moneyDto.test.ts
  ```

- [ ] **Type check passes:**
  ```bash
  npm run check
  ```

- [ ] **Manual verification:**
  - [ ] Create goal with transaction → Check notification has currency
  - [ ] Trigger snapshot creation → Check snapshots table has currency
  - [ ] Test recurring summary → Check totals are strings with proper format

- [ ] **Commit checkpoint:**
  ```bash
  git add -A
  git commit -m "fix(money): eliminate parseFloat violations in Goals/Recurring

- Replace parseFloat with Money class in goalStatusWorker.ts
- Fix Money violations in snapshotWorker.ts
- Create shared MoneyDto utilities for client
- Fix Money -> Number -> Money antipattern in RecurringProcessingService

Fixes: GOAL-MONEY-001, SNAP-001, MONEY-UTIL-001, REC-007

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
  ```

---

## PHASE 2: Type Safety & Rate Limiting (P0)

**Duration:** 1-2 days
**Risk Level:** MEDIUM
**Dependencies:** None (can run parallel to Phase 1)

---

### TASK 2.1: Remove Server `as any` Casts in Recurring Module

**Issue ID:** REC-002
**Files:** 5 locations across recurring module
**Time Estimate:** 3 hours

#### Location 2.1.1: RecurringRepository.ts:205-206

**Current (INCORRECT):**
```typescript
calculateNextDate(
  currentDate: string,
  frequency: string,
  options?: {
    dayOfMonth?: number;
    dayOfWeek?: number;
    intervalValue?: number | null;
    intervalUnit?: string | null;
  }
): string {
  return calculateNextDate(currentDate, frequency as any, options as any);
}
```

**Fix:**
```typescript
import type { Frequency, IntervalUnit } from "../core/calculations";

// Define proper options type
interface CalculateNextDateOptions {
  dayOfMonth?: number;
  dayOfWeek?: number;
  intervalValue?: number | null;
  intervalUnit?: IntervalUnit | null;
}

calculateNextDate(
  currentDate: string,
  frequency: Frequency,  // ✅ Strong type
  options?: CalculateNextDateOptions
): string {
  return calculateNextDate(currentDate, frequency, options);  // ✅ No cast
}
```

#### Location 2.1.2: recurring.controller.ts:180

**Current (INCORRECT):**
```typescript
const rule = await recurringService.createRecurring(
  parseResult.data as any,  // ❌
  householdId,
  req.user!.id
);
```

**Fix Option 1 - Update schema transform:**
```typescript
// In recurring.validation.ts
export const createRecurringSchema = z.object({
  name: z.string().min(1).max(255),
  amount: positiveMoneyDtoSchema,
  type: z.enum(["income", "expense"]),
  frequency: z.enum(["weekly", "biweekly", "monthly", "yearly"]),
  // ... other fields
}).transform((data) => ({
  ...data,
  amount: data.amount.amount,      // Extract string from MoneyDto
  currency: data.amount.currency,  // Preserve currency
}));

export type CreateRecurringInput = z.infer<typeof createRecurringSchema>;
```

**Then in controller:**
```typescript
const rule = await recurringService.createRecurring(
  parseResult.data,  // ✅ Type-safe now
  householdId,
  req.user!.id
);
```

#### Location 2.1.3-2.1.5: Similar pattern for remaining casts

Follow same pattern:
1. Identify expected type
2. Update upstream schema/interface
3. Remove cast

#### Verification Steps:
```powershell
# 1. Check all casts removed
grep -n "as any" server/repositories/RecurringRepository.ts server/modules/recurring/recurring.controller.ts server/services/recurring/
# Expected: 0 matches

# 2. Type check
npm run check

# 3. Run tests
npm run test:server:run -- recurring
```

---

### TASK 2.2: Fix Client-Side `as any` Casts

**Issue ID:** REC-006, GOAL-TYPE-001
**Files:** `useRecurringPageData.ts`, `TransactionFormFields.tsx`, `GoalAccountsModal.tsx`, `GoalCreationWizard.tsx`
**Time Estimate:** 3 hours

#### Fix 2.2.1: useRecurringPageData.ts:128

```typescript
// BEFORE
frequency: editForm.frequency as any,

// AFTER
import type { Frequency } from "@/hooks/useRecurring";

frequency: editForm.frequency as Frequency,  // ✅ Explicit type, not any
```

#### Fix 2.2.2: TransactionFormFields.tsx:40-46

```typescript
// BEFORE
interface TransactionFormFieldsProps {
  form: UseFormReturn<TransactionFormValues>;
  settings: any;
  accounts: any[];
  receipt: any;
  createMerchant: any;
}

// AFTER
import type { Account } from "@/hooks/useAccounts";
import type { Settings } from "@/contexts/SettingsContext";
import type { ReceiptUpload } from "@/hooks/useReceipts";
import type { UseMutationResult } from "@tanstack/react-query";
import type { Merchant } from "@/lib/api";

interface TransactionFormFieldsProps {
  form: UseFormReturn<TransactionFormValues>;
  settings: Settings;
  accounts: Account[];
  receipt: ReceiptUpload | null;
  createMerchant: UseMutationResult<Merchant, Error, { name: string }>;
  isLoading: {
    accounts: boolean;
    categories: boolean;
  };
}
```

#### Fix 2.2.3: GoalAccountsModal.tsx + GoalCreationWizard.tsx

```typescript
// Define proper type (new file or at top of component)
interface AssignmentPayload {
  assignmentType: "percentage" | "fixed" | "remainder";
  percentage?: number;
  fixedAmount?: {
    amount: string;
    currency: string;
  };
}

// BEFORE
assignmentPayload as any

// AFTER
assignmentPayload  // Type inferred from AssignmentPayload
```

#### Verification:
```powershell
grep -n "as any" client/src/features/recurring client/src/features/goals client/src/components/transactions
# Expected: Significant reduction, none in financial data paths
```

---

### TASK 2.3: Add Rate Limiting to Recurring & Goals Routes

**Issue IDs:** REC-NEW-003, GOAL-010
**Files:** `server/modules/recurring/recurring.routes.ts`, `server/modules/goals/goals.routes.ts`
**Time Estimate:** 2 hours

#### Step 2.3.1: Add rate limiters to recurring routes

```typescript
// server/modules/recurring/recurring.routes.ts
import { generalLimiter, analyticsLimiter } from "../../middleware/rateLimit";

const router = Router();

// Apply general limiter to all routes
router.use(generalLimiter);  // 100 req/min

// List and CRUD
router.get("/", asyncHandler(recurringController.list));
router.post("/", asyncHandler(recurringController.create));
// ... other routes

// Heavy operations get stricter limits
router.post(
  "/detect",
  analyticsLimiter,  // 30 req/min
  requireRole("member"),
  asyncHandler(recurringController.detectPatterns)
);

router.get(
  "/summary",
  analyticsLimiter,  // 30 req/min
  asyncHandler(recurringController.getSummary)
);
```

#### Step 2.3.2: Add rate limiters to goals routes

```typescript
// server/modules/goals/goals.routes.ts
import { generalLimiter, analyticsLimiter } from "../../middleware/rateLimit";

const router = Router();

router.use(generalLimiter);  // 100 req/min for all goal operations

// Heavy operations
router.get(
  "/available-funds",
  analyticsLimiter,  // Calculates across all accounts
  asyncHandler(goalsController.getAvailableFunds)
);

router.get(
  "/:id/activity",
  analyticsLimiter,  // May query many transactions
  asyncHandler(goalsController.getActivity)
);
```

#### Step 2.3.3: (OPTIONAL) Add per-user rate limiting

**Issue ID:** RATE-LIMIT-001
**Priority:** P2 (can defer to later phase)

```typescript
// server/middleware/rateLimit.ts
import rateLimit from "express-rate-limit";

export const perUserLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 100,
  keyGenerator: (req) => {
    // Use user ID if authenticated, fall back to IP
    return req.user?.id || req.ip || "unknown";
  },
  message: "Too many requests from this account, please try again later",
  standardHeaders: true,
  legacyHeaders: false,
});
```

#### Verification:
```powershell
# 1. Check rate limiters applied
grep -n "Limiter" server/modules/recurring/recurring.routes.ts server/modules/goals/goals.routes.ts

# 2. Manual test (use curl or Postman)
# Make 101 requests to /api/recurring in 1 minute
# Expected: 101st request returns 429 Too Many Requests

# 3. Test heavy endpoint limiter
# Make 31 requests to /api/recurring/detect
# Expected: 31st request returns 429
```

---

## Phase 2 Verification Checklist

- [ ] **Type safety improved:**
  ```powershell
  grep -rn "as any" server/modules/recurring server/services/recurring client/src/features/recurring client/src/features/goals
  # Expected: Minimal matches, none in critical paths
  ```

- [ ] **Rate limiting active:**
  - [ ] Test: 101 requests to `/api/recurring` → 429 on 101st
  - [ ] Test: 31 requests to `/api/recurring/detect` → 429 on 31st
  - [ ] Check response headers include `X-RateLimit-*` headers

- [ ] **Tests pass:**
  ```bash
  npm run test:server:run
  npm run test:run
  npm run check
  ```

- [ ] **Commit checkpoint:**
  ```bash
  git add -A
  git commit -m "fix(types): remove as any casts and add rate limiting

- Remove server-side as any casts in recurring module
- Fix client type safety in forms and hooks
- Add rate limiting to recurring and goals routes
- Apply stricter limits to expensive operations

Fixes: REC-002, REC-006, GOAL-TYPE-001, REC-NEW-003, GOAL-010

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
  ```

---

## PHASE 3: Client Money Handling & Validation (P1)

**Duration:** 2-3 days
**Risk Level:** MEDIUM
**Dependencies:** Phase 1 (MONEY-UTIL-001 must be complete)

---

### TASK 3.1: Fix CalendarItem.amount Type Mismatch

**Issue ID:** REC-005
**Files:** `client/src/features/recurring/types.ts`, `useRecurringPageData.ts`, `RecurringCalendar.tsx`
**Time Estimate:** 2 hours

#### Step 3.1.1: Update type definition

```typescript
// client/src/features/recurring/types.ts
import type { MoneyDto } from "@shared/money";

export interface CalendarItem {
  id: string;
  day: number;
  name: string;
  amount: MoneyDto;  // ✅ Changed from number
  type: "bill" | "income";
  category?: string;
  status?: "due" | "paid" | "overdue";
}
```

#### Step 3.1.2: Update data mapping

```typescript
// client/src/features/recurring/hooks/useRecurringPageData.ts:69
return {
  id: item.id,
  day: new Date(item.nextDueDate).getDate(),
  name: item.name,
  amount: item.amount,  // ✅ Keep MoneyDto (was: parseMoney(item.amount))
  type: item.type === "expense" ? "bill" : "income",
  category: item.category,
  status: determineStatus(item),
} as CalendarItem;
```

#### Step 3.1.3: Update display components

```typescript
// client/src/features/recurring/components/RecurringCalendar.tsx
import { formatMoneyDto } from "@/lib/moneyDto";

// In render
<span className="amount">
  {formatMoneyDto(item.amount)}  {/* ✅ Use MoneyDto formatter */}
</span>
```

#### Verification:
```powershell
# 1. Type check
npm run check

# 2. Visual test
# Navigate to Recurring Calendar page
# Verify amounts display with currency symbol

# 3. Test multi-currency (if applicable)
# Create recurring items in different currencies
# Verify calendar shows correct currency for each
```

---

### TASK 3.2: Fix Client Totals with MoneyDto Summation

**Issue ID:** REC-NEW-005
**Files:** `client/src/features/recurring/hooks/useRecurringPageData.ts:83-95`
**Time Estimate:** 1 hour

#### Current (INCORRECT):
```typescript
const totalRecurring =
  recurringData?.reduce((sum, r) => sum + parseMoney(r.amount), 0) || 0;
const billsTotal =
  recurringData
    ?.filter((r) => r.type === "expense")
    .reduce((sum, r) => sum + parseMoney(r.amount), 0) || 0;
```

#### Fix:
```typescript
import { sumMoneyDto } from "@/lib/moneyDto";

const totalRecurring = recurringData
  ? sumMoneyDto(recurringData.map((r) => r.amount))
  : { amount: "0.00", currency: defaultCurrency };

const billsTotal = recurringData
  ? sumMoneyDto(
      recurringData
        .filter((r) => r.type === "expense")
        .map((r) => r.amount)
    )
  : { amount: "0.00", currency: defaultCurrency };

const incomeTotal = recurringData
  ? sumMoneyDto(
      recurringData
        .filter((r) => r.type === "income")
        .map((r) => r.amount)
    )
  : { amount: "0.00", currency: defaultCurrency };
```

#### Step 3.2.2: Update display to use MoneyDto
```typescript
// In component that displays totals
<div>Total Bills: {formatMoneyDto(billsTotal)}</div>
<div>Total Income: {formatMoneyDto(incomeTotal)}</div>
```

#### Verification:
```powershell
# Manual test
# 1. Create 3 recurring expenses: 0.10, 0.20, 0.30 ZMW
# 2. Check total displays: "0.60 ZMW" (not 0.6000000000000001)
```

---

### TASK 3.3: Fix RecurringTransactionLink Type Mismatch

**Issue ID:** REC-NEW-006
**Files:** `client/src/hooks/useRecurring.ts:238-239`
**Time Estimate:** 1 hour

#### Update type definition:
```typescript
// client/src/hooks/useRecurring.ts
import type { MoneyDto } from "@shared/money";

export interface RecurringTransactionLink {
  id: string;
  recurringTransactionId: string;
  transactionId: string;
  matchConfidence?: number | null;
  matchMethod?: "auto" | "manual" | "confirmed" | null;
  expectedDate?: string | null;
  actualDate?: string | null;
  expectedAmount?: MoneyDto | null;  // ✅ Changed from string | null
  actualAmount?: MoneyDto | null;     // ✅ Changed from string | null
  status?: string | null;
  createdAt: string;
}
```

#### Update display components:
```typescript
// Wherever RecurringTransactionLink is displayed
import { formatMoneyDto } from "@/lib/moneyDto";

<div>
  Expected: {link.expectedAmount ? formatMoneyDto(link.expectedAmount) : "N/A"}
</div>
<div>
  Actual: {link.actualAmount ? formatMoneyDto(link.actualAmount) : "N/A"}
</div>
```

#### Verification:
```bash
npm run check  # Should pass with no type errors on RecurringTransactionLink
```

---

### TASK 3.4: Replace parseFloat in Goals UI Components

**Issue ID:** GOAL-CLIENT-001
**Files:** `GoalCard.tsx`, `GoalListItem.tsx`, `GoalActivityItem.tsx` (54 instances)
**Time Estimate:** 4 hours

#### Strategy:
1. Use MoneyDto for all financial amounts
2. Use existing `parseMoney()` utility for display ONLY (not calculations)
3. For progress bars, calculate percentage server-side if possible

#### Example Fix (GoalCard.tsx):
```typescript
// BEFORE
const progress = (parseFloat(goal.currentAmount) / parseFloat(goal.targetAmount)) * 100;

// AFTER - Option 1: Server calculates
const progress = goal.progressPercentage;  // Add to API response

// AFTER - Option 2: Client calculates with MoneyDto
import { compareMoneyDto } from "@/lib/moneyDto";
const current = goal.currentAmount;  // Already MoneyDto
const target = goal.targetAmount;    // Already MoneyDto
const progress = (parseFloat(current.amount) / parseFloat(target.amount)) * 100;
// Note: Division is OK for percentage calculation, not for money storage
```

#### Verification:
```powershell
# Find remaining parseFloat in goals components
grep -n "parseFloat" client/src/features/goals/components/
# Expect: Minimal, only for percentage calculations with comments
```

---

### TASK 3.5: Add Validation Gaps Fixes

**Issue ID:** REC-011
**Files:** `server/modules/recurring/recurring.validation.ts`
**Time Estimate:** 2 hours

#### Fix 3.5.1: Date validation (lines 48, 52, 55, 195)

```typescript
// Create shared date validator
const validDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid date format (YYYY-MM-DD)")
  .refine((date) => {
    const parsed = new Date(date);
    return (
      !isNaN(parsed.getTime()) &&
      date === parsed.toISOString().split("T")[0]
    );
  }, "Invalid date (e.g., Feb 30 doesn't exist)");

// Use in schemas
nextDueDate: validDateSchema,
endDate: validDateSchema.optional(),
```

#### Fix 3.5.2: parseInt radix (lines 246, 295)

```typescript
// BEFORE
.transform((v) => parseInt(v))

// AFTER
.transform((v) => {
  const parsed = parseInt(v, 10);
  if (isNaN(parsed)) {
    throw new Error("Invalid number");
  }
  return parsed;
})
```

#### Fix 3.5.3: amountVariance max (line 267)

```typescript
// BEFORE
amountVariance: z.number().min(0).optional(),

// AFTER
amountVariance: z.number().min(0).max(100).optional(),  // Cap at 100%
```

#### Fix 3.5.4: dayOfMonth validation (lines 56, 195)

```typescript
// BEFORE
dayOfMonth: z.number().min(1).max(31).optional(),

// AFTER
dayOfMonth: z.number().min(1).max(28).optional(),  // Safe for all months
// OR add refinement for month-specific validation
dayOfMonth: z.number().min(1).max(31).optional().refine((day) => {
  if (!day) return true;
  // For monthly frequency, restrict to 1-28 to avoid month-end issues
  return day <= 28;
}, "Day must be 1-28 to work for all months"),
```

#### Verification:
```bash
# Test invalid inputs
curl -X POST /api/recurring \
  -H "Content-Type: application/json" \
  -d '{"nextDueDate": "2025-02-30"}'  # Should return 400 validation error
```

---

### TASK 3.6: Add Client-Side Form Validation with Zod

**Issue ID:** CLIENT-VALIDATION-001
**Files:** `GoalCreationWizard.tsx`, `RecurringForm.tsx` (if exists)
**Time Estimate:** 3 hours

#### Install dependencies (if not present):
```bash
npm install @hookform/resolvers
```

#### Example: GoalCreationWizard.tsx

```typescript
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { positiveMoneyDtoSchema } from "@shared/validation/money";

// Define form schema (can share with server if possible)
const createGoalFormSchema = z.object({
  name: z.string().min(1, "Name is required").max(255),
  type: z.enum(["savings", "debt", "investment"]),
  targetAmount: positiveMoneyDtoSchema,
  targetDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  // ... other fields
});

type CreateGoalFormValues = z.infer<typeof createGoalFormSchema>;

// In component
const form = useForm<CreateGoalFormValues>({
  resolver: zodResolver(createGoalFormSchema),  // ✅ Zod validation
  defaultValues: {
    name: "",
    type: "savings",
    targetAmount: { amount: "0.00", currency: "ZMW" },
  },
});

// On submit
const onSubmit = (data: CreateGoalFormValues) => {
  // Data is validated by Zod before this runs
  createGoal.mutate(data);
};
```

#### Verification:
```powershell
# 1. Try submitting empty form
# Expected: Validation errors shown inline

# 2. Try invalid date (e.g., "2025-13-45")
# Expected: Error before API call

# 3. Check browser console
# Expected: No runtime type errors
```

---

## Phase 3 Verification Checklist

- [ ] **MoneyDto used consistently:**
  ```powershell
  grep -n "parseMoney" client/src/features/recurring client/src/features/goals
  # Should only appear in display contexts, not calculations
  ```

- [ ] **Validation strengthened:**
  - [ ] Test invalid date (2025-02-30) → 400 error
  - [ ] Test amountVariance > 100 → 400 error
  - [ ] Test dayOfMonth = 31 for monthly → validation error

- [ ] **Client forms validate before submit:**
  - [ ] Create goal with empty name → inline error
  - [ ] Create recurring with invalid date → inline error

- [ ] **Tests pass:**
  ```bash
  npm run test:run
  npm run check
  ```

- [ ] **Commit checkpoint:**
  ```bash
  git add -A
  git commit -m "fix(client): improve money handling and validation

- Use MoneyDto throughout client for currency preservation
- Replace parseMoney calculations with sumMoneyDto utility
- Fix CalendarItem and RecurringTransactionLink types
- Strengthen date and numeric validation
- Add Zod form validation to creation wizards

Fixes: REC-005, REC-NEW-005, REC-NEW-006, GOAL-CLIENT-001, REC-011, CLIENT-VALIDATION-001

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
  ```

---

## PHASE 4: Test Coverage (P1)

**Duration:** 4-5 days
**Risk Level:** LOW (no production code changes)
**Dependencies:** Phases 1-3 complete (testing fixed code)

This phase is detailed but I'll provide the structure. Full test cases can be generated on demand.

---

### TASK 4.1: Add Goals Integration Tests

**Issue ID:** GOAL-TEST-001
**Target:** 50+ tests
**Time Estimate:** 2 days

#### Test Groups:

**Group A: CRUD Operations (10 tests)**
- Create goal (all types: savings, debt, investment)
- Get goal by ID
- Update goal
- Delete goal
- List goals with filters

**Group B: Account Assignments (12 tests)**
- Assign account (percentage)
- Assign account (fixed amount)
- Assign account (remainder)
- Update assignment
- Remove assignment
- Prevent duplicate assignments
- Prevent over-assignment (>100%)
- Full balance assignment exclusive check
- Race condition test (concurrent assignments)
- Household isolation test

**Group C: Goal Transfers (8 tests)**
- Create transfer
- List transfers for goal
- List transfers for household
- Prevent negative balance transfer
- Audit logging verification
- Currency validation

**Group D: Transaction Linking (10 tests)**
- Link transaction to goal
- Unlink transaction from goal
- Prevent duplicate links
- Private transaction isolation
- Update goal balance on link
- Update goal balance on unlink

**Group E: Activity Feed (5 tests)**
- Get activity with pagination
- Filter by type
- Filter by date range
- Activity ordering

**Group F: Available Funds (5 tests)**
- Calculate available funds across accounts
- Exclude assigned amounts
- Multi-currency handling
- Include/exclude specific accounts

#### Test File Structure:
```typescript
// server/routes/__tests__/goals.integration.test.ts
import request from "supertest";
import { describe, it, expect, beforeEach } from "vitest";
import app from "../../app";
import { createTestUser, createTestGoal } from "../../../test/helpers";

describe("Goals API Integration Tests", () => {
  let userCookie: string;
  let household1Id: string;

  beforeEach(async () => {
    // Setup test user and household
  });

  describe("POST /api/goals", () => {
    it("creates savings goal with valid data", async () => {
      const res = await request(app)
        .post("/api/goals")
        .set("Cookie", userCookie)
        .send({
          name: "Emergency Fund",
          type: "savings",
          targetAmount: { amount: "10000.00", currency: "ZMW" },
          targetDate: "2025-12-31",
        })
        .expect(201);

      expect(res.body.success).toBe(true);
      expect(res.body.data.name).toBe("Emergency Fund");
      expect(res.body.data.currentAmount).toEqual({
        amount: "0.00",
        currency: "ZMW",
      });
    });

    // ... 49 more tests
  });
});
```

---

### TASK 4.2: Add Recurring Integration Tests

**Issue ID:** REC-003
**Target:** 12 new tests (adding to existing 7)
**Time Estimate:** 1 day

#### Test Groups (NEW tests only):

**Group A: Lifecycle Actions (4 tests)**
```typescript
describe("Lifecycle Actions", () => {
  it("skips next occurrence and advances nextDueDate", async () => {
    const recurring = await createTestRecurring({ nextDueDate: "2025-01-15" });

    const res = await request(app)
      .post(`/api/recurring/${recurring.id}/skip`)
      .set("Cookie", userCookie)
      .expect(200);

    expect(res.body.data.nextDueDate).toBe("2025-02-15");  // Advanced by 1 month
  });

  it("pauses recurring rule", async () => { /* ... */ });
  it("resumes paused recurring rule", async () => { /* ... */ });
  it("ends recurring rule with end date", async () => { /* ... */ });
});
```

**Group B: Pattern Detection (2 tests)**
```typescript
describe("Pattern Detection", () => {
  it("detects recurring patterns with confidence threshold", async () => {
    // Create 3 similar transactions
    await createTestTransaction({ name: "Netflix", amount: 9.99, date: "2025-01-01" });
    await createTestTransaction({ name: "Netflix", amount: 9.99, date: "2025-02-01" });
    await createTestTransaction({ name: "Netflix", amount: 9.99, date: "2025-03-01" });

    const res = await request(app)
      .post("/api/recurring/detect")
      .set("Cookie", userCookie)
      .send({ minConfidence: 0.8 })
      .expect(200);

    expect(res.body.data.patterns).toHaveLength(1);
    expect(res.body.data.patterns[0].name).toContain("Netflix");
    expect(res.body.data.patterns[0].confidence).toBeGreaterThan(0.8);
  });

  it("confirms pattern and creates recurring rule with auto-links", async () => { /* ... */ });
});
```

**Group C: Transaction Linking (4 tests)**
```typescript
describe("Transaction Linking", () => {
  it("links transaction to recurring rule", async () => { /* ... */ });
  it("rejects linking already-linked transaction", async () => { /* ... */ });

  it("rejects linking private transaction by non-owner", async () => {
    // CRITICAL: Tests ISSUE-REC-008 fix
    const privateTransaction = await createTestTransaction({
      userId: user1.id,
      isPrivate: true,
    });

    const recurring = await createTestRecurring({ userId: user2.id });

    const res = await request(app)
      .post(`/api/recurring/${recurring.id}/link`)
      .set("Cookie", user2Cookie)
      .send({ transactionId: privateTransaction.id })
      .expect(404);  // Not 403, to hide existence

    expect(res.body.error.message).toContain("not found");
  });

  it("unlinks transaction from recurring rule", async () => { /* ... */ });
});
```

**Group D: History & Create-from-Transaction (2 tests)**

---

### TASK 4.3: Add Household Isolation Tests

**Issue ID:** TEST-ISOLATION-001
**Target:** 10 tests (5 goals + 5 recurring)
**Time Estimate:** 0.5 days

```typescript
describe("Household Isolation", () => {
  let household1Cookie: string;
  let household2Cookie: string;

  it("cannot access goals from other household", async () => { /* ... */ });
  it("cannot modify goals from other household", async () => { /* ... */ });
  it("cannot link transaction from other household to goal", async () => { /* ... */ });
  it("cannot assign account from other household to goal", async () => { /* ... */ });
  it("cannot create goal transfer to other household", async () => { /* ... */ });

  // Same 5 tests for recurring module
});
```

---

### TASK 4.4: Verify Audit Logging Coverage

**Issue ID:** GOAL-AUDIT-001
**Time Estimate:** 0.5 days

#### Step 4.4.1: Audit current coverage
```powershell
grep -n "businessAuditService\|auditService" server/modules/goals/goals.controller.ts
```

#### Step 4.4.2: Add tests for audit logging
```typescript
describe("Audit Logging", () => {
  it("logs goal creation", async () => {
    await request(app).post("/api/goals").send(validGoalData);

    const logs = await db.select().from(auditLogs).where(eq(auditLogs.entityType, "goal"));
    expect(logs).toHaveLength(1);
    expect(logs[0].action).toBe("CREATE");
  });

  it("logs goal deletion", async () => { /* ... */ });
  it("logs account assignment", async () => { /* ... */ });
  it("logs transaction linking", async () => { /* ... */ });
  it("logs goal transfer", async () => { /* ... */ });
});
```

---

## Phase 4 Verification Checklist

- [ ] **Test coverage improved:**
  ```bash
  npm run test:server:run -- --coverage
  # Check coverage report:
  # - goals.integration.test.ts: >80% coverage
  # - recurring.integration.test.ts: >80% coverage
  ```

- [ ] **All new tests pass:**
  ```bash
  npm run test:server:run -- goals.integration.test.ts
  npm run test:server:run -- recurring.integration.test.ts
  ```

- [ ] **Household isolation verified:**
  - All cross-household access attempts return 404
  - No data leakage in error messages

- [ ] **Audit logging verified:**
  - All mutating operations logged
  - Logs include userId, householdId, entityType, action

- [ ] **Commit checkpoint:**
  ```bash
  git add -A
  git commit -m "test: comprehensive integration tests for goals and recurring

- Add 50+ goal integration tests covering CRUD, assignments, transfers, linking
- Add 12 recurring integration tests for lifecycle, patterns, linking
- Add 10 household isolation tests
- Verify audit logging coverage

Fixes: GOAL-TEST-001, REC-003, TEST-ISOLATION-001, GOAL-AUDIT-001

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
  ```

---

## PHASE 5: Refactoring & UI Enhancements (P2)

**Duration:** 2-3 days
**Risk Level:** LOW
**Dependencies:** All previous phases complete

---

### TASK 5.1: Split RecurringRepository

**Issue ID:** REC-009
**Files:** `server/repositories/RecurringRepository.ts` (516 LOC → 300 + 200)
**Time Estimate:** 4 hours

#### Target Structure:
```
server/repositories/
├── RecurringRepository.ts (300 LOC)
│   ├── CRUD (create, update, delete, findById, findByHousehold)
│   ├── Lifecycle (pause, resume, skipNext, updateNextDueDate)
│   └── Links (createLink, deleteLink, findLinksByRecurring)
├── RecurringQueryRepository.ts (200 LOC)
│   ├── findDue
│   ├── findUpcoming
│   ├── getSummary (with fixed Money handling from Phase 1)
│   ├── findHistory
│   └── Complex queries
└── index.ts (barrel exports)
```

#### Implementation:
1. Create `RecurringQueryRepository.ts`
2. Move query methods (getSummary, findDue, findUpcoming, findHistory)
3. Update imports in services
4. Create barrel export

#### Verification:
```powershell
# Check LOC
(Get-Content server/repositories/RecurringRepository.ts | Measure-Object -Line).Lines
# Expected: <300

(Get-Content server/repositories/RecurringQueryRepository.ts | Measure-Object -Line).Lines
# Expected: <220

# Run tests
npm run test:server:run -- recurring
```

---

### TASK 5.2: Split Oversized Goal Components

**Issue ID:** GOAL-QUALITY-001
**Files:**
- `GoalCreationWizard.tsx` (453 → ~250 LOC)
- `GoalAccountsModal.tsx` (323 → ~200 LOC)
- `GoalActivityItem.tsx` (308 → ~180 LOC)

**Time Estimate:** 6 hours

#### Example: GoalCreationWizard Split

**Before:** 453 LOC monolithic component

**After Structure:**
```
client/src/features/goals/components/GoalCreationWizard/
├── index.tsx (150 LOC - main wizard logic)
├── components/
│   ├── BasicInfoStep.tsx (80 LOC)
│   ├── TargetDetailsStep.tsx (90 LOC)
│   ├── AccountAssignmentStep.tsx (100 LOC)
│   └── ReviewStep.tsx (60 LOC)
└── hooks/
    └── useGoalCreationForm.ts (80 LOC - form state and validation)
```

#### Verification:
```powershell
# Check all files <300 LOC
Get-ChildItem -Path "client/src/features/goals/components" -Recurse -Include "*.tsx" |
  ForEach-Object {
    $lines = (Get-Content $_.FullName | Measure-Object -Line).Lines
    if ($lines -gt 300) { Write-Host "$($_.Name): $lines LOC - EXCEEDS LIMIT" }
  }
```

---

### TASK 5.3: Add Custom Frequency Fields to UI

**Issue ID:** REC-010
**Files:** `client/src/components/transactions/form/RecurringSettingsSection.tsx`
**Time Estimate:** 3 hours

#### Add Custom Frequency UI:
```tsx
<FormField name="frequency">
  <FormLabel>Frequency</FormLabel>
  <Select value={frequency} onValueChange={setFrequency}>
    <SelectItem value="weekly">Weekly</SelectItem>
    <SelectItem value="biweekly">Bi-weekly</SelectItem>
    <SelectItem value="monthly">Monthly</SelectItem>
    <SelectItem value="yearly">Yearly</SelectItem>
    <SelectItem value="custom">Custom</SelectItem>
  </Select>
</FormField>

{frequency === "custom" && (
  <div className="grid grid-cols-2 gap-4 mt-4">
    <FormField name="intervalValue">
      <FormLabel>Repeat every</FormLabel>
      <Input type="number" min={1} max={365} />
    </FormField>
    <FormField name="intervalUnit">
      <FormLabel>Unit</FormLabel>
      <Select>
        <SelectItem value="days">Days</SelectItem>
        <SelectItem value="weeks">Weeks</SelectItem>
        <SelectItem value="months">Months</SelectItem>
        <SelectItem value="years">Years</SelectItem>
      </Select>
    </FormField>
  </div>
)}
```

#### Verification:
- [ ] Select "Custom" frequency
- [ ] Enter interval (e.g., "3 months")
- [ ] Save recurring transaction
- [ ] Check API payload includes intervalValue and intervalUnit

---

### TASK 5.4: Minor Fixes

**Remaining issues:** REC-NEW-004 (history limit), GOAL-VALIDATION-001 (max bounds)

**Time Estimate:** 1.5 hours total

#### REC-NEW-004: Fix history limit parameter
```typescript
// server/modules/recurring/recurring.controller.ts:144
async getHistory(req: Request, res: Response, next: NextFunction) {
  const { householdId } = req.householdContext!;
  const { id } = req.params;

  const queryResult = historyQuerySchema.safeParse(req.query);
  const limit = queryResult.success ? queryResult.data.limit : 50;

  const history = await recurringService.getHistory(id, householdId, limit);
  return success(res, history);
}
```

#### GOAL-VALIDATION-001: Add money max bound
```typescript
// server/core/validation/money.ts
export const positiveMoneyDtoSchema = moneyDtoSchema.refine(
  (m) => {
    const amount = parseFloat(m.amount.replace(/,/g, ""));
    return amount > 0 && amount <= 9999999999999.99;  // DECIMAL(15,2) max
  },
  "Amount must be positive and less than 10 trillion"
);
```

---

## Phase 5 Verification Checklist

- [ ] **All files meet LOC limits:**
  ```powershell
  # Check server files
  Get-ChildItem -Path "server" -Recurse -Include "*.ts" |
    Where-Object { $_.FullName -notmatch "test" } |
    ForEach-Object {
      $lines = (Get-Content $_.FullName | Measure-Object -Line).Lines
      if ($lines -gt 500) { Write-Host "$($_.Name): $lines LOC" }
    }
  # Expected: RecurringRepository and all split files <500

  # Check client components
  # Expected: All goal components <300
  ```

- [ ] **UI enhancements work:**
  - [ ] Create recurring with custom frequency (e.g., every 3 weeks)
  - [ ] Request history with limit parameter
  - [ ] Try creating goal with amount > 10 trillion → validation error

- [ ] **Tests still pass:**
  ```bash
  npm run test:server:run
  npm run test:run
  npm run check
  ```

- [ ] **Final commit:**
  ```bash
  git add -A
  git commit -m "refactor: split large files and add UI enhancements

- Split RecurringRepository into CRUD and Query repositories
- Split oversized goal components into sub-components
- Add custom frequency fields to recurring settings UI
- Fix history limit parameter handling
- Add money max bound validation

Fixes: REC-009, GOAL-QUALITY-001, REC-010, REC-NEW-004, GOAL-VALIDATION-001

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
  ```

---

## Final Verification & Merge

### Pre-Merge Checklist

- [ ] **All tests pass:**
  ```bash
  npm run test:run
  npm run test:server:run
  npm run check
  ```

- [ ] **Money precision violations eliminated:**
  ```powershell
  grep -rn "parseFloat\|Math\.round" server/services/goal server/jobs server/repositories --include="*.ts" | grep -v "percentage\|rate\|comment"
  # Expected: 0 financial violations
  ```

- [ ] **Type safety improved:**
  ```powershell
  grep -rn "as any" server/modules/recurring server/services/recurring client/src/features/recurring client/src/features/goals
  # Expected: Minimal, none in critical paths
  ```

- [ ] **Test coverage targets met:**
  ```bash
  npm run test:server:run -- --coverage
  # Check: goals >80%, recurring >80%
  ```

- [ ] **LOC limits met:**
  - RecurringRepository: <300
  - All client components: <300
  - All controllers: <500

- [ ] **Update known-issues.md:**
  - Mark all fixed issues as FIXED with date
  - Move to "Recently Resolved" section

- [ ] **Update documentation:**
  ```bash
  # Create summary document
  echo "# Goals + Recurring Fixes - Completion Summary" > docs/implementation/COMPLETION_SUMMARY.md
  # Document all changes, test coverage improvements, verification results
  ```

---

### Merge Strategy

```bash
# 1. Rebase on main
git checkout main
git pull origin main
git checkout fix/goals-recurring-combined
git rebase main

# 2. Run full test suite
npm run test:run && npm run test:server:run && npm run check

# 3. Squash if desired (optional)
git rebase -i main  # Combine into logical commits

# 4. Merge to main
git checkout main
git merge fix/goals-recurring-combined --no-ff -m "fix: comprehensive goals and recurring module improvements

Addresses 35+ critical and high-priority issues:
- Money precision: Eliminated parseFloat/Math.round in financial code
- Type safety: Removed as any casts
- Test coverage: Added 60+ integration tests
- Rate limiting: Applied to all routes
- Client validation: Added Zod form validation
- Code quality: Split oversized files

See docs/implementation/COMPLETION_SUMMARY.md for details.

Fixes: GOAL-MONEY-001, SNAP-001, REC-002, REC-003, GOAL-TEST-001, and 30 more

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"

# 5. Push to remote
git push origin main
```

---

## Rollback Procedures

### Phase-Level Rollback

If any phase fails:
```bash
# Reset to phase checkpoint
git log --oneline  # Find commit hash before failed phase
git reset --hard <commit-hash>

# Or reset individual files
git checkout HEAD~1 path/to/file.ts
```

### Complete Rollback

If entire feature branch needs rollback:
```bash
git checkout main
git branch -D fix/goals-recurring-combined
# Start fresh from baseline
```

---

## Success Metrics

### Quantitative Targets

| Metric | Before | Target | How to Measure |
|--------|--------|--------|----------------|
| Money violations | 50+ | 0 | `grep -c "parseFloat" server/` (financial code) |
| Type casts (`as any`) | 15+ | <5 | `grep -c "as any" server/ client/` |
| Test coverage (Goals) | 0% | >80% | `npm run test:server:run -- --coverage` |
| Test coverage (Recurring) | 39% | >80% | `npm run test:server:run -- --coverage` |
| LOC violations | 4 files | 0 | Check all files <500 LOC |
| Rate-limited routes | 0% | 100% | All routes have limiter |

### Qualitative Targets

- [ ] All financial calculations use Money class
- [ ] All forms validate before API call
- [ ] All endpoints have rate limiting
- [ ] Multi-currency support preserved throughout
- [ ] Household isolation verified by tests
- [ ] Audit logging complete for all mutations

---

## Appendix: Quick Reference Commands

```powershell
# Money violation scan
grep -rn "parseFloat\|Math\.round" server/services/goal server/jobs server/repositories/RecurringRepository.ts

# Type safety scan
grep -rn "as any" server/ client/ --include="*.ts" --include="*.tsx"

# LOC check (single file)
(Get-Content path/to/file.ts | Measure-Object -Line).Lines

# LOC check (all server files)
Get-ChildItem -Path "server" -Recurse -Include "*.ts" |
  Where-Object { $_.FullName -notmatch "test" } |
  ForEach-Object {
    $lines = (Get-Content $_.FullName | Measure-Object -Line).Lines
    if ($lines -gt 500) { Write-Host "$($_.FullName): $lines LOC" }
  }

# Run specific test file
npm run test:server:run -- goals.integration.test.ts

# Coverage report
npm run test:server:run -- --coverage

# Type check
npm run check
```

---

## Next Steps After Plan Review

Once this plan is approved:

1. **Create tracking sheet:** Copy task list to `docs/implementation/TRACKING.md`
2. **Set up branch:** `git checkout -b fix/goals-recurring-combined`
3. **Begin Phase 1:** Start with TASK 1.1 (GoalStatusWorker)
4. **Daily standup format:**
   - Completed tasks (with commit hashes)
   - In-progress tasks
   - Blockers
   - Next 3 tasks

---

**PLAN STATUS: READY FOR REVIEW**

**Questions for User:**
1. Approve plan as-is?
2. Adjust phase ordering?
3. Add/remove any tasks?
4. Proceed with implementation starting Phase 1?
