# Weekly Recap Module - Overhaul Plan

**Created:** 2026-01-27
**Based On:** 5-Skill Assessment (54/100 - FAIL)
**Status:** Closed (Re-audited 2026-02-07)

---
## Re-Audit 2026-02-07

Most P0/P1 claims in this plan are implemented, including the previously open settings persistence item:

- Weekly recap routes include auth/household guards and rate limiting.
- Money and contract mismatches were addressed (topCategories/name, dueDate, wrap-up/overall compatibility).
- Weekly recap history/generate/settings endpoints exist.
- Weekly recap email scheduler job exists in `server/scheduler.ts`.
- Weekly recap settings are persisted to DB in `server/modules/weekly-recap/weekly-recap.controller.ts`.
- Integration coverage exists in `server/modules/weekly-recap/__tests__/`, including settings persistence tests.

---

## Executive Summary

The Weekly Recap module requires fixes for **Money class violations**, **client-server contract mismatches**, and **zero test coverage**. This plan addresses all 28 issues identified across the 5-skill reviews, with data integrity fixes prioritized.

---

## Issue Registry

### Phase 1: Money Class & Data Integrity (P0) - 8 Issues

| ID | Issue | Location | Impact | Effort |
|----|-------|----------|--------|--------|
| MONEY-001 | `toMoneyNumber()` uses `Number()` conversion | `service.ts:24-35` | Precision loss | 1 hour |
| MONEY-002 | `sumAmounts()` converts Money mid-calculation | `service.ts:40-45` | Precision loss | 1 hour |
| MONEY-003 | JavaScript arithmetic on net worth | `service.ts:114-119` | Precision loss | 30 min |
| CONTRACT-001 | `categories` vs `topCategories` mismatch | client/server | Runtime error | 30 min |
| CONTRACT-002 | `categoryName` vs `name` mismatch | client/server | Runtime error | 15 min |
| CONTRACT-003 | `date` vs `dueDate` mismatch | client/server | Runtime error | 15 min |
| CONTRACT-004 | `amount: string` vs `number` type mismatch | recurring items | Type error | 30 min |
| CONTRACT-005 | Feedback step enum "wrap-up" vs "overall" | WrapUpStep.tsx | 400 error | 15 min |

**Phase 1 Total Effort:** ~4 hours

### Phase 2: Security & Validation (P1) - 3 Issues

| ID | Issue | Location | Impact | Effort |
|----|-------|----------|--------|--------|
| RATE-001 | POST /feedback missing rate limiter | `routes.ts:20` | DOS vulnerability | 15 min |
| VAL-001 | Date validation accepts invalid dates | `validation.ts` | Bad data | 30 min |
| GUARD-001 | Missing householdGuard on feedback | `routes.ts:20` | Auth bypass | 15 min |

**Phase 2 Total Effort:** ~1 hour

### Phase 3: Test Coverage (P1) - 4 Issues

| ID | Issue | Location | Tests Needed | Effort |
|----|-------|----------|--------------|--------|
| TEST-001 | Server integration tests | - | 18 | 3 hours |
| TEST-002 | Server validation tests | - | 6 | 1 hour |
| TEST-003 | Client hook tests | - | 8 | 1.5 hours |
| TEST-004 | Client component tests | - | 24 | 4 hours |

**Phase 3 Total Effort:** ~9.5 hours (56 test cases)

### Phase 4: Accessibility (P2) - 6 Issues

| ID | Issue | Location | WCAG | Effort |
|----|-------|----------|------|--------|
| A11Y-001 | Close button lacks aria-label | `WeeklyRecapWizard.tsx` | 4.1.2 | 15 min |
| A11Y-002 | StepProgress no semantic markup | `StepProgress.tsx` | 1.3.1 | 45 min |
| A11Y-003 | Loading spinner missing role="status" | Multiple | 4.1.2 | 20 min |
| A11Y-004 | No aria-live for step changes | Wizard | 4.1.3 | 30 min |
| A11Y-005 | WeeklyChart no accessible description | `WeeklyChart.tsx` | 1.1.1 | 30 min |
| A11Y-006 | Low contrast subtitle text | `WeeklyRecapWidget.tsx` | 1.4.3 | 15 min |

**Phase 4 Total Effort:** ~2.5 hours

### Phase 5: UX Improvements (P2) - 3 Issues

| ID | Issue | Location | Impact | Effort |
|----|-------|----------|--------|--------|
| UX-001 | No "Back" button for previous steps | Wizard | Poor navigation | 1 hour |
| UX-002 | Missing empty state in SpendingStep | `SpendingStep.tsx` | Edge case | 30 min |
| DATA-001 | Week start day mismatch (Sun vs Mon) | service/client | Date confusion | 1 hour |

