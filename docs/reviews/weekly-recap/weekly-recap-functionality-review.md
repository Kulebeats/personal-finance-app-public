# Weekly Recap Module - Functionality Review

**Reviewed:** 2026-01-27
**Reviewer:** Claude Opus 4.5 (Product Manager Perspective)
**Module:** `client/src/components/weekly-recap/` + `server/modules/weekly-recap/`

---

## Overall Score: 58/100

| Category | Score | Weight | Weighted |
|----------|-------|--------|----------|
| User Flow Completeness | 50/100 | 25% | 12.50 |
| Feature Completeness | 45/100 | 25% | 11.25 |
| Data Accuracy | 65/100 | 25% | 16.25 |
| Business Logic Correctness | 70/100 | 25% | 17.50 |
| **Total** | | | **57.5/100** |

**Rounded Score: 58/100** (FAIL - Below 70% threshold for production readiness)

---

## Executive Summary

The Weekly Recap module provides a visually appealing wizard experience but has **critical functional gaps** that prevent it from delivering on its promise. The module claims to offer "spending summary, net worth changes, recurring transactions due, and goal progress" but only partially implements 3 of these 4 features, with goal progress completely missing.

### Key Strengths
- Clean wizard UX flow (Welcome -> Net Worth -> Spending -> Recurring -> Wrap-up)
- Real data integration via AnalyticsService and RecurringService
- User feedback collection mechanism (positive/negative per step)
- Week-over-week comparison for net worth
- Properly structured modular architecture on server-side

### Critical Issues
- **FUNC-01:** Goal progress step completely missing (was in spec, never implemented)
- **FUNC-02:** Client-server data contract mismatch (6+ fields differ)
- **FUNC-03:** Spending "trend" and "changePercent" data not returned by server
- **FUNC-04:** Feedback submission will fail - "wrap-up" not in backend enum
- **FUNC-05:** No settings endpoint despite validation schema existing
- **FUNC-06:** Zero test coverage (0% client, 0% server)

---

## 1. User Flow Verification

### 1.1 Weekly Recap Wizard Flow

| Step | Implemented | Data Source | Verified Working |
|------|-------------|-------------|------------------|
| Welcome | YES | Static + weekStart/weekEnd | YES |
| Net Worth | YES | AnalyticsService.getNetWorth() | PARTIAL |
| Spending | YES | AnalyticsService.getSpendingBreakdown() | PARTIAL |
| Recurring | YES | RecurringService.getUpcomingBills() | YES |
| Goals Progress | **NO** | N/A | **MISSING** |
| Wrap-up | YES | Static | PARTIAL |

**Flow Diagram (Actual vs Expected):**

```
EXPECTED (per validation schema hints):
Welcome -> Net Worth -> Spending -> Goals -> Recurring -> Wrap-up

ACTUAL:
Welcome -> Net Worth -> Spending -> Recurring -> Wrap-up
                                    ^
                                    Goals step MISSING
```

### 1.2 Entry Points

| Entry Point | Location | Working |
|-------------|----------|---------|
| Dashboard Widget | `client/src/pages/Dashboard.tsx:213` | YES |
| Direct URL | N/A | NO (not implemented) |
| Notification Click | N/A | NO (not implemented) |
| Scheduled Email Link | N/A | NO (not implemented) |

**Assessment:** The only entry point is the dashboard widget. The `updateRecapSettingsSchema` in validation.ts suggests email/push notifications were planned but never implemented.

### 1.3 Navigation Flow

| Action | Expected | Actual | Status |
|--------|----------|--------|--------|
| Open wizard | Modal opens with Welcome step | Works | PASS |
| Click "Let's Dive In" | Advances to Net Worth | Works | PASS |
| Click "Continue" (any step) | Advances to next step | Works | PASS |
| Click "Back" | Returns to previous step | **No back button** | FAIL |
| Press Escape | Closes wizard | Works (Dialog default) | PASS |
| Click X button | Closes wizard | Works | PASS |
| Click "Done" on Wrap-up | Closes wizard | Works | PASS |

---

## 2. Feature Completeness Analysis

### 2.1 Advertised vs Implemented Features

**WeeklyRecapWidget.tsx:22-23 claims:**
> "Review your spending and net worth changes for this week."

