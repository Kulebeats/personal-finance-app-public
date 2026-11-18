# Cash Flow Implementation Plan

Based on thorough review of [../reviews/cashflow-review.md](../reviews/cashflow-review.md) and codebase exploration.

---

## Executive Summary

The Cash Flow feature has **11 identified issues** across 3 severity levels. This plan organizes fixes into **4 phases** with clear dependencies, acceptance criteria, and specific file changes.

**Estimated Scope:** ~15 files modified, ~800-1200 lines changed

---

## Phase 1: Foundation Fixes (No Dependencies)

These issues can be addressed independently and should be completed first.

### 1.1 Gate Sankey Query Behind View Selection
**Severity:** High | **Files:** 1 | **Complexity:** Low

**Problem:** Sankey data fetched on every page load even when user stays on Trends view ([CashFlow.tsx:33](../../client/src/pages/CashFlow.tsx#L33))

**Solution:**
```typescript
// client/src/pages/CashFlow.tsx - Line 33
const { data: sankeyData, isLoading: sankeyLoading } = useReportsSankey(
  { from, to, mode: "income_to_expense_groups", includeSavingsNode: true },
  { enabled: view === "sankey" }  // Add this option
);
```

**Files to Modify:**
- [client/src/pages/CashFlow.tsx](../../client/src/pages/CashFlow.tsx) - Add `enabled` option to useReportsSankey call

**Acceptance Criteria:**
- [ ] Network tab shows no `/api/reports/sankey` request when page loads on Trends view
- [ ] Sankey data fetches when user switches to Sankey view
- [ ] No console errors or blank state when switching views
- [ ] Optional: Prefetch on hover over Sankey tab button

---

### 1.2 Fix User Formatting Preferences
**Severity:** Low | **Files:** 1 | **Complexity:** Low

**Problem:** Hard-coded `Intl.NumberFormat("en-US")` ignores user locale settings ([CashFlow.tsx:70](../../client/src/pages/CashFlow.tsx#L70))

**Solution:**
```typescript
// Replace hard-coded formatter
const formatter = new Intl.NumberFormat("en-US", {...});

// With settings-aware hook (pattern from CashFlowWidget.tsx)
import { useFormatters } from "@/contexts/SettingsContext";
const { formatCurrency } = useFormatters();
```

**Files to Modify:**
- [client/src/pages/CashFlow.tsx](../../client/src/pages/CashFlow.tsx) - Replace formatter with `useFormatters()` hook

**Acceptance Criteria:**
- [ ] Currency displays according to user's locale settings
- [ ] Matches formatting in other report pages
- [ ] Summary cards, chart tooltips, and table all use consistent formatting

---

### 1.3 Fix Table Row Keys and Add Empty/Error States
**Severity:** Low | **Files:** 1 | **Complexity:** Low

**Problem:** Array index keys ([CashFlow.tsx:305](../../client/src/pages/CashFlow.tsx#L305)) and no empty/error states

**Solution:**
```typescript
// Replace: key={i}
// With: key={row.periodStart}

// Add states:
{isLoading && <TableLoadingSkeleton rows={6} />}
{error && <ErrorState message="Failed to load cash flow data" onRetry={refetch} />}
{!isLoading && !error && chartData.length === 0 && (
  <EmptyState
    icon={TrendingUp}
    title="No cash flow data"
    description="No transactions found for the selected period"
  />
)}
```

**Files to Modify:**
- [client/src/pages/CashFlow.tsx](../../client/src/pages/CashFlow.tsx) - Fix keys, add loading/error/empty states

**Acceptance Criteria:**
- [ ] Table rows use `periodStart` as React key
- [ ] Loading skeleton shown while data fetches
- [ ] Error state with retry button shown on API failure
- [ ] Empty state shown when no data exists for selected range

---

### 1.4 Fix Month Labels for Multi-Year Ranges
**Severity:** Low | **Files:** 1 | **Complexity:** Low

**Problem:** Month labels can collide for multi-year ranges ([CashFlow.tsx:44](../../client/src/pages/CashFlow.tsx#L44))

**Solution:**
```typescript
// Current: Only short month name
const month = new Date(item.periodStart).toLocaleDateString("en-US", { month: "short" });

// Fixed: Include year when range spans multiple years
const chartData = cashflowData.series.map((item) => {
  const date = new Date(item.periodStart);
  const rangeYears = new Date(to).getFullYear() - new Date(from).getFullYear();
  const label = rangeYears > 0
    ? date.toLocaleDateString("en-US", { month: "short", year: "2-digit" })
    : date.toLocaleDateString("en-US", { month: "short" });
  return { month: label, ...item };
});
```

**Files to Modify:**
- [client/src/pages/CashFlow.tsx](../../client/src/pages/CashFlow.tsx) - Update label generation logic

**Acceptance Criteria:**
- [ ] Single-year range shows "Jan", "Feb", etc.
- [ ] Multi-year range shows "Jan '24", "Feb '25", etc.
- [ ] No duplicate x-axis labels in any scenario

---

### 1.5 Fix Date Parsing Timezone Issue
**Severity:** Medium | **Files:** 1 | **Complexity:** Low

**Problem:** `new Date(item.periodStart)` can shift month labels for users behind UTC ([CashFlow.tsx:46](../../client/src/pages/CashFlow.tsx#L46))

**Solution:**
```typescript
// Create helper function to parse ISO date as local
function parseLocalDate(isoDate: string): Date {
  const [year, month, day] = isoDate.split("-").map(Number);
  return new Date(year, month - 1, day);
}

// Use throughout component
const date = parseLocalDate(item.periodStart);
```

**Files to Modify:**
- [client/src/pages/CashFlow.tsx](../../client/src/pages/CashFlow.tsx) - Add helper and update all date parsing
- Consider: [client/src/lib/dateUtils.ts](../../client/src/lib) - Add shared utility if not exists

**Acceptance Criteria:**
- [ ] Users in UTC-12 see correct month labels
- [ ] Users in UTC+14 see correct month labels
- [ ] Table rows show correct dates regardless of timezone

---

### 1.6 Fix Net Savings Legend Mismatch
**Severity:** Medium | **Files:** 1 | **Complexity:** Low

**Problem:** Legend shows Net Savings but no series rendered ([CashFlow.tsx:183](../../client/src/pages/CashFlow.tsx#L183) vs [CashFlow.tsx:199](../../client/src/pages/CashFlow.tsx#L199))

**Solution Options:**
1. **Remove legend entry** (simpler) - Remove Net Savings from legend if not displaying series
2. **Add savings series** (better UX) - Add third bar or line showing net savings

Recommended: Option 2 - Add savings as a line overlay on the bar chart

```typescript
// Add savings to chartData
const chartData = cashflowData.series.map((item) => ({
  month: label,
  income: item.income,
  expenses: Math.abs(item.expenses),
  savings: item.income + item.expenses, // expenses are negative
}));

// Use CompositeChart with Line for savings
```

**Files to Modify:**
- [client/src/pages/CashFlow.tsx](../../client/src/pages/CashFlow.tsx) - Add savings series or remove legend entry

**Acceptance Criteria:**
- [ ] Legend entries match visible chart elements
- [ ] If savings line added: Shows net savings per month
- [ ] Tooltip shows all visible series values

---

### 1.7 Fix Average Monthly Savings Calculation
**Severity:** Medium | **Files:** 1 | **Complexity:** Low

**Problem:** Divides by 12 regardless of actual date range ([CashFlow.tsx:160](../../client/src/pages/CashFlow.tsx#L160))

**Solution:**
```typescript
// Current (incorrect):
const avgSavings = totals.savings / 12;

// Fixed: Divide by actual months in data
const actualMonths = cashflowData?.series?.length || 1;
const avgSavings = totals.savings / actualMonths;
```

**Files to Modify:**
- [client/src/pages/CashFlow.tsx](../../client/src/pages/CashFlow.tsx) - Update calculation

**Acceptance Criteria:**
- [ ] In January, "Avg Monthly" shows total savings (1 month)
- [ ] In June, divides by 6 months (not 12)
- [ ] For custom 3-month range, divides by 3

---

## Phase 2: Backend Enhancements (Parallel Work)

These can be worked on in parallel with Phase 1.

### 2.1 Implement Sankey Query Parameters
**Severity:** Medium | **Files:** 2 | **Complexity:** Medium

**Problem:** `scope`, `includePending`, `includeTransfers`, `includeSavingsNode` defined but ignored ([server/modules/reports/reports.validation.ts](../../server/modules/reports/reports.validation.ts#L83) vs [server/repositories/reports/CompositeReportRepository.ts](../../server/repositories/reports/CompositeReportRepository.ts))

**Solution:**
Update `getSankey` method to apply all filters:

```typescript
// server/repositories/ReportRepository.ts - getSankey method

async getSankey(params: {
  householdId: number;
  userId: number;
  from: string;
  to: string;
  mode: string;
  maxNodes?: number;
  scope?: "household" | "mine";
  includePending?: boolean;
  includeTransfers?: boolean;
  includeSavingsNode?: boolean;
}): Promise<SankeyResponse> {

  // Apply scope filter (existing pattern from getCashflow)
  const scopeFilter = params.scope === "mine"
    ? eq(transactions.userId, params.userId)
    : undefined;

  // Apply pending filter
  const pendingFilter = params.includePending
    ? undefined
    : eq(transactions.isPending, false);

  // Apply transfers filter
  const transfersFilter = params.includeTransfers
    ? undefined
    : eq(transactions.isTransfer, false);

  // Conditionally include savings node
  if (params.includeSavingsNode !== false) {
    // Add savings node logic
  }

  // ... rest of implementation
}
```

**Files to Modify:**
- [server/repositories/reports/CompositeReportRepository.ts](../../server/repositories/reports/CompositeReportRepository.ts) - Update `getSankey`
- [server/services/AnalyticsService.ts](../../server/services/AnalyticsService.ts) - Pass params through (lines 175-190)

**Acceptance Criteria:**
- [ ] `scope=mine` filters to current user's transactions only
- [ ] `includePending=false` excludes pending transactions
- [ ] `includeTransfers=false` excludes transfer transactions
- [ ] `includeSavingsNode=false` hides savings node from diagram
- [ ] All filters work in combination

---

### 2.2 Enforce Account Hide Transactions Flag
**Severity:** High | **Files:** 2 | **Complexity:** Medium

**Problem:** Account-level "Hide from cash flow" not enforced in analytics ([EditAccountModal.tsx](../../client/src/features/accounts/components/EditAccountModal.tsx#L226) vs [CompositeReportRepository](../../server/repositories/reports/CompositeReportRepository.ts))

**Current State:**
- UI promises: "Hide from cash flow and budget calculations"
- Backend only checks `t.is_excluded_from_reports` on transactions
- Never checks `accounts.hide_transactions` flag

**Solution:**
Add account-level filter to analytics queries:

```typescript
// server/repositories/ReportRepository.ts - Add to base filter conditions

// In getCashflow, getSankey, getSpendingBreakdown, etc.
const accountFilter = notExists(
  db.select()
    .from(accounts)
    .where(
      and(
        eq(accounts.id, transactions.accountId),
        eq(accounts.hideTransactions, true)
      )
    )
);

// OR use JOIN pattern (more efficient):
.leftJoin(accounts, eq(transactions.accountId, accounts.id))
.where(
  and(
    // ... existing filters
    or(
      isNull(accounts.hideTransactions),
      eq(accounts.hideTransactions, false)
    )
  )
)
```

**Files to Modify:**
- [server/repositories/reports/CompositeReportRepository.ts](../../server/repositories/reports/CompositeReportRepository.ts) - Add filter to:
  - `getCashflow` (line ~228)
  - `getSankey` (line ~738)
  - `getSpendingBreakdown` (line ~102)
  - Other analytics methods
- [shared/schema.ts](../../shared/schema.ts) - Verify `hideTransactions` field exists on accounts table

**Acceptance Criteria:**
- [ ] Transactions from hidden accounts don't appear in Cash Flow totals
- [ ] Sankey diagram excludes hidden account transactions
- [ ] Spending breakdown excludes hidden account transactions
- [ ] Budget calculations exclude hidden account transactions
- [ ] Dashboard widgets reflect accurate totals

---

## Phase 3: Filter Modal & Export (Depends on Phase 2)

### 3.1 Create Cash Flow Filter Modal
**Severity:** High | **Files:** 3-4 | **Complexity:** High

**Problem:** Filter button renders but has no handler ([CashFlow.tsx:116](../../client/src/pages/CashFlow.tsx#L116))

**Solution:**
Create a new filter modal following the pattern from [FiltersModal.tsx](../../client/src/components/transactions/FiltersModal.tsx)

**New File Structure:**
```
client/src/components/cashflow/
├── CashFlowFiltersModal.tsx     # Main modal component
├── CashFlowFiltersContext.tsx   # Filter state management (optional)
└── index.ts                     # Exports
```

**Filter Options:**
1. **Date Range** - Start date, End date, Quick presets (YTD, Last 12 months, Custom)
2. **Interval** - Day, Week, Month
3. **Scope** - Household (all members), Mine only
4. **Include Pending** - Toggle
5. **Include Transfers** - Toggle

**Implementation Pattern:**
```typescript
// CashFlowFiltersModal.tsx
interface CashFlowFilters {
  from: string;
  to: string;
  interval: "day" | "week" | "month";
  scope: "household" | "mine";
  includePending: boolean;
  includeTransfers: boolean;
}

// Use Dialog from Radix UI (existing pattern)
// Three-panel layout from FiltersModal.tsx
// Draft/Apply pattern for changes
```

**Files to Create:**
- `client/src/components/cashflow/CashFlowFiltersModal.tsx` - New modal component

**Files to Modify:**
- [client/src/pages/CashFlow.tsx](../../client/src/pages/CashFlow.tsx) - Import and wire modal
- [client/src/hooks/use-reports.ts](../../client/src/hooks/use-reports.ts) - Ensure hook accepts all filter params

**Acceptance Criteria:**
- [ ] Filter button opens modal
- [ ] Modal displays all filter options
- [ ] Changes apply only on "Apply" button click
- [ ] Clear button resets to defaults
- [ ] Applied filters update URL query params (for shareability)
- [ ] Filter badge shows count of non-default filters
- [ ] Both chart and table respect applied filters

---

### 3.2 Wire Export Functionality
**Severity:** High | **Files:** 1-2 | **Complexity:** Medium

**Problem:** Export button renders but has no handler ([CashFlow.tsx:119](../../client/src/pages/CashFlow.tsx#L119))

**Existing Export Endpoint:**
- `GET /api/reports/export?type=cashflow&format=csv&from=...&to=...`
- Already implemented at [server/modules/reports/reports.routes.ts](../../server/modules/reports/reports.routes.ts)

**Solution:**
```typescript
// client/src/pages/CashFlow.tsx

const handleExport = async () => {
  const params = new URLSearchParams({
    type: "cashflow",
    format: "csv",
    from,
    to,
    // Include current filter values
    ...(scope !== "household" && { scope }),
    ...(includePending && { includePending: "true" }),
    ...(includeTransfers && { includeTransfers: "true" }),
  });

  // Trigger download
  window.location.href = `/api/reports/export?${params.toString()}`;

  // Or use fetch for better UX:
  const response = await fetch(`/api/reports/export?${params}`);
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `cashflow-${from}-to-${to}.csv`;
  a.click();
};
```

**Files to Modify:**
- [client/src/pages/CashFlow.tsx](../../client/src/pages/CashFlow.tsx) - Add export handler
- [server/modules/reports/reports.routes.ts](../../server/modules/reports/reports.routes.ts) - Ensure export respects all filter params (may need updates)

**Acceptance Criteria:**
- [ ] Export button triggers CSV download
- [ ] Exported data matches currently filtered view
- [ ] Filename includes date range
- [ ] Loading state shown during export
- [ ] Error toast on export failure

---

## Phase 4: Dashboard Widget (Depends on Phase 2.2)

### 4.1 Replace Dashboard Widget Static Data
**Severity:** High | **Files:** 1 | **Complexity:** Medium

**Problem:** Widget uses hard-coded data ([CashFlowWidget.tsx:5](../../client/src/components/dashboard/CashFlowWidget.tsx#L5) and [line 31](../../client/src/components/dashboard/CashFlowWidget.tsx#L31))

**Solution:**
```typescript
// client/src/components/dashboard/CashFlowWidget.tsx

import { useReportsCashflow } from "@/hooks/use-reports";
import { useLastNMonthsRange } from "@/hooks/use-reports";

export function CashFlowWidget() {
  const { from, to } = useLastNMonthsRange(6); // Last 6 months
  const { data, isLoading, error } = useReportsCashflow({
    from,
    to,
    interval: "month"
  });

  const chartData = data?.series.map((item) => ({
    name: new Date(item.periodStart).toLocaleDateString("en-US", { month: "short" }),
    income: item.income,
    expenses: Math.abs(item.expenses),
  })) ?? [];

  const totals = data?.totals ?? { income: 0, expenses: 0, savings: 0 };

  if (isLoading) return <CashFlowWidgetSkeleton />;
  if (error) return <WidgetError onRetry={refetch} />;

  return (
    // ... existing JSX with real data
  );
}
```

**Files to Modify:**
- [client/src/components/dashboard/CashFlowWidget.tsx](../../client/src/components/dashboard/CashFlowWidget.tsx) - Replace static data

**Acceptance Criteria:**
- [ ] Widget shows real transaction data
- [ ] Default range is last 6 months (configurable)
- [ ] Loading skeleton while fetching
- [ ] Error state with retry
- [ ] Empty state when no data
- [ ] Totals match Cash Flow page for same date range

---

## Testing Plan

### Unit Tests

| Test File | Coverage |
|-----------|----------|
| `CashFlow.test.tsx` | Chart transforms, summary calculations, empty/error states |
| `CashFlowFiltersModal.test.tsx` | Filter selection, apply/clear, URL sync |
| `CashFlowWidget.test.tsx` | Data loading, rendering, error handling |
| `ReportRepository.test.ts` | Sankey filters, account hide flag, scope filtering |

### Integration Tests

| Scenario | Steps |
|----------|-------|
| Filter persistence | Apply filters → Navigate away → Return → Filters restored |
| Export with filters | Apply filters → Export → Verify CSV matches filtered data |
| Cross-widget consistency | Dashboard widget totals match Cash Flow page for same range |
| Account hiding | Hide account → Verify excluded from all analytics |

### E2E Tests

| Flow | Validation |
|------|------------|
| Full cash flow workflow | Load page → Apply filters → Switch views → Export |
| Dashboard drill-down | Click widget → Navigate to Cash Flow with matching range |

---

## Task Checklist

### Phase 1: Foundation (Can Start Immediately) ✅ COMPLETE
- [x] 1.1 Gate Sankey query behind view selection
- [x] 1.2 Fix user formatting preferences
- [x] 1.3 Fix table row keys and add empty/error states
- [x] 1.4 Fix month labels for multi-year ranges
- [x] 1.5 Fix date parsing timezone issue
- [x] 1.6 Fix net savings legend mismatch
- [x] 1.7 Fix average monthly savings calculation

### Phase 2: Backend (Can Start Immediately, Parallel with Phase 1) ✅ COMPLETE
- [x] 2.1 Implement Sankey query parameters (scope, pending, transfers, savings node)
- [x] 2.2 Enforce account hide transactions flag in all analytics queries

### Phase 3: Filter Modal & Export (After Phase 2) ✅ COMPLETE
- [x] 3.1 Create Cash Flow filter modal component
- [x] 3.2 Wire export functionality to existing endpoint

### Phase 4: Dashboard Widget (After Phase 2.2) ✅ COMPLETE
- [x] 4.1 Replace dashboard widget static data with live queries

### Testing ⏳ PARTIALLY COMPLETE
- [x] Add unit tests for CashFlow.tsx transformations (in `client/src/features/cashflow/__tests__/`)
- [x] Add unit tests for CashFlowFiltersModal
- [ ] Add integration tests for filter → export flow
- [ ] Add tests for account hide flag enforcement

**Completion Notes (2026-01-29):**
✅ ALL COMPLETE - CashFlow feature fully implemented. CashFlow.tsx reduced to 239 LOC. Feature module exists at `client/src/features/cashflow/` with components, hooks, and tests. Backend repositories include CashflowReportRepository, CashflowForecastRepository, and CashflowBudgetComparisonRepository. All phases complete.

---

## Open Questions (Require Decision)

1. **Filter Modal vs Sheet?**
   - Option A: Full modal (like FiltersModal.tsx pattern)
   - Option B: Side sheet (like mobile-first design)
   - **Recommendation:** Modal for desktop, sheet for mobile

2. **Default Date Range?**
   - Option A: YTD (current year)
   - Option B: Rolling 12 months
   - Option C: Last 6 months
   - **Recommendation:** YTD with easy preset buttons

3. **Savings in Sankey?**
   - Option A: Always show when positive
   - Option B: Only show when `includeSavingsNode=true`
   - Option C: Show with toggle, default on
   - **Recommendation:** Show by default, allow hiding via filter

4. **URL State Persistence?**
   - Should filters be stored in URL query params for shareability?
   - **Recommendation:** Yes, use `useSearchParams` pattern

---

## Dependency Graph

```
Phase 1 (Independent)     Phase 2 (Independent)
├── 1.1 Gate Sankey       ├── 2.1 Sankey Params
├── 1.2 Formatting        └── 2.2 Account Hide ────┐
├── 1.3 Table Keys                                 │
├── 1.4 Month Labels            ┌──────────────────┘
├── 1.5 Timezone                │
├── 1.6 Legend Mismatch         ▼
└── 1.7 Avg Calculation   Phase 3 (Depends on 2.1, 2.2)
                          ├── 3.1 Filter Modal
                          └── 3.2 Export
                                │
                                ▼
                          Phase 4 (Depends on 2.2)
                          └── 4.1 Dashboard Widget
```

---

## Notes

- All backend changes should maintain backwards compatibility
- Consider feature flag for gradual rollout of filter modal
- Export should work even if filter modal not yet implemented (use default values)
- Dashboard widget can use simpler subset of filters (just date range)