**Phase 5 Total Effort:** ~2.5 hours

### Phase 6: Missing Features (P3) - 4 Issues

| ID | Issue | Location | Impact | Effort |
|----|-------|----------|--------|--------|
| FUNC-001 | Goal progress step missing | - | Feature gap | 6 hours |
| FUNC-002 | Settings feature not implemented | - | Feature gap | 4 hours |
| FUNC-003 | Email digest not implemented | - | Feature gap | 8 hours |
| FUNC-004 | Historical recaps not available | - | Feature gap | 4 hours |

**Phase 6 Total Effort:** ~22 hours

---

## Total Issue Count: 28

| Phase | Issues | Priority | Effort |
|-------|--------|----------|--------|
| Phase 1: Money & Data | 8 | P0 | 4 hours |
| Phase 2: Security | 3 | P1 | 1 hour |
| Phase 3: Test Coverage | 4 | P1 | 9.5 hours |
| Phase 4: Accessibility | 6 | P2 | 2.5 hours |
| Phase 5: UX | 3 | P2 | 2.5 hours |
| Phase 6: Features | 4 | P3 | 22 hours |
| **TOTAL** | **28** | | **41.5 hours** |

---

## Implementation Details

### Phase 1: Money Class & Data Integrity

#### MONEY-001, MONEY-002, MONEY-003: Fix Money Class Usage

**File:** `server/modules/weekly-recap/weekly-recap.service.ts`

```typescript
// DELETE: toMoneyNumber() function entirely

// REPLACE sumAmounts() with proper Money aggregation
private sumAmounts(amounts: (MoneyDto | null | undefined)[], currency: string): Money {
  return amounts.reduce((sum, amount) => {
    if (!amount) return sum;
    return sum.add(new Money(amount.amount));
  }, Money.zero(currency));
}

// REPLACE net worth calculation (lines 114-119)
// BEFORE
const netWorthChange = currentNetWorth - previousNetWorth;
const netWorthChangePercent = previousNetWorth !== 0
  ? ((netWorthChange / previousNetWorth) * 100)
  : 0;

// AFTER
const currentMoney = new Money(String(currentNetWorth));
const previousMoney = new Money(String(previousNetWorth));
const netWorthChange = currentMoney.subtract(previousMoney);
const netWorthChangePercent = previousMoney.isZero()
  ? 0
  : netWorthChange.divide(previousMoney).multiply(100).toNumber();
```

#### CONTRACT-001 through CONTRACT-005: Fix Data Contract

**Option A: Update client to match server (recommended - less risk)**

**File:** `client/src/components/weekly-recap/hooks/useWeeklyRecapData.ts`

```typescript
// Update WeeklyRecapData interface to match server response
export interface WeeklyRecapData {
  spending: {
    totalSpent: number;
    topCategories: Array<{  // Changed from 'categories'
      name: string;         // Changed from 'categoryName'
      amount: number;
      percentage: number;
    }>;
    comparisonPercent: number;
  };
  recurring: {
    items: Array<{
      id: string;
      name: string;
      dueDate: string;      // Changed from 'date'
      amount: number;       // Ensure number type
      isPaid: boolean;
    }>;
    totalDue: number;
  };
  netWorth: {
    current: number;
    previous: number;
    change: number;
    changePercent: number;
  };
}
```

**File:** `client/src/components/weekly-recap/steps/WrapUpStep.tsx`

```typescript
// BEFORE (line ~45)
step: "wrap-up",

// AFTER
step: "overall",  // Match server enum
```

### Phase 2: Security & Validation

#### RATE-001 & GUARD-001: Fix Feedback Endpoint Security

**File:** `server/modules/weekly-recap/weekly-recap.routes.ts`

```typescript
// BEFORE
import { Router } from "express";
import { requireAuth } from "../../middleware";
import { analyticsLimiter } from "../../middleware/rateLimit";

const router = Router();
router.use(requireAuth);

router.get("/", analyticsLimiter, controller.getWeeklyRecap);
router.post("/feedback", controller.submitFeedback);  // âŒ No limiter, no guard

// AFTER
import { Router } from "express";
import { requireAuth, householdGuard } from "../../middleware";
import { analyticsLimiter, generalLimiter } from "../../middleware/rateLimit";

const router = Router();
router.use(requireAuth);
router.use(householdGuard);  // âœ… Add household guard to all routes

router.get("/", analyticsLimiter, controller.getWeeklyRecap);
router.post("/feedback", generalLimiter, controller.submitFeedback);  // âœ… Add limiter
```