| Feature | Advertised | Implemented | Data Quality |
|---------|-----------|-------------|--------------|
| Net Worth Current | YES | YES | GOOD |
| Net Worth Change | YES | YES | GOOD |
| Net Worth Trend Chart | NO | YES | PARTIAL (missing trend field) |
| Spending Total | YES | YES | GOOD |
| Top Categories | NO | YES | GOOD |
| Spending Trend Chart | NO | PARTIAL | NO DATA (server doesn't return trend) |
| Spending Change % | NO | PARTIAL | NO DATA (server doesn't return changePercent) |
| Recurring Bills | NO | YES | GOOD |
| Goal Progress | **SPEC HAS IT** | **NO** | **MISSING** |
| Feedback Collection | NO | YES | PARTIAL (backend enum mismatch) |

### 2.2 Goal Progress - Critical Missing Feature

**Evidence it was planned:**

1. `weekly-recap.validation.ts:42`:
```typescript
includeGoalProgress: z.boolean().optional(),
```

2. User expectation from similar apps (Monarch Money, YNAB) includes goal tracking in weekly summaries.

**Impact:** Users cannot see:
- Progress toward savings goals
- Debt paydown progress
- Investment goal milestones
- Goal contribution activity this week

**Recommendation:** Add GoalProgressStep between SpendingStep and RecurringStep:

```typescript
// New step in WeeklyRecapContext.tsx STEPS array:
const STEPS: RecapStep[] = [
  "welcome",
  "net-worth",
  "spending",
  "goals",       // <-- ADD THIS
  "recurring",
  "wrap-up",
];
```

### 2.3 Settings Feature - Completely Missing

**Evidence it was planned:**

`weekly-recap.validation.ts:31-44`:
```typescript
export const updateRecapSettingsSchema = z.object({
  enabled: z.boolean().optional(),
  dayOfWeek: z.number().int().min(0).max(6).optional(),
  timeOfDay: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  emailEnabled: z.boolean().optional(),
  pushEnabled: z.boolean().optional(),
  includeBudgetProgress: z.boolean().optional(),
  includeGoalProgress: z.boolean().optional(),
  includeUpcomingBills: z.boolean().optional(),
  includeSpendingInsights: z.boolean().optional(),
});
```

**Not implemented:**
- No `/api/weekly-recap/settings` GET endpoint
- No `/api/weekly-recap/settings` PATCH endpoint
- No database table for recap preferences
- No UI for configuring recap settings
- No scheduled job for sending recaps

---

## 3. Data Accuracy Analysis

### 3.1 Client-Server Contract Mismatches

**Client expects (useWeeklyRecapData.ts:4-27):**
```typescript
interface WeeklyRecapData {
  netWorth: {
    current: number;
    previous: number;
    change: number;
    changePercent: number;
    series: Array<{ date: string; value: number }>;
    trend: "up" | "down" | "steady";  // <-- NOT RETURNED
  };
  spending: {
    total: number;
    topCategories: Array<{ name: string; amount: number; percent: number }>;
    hasData: boolean;          // <-- NOT RETURNED
    changePercent?: number;    // <-- NOT RETURNED
    trend?: Array<{ date: string; amount: number }>;  // <-- NOT RETURNED
  };
  recurring: {
    upcoming: Array<{ name: string; amount: number; dueDate: string }>;
    count: number;
    totalAmount: number;
  };
}
```

**Server returns (weekly-recap.service.ts:77-83):**
```typescript
interface WeeklyRecap {
  netWorth: {
    current: number;
    previous: number;
    change: number;
    changePercent: number;
    series: Array<{ date: string; value: number }>;
    // NO trend field
  };
  spending: {
    total: number;
    categories: Array<{          // <-- Different key name!
      categoryId: string;        // <-- Extra field
      categoryName: string;      // <-- Different key name!
      amount: number;
      percent: number;
    }>;
    // NO hasData, changePercent, trend fields
  };
  recurring: {
    upcoming: Array<{
      id: string;                // <-- Extra field
      name: string;
      amount: string;            // <-- STRING not number!
      date: string;              // <-- Different key name (date vs dueDate)!
      frequency: string;         // <-- Extra field
    }>;
    count: number;
    totalAmount: number;
  };
}
```

**Mismatch Summary:**

| Field | Client Type | Server Type | Impact |
|-------|-------------|-------------|--------|
| `netWorth.trend` | `"up" | "down" | "steady"` | Not returned | SpendingStep line 27 will be `undefined` |
| `spending.topCategories` | Key name | `categories` (different key) | **RUNTIME ERROR** - accessing wrong property |
| `spending.topCategories[].name` | `name` | `categoryName` | **RUNTIME ERROR** |
| `spending.hasData` | `boolean` | Not returned | Will be `undefined` |
| `spending.changePercent` | `number` | Not returned | Uses `?? 0` fallback, OK |
| `spending.trend` | `Array<{date, amount}>` | Not returned | Empty chart, graceful |
| `recurring.upcoming[].amount` | `number` | `string` | **TYPE MISMATCH** - formatCurrency may fail |
| `recurring.upcoming[].dueDate` | `dueDate` | `date` | **RUNTIME ERROR** - wrong property |

### 3.2 Money Handling Issues

**Server uses Money class correctly in:**
- `weekly-recap.service.ts:40-45` - `sumAmounts()` uses `new Money(amt)`

**Server converts to number incorrectly in:**
- `weekly-recap.service.ts:24-35` - `toMoneyNumber()` uses `Number()` which loses precision

**Client receives numbers, displays correctly:**
- `NetWorthStep.tsx:40` - `formatCurrency(netWorth.current)` - OK
- `SpendingStep.tsx:48` - `formatCurrency(spending.total)` - OK
- `RecurringStep.tsx:83` - `formatCurrency(item.amount)` - **WILL FAIL** (amount is string)

### 3.3 Date Calculation Issues

**Server week calculation (weekly-recap.controller.ts:35-42):**
```typescript
const dayOfWeek = now.getDay();
const start = new Date(now);
start.setDate(now.getDate() - dayOfWeek);  // Sunday-based week
```

**Issue:** Uses Sunday as week start, but many users expect Monday-based weeks (ISO 8601). No configuration option exists.

**Client week calculation (WeeklyRecapContext.tsx:74-81):**
```typescript
const dayOfWeek = now.getDay();
const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
const monday = new Date(now);
monday.setDate(now.getDate() + mondayOffset);  // Monday-based week
```

**Issue:** Client and server use DIFFERENT week start days! Server uses Sunday, client fallback uses Monday.

---

## 4. Business Logic Verification

### 4.1 Net Worth Calculation

| Logic | Implementation | Correct |
|-------|---------------|---------|
| Fetch current net worth | Via AnalyticsService | YES |
| Fetch previous week net worth | Calculates prev week dates correctly | YES |
| Calculate change | `current - previous` | YES |
| Calculate change percent | `(change / |previous|) * 100` | YES |
| Handle zero previous | Returns 0% | YES |

**Assessment:** Net worth logic is sound.

### 4.2 Spending Breakdown

| Logic | Implementation | Correct |
|-------|---------------|---------|
| Fetch spending by category | Via AnalyticsService | YES |
| Limit to top 5 categories | `slice(0, 5)` | YES |
| Return previous week comparison | **NOT IMPLEMENTED** | MISSING |
| Return daily trend | **NOT IMPLEMENTED** | MISSING |

**Assessment:** Basic spending works, but comparison features are missing.

### 4.3 Recurring Bills

| Logic | Implementation | Correct |
|-------|---------------|---------|
| Fetch upcoming bills | Via RecurringService | YES |
| Filter to current week | Filters by `from <= billDate <= to` | YES |
| Calculate total | Uses Money class `sumAmounts()` | YES |

**Assessment:** Recurring logic is correct.

### 4.4 Feedback Submission

**Current flow:**
1. User clicks thumbs up/down
2. Client calls `POST /api/weekly-recap/feedback`
3. Server validates with schema allowing `['net-worth', 'spending', 'recurring', 'overall']`
4. Server logs feedback (not stored in DB)

**Bug:** WrapUpStep sends `step: "wrap-up"` but backend enum only allows `"overall"`. Feedback submission will return 400.

**Evidence (WrapUpStep.tsx:22-33):**
```typescript
// Comment in code acknowledges the bug:
// Schema has 'overall' step.
// `RecapStep` in frontend context is "wrap-up".
// So 'wrap-up' will fail.
```

---

## 5. Cross-Module Integration

### 5.1 Dependencies

| Service | Used For | Integration Quality |
|---------|----------|---------------------|
| AnalyticsService | Net worth, Spending | GOOD |
| RecurringService | Upcoming bills | GOOD |
| GoalsService | Goal progress | **NOT INTEGRATED** |
| BudgetService | Budget progress | **NOT INTEGRATED** |

### 5.2 Missing Integrations

**GoalsService integration needed:**
```typescript
// In weekly-recap.service.ts
import { goalService } from "../../services/Goal";

async getGoalProgress(householdId: string): Promise<GoalProgressData> {
  const goals = await goalService.getActiveGoals(householdId);
  return {
    goals: goals.map(g => ({
      name: g.name,
      currentAmount: g.currentAmount,
      targetAmount: g.targetAmount,
      percentComplete: (g.currentAmount / g.targetAmount) * 100,
      weeklyProgress: g.weeklyContribution,
    })),
    totalProgress: calculateTotalProgress(goals),
  };
}
```

---

## 6. API Completeness

### 6.1 Implemented Endpoints

| Endpoint | Method | Status | Rate Limiting |
|----------|--------|--------|---------------|
| `/api/weekly-recap` | GET | Working | `analyticsLimiter` (30/min) |
| `/api/weekly-recap/feedback` | POST | BUGGY | **NONE** |

### 6.2 Missing Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/weekly-recap/settings` | GET | Get user's recap preferences |
| `/api/weekly-recap/settings` | PATCH | Update recap preferences |
| `/api/weekly-recap/history` | GET | View past recaps |
| `/api/weekly-recap/generate` | POST | Force regenerate recap |

### 6.3 Rate Limiting Issue

**Found:** Feedback endpoint has NO rate limiter.

```typescript
// weekly-recap.routes.ts:20
router.post("/feedback", weeklyRecapController.submitFeedback);
// Missing: analyticsLimiter or generalLimiter
```

**Impact:** Potential for feedback spam / DoS on logging system.

---

## 7. Test Coverage

### 7.1 Current Coverage

| File | Unit Tests | Integration Tests |
|------|------------|-------------------|
| weekly-recap.service.ts | 0 | 0 |
| weekly-recap.controller.ts | 0 | 0 |
| weekly-recap.routes.ts | 0 | 0 |
| weekly-recap.validation.ts | 0 | 0 |
| WeeklyRecapWizard.tsx | 0 | 0 |
| useWeeklyRecapData.ts | 0 | 0 |
| All step components | 0 | 0 |

**Total Coverage: 0%**

### 7.2 Required Tests

**Server tests needed:**
1. `getRecap()` returns correct shape
2. Net worth calculation with zero previous
3. Spending categories limited to 5
4. Recurring filtering by date range
5. Feedback validation rejects invalid steps
6. Rate limiting on feedback endpoint

**Client tests needed:**
1. Wizard step navigation
2. Data transformation from API response
3. Empty state handling
4. Error state handling
5. Feedback submission

---

## 8. Monarch Money Comparison

| Feature | Monarch Money | This App | Gap |
|---------|--------------|----------|-----|
| Net worth change | YES | YES | - |
| Spending by category | YES | YES | - |
| Spending trend | YES | NO | Missing trend chart data |
| Budget status | YES | NO | Not implemented |
| Goal progress | YES | NO | **Critical gap** |
| Recurring bills | YES | YES | - |
| Investment performance | YES | NO | Not implemented |
| Email delivery | YES | NO | Not implemented |
| Mobile push | YES | NO | Not implemented |
| Custom schedule | YES | NO | Not implemented |
| Historical recaps | YES | NO | Not implemented |

**Gap Analysis:** This module implements ~40% of what Monarch Money offers.

---

## 9. Recommendations

### P0 - Critical (Blocking Production)

1. **FUNC-01:** Fix client-server data contract:
   - Rename `categories` to `topCategories` in server response
   - Rename `categoryName` to `name`
   - Rename `date` to `dueDate` for recurring
   - Convert `amount` to number for recurring

2. **FUNC-02:** Fix feedback endpoint:
   - Map "wrap-up" to "overall" in backend enum OR
   - Change frontend step name to "overall"

3. **FUNC-03:** Add rate limiting to feedback endpoint

### P1 - High Priority

4. **FUNC-04:** Implement Goal Progress step:
   - Add `goals` step to wizard flow
   - Create `GoalProgressStep.tsx` component
   - Integrate GoalsService in weekly-recap.service.ts

5. **FUNC-05:** Add missing server fields:
   - `netWorth.trend` calculation
   - `spending.changePercent` (vs previous week)
   - `spending.trend` array (daily breakdown)

6. **FUNC-06:** Align week start day:
   - Server and client must use same week start (prefer Monday/ISO)

### P2 - Medium Priority

7. **FUNC-07:** Add basic test coverage (target 50%):
   - Server service tests
   - Client wizard navigation tests
   - API contract tests

8. **FUNC-08:** Implement settings endpoint and UI:
   - Store preferences in database
   - Add settings modal in UI

### P3 - Low Priority (Future)

9. **FUNC-09:** Implement email/push delivery
10. **FUNC-10:** Add historical recaps view
11. **FUNC-11:** Add budget progress step

---

## 10. Score Breakdown

| Criterion | Weight | Score | Notes |
|-----------|--------|-------|-------|
| **Wizard Flow Complete** | 10% | 70/100 | Missing goals step |
| **Data Contract Match** | 15% | 30/100 | 6+ field mismatches |
| **Net Worth Feature** | 10% | 90/100 | Works well |
| **Spending Feature** | 10% | 50/100 | Missing trend, changePercent |
| **Recurring Feature** | 10% | 80/100 | Works, minor type issue |
| **Goals Feature** | 15% | 0/100 | **Not implemented** |
| **Feedback System** | 10% | 40/100 | Will fail on wrap-up step |
| **Settings Feature** | 5% | 0/100 | Not implemented |
| **Test Coverage** | 10% | 0/100 | 0% coverage |
| **API Completeness** | 5% | 40/100 | 2/6 endpoints |

**Final Score: 58/100**

---

## 11. Files Reviewed

### Client Files

| File | Path | LOC |
|------|------|-----|
| WeeklyRecapWizard.tsx | `client/src/components/weekly-recap/WeeklyRecapWizard.tsx` | 126 |
| WeeklyRecapWidget.tsx | `client/src/components/weekly-recap/WeeklyRecapWidget.tsx` | 40 |
| WeeklyRecapContext.tsx | `client/src/components/weekly-recap/WeeklyRecapContext.tsx` | 116 |
| useWeeklyRecapData.ts | `client/src/components/weekly-recap/hooks/useWeeklyRecapData.ts` | 92 |
| StepProgress.tsx | `client/src/components/weekly-recap/components/StepProgress.tsx` | 31 |
| WeeklyChart.tsx | `client/src/components/weekly-recap/components/WeeklyChart.tsx` | 65 |
| NetWorthStep.tsx | `client/src/components/weekly-recap/steps/NetWorthStep.tsx` | 107 |
| SpendingStep.tsx | `client/src/components/weekly-recap/steps/SpendingStep.tsx` | 136 |
| RecurringStep.tsx | `client/src/components/weekly-recap/steps/RecurringStep.tsx` | 126 |
| WelcomeStep.tsx | `client/src/components/weekly-recap/steps/WelcomeStep.tsx` | 71 |
| WrapUpStep.tsx | `client/src/components/weekly-recap/steps/WrapUpStep.tsx` | 109 |
| Dashboard.tsx | `client/src/pages/Dashboard.tsx` | 232 |

### Server Files

| File | Path | LOC |
|------|------|-----|
| weekly-recap.service.ts | `server/modules/weekly-recap/weekly-recap.service.ts` | 262 |
| weekly-recap.controller.ts | `server/modules/weekly-recap/weekly-recap.controller.ts` | 113 |
| weekly-recap.routes.ts | `server/modules/weekly-recap/weekly-recap.routes.ts` | 22 |
| weekly-recap.validation.ts | `server/modules/weekly-recap/weekly-recap.validation.ts` | 54 |
| index.ts | `server/modules/weekly-recap/index.ts` | 5 |

---

## 12. Appendix: Data Contract Fix

**Recommended server response shape to match client:**

```typescript
// server/modules/weekly-recap/weekly-recap.types.ts

export interface WeeklyRecapResponse {
  weekStart: string;
  weekEnd: string;
  netWorth: {
    current: number;
    previous: number;
    change: number;
    changePercent: number;
    series: Array<{ date: string; value: number }>;
    trend: "up" | "down" | "steady";
  };
  spending: {
    total: number;
    topCategories: Array<{
      name: string;          // Changed from categoryName
      amount: number;
      percent: number;
    }>;
    hasData: boolean;        // Add this
    changePercent?: number;  // Add this
    trend?: Array<{          // Add this
      date: string;
      amount: number;
    }>;
  };
  recurring: {
    upcoming: Array<{
      name: string;
      amount: number;        // Changed from string
      dueDate: string;       // Changed from date
    }>;
    count: number;
    totalAmount: number;
  };
  goals?: {                  // Add this section
    items: Array<{
      name: string;
      currentAmount: number;
      targetAmount: number;
      percentComplete: number;
    }>;
    totalProgress: number;
    weeklyContributions: number;
  };
}
```

---

*Review conducted per CLAUDE.md guidelines for Product Manager functionality verification.*
