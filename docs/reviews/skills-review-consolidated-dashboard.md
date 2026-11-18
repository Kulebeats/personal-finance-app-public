# Dashboard Module - Consolidated Skills Review

**Module:** Dashboard
**Review Date:** 2026-01-21
**Reviewers:** Senior Developer, Fintech Expert, Product Manager, QA Engineer, UX Designer
**Overall Score:** 74/100
**Status:** Acceptable with Noted Improvements Required

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [Module Overview](#module-overview)
3. [Consolidated Findings](#consolidated-findings)
4. [Detailed Technical Specifications](#detailed-technical-specifications)
5. [Implementation Todo List](#implementation-todo-list)
6. [Files Inventory](#files-inventory)
7. [Appendix: Raw Review Scores](#appendix-raw-review-scores)

---

## Executive Summary

### Score Summary

| Perspective | Reviewer | Score | Status |
|-------------|----------|-------|--------|
| Code Quality | Senior Developer | 78/100 | Needs Work |
| Compliance | Fintech Expert | 72/100 | Moderate Risk |
| Functionality | Product Manager | 85/100 | Minor Issues |
| Test Coverage | QA Engineer | 58/100 | Significant Gaps |
| UX/Accessibility | UX Designer | 75/100 | Needs Work |
| **Overall** | **Consolidated** | **74/100** | **Acceptable** |

### Key Findings at a Glance

| Category | Critical | Major | Minor |
|----------|----------|-------|-------|
| Type Safety | 2 | 0 | 0 |
| Accessibility | 2 | 1 | 0 |
| Security | 0 | 2 | 0 |
| Compliance | 0 | 1 | 0 |
| Functionality | 0 | 0 | 2 |
| Test Coverage | 0 | 2 | 1 |
| Dark Mode | 0 | 1 | 0 |
| **Total** | **4** | **7** | **3** |

### Risk Assessment

- **Security Risk:** MEDIUM - Missing rate limiting on settings API
- **Compliance Risk:** LOW - Missing audit logging for non-financial preferences
- **Accessibility Risk:** HIGH - Keyboard navigation gaps for transaction rows
- **Data Integrity Risk:** LOW - Read-only display module

---

## Module Overview

### Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Dashboard Module                          │
├─────────────────────────────────────────────────────────────────┤
│  CLIENT                                                          │
│  ┌─────────────────┐  ┌──────────────────────────────────────┐  │
│  │ Dashboard.tsx   │──│ useDashboardWidgets.ts               │  │
│  │ (Main Page)     │  │ - Widget state management            │  │
│  │ - DndContext    │  │ - Debounced server sync              │  │
│  │ - SortableCtx   │  │ - Toggle/reorder functions           │  │
│  └────────┬────────┘  └──────────────────────────────────────┘  │
│           │                                                      │
│  ┌────────▼────────────────────────────────────────────────┐    │
│  │              Widget Components (15 total)                │    │
│  │  ┌─────────────┐ ┌─────────────┐ ┌─────────────────┐    │    │
│  │  │NetWorthWidget│ │CashFlowWidget│ │GoalsWidget      │    │    │
│  │  │AccountsWidget│ │SpendingWidget│ │BudgetStatusWidget│    │    │
│  │  │InvestmentWidget│ │RecurringWidget│ │TransactionsWidget│    │    │
│  │  │...           │ │...           │ │...              │    │    │
│  │  └─────────────┘ └─────────────┘ └─────────────────┘    │    │
│  └──────────────────────────────────────────────────────────┘    │
│           │                                                      │
│           │  API Calls                                           │
├───────────┼──────────────────────────────────────────────────────┤
│  SERVER   ▼                                                      │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │ settings.report-widgets.ts                               │    │
│  │ GET  /api/settings/report-widgets                        │    │
│  │ PATCH /api/settings/report-widgets                       │    │
│  └─────────────────────────────────────────────────────────┘    │
│           │                                                      │
│  ┌────────▼────────┐                                            │
│  │ UserRepository  │ → display_settings table                   │
│  └─────────────────┘                                            │
└─────────────────────────────────────────────────────────────────┘
```

### File Structure

```
client/
├── src/
│   ├── pages/
│   │   └── Dashboard.tsx                    # Main dashboard page (222 LOC)
│   ├── hooks/
│   │   └── useDashboardWidgets.ts           # Widget state hook (107 LOC)
│   ├── components/
│   │   └── dashboard/
│   │       ├── CustomizeDashboardModal.tsx  # Widget customization (50 LOC)
│   │       ├── NetWorthWidget.tsx           # Net worth chart (129 LOC)
│   │       ├── CashFlowWidget.tsx           # Cash flow chart (138 LOC)
│   │       ├── GoalsWidget.tsx              # Goals summary (225 LOC)
│   │       ├── AccountsWidget.tsx           # Accounts list (67 LOC)
│   │       ├── InvestmentSummaryWidget.tsx  # Investments (88 LOC)
│   │       ├── RecentTransactionsWidget.tsx # Transactions list (168 LOC)
│   │       ├── SpendingWidget.tsx           # Spending pie chart (109 LOC)
│   │       ├── BudgetStatusWidget.tsx       # Budget status (107 LOC)
│   │       ├── RecurringExpensesWidget.tsx  # Upcoming bills (79 LOC)
│   │       ├── DashboardBudgetWidget.tsx    # Budget progress (93 LOC)
│   │       ├── DashboardSpendingWidget.tsx  # Spending trend
│   │       ├── DashboardTransactionsWidget.tsx
│   │       ├── TopMerchantsWidget.tsx
│   │       ├── AnnualSummaryWidget.tsx
│   │       └── TransactionDetailModal.tsx
│   └── lib/
│       └── money.ts                         # Money utilities (214 LOC)

server/
├── routes/
│   └── settings.report-widgets.ts           # Report widget API (190 LOC)
└── modules/
    └── settings/
        └── settings.routes.ts               # Settings router (60 LOC)

e2e/
└── dashboard.spec.ts                        # E2E tests (95 LOC)
```

---

## Consolidated Findings

### FINDING-001: Type Safety Violations - Server Side

**Severity:** Critical
**Category:** Code Quality
**Identified By:** Senior Developer

**Description:**
The server-side settings API uses `as any` casts to bypass TypeScript's type checking, which can lead to runtime errors and makes the code harder to maintain.

**Locations:**
| File | Line | Code |
|------|------|------|
| `server/routes/settings.report-widgets.ts` | 44 | `(displaySettings as any)?.reportWidgetPreferences` |
| `server/routes/settings.report-widgets.ts` | 134 | `(displaySettings as any)?.reportWidgetPreferences` |
| `server/routes/settings.report-widgets.ts` | 151 | `} as any` |

**Impact:**
- TypeScript cannot catch type errors at compile time
- IDE autocomplete and refactoring tools don't work properly
- Violates CLAUDE.md Rule 16: Zero `as any` in production code

**Root Cause:**
The `DisplaySettings` type from the repository doesn't include the `reportWidgetPreferences` field, so developers cast to `any` to bypass type errors.

---

### FINDING-002: Type Safety Violations - Client Side

**Severity:** Critical
**Category:** Code Quality
**Identified By:** Senior Developer

**Description:**
Several client-side components use `any` types for transaction and category data, reducing type safety.

**Locations:**
| File | Line | Code |
|------|------|------|
| `client/src/components/dashboard/RecentTransactionsWidget.tsx` | 19 | `const categoryIcons: Record<string, any>` |
| `client/src/components/dashboard/RecentTransactionsWidget.tsx` | 29 | `useState<any>(null)` |
| `client/src/components/dashboard/RecentTransactionsWidget.tsx` | 77 | `const handleRowClick = (t: any)` |
| `client/src/components/dashboard/TransactionDetailModal.tsx` | 33 | `icon: any` |

**Impact:**
- No compile-time type checking for transaction objects
- Potential runtime errors if API response shape changes
- Harder to refactor safely

---

### FINDING-003: Missing Keyboard Accessibility

**Severity:** Critical
**Category:** Accessibility (WCAG 2.1.1)
**Identified By:** UX Designer

**Description:**
Transaction rows in RecentTransactionsWidget use `<div onClick>` without keyboard support, making them inaccessible to keyboard-only users.

**Location:**
`client/src/components/dashboard/RecentTransactionsWidget.tsx:105-111`

```typescript
// Current implementation (INACCESSIBLE)
<div
  key={t.id}
  className={cn("flex items-center justify-between...")}
  onClick={() => handleRowClick(t)}  // No keyboard handler!
>
```

**Impact:**
- Users who rely on keyboard navigation cannot access transaction details
- Fails WCAG 2.1 Level A (Keyboard) compliance
- Screen reader users cannot interact with rows

---

### FINDING-004: Missing Icon Button Labels

**Severity:** Critical
**Category:** Accessibility (WCAG 1.1.1)
**Identified By:** UX Designer

**Description:**
Icon-only buttons lack accessible labels, making them meaningless to screen reader users.

**Locations:**
| File | Line | Element | Issue |
|------|------|---------|-------|
| `DashboardBudgetWidget.tsx` | 54-56 | MoreHorizontal button | No aria-label |
| `RecurringExpensesWidget.tsx` | 21-26 | View All button | Has text, OK |

**Impact:**
- Screen readers announce "button" with no context
- Users cannot understand the button's purpose

---

### FINDING-005: Missing Rate Limiting

**Severity:** Major
**Category:** Security
**Identified By:** Senior Developer, Fintech Expert

**Description:**
The `/api/settings/report-widgets` endpoints lack rate limiting middleware, creating potential for denial-of-service attacks.

**Location:**
`server/routes/settings.report-widgets.ts` - entire file

**Current State:**
```typescript
router.get("/report-widgets", async (req, res) => {...});
router.patch("/report-widgets", async (req, res) => {...});
// No rate limiter applied!
```

**Impact:**
- Attackers could flood the endpoint with requests
- Database could be overwhelmed
- Violates CLAUDE.md Rule 12

---

### FINDING-006: Missing Audit Logging

**Severity:** Major
**Category:** Compliance
**Identified By:** Fintech Expert

**Description:**
The PATCH endpoint for report widget preferences modifies user data without audit logging.

**Location:**
`server/routes/settings.report-widgets.ts:110-186`

**Impact:**
- Cannot trace who changed dashboard configuration
- Potential compliance issue for audit trails
- Violates CLAUDE.md Rule 9

**Note:** This is lower risk than financial audit logging since it's only display preferences, but should still be implemented for consistency.

---

---

### FINDING-008: Hardcoded Chart Colors

**Severity:** Major
**Category:** Dark Mode / Visual Consistency
**Identified By:** UX Designer

**Description:**
Chart components use hardcoded hex colors instead of theme-aware tokens, causing potential contrast issues in dark mode.

**Locations:**
| File | Lines | Colors |
|------|-------|--------|
| `SpendingWidget.tsx` | 11 | `["#3b82f6", "#10b981", "#f59e0b", "#8b5cf6", "#64748b"]` |
| `CashFlowWidget.tsx` | 130-131 | `fill="#10b981"`, `fill="#f43f5e"` |
| `DashboardSpendingWidget.tsx` | 74-79, 117, 126, 131 | Multiple orange/slate colors |

**Impact:**
- Colors may have poor contrast in dark mode
- Inconsistent with design system token usage
- Harder to maintain global theme changes

---

### FINDING-009: Insufficient Test Coverage

**Severity:** Major
**Category:** Quality Assurance
**Identified By:** QA Engineer

**Description:**
The dashboard module has only E2E tests with no unit or integration tests for individual components or the API.

**Current Test Coverage:**
| Type | Files | Tests | Coverage |
|------|-------|-------|----------|
| Unit (widgets) | 0 | 0 | 0% |
| Integration (API) | 0 | 0 | 0% |
| E2E (Playwright) | 1 | 6 | ~20% |

**Impact:**
- Bugs may not be caught before deployment
- Refactoring is risky without test safety net
- Cannot verify edge cases systematically

---

### FINDING-010: Inconsistent Error States

**Severity:** Major
**Category:** UX / Functionality
**Identified By:** QA Engineer, Product Manager

**Description:**
Only CashFlowWidget properly handles API errors with a user-facing error state. Other widgets show nothing or fail silently.

**Widget Error State Audit:**
| Widget | Has Error State | Behavior on Error |
|--------|-----------------|-------------------|
| CashFlowWidget | ✅ Yes | Shows error icon + message |
| NetWorthWidget | ❌ No | Shows loading forever |
| SpendingWidget | ❌ No | Shows loading forever |
| GoalsWidget | ❌ No | Shows loading forever |
| AccountsWidget | ❌ No | Shows empty state |
| BudgetStatusWidget | ❌ No | Shows loading forever |
| InvestmentSummaryWidget | ❌ No | Shows empty state |

**Impact:**
- Users don't know when data failed to load
- No way to retry or understand the problem
- Poor user experience during network issues

---

### FINDING-011: Direct Error Responses in API

**Severity:** Minor
**Category:** Code Quality
**Identified By:** Senior Developer

**Description:**
The settings API manually constructs JSON error responses instead of using the standard AppError pattern.

**Location:**
`server/routes/settings.report-widgets.ts:59-66, 179-186`

```typescript
// Current (inconsistent)
res.status(500).json({
  success: false,
  error: {
    code: "DATABASE_ERROR",
    message: "Failed to get report widget preferences",
  },
});

// Should use
throw new DatabaseError("Failed to get report widget preferences");
```

**Impact:**
- Inconsistent error response format across API
- Error handler middleware not utilized
- Harder to maintain error handling logic

---

---

### FINDING-013: Percentage Calculations Use JavaScript Math

**Severity:** Minor (Acceptable)
**Category:** Money Handling
**Identified By:** Fintech Expert

**Description:**
Several widgets use `Math.round()` and `.toFixed()` for percentage calculations.

**Locations:**
| File | Line | Usage |
|------|------|-------|
| `NetWorthWidget.tsx` | 48 | `.toFixed(1)` for % change |
| `GoalsWidget.tsx` | 58 | `Math.round()` for progress % |
| `BudgetStatusWidget.tsx` | 33 | `Math.round()` for spent % |
| `TopMerchantsWidget.tsx` | 51 | `.toFixed(1)` for spend % |

**Assessment:** **ACCEPTABLE**
Per `client/src/lib/money.ts` guidelines, `parseFloat` and rounding are permitted for display-only purposes on the client. These are percentage calculations for visual display, not financial calculations.

---

## Detailed Technical Specifications

### SPEC-001: Fix Type Safety - Server Side

**Priority:** P0 (Critical)
**Estimated Effort:** 2-3 hours
**Files to Modify:**
- `server/routes/settings.report-widgets.ts`
- `shared/schema.ts` or `server/types/settings.ts` (new)

**Technical Approach:**

1. **Define proper interface for report widget preferences:**

```typescript
// In shared/types/settings.ts or appropriate location
export interface WidgetConfig {
  enabled: boolean;
  order: number;
  chartType: string;
}

export interface CustomChart {
  id: string;
  name: string;
  chartType: string;
  primaryMetric: string;
  secondaryMetric?: string;
  groupBy?: string;
  aggregation?: string;
  order: number;
}

export interface ReportWidgetPreferences {
  coreWidgets: Record<string, WidgetConfig>;
  optionalWidgets: Record<string, WidgetConfig>;
  customCharts: CustomChart[];
  hasCompletedWidgetSetup: boolean;
}

export interface DisplaySettingsWithWidgets {
  // ... existing DisplaySettings fields
  reportWidgetPreferences?: ReportWidgetPreferences;
  dashboardWidgets?: {
    widgets: Array<{ id: string; label: string; enabled: boolean }>;
    version: number;
  };
}
```

2. **Update UserRepository to use proper types:**

```typescript
// In UserRepository
async getDisplaySettings(userId: string): Promise<DisplaySettingsWithWidgets | null> {
  // ... implementation
}
```

3. **Remove `as any` casts in settings.report-widgets.ts:**

```typescript
// Before (line 44)
const preferences = (displaySettings as any)?.reportWidgetPreferences || defaultPreferences;

// After
const preferences = displaySettings?.reportWidgetPreferences ?? defaultPreferences;
```

**Verification:**
- Run `npm run check` - must pass with zero errors
- No `as any` in file: `grep "as any" server/routes/settings.report-widgets.ts` returns empty

---

### SPEC-002: Fix Type Safety - Client Side

**Priority:** P0 (Critical)
**Estimated Effort:** 1-2 hours
**Files to Modify:**
- `client/src/components/dashboard/RecentTransactionsWidget.tsx`
- `client/src/components/dashboard/TransactionDetailModal.tsx`

**Technical Approach:**

1. **Define proper transaction display type:**

```typescript
// In RecentTransactionsWidget.tsx
import type { LucideIcon } from "lucide-react";

interface TransactionDisplay {
  id: string;
  name: string;
  date: string;
  amount: number;
  categoryId?: string;
  categoryName: string;
  icon: LucideIcon;
}
```

2. **Update categoryIcons type:**

```typescript
// Before
const categoryIcons: Record<string, any> = {...};

// After
const categoryIcons: Record<string, LucideIcon> = {
  Groceries: ShoppingBag,
  "Food & Dining": Coffee,
  Transportation: Car,
  Housing: Home,
  Salary: Smartphone,
  default: DollarSign,
};
```

3. **Update state and handler types:**

```typescript
// Before
const [selectedTransaction, setSelectedTransaction] = useState<any>(null);
const handleRowClick = (t: any) => {...};

// After
const [selectedTransaction, setSelectedTransaction] = useState<TransactionDisplay | null>(null);
const handleRowClick = (t: TransactionDisplay) => {...};
```

4. **Update TransactionDetailModal props:**

```typescript
// In TransactionDetailModal.tsx
interface TransactionDetailModalProps {
  transaction: TransactionDisplay | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  categories: Category[];
  categoriesLoading: boolean;
}
```

**Verification:**
- `npm run check` passes
- `grep ": any" client/src/components/dashboard/RecentTransactionsWidget.tsx` returns only acceptable patterns

---

### SPEC-003: Fix Keyboard Accessibility

**Priority:** P0 (Critical)
**Estimated Effort:** 1 hour
**Files to Modify:**
- `client/src/components/dashboard/RecentTransactionsWidget.tsx`

**Technical Approach:**

**Option A: Convert to button (Recommended)**

```typescript
// Replace div with button
<button
  key={t.id}
  type="button"
  className={cn(
    "flex items-center justify-between px-4 h-[56px] w-full text-left",
    "hover:bg-muted/50 transition-colors cursor-pointer group",
    "focus:outline-none focus:ring-2 focus:ring-primary focus:ring-inset",
    i % 2 === 0 ? "bg-transparent" : "bg-muted/10"
  )}
  onClick={() => handleRowClick(t)}
>
  {/* ... row content ... */}
</button>
```

**Option B: Add keyboard handler to div**

```typescript
<div
  key={t.id}
  role="button"
  tabIndex={0}
  className={cn(...)}
  onClick={() => handleRowClick(t)}
  onKeyDown={(e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      handleRowClick(t);
    }
  }}
>
```

**Verification:**
- Tab through page - transaction rows receive focus
- Press Enter/Space on focused row - modal opens
- Focus indicator is visible

---

### SPEC-004: Fix Icon Button Labels

**Priority:** P0 (Critical)
**Estimated Effort:** 30 minutes
**Files to Modify:**
- `client/src/components/dashboard/DashboardBudgetWidget.tsx`

**Technical Approach:**

```typescript
// Before (line 54-56)
<button className="text-muted-foreground hover:text-foreground">
  <MoreHorizontal className="w-5 h-5" />
</button>

// After
<button
  aria-label="More budget options"
  className="text-muted-foreground hover:text-foreground"
>
  <MoreHorizontal className="w-5 h-5" />
</button>
```

**Also check and fix any other icon-only buttons in dashboard widgets.**

**Verification:**
- Run axe DevTools accessibility audit
- Screen reader announces "More budget options, button"

---

### SPEC-005: Add Rate Limiting

**Priority:** P1 (Major)
**Estimated Effort:** 30 minutes
**Files to Modify:**
- `server/routes/settings.report-widgets.ts`

**Technical Approach:**

```typescript
import { generalLimiter } from "../middleware/rateLimit";

const router = Router();

// Apply rate limiting to all routes in this file
router.use(generalLimiter);

// Routes remain unchanged
router.get("/report-widgets", async (req: Request, res: Response) => {...});
router.patch("/report-widgets", async (req: Request, res: Response) => {...});
```

**Verification:**
- Test rapid requests (>100/min) - should receive 429 response
- Normal usage unaffected

---

### SPEC-006: Add Audit Logging

**Priority:** P1 (Major)
**Estimated Effort:** 1 hour
**Files to Modify:**
- `server/routes/settings.report-widgets.ts`

**Technical Approach:**

```typescript
import { businessAuditService } from "../services/businessAudit.service";

// In PATCH handler, after successful update (line ~154)
router.patch("/report-widgets", async (req: Request, res: Response) => {
  try {
    // ... existing validation and update logic ...

    // Add audit logging
    await businessAuditService.logUpdate({
      userId: req.session.userId!,
      householdId: req.householdContext?.householdId || "user-settings",
      entityType: "display_settings",
      entityId: req.session.userId!,
      changes: {
        reportWidgetPreferences: {
          before: currentPreferences,
          after: updatedPreferences,
        },
      },
      ipAddress: businessAuditService.getIpAddress(req),
    });

    res.json({
      success: true,
      data: { preferences: updatedPreferences },
      message: "Report widget preferences updated successfully",
    });
  } catch (error) {
    // ... error handling
  }
});
```

**Verification:**
- Make PATCH request
- Query `audit_logs` table - entry should exist with entityType="display_settings"

---

---

### SPEC-008: Fix Chart Colors for Dark Mode

**Priority:** P1 (Major)
**Estimated Effort:** 2-3 hours
**Files to Modify:**
- `client/src/components/dashboard/SpendingWidget.tsx`
- `client/src/components/dashboard/CashFlowWidget.tsx`
- `client/src/components/dashboard/DashboardSpendingWidget.tsx`

**Technical Approach:**

1. **Add chart color tokens to CSS:**

```css
/* In client/src/index.css */
:root {
  --chart-1: 221.2 83.2% 53.3%;  /* blue-500 */
  --chart-2: 160 84% 39%;        /* emerald-500 */
  --chart-3: 38 92% 50%;         /* amber-500 */
  --chart-4: 262 83% 58%;        /* violet-500 */
  --chart-5: 215 16% 47%;        /* slate-500 */
  --chart-income: 160 84% 39%;   /* emerald-500 */
  --chart-expense: 350 89% 60%;  /* rose-500 */
}

.dark {
  --chart-1: 217.2 91.2% 59.8%;  /* blue-400 */
  --chart-2: 160 81% 45%;        /* emerald-400 */
  --chart-3: 38 95% 54%;         /* amber-400 */
  --chart-4: 262 83% 68%;        /* violet-400 */
  --chart-5: 215 20% 65%;        /* slate-400 */
  --chart-income: 160 81% 45%;
  --chart-expense: 350 89% 65%;
}
```

2. **Update SpendingWidget.tsx:**

```typescript
// Before
const COLORS = ["#3b82f6", "#10b981", "#f59e0b", "#8b5cf6", "#64748b"];

// After
const COLORS = [
  "hsl(var(--chart-1))",
  "hsl(var(--chart-2))",
  "hsl(var(--chart-3))",
  "hsl(var(--chart-4))",
  "hsl(var(--chart-5))",
];
```

3. **Update CashFlowWidget.tsx:**

```typescript
// Before
<Bar dataKey="income" fill="#10b981" ... />
<Bar dataKey="expenses" fill="#f43f5e" ... />

// After
<Bar dataKey="income" fill="hsl(var(--chart-income))" ... />
<Bar dataKey="expenses" fill="hsl(var(--chart-expense))" ... />
```

**Verification:**
- Toggle dark mode
- Charts should remain readable with good contrast

---

### SPEC-009: Add Error States to Widgets

**Priority:** P1 (Major)
**Estimated Effort:** 3-4 hours
**Files to Modify:**
- All widget files without error states

**Technical Approach:**

Create a reusable error component and apply to all widgets:

```typescript
// In client/src/components/dashboard/WidgetErrorState.tsx
import { AlertCircle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

interface WidgetErrorStateProps {
  title?: string;
  message?: string;
  onRetry?: () => void;
}

export function WidgetErrorState({
  title = "Failed to load data",
  message = "Something went wrong. Please try again.",
  onRetry,
}: WidgetErrorStateProps) {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-3 p-6">
      <AlertCircle className="w-8 h-8 text-destructive" />
      <div className="text-center">
        <p className="text-sm font-medium text-foreground">{title}</p>
        <p className="text-xs text-muted-foreground mt-1">{message}</p>
      </div>
      {onRetry && (
        <Button variant="outline" size="sm" onClick={onRetry}>
          <RefreshCw className="w-3 h-3 mr-2" />
          Retry
        </Button>
      )}
    </div>
  );
}
```

Then apply to each widget:

```typescript
// Example in NetWorthWidget.tsx
const { data, isLoading, isError, refetch } = useReportsNetWorth({...});

if (isError) {
  return (
    <Card className="...">
      <WidgetErrorState
        title="Net Worth Unavailable"
        onRetry={() => refetch()}
      />
    </Card>
  );
}
```

---

### SPEC-010: Add Unit Tests

**Priority:** P1 (Major)
**Estimated Effort:** 4-6 hours
**Files to Create:**
- `client/src/components/dashboard/__tests__/NetWorthWidget.test.tsx`
- `client/src/components/dashboard/__tests__/GoalsWidget.test.tsx`
- `client/src/hooks/__tests__/useDashboardWidgets.test.ts`
- `server/routes/__tests__/settings.report-widgets.test.ts`

**Technical Approach:**

1. **Widget Unit Test Example:**

```typescript
// In client/src/components/dashboard/__tests__/NetWorthWidget.test.tsx
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { vi } from "vitest";
import NetWorthWidget from "../NetWorthWidget";

// Mock the hooks
vi.mock("@/hooks/use-reports", () => ({
  useReportsNetWorth: vi.fn(),
  useCurrentYearRange: () => ({ from: "2026-01-01", to: "2026-12-31" }),
}));

vi.mock("@/contexts/SettingsContext", () => ({
  useFormatters: () => ({
    formatCurrency: (v: number) => `$${v.toFixed(2)}`,
  }),
}));

describe("NetWorthWidget", () => {
  const queryClient = new QueryClient();

  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );

  it("shows loading state", () => {
    const { useReportsNetWorth } = require("@/hooks/use-reports");
    useReportsNetWorth.mockReturnValue({ isLoading: true, data: null });

    render(<NetWorthWidget />, { wrapper });
    expect(screen.getByRole("status")).toBeInTheDocument(); // Loader
  });

  it("displays net worth value", () => {
    const { useReportsNetWorth } = require("@/hooks/use-reports");
    useReportsNetWorth.mockReturnValue({
      isLoading: false,
      data: {
        latest: { netWorth: { amount: "50000.00", currency: "USD" } },
        series: [{ id: "Net Worth", data: [{ x: "2026-01", y: 50000 }] }],
      },
    });

    render(<NetWorthWidget />, { wrapper });
    expect(screen.getByText("$50000.00")).toBeInTheDocument();
  });

  it("handles empty data", () => {
    const { useReportsNetWorth } = require("@/hooks/use-reports");
    useReportsNetWorth.mockReturnValue({
      isLoading: false,
      data: { latest: null, series: [] },
    });

    render(<NetWorthWidget />, { wrapper });
    expect(screen.getByText("$0.00")).toBeInTheDocument();
  });
});
```

2. **API Integration Test Example:**

```typescript
// In server/routes/__tests__/settings.report-widgets.test.ts
import request from "supertest";
import { app } from "../../app";
import { createTestUser, loginAs } from "../../test/helpers";

describe("GET /api/settings/report-widgets", () => {
  it("returns default preferences for new user", async () => {
    const user = await createTestUser();
    const agent = await loginAs(user);

    const res = await agent.get("/api/settings/report-widgets");

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.preferences.coreWidgets).toBeDefined();
    expect(res.body.data.preferences.coreWidgets.summaryCards.enabled).toBe(true);
  });
});

describe("PATCH /api/settings/report-widgets", () => {
  it("updates widget preferences", async () => {
    const user = await createTestUser();
    const agent = await loginAs(user);

    const res = await agent
      .patch("/api/settings/report-widgets")
      .send({
        coreWidgets: {
          summaryCards: { enabled: false, order: 0, chartType: "cards" },
        },
      });

    expect(res.status).toBe(200);
    expect(res.body.data.preferences.coreWidgets.summaryCards.enabled).toBe(false);
  });

  it("rejects invalid chartType", async () => {
    const user = await createTestUser();
    const agent = await loginAs(user);

    const res = await agent
      .patch("/api/settings/report-widgets")
      .send({
        coreWidgets: {
          summaryCards: { enabled: true, order: -1, chartType: "cards" }, // invalid order
        },
      });

    expect(res.status).toBe(400);
  });
});
```

---

## Implementation Todo List

### Phase 1: Critical Fixes (P0) - Week 1

| # | Task | File(s) | Est. | Owner | Status |
|---|------|---------|------|-------|--------|
| 1.1 | Define ReportWidgetPreferences interface | `shared/types/settings.ts` | 1h | - | ⬜ Pending |
| 1.2 | Update UserRepository return types | `server/repositories/UserRepository.ts` | 1h | - | ⬜ Pending |
| 1.3 | Remove `as any` casts in server | `server/routes/settings.report-widgets.ts` | 1h | - | ⬜ Pending |
| 1.4 | Define TransactionDisplay interface | `RecentTransactionsWidget.tsx` | 30m | - | ⬜ Pending |
| 1.5 | Fix transaction state types | `RecentTransactionsWidget.tsx` | 30m | - | ⬜ Pending |
| 1.6 | Fix categoryIcons type | `RecentTransactionsWidget.tsx` | 15m | - | ⬜ Pending |
| 1.7 | Update TransactionDetailModal props | `TransactionDetailModal.tsx` | 30m | - | ⬜ Pending |
| 1.8 | Convert transaction rows to buttons | `RecentTransactionsWidget.tsx` | 1h | - | ⬜ Pending |
| 1.9 | Add focus styles to transaction rows | `RecentTransactionsWidget.tsx` | 30m | - | ⬜ Pending |
| 1.10 | Add aria-label to MoreHorizontal button | `DashboardBudgetWidget.tsx` | 15m | - | ⬜ Pending |
| 1.11 | Audit all widgets for icon buttons | All widgets | 1h | - | ⬜ Pending |
| 1.12 | Run `npm run check` verification | - | 15m | - | ⬜ Pending |
| 1.13 | Run accessibility audit (axe) | - | 30m | - | ⬜ Pending |

**Phase 1 Total: ~8 hours**

---

### Phase 2: Major Fixes (P1) - Week 2

| # | Task | File(s) | Est. | Owner | Status |
|---|------|---------|------|-------|--------|
| 2.1 | Add generalLimiter to report-widgets routes | `settings.report-widgets.ts` | 30m | - | ⬜ Pending |
| 2.2 | Add businessAuditService.logUpdate to PATCH | `settings.report-widgets.ts` | 1h | - | ⬜ Pending |
| 2.4 | Add chart color CSS variables | `client/src/index.css` | 30m | - | ⬜ Pending |
| 2.5 | Update SpendingWidget colors | `SpendingWidget.tsx` | 30m | - | ⬜ Pending |
| 2.6 | Update CashFlowWidget colors | `CashFlowWidget.tsx` | 30m | - | ⬜ Pending |
| 2.7 | Update DashboardSpendingWidget colors | `DashboardSpendingWidget.tsx` | 30m | - | ⬜ Pending |
| 2.8 | Create WidgetErrorState component | `components/dashboard/WidgetErrorState.tsx` | 1h | - | ⬜ Pending |
| 2.9 | Add error state to NetWorthWidget | `NetWorthWidget.tsx` | 30m | - | ⬜ Pending |
| 2.10 | Add error state to SpendingWidget | `SpendingWidget.tsx` | 30m | - | ⬜ Pending |
| 2.11 | Add error state to GoalsWidget | `GoalsWidget.tsx` | 30m | - | ⬜ Pending |
| 2.12 | Add error state to AccountsWidget | `AccountsWidget.tsx` | 30m | - | ⬜ Pending |
| 2.13 | Add error state to BudgetStatusWidget | `BudgetStatusWidget.tsx` | 30m | - | ⬜ Pending |
| 2.14 | Add error state to InvestmentSummaryWidget | `InvestmentSummaryWidget.tsx` | 30m | - | ⬜ Pending |
| 2.15 | Add error state to remaining widgets | Various | 1h | - | ⬜ Pending |
| 2.16 | Convert manual error responses to AppError | `settings.report-widgets.ts` | 1h | - | ⬜ Pending |
| 2.17 | Test dark mode with new colors | - | 30m | - | ⬜ Pending |
| 2.18 | Verify rate limiting works | - | 15m | - | ⬜ Pending |
| 2.19 | Verify audit logs created | - | 15m | - | ⬜ Pending |

**Phase 2 Total: ~10.75 hours**

---

### Phase 3: Test Coverage (P1) - Week 3

| # | Task | File(s) | Est. | Owner | Status |
|---|------|---------|------|-------|--------|
| 3.1 | Create test setup/mocks | `client/src/test/setup.ts` | 1h | - | ⬜ Pending |
| 3.2 | Write NetWorthWidget unit tests | `__tests__/NetWorthWidget.test.tsx` | 1.5h | - | ⬜ Pending |
| 3.3 | Write CashFlowWidget unit tests | `__tests__/CashFlowWidget.test.tsx` | 1.5h | - | ⬜ Pending |
| 3.4 | Write GoalsWidget unit tests | `__tests__/GoalsWidget.test.tsx` | 1.5h | - | ⬜ Pending |
| 3.5 | Write useDashboardWidgets hook tests | `__tests__/useDashboardWidgets.test.ts` | 2h | - | ⬜ Pending |
| 3.6 | Write settings.report-widgets API tests | `__tests__/settings.report-widgets.test.ts` | 2h | - | ⬜ Pending |
| 3.7 | Add widget customization E2E test | `e2e/dashboard.spec.ts` | 1h | - | ⬜ Pending |
| 3.8 | Add widget reorder E2E test | `e2e/dashboard.spec.ts` | 1h | - | ⬜ Pending |
| 3.9 | Run full test suite | - | 30m | - | ⬜ Pending |
| 3.10 | Generate coverage report | - | 15m | - | ⬜ Pending |

**Phase 3 Total: ~12 hours**

---

### Phase 4: Nice to Have (P2) - Future Sprint

| # | Task | File(s) | Est. | Owner | Status |
|---|------|---------|------|-------|--------|
| 4.1 | Add auto-refresh on window focus | `useDashboardWidgets.ts` | 2h | - | ⬜ Backlog |
| 4.2 | Add "Last updated" timestamp | Various widgets | 3h | - | ⬜ Backlog |
| 4.3 | Add widget reorder animation | `Dashboard.tsx` | 2h | - | ⬜ Backlog |
| 4.4 | Add remaining widget unit tests | Various | 4h | - | ⬜ Backlog |

---

## Summary Checklist

### Before Marking Complete

- [ ] All `as any` removed from production code (grep verification)
- [ ] All widgets have keyboard-accessible interactive elements
- [ ] All icon-only buttons have aria-labels
- [ ] Rate limiting applied to settings API
- [ ] Audit logging implemented for preference updates
- [ ] All widgets have loading, error, and empty states
- [ ] Chart colors use theme-aware tokens
- [ ] `npm run check` passes
- [ ] `npm run test:run` passes (when tests added)
- [ ] axe accessibility audit passes with no critical issues
- [ ] Dark mode tested manually

---

## Files Inventory

### Client Files (15 widgets + 2 supporting)

| File | LOC | Type | Status |
|------|-----|------|--------|
| `pages/Dashboard.tsx` | 222 | Page | ✅ Under limit |
| `hooks/useDashboardWidgets.ts` | 107 | Hook | ✅ Under limit |
| `components/dashboard/CustomizeDashboardModal.tsx` | 50 | Component | ✅ Under limit |
| `components/dashboard/NetWorthWidget.tsx` | 129 | Widget | ✅ Under limit |
| `components/dashboard/CashFlowWidget.tsx` | 138 | Widget | ✅ Under limit |
| `components/dashboard/GoalsWidget.tsx` | 225 | Widget | ✅ Under limit |
| `components/dashboard/AccountsWidget.tsx` | 67 | Widget | ✅ Under limit |
| `components/dashboard/InvestmentSummaryWidget.tsx` | 88 | Widget | ✅ Under limit |
| `components/dashboard/RecentTransactionsWidget.tsx` | 168 | Widget | ✅ Under limit |
| `components/dashboard/SpendingWidget.tsx` | 109 | Widget | ✅ Under limit |
| `components/dashboard/BudgetStatusWidget.tsx` | 107 | Widget | ✅ Under limit |
| `components/dashboard/RecurringExpensesWidget.tsx` | 79 | Widget | ✅ Under limit |
| `components/dashboard/DashboardBudgetWidget.tsx` | 93 | Widget | ✅ Under limit |
| `components/dashboard/DashboardSpendingWidget.tsx` | ~120 | Widget | ✅ Under limit |
| `components/dashboard/DashboardTransactionsWidget.tsx` | ~80 | Widget | ✅ Under limit |
| `components/dashboard/TopMerchantsWidget.tsx` | ~100 | Widget | ✅ Under limit |
| `components/dashboard/AnnualSummaryWidget.tsx` | ~150 | Widget | ✅ Under limit |

### Server Files

| File | LOC | Type | Status |
|------|-----|------|--------|
| `routes/settings.report-widgets.ts` | 190 | Route | ✅ Under limit |
| `modules/settings/settings.routes.ts` | 60 | Route | ✅ Under limit |

### Test Files

| File | LOC | Type | Status |
|------|-----|------|--------|
| `e2e/dashboard.spec.ts` | 95 | E2E Test | ✅ Exists |
| `__tests__/*.test.tsx` | 0 | Unit Tests | ❌ Missing |

---

## Appendix: Raw Review Scores

### Senior Developer Code Review (78/100)

| Criteria | Score | Max |
|----------|-------|-----|
| Architecture & Design | 14 | 15 |
| Type Safety | 10 | 20 |
| Error Handling | 12 | 15 |
| API Standards | 14 | 15 |
| Security | 12 | 15 |
| Code Style | 16 | 20 |
| **Total** | **78** | **100** |

### Fintech Compliance Review (72/100)

| Criteria | Score | Max |
|----------|-------|-----|
| Money Handling | 20 | 20 |
| Audit Trail | 10 | 20 |
| Data Privacy | 15 | 15 |
| Balance Integrity | N/A | N/A |
| Currency Handling | 15 | 15 |
| Financial Calculations | 12 | 15 |
| Regulatory | 0 | 15 |
| **Total** | **72** | **100** |

### Product Manager Functionality Review (85/100)

| Criteria | Score | Max |
|----------|-------|-----|
| Functional Correctness | 27 | 30 |
| Data Integrity | 20 | 20 |
| Security and Isolation | 14 | 15 |
| API Completeness | 15 | 15 |
| Error Handling | 5 | 10 |
| Test Coverage | 4 | 10 |
| **Total** | **85** | **100** |

### QA Engineer Review (58/100)

| Criteria | Score | Max |
|----------|-------|-----|
| Unit Test Coverage | 0 | 25 |
| Integration Tests | 0 | 20 |
| E2E Tests | 15 | 20 |
| Edge Cases Covered | 8 | 15 |
| Input Validation | 15 | 10 |
| Error Paths | 10 | 10 |
| **Total** | **58** | **100** |

### UX Designer Review (75/100)

| Criteria | Score | Max |
|----------|-------|-----|
| Accessibility | 15 | 25 |
| Visual Consistency | 18 | 20 |
| Interaction Design | 17 | 20 |
| Monarch Alignment | 12 | 15 |
| Dark Mode | 6 | 10 |
| Responsiveness | 7 | 10 |
| **Total** | **75** | **100** |

---

*Document generated by Claude Code multi-perspective review system*
*Last updated: 2026-01-21*