#### VAL-001: Fix Date Validation

**File:** `server/modules/weekly-recap/weekly-recap.validation.ts`

```typescript
// BEFORE
export const getWeeklyRecapSchema = z.object({
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

// AFTER
const validDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be in YYYY-MM-DD format")
  .refine(
    (dateStr) => {
      const date = new Date(dateStr + "T00:00:00Z");
      if (isNaN(date.getTime())) return false;
      const [year, month, day] = dateStr.split("-").map(Number);
      return (
        date.getUTCFullYear() === year &&
        date.getUTCMonth() + 1 === month &&
        date.getUTCDate() === day
      );
    },
    { message: "Invalid date - the date does not exist" }
  );

export const getWeeklyRecapSchema = z.object({
  startDate: validDateSchema,
  endDate: validDateSchema,
});
```

### Phase 3: Test Coverage

#### TEST-001: Server Integration Tests

**Create:** `server/modules/weekly-recap/__tests__/weekly-recap.integration.test.ts`

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import { app } from "../../../app";
import { createTestUser, createTestHousehold } from "../../../test/factories";

describe("Weekly Recap API", () => {
  describe("GET /api/weekly-recap", () => {
    it("should return recap data for valid date range", async () => { });
    it("should require authentication", async () => { });
    it("should validate date format", async () => { });
    it("should reject invalid dates like 2025-02-30", async () => { });
    it("should only include household transactions", async () => { });
    it("should calculate spending totals correctly", async () => { });
    it("should return top categories sorted by amount", async () => { });
    it("should include recurring items due in range", async () => { });
    it("should calculate net worth change", async () => { });
    it("should handle empty data gracefully", async () => { });
  });

  describe("POST /api/weekly-recap/feedback", () => {
    it("should save feedback with valid data", async () => { });
    it("should require authentication", async () => { });
    it("should validate step enum", async () => { });
    it("should validate rating range", async () => { });
    it("should be rate limited", async () => { });
    it("should require household membership", async () => { });
    it("should accept 'overall' as step value", async () => { });
    it("should reject 'wrap-up' as step value", async () => { });
  });
});
```

#### TEST-004: Client Component Tests

**Create:** `client/src/components/weekly-recap/__tests__/WeeklyRecapWizard.test.tsx`

```typescript
import { render, screen, fireEvent } from "@testing-library/react";
import { WeeklyRecapWizard } from "../WeeklyRecapWizard";

describe("WeeklyRecapWizard", () => {
  it("should render welcome step initially", () => { });
  it("should navigate to next step on continue", () => { });
  it("should close on escape key", () => { });
  it("should show loading state while fetching data", () => { });
  it("should show error state on fetch failure", () => { });
  it("should announce step changes to screen readers", () => { });
  // ... 24 total test cases
});
```

### Phase 4: Accessibility

#### A11Y-001: Add aria-label to Close Button

**File:** `client/src/components/weekly-recap/WeeklyRecapWizard.tsx`

```tsx
// BEFORE
<button onClick={onClose} className="...">
  <X className="h-4 w-4" />
</button>

// AFTER
<button
  onClick={onClose}
  aria-label="Close weekly recap"
  className="..."
>
  <X className="h-4 w-4" aria-hidden="true" />
</button>
```

#### A11Y-002: Add Semantic Markup to StepProgress

**File:** `client/src/components/weekly-recap/components/StepProgress.tsx`

```tsx
// BEFORE
<div className="flex gap-2">
  {steps.map((_, index) => (
    <div
      key={index}
      className={cn("h-1 flex-1 rounded-full", ...)}
    />
  ))}
</div>

// AFTER
<nav aria-label="Wizard progress">
  <ol className="flex gap-2" role="list">
    {steps.map((step, index) => (
      <li
        key={index}
        role="listitem"
        aria-current={index === currentStep ? "step" : undefined}
      >
        <div
          className={cn("h-1 flex-1 rounded-full", ...)}
          aria-label={`Step ${index + 1} of ${steps.length}: ${step.name}${
            index < currentStep ? " (completed)" : index === currentStep ? " (current)" : ""
          }`}
        />
      </li>
    ))}
  </ol>
</nav>
```

#### A11Y-004: Add aria-live Region for Step Changes

**File:** `client/src/components/weekly-recap/WeeklyRecapWizard.tsx`

```tsx
// Add state for announcements
const [announcement, setAnnouncement] = useState("");

// Update announcement on step change
useEffect(() => {
  setAnnouncement(`Step ${currentStep + 1} of ${totalSteps}: ${stepNames[currentStep]}`);
}, [currentStep]);

// Add live region to JSX
<div
  role="status"
  aria-live="polite"
  aria-atomic="true"
  className="sr-only"
>
  {announcement}
</div>
```

### Phase 5: UX Improvements

#### UX-001: Add Back Button

**File:** `client/src/components/weekly-recap/WeeklyRecapWizard.tsx`

```tsx
// In step content footer:
<div className="flex justify-between">
  {currentStep > 0 && (
    <Button
      variant="ghost"
      onClick={() => setCurrentStep(currentStep - 1)}
    >
      <ChevronLeft className="h-4 w-4 mr-2" />
      Back
    </Button>
  )}
  <Button onClick={handleNext}>
    {currentStep === totalSteps - 1 ? "Finish" : "Continue"}
  </Button>
</div>
```

---

## Verification Checklist

### After Phase 1
```bash
# Verify Money class usage - should find no Number() on financial data
grep -n "Number(" server/modules/weekly-recap/weekly-recap.service.ts
# Should return 0 matches for financial calculations

# Verify contract fix
npm run check  # TypeScript should pass
```

### After Phase 2
```bash
# Verify rate limiter
grep -n "generalLimiter" server/modules/weekly-recap/weekly-recap.routes.ts
# Should return 1 match for feedback route

# Verify householdGuard
grep -n "householdGuard" server/modules/weekly-recap/weekly-recap.routes.ts
# Should return 1 match
```

### After Phase 3
```bash
# Run tests
npm run test:server:run -- --grep "Weekly Recap"
npm run test:run -- --grep "WeeklyRecap"

# Check coverage
npm run test:server:coverage
```

### Full Verification
```bash
npm run check              # TypeScript must pass
npm run test:run           # Client tests must pass
npm run test:server:run    # Server tests must pass
```

---

## Success Criteria

### Phase 1 Complete When:
- [ ] No `Number()` conversions on financial data
- [ ] `sumAmounts()` uses Money class throughout
- [ ] Net worth calculation uses Money class
- [ ] Client types match server response exactly
- [ ] Feedback submission works without 400 error
- [ ] `npm run check` passes

### Phase 2 Complete When:
- [ ] Feedback endpoint has rate limiting
- [ ] Feedback endpoint has householdGuard
- [ ] Invalid dates like "2025-02-30" are rejected

### Phase 3 Complete When:
- [ ] 18 server integration tests pass
- [ ] 6 validation tests pass
- [ ] 8 client hook tests pass
- [ ] 24 component tests pass
- [ ] Coverage reaches 60%

### Phase 4 Complete When:
- [ ] Close button has aria-label
- [ ] StepProgress has semantic markup
- [ ] Step changes announced to screen readers
- [ ] Chart has accessible description

### Phase 5 Complete When:
- [ ] Back button navigation works
- [ ] Empty state shown when no spending data
- [ ] Week start day consistent between client/server

---

## Dependencies

| Phase | Depends On |
|-------|------------|
| Phase 1 | None (start immediately) |
| Phase 2 | None (can run parallel with Phase 1) |
| Phase 3 | Phase 1, Phase 2 (test the fixed code) |
| Phase 4 | None (can run parallel) |
| Phase 5 | None (can run parallel) |
| Phase 6 | Phase 1-3 (core must be stable first) |

---

## Timeline Estimate

| Phase | Effort | Calendar Time |
|-------|--------|---------------|
| Phase 1 | 4 hours | Day 1 |
| Phase 2 | 1 hour | Day 1 |
| Phase 3 | 9.5 hours | Days 2-3 |
| Phase 4 | 2.5 hours | Day 3 |
| Phase 5 | 2.5 hours | Day 3 |
| Phase 6 | 22 hours | Days 4-6 (optional) |
| **Total** | **41.5 hours** | **~6 days** |

---

## References

- [Weekly Recap Module Assessment](../../../reviews/weekly-recap/weekly-recap-module-assessment.md)
- [Senior Developer Review](../../../reviews/weekly-recap/weekly-recap-senior-dev-review.md)
- [QA Engineer Review](../../../reviews/weekly-recap/weekly-recap-qa-review.md)
- [Fintech Compliance Review](../../../reviews/weekly-recap/weekly-recap-fintech-review.md)
- [Functionality Review](../../../reviews/weekly-recap/weekly-recap-functionality-review.md)
- [UI/UX Review](../../../reviews/weekly-recap/weekly-recap-ux-review.md)

