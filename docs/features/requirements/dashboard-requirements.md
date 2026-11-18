# Dashboard Review & Improvement Requirements

## Project Overview

Comprehensive overhaul of the Dashboard page to transform it from a prototype with mock data into a fully functional, production-ready financial dashboard similar to Monarch Money.

---

## Current State Analysis

### Dashboard Architecture
- **File**: `client/src/pages/Dashboard.tsx`
- **Framework**: React with @dnd-kit for drag-and-drop
- **Layout**: 2-column responsive grid with 350px auto-rows
- **Total Widgets**: 14 configurable widgets
- **Widget State**: Stored in React useState (NOT persisted to database)

### Data Hook Notes
- **Compatibility layer**: `AccountsWidget` and `RecentTransactionsWidget` use `@/hooks/use-finance-data` (proxies to API-backed hooks)

### Widget Status Summary

| Widget | File | Current Status | Data Source |
|--------|------|----------------|-------------|
| DashboardBudgetWidget | `DashboardBudgetWidget.tsx` | MOCK DATA | Hardcoded |
| DashboardSpendingWidget | `DashboardSpendingWidget.tsx` | MOCK DATA | Hardcoded |
| CashFlowWidget | `CashFlowWidget.tsx` | WORKING | useReportsCashflow (last 6 months) |
| SpendingWidget | `SpendingWidget.tsx` | MOCK DATA | Hardcoded |
| BudgetStatusWidget | `BudgetStatusWidget.tsx` | MOCK DATA | Hardcoded |
| RecurringExpensesWidget | `RecurringExpensesWidget.tsx` | WORKING | useUpcomingBills(7) |
| NetWorthWidget | `NetWorthWidget.tsx` | PARTIAL | Real current value, fake history |
| AnnualSummaryWidget | `AnnualSummaryWidget.tsx` | MOCK DATA | Hardcoded |
| DashboardTransactionsWidget | `DashboardTransactionsWidget.tsx` | MOCK DATA | Hardcoded fallback |
| TopMerchantsWidget | `TopMerchantsWidget.tsx` | WORKING | useReportsSpendingBreakdown |
| GoalsWidget | `GoalsWidget.tsx` | WORKING | useGoalsSummary |
| InvestmentSummaryWidget | `InvestmentSummaryWidget.tsx` | WORKING | usePortfolioSummary |
| RecentTransactionsWidget | `RecentTransactionsWidget.tsx` | WORKING | useTransactions |
| AccountsWidget | `AccountsWidget.tsx` | WORKING | useAccounts |

---

## Requirements

### REQ-1: Replace Mock Data with Real API Data

#### REQ-1.1: DashboardBudgetWidget
- **Current**: Hardcoded `$9,591` income, `$6,273` expenses, "July 2025"
- **Required**:
  - Fetch real income/expenses using `useReportsCashflow` hook
  - Display current month name dynamically (e.g., "January 2026")
  - Show loading skeleton while data loads
  - Handle empty/error states gracefully
- **API Hook**: `useReportsCashflow({ from, to, aggregation: "monthly" })`
- **Data Fields**: `series[0].income`, `series[0].expenses`

#### REQ-1.2: DashboardSpendingWidget
- **Current**: Hardcoded 9-day spending array
- **Required**:
  - Fetch last 30 days spending trend using `useReportsSpendingTrend`
  - Show daily spending as line/area chart
  - Include comparison to previous period
- **API Hook**: `useReportsSpendingTrend({ from, to, aggregation: "daily", compare: "previous_period" })`

#### REQ-1.3: CashFlowWidget
- **Current**: Real cashflow data via `useReportsCashflow` with `useLastNMonthsRange(6)`
- **Required**:
  - Fetch last 6 months of cashflow data
  - Show income vs expenses bar chart
  - Dynamic month labels
- **API Hook**: `useReportsCashflow({ from, to, aggregation: "monthly" })` with `useLastNMonthsRange(6)`

#### REQ-1.4: SpendingWidget (Category Pie Chart)
- **Current**: Hardcoded categories (Housing $2,400, Food $800, etc.)
- **Required**:
  - Fetch top 5-6 spending categories
  - Pie/donut chart with real percentages
  - Category colors from database or predefined palette
- **API Hook**: `useReportsSpendingBreakdown({ from, to, groupBy: "categoryGroup", limit: 6 })`

#### REQ-1.5: BudgetStatusWidget
- **Current**: Hardcoded `$2,500` budget, `$2,350` spent (94%)
- **Required**:
  - Fetch active budgets for current month
  - Aggregate total budgeted vs total spent
  - Show overall budget utilization percentage
- **API Hook**: `useBudgetProgress(year, month)` from `@/hooks/useBudgets`

#### REQ-1.6: RecurringExpensesWidget
- **Current**: Real upcoming bills via `useUpcomingBills(7)` with loading/empty states and total upcoming
- **Required**:
  - Fetch upcoming recurring transactions for next 7 days
  - Show merchant name, due date, amount
  - Calculate total upcoming bills
- **API Hook**: `useUpcomingBills(7)` from `@/hooks/useRecurring`

#### REQ-1.7: NetWorthWidget
- **Current Issues**:
  1. Generates fake historical data: `currentNetWorth * 0.85, 0.88, 0.86, 0.92, 0.95, 1.0`
  2. Tooltip uses hardcoded `$` symbol instead of `formatCurrency`
- **Required**:
  - Fetch real historical net worth snapshots
  - Use last 6 months of data
  - Fix tooltip to use `formatCurrency`
- **API Hook**: `useReportsNetWorth({ from, to, aggregation: "monthly" })`

#### REQ-1.8: AnnualSummaryWidget
- **Current**: Hardcoded `$1,680,000` income, `$711,000` expenses, `$669,000` savings
- **Required**:
  - Fetch current year annual totals
  - Display Net Savings (income - expenses - debt payments) and Savings Contributions (transfers to savings/investment accounts)
  - If layout allows only one value, default to Net Savings and label it explicitly
  - Show year-over-year comparison if data available
- **API Hook**: `useReportsAnnual({ year: currentYear })`

#### REQ-1.9: DashboardTransactionsWidget
- **Current**: Hardcoded 5 transaction fallback array
- **Required**:
  - Fetch 5 most recent transactions
  - Show merchant/payee, category, amount, date
  - Link to transaction details
- **API Hook**: `useTransactions({ limit: 5 })`

---

### REQ-2: Fix Currency Formatting

#### REQ-2.1: Consistent Currency Display
All monetary values must use the user's currency setting (default: ZMW - Zambian Kwacha).

**Files requiring currency fixes**:

| File | Line(s) | Current | Required |
|------|---------|---------|----------|
| `NetWorthWidget.tsx` | 80-83 | `$${value.toLocaleString()}` | `formatCurrency(value)` |
| `SpendingWidget.tsx` | Tooltip | `$${value}` | `formatCurrency(value)` |
| `DashboardSpendingWidget.tsx` | Tooltip | Hardcoded `$` | `formatCurrency(value)` |

#### REQ-2.2: Currency Symbol Mapping
Use the existing `CURRENCY_SYMBOLS` from `client/src/lib/format.ts`:
- ZMW: "K" (Zambian Kwacha)
- USD: "$"
- ZAR: "R" (South African Rand)
- GBP: "£"
- EUR: "€"
- BWP: "P" (Botswana Pula)

---

### REQ-3: Dashboard Date Range Filter

#### REQ-3.1: Filter UI
- Add a date range selector in the dashboard header
- Position: Below greeting, above widget grid
- Style: Consistent with existing UI (Tailwind + Radix Select)

#### REQ-3.2: Filter Presets
| Preset | Description |
|--------|-------------|
| This Month | Current calendar month (default) |
| Last 30 Days | Rolling 30 days from today |
| Last 90 Days | Rolling 90 days from today |
| Year to Date | January 1 to today |
| Custom | Date picker for custom range |

#### REQ-3.3: Filter Context
- Create `DashboardContext.tsx` for shared filter state
- All widgets read from context
- Filter changes update all widgets simultaneously

#### REQ-3.4: Filter Persistence (Optional)
- Save last selected filter to localStorage or user settings
- Restore on page reload

---

### REQ-4: Widget Preferences Persistence

#### REQ-4.1: Save Widget Configuration
- Widget order (drag-drop position)
- Widget visibility (enabled/disabled)
- Save to `dashboardWidgets` column in `user_display_settings` table

#### REQ-4.2: Load Widget Configuration
- On dashboard load, fetch saved configuration
- Fall back to default configuration if none saved

#### REQ-4.3: Auto-save
- Debounce saves (500ms delay)
- Save on widget reorder
- Save on widget toggle

#### REQ-4.4: Schema
```typescript
interface WidgetConfig {
  id: string;
  label: string;
  enabled: boolean;
  order: number;
}

interface DashboardWidgetsPreference {
  widgets: WidgetConfig[];
  lastUpdated: string;
}
```

---

### REQ-5: Weekly Recap Feature

Based on Monarch Money's Weekly Recap feature.

#### REQ-5.1: WeeklyRecapWidget (Dashboard Card)
- **Position**: First widget in dashboard (or configurable)
- **Display**:
  - Title: "Your Weekly Recap"
  - Subtitle: Date range (e.g., "December 28th - January 3rd")
  - Brief stats: Net worth change, total spending
  - Sparkle icon to indicate AI/insights feature
- **Action**: Click opens WeeklyRecapWizard modal

#### REQ-5.2: WeeklyRecapWizard (Modal)
5-step wizard flow:

**Step 1: Welcome**
- Title: "Weekly Recap"
- Subtitle: "Your weekly financial check-in"
- Description: "See what changed, what's coming, and what to keep an eye on"
- Privacy notice about data usage
- Progress indicator: 5 dots (first filled)
- Button: "Continue"

**Step 2: Net Worth**
- Header: "Net worth | [Date Range]"
- Title: "Net worth [steady/up/down] at [Amount] this week"
- Chart: Line/area chart showing daily net worth for the week
- Commentary: "Your net worth held steady..." or trend explanation
- Progress indicator: 5 dots (second filled)
- Button: "Next up: spending"

**Step 3: Spending**
- Header: "Spending | [Date Range]"
- Title: "No spending data this week" OR "[Amount] spent this week"
- If data: Top categories breakdown
- If no data: "Check back next week for your spending summary"
- Note about data sources
- Thumbs up/down feedback icons
- Progress indicator: 5 dots (third filled)
- Button: "Next up: upcoming transactions"

**Step 4: Recurring Transactions**
- Header: "Recurring | [Date Range]"
- Title: "You have [X] recurring transactions scheduled" OR "No recurring transactions scheduled"
- List upcoming bills/subscriptions
- Tip about setting up recurring transactions
- Thumbs up/down feedback icons
- Progress indicator: 5 dots (fourth filled)
- Button: "Finish reviewing your recap"

**Step 5: Wrap Up**
- Header: "That's a wrap | [Date Range]"
- Title: "Another week reviewed - nice work!"
- Encouragement message about weekly check-ins
- Note about recap data sources
- Thumbs up/down feedback for overall recap
- Progress indicator: 5 dots (all filled)
- Button: "Ask follow up questions" (opens AI assistant)

#### REQ-5.3: Weekly Recap Data Hook
Create `useWeeklyRecapData.ts`:
```typescript
interface WeeklyRecapData {
  weekStart: string;  // ISO date
  weekEnd: string;    // ISO date
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
    previousTotal: number;
    change: number;
    topCategories: Array<{
      name: string;
      amount: number;
      percent: number;
    }>;
    hasData: boolean;
  };
  recurring: {
    upcoming: Array<{
      name: string;
      amount: number;
      dueDate: string;
    }>;
    count: number;
    totalAmount: number;
  };
}
```

#### REQ-5.4: Feedback Persistence
- **Database Table**: `weekly_recap_feedback`
  ```sql
  CREATE TABLE weekly_recap_feedback (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id),
    household_id UUID REFERENCES households(id),
    week_start DATE NOT NULL,
    week_end DATE NOT NULL,
    step VARCHAR(20), -- 'spending', 'recurring', 'overall'
    feedback VARCHAR(10) NOT NULL, -- 'positive' or 'negative'
    created_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(user_id, week_start, step)
  );
  ```
- **API Endpoint**: `POST /api/weekly-recap/feedback`
  ```typescript
  {
    weekStart: string;
    weekEnd: string;
    step: "spending" | "recurring" | "overall";
    feedback: "positive" | "negative";
  }
  ```

#### REQ-5.5: Weekly Recap State Management
Create `WeeklyRecapContext.tsx`:
```typescript
type WeeklyRecapStep = "welcome" | "net-worth" | "spending" | "recurring" | "wrap-up";

interface WeeklyRecapContextType {
  isOpen: boolean;
  currentStep: WeeklyRecapStep;
  data: WeeklyRecapData | null;
  isLoading: boolean;
  feedback: Record<string, "positive" | "negative">;

  openRecap: () => void;
  closeRecap: () => void;
  nextStep: () => void;
  prevStep: () => void;
  goToStep: (step: WeeklyRecapStep) => void;
  setFeedback: (step: string, value: "positive" | "negative") => void;
}
```

---

### REQ-6: Reports/Analytics Alignment (Shared Dependencies)

Dashboard widgets rely on shared reports endpoints. Keep dashboard requirements aligned with reports module behavior.

#### REQ-6.1: Reports API Parity
- Ensure `/api/reports/*` endpoints align with dashboard widgets that consume them.
- Maintain consistent filters for `scope`, `includePending`, and `includeTransfers` (transfers excluded from income/expense by default).
- Support common report parameters: `aggregation`, `timezone`, and `baseCurrency` (defaults align with Annual Dashboard v1.1).
- Ensure spending breakdown supports `groupBy` values required by dashboard and reports.

#### REQ-6.2: Report Export Support
- Dashboard and Reports exports should flow through `/api/reports/export`.
- Persist export metadata to `data_exports` for audit history.
- Support CSV for cashflow, spending breakdown, income, net worth, savings rates (contributions and net), and annual exports.

#### REQ-6.3: Currency + Timezone Consistency
- Use `households.currency`, `accounts.currency`, and `transactions.currency` consistently across dashboard and reports.
- Respect `user_display_settings.timezone` for date ranges and aggregations.
- Default timezone when missing: `Africa/Lusaka`.
- Convert to base currency using daily FX at transaction date (fallback to month-end rate if missing).
- Fiscal year defaults to Jan 1 - Dec 31 unless user settings override.

#### REQ-6.4: Report Export History + Download
- Add `GET /api/reports/exports` to list export history scoped to the current household (legacy null rows remain user-scoped).
- Add `GET /api/reports/exports/:id` to return metadata or download the file (`?download=true`).
- Persist `data_exports.household_id` for correct scoping and future auditing.
- Restrict `/api/reports/export` generation to `member` role or higher.

#### REQ-6.5: Merchant Trend Parity
- Spending trend for the Reports Merchants tab must filter by `merchantId` when selected.
- Extend `reportsSpendingTrendQuerySchema` to accept `merchantId` and forward to `getSpendingTrend`.

#### REQ-6.6: Sankey Transfers Coverage
- Honor `includeTransfers` in Sankey data by showing transfer-in/out as transfer flows (not counted in income/expense KPIs).
- Exclude transfers entirely when `includeTransfers` is false.
- Ensure uncategorized transfers fall into the "Uncategorized" transfer bucket for group/category nodes.

#### REQ-6.7: Reporting Definitions Alignment (Annual Dashboard v1.1)
- Savings Contributions: transfers into savings/investment accounts or transactions tagged as savings/investments.
- Net Savings: income - expenses - debt payments (excludes transfers).
- Credit card payments are debt payments; interest and fees are expenses.
- Transfers between owned accounts are excluded from income/expense totals and cash flow.
- Default scope is `mine`; `household` scope requires owner/admin role.

#### REQ-6.8: Transaction Drill-Down Endpoint
- Provide `/api/reports/transactions` with filters and pagination for drill-down links.
- Use for deep links from dashboard widgets that support transaction details.

#### REQ-6.9: Custom Chart Execution Limits (Shared Reports)
- Enforce row limits (max 5,000 rows) and bucket limits (max 25 groups).
- Time window max: 36 months per custom chart query.
- Enforce allowed metrics and groupings per reports spec.

---

## Task List

### Phase 1: Mock Data Fixes (Priority: HIGH)

| Task ID | Description | File | Status |
|---------|-------------|------|--------|
| T1.1 | Fix DashboardBudgetWidget - use useReportsCashflow | `DashboardBudgetWidget.tsx` | TODO |
| T1.2 | Fix RecurringExpensesWidget - use useUpcomingBills | `RecurringExpensesWidget.tsx` | DONE |
| T1.3 | Fix NetWorthWidget - use useReportsNetWorth + fix currency | `NetWorthWidget.tsx` | TODO |
| T1.4 | Fix CashFlowWidget - use useReportsCashflow | `CashFlowWidget.tsx` | DONE |
| T1.5 | Fix SpendingWidget - use useReportsSpendingBreakdown | `SpendingWidget.tsx` | TODO |
| T1.6 | Fix BudgetStatusWidget - use useBudgetProgress | `BudgetStatusWidget.tsx` | TODO |
| T1.7 | Fix AnnualSummaryWidget - use useReportsAnnual | `AnnualSummaryWidget.tsx` | TODO |
| T1.8 | Fix DashboardSpendingWidget - use useReportsSpendingTrend | `DashboardSpendingWidget.tsx` | TODO |
| T1.9 | Fix DashboardTransactionsWidget - use useTransactions | `DashboardTransactionsWidget.tsx` | TODO |

### Phase 2: Currency Fixes (Priority: HIGH)

| Task ID | Description | File | Status |
|---------|-------------|------|--------|
| T2.1 | Fix NetWorthWidget tooltip formatter | `NetWorthWidget.tsx` | TODO |
| T2.2 | Fix SpendingWidget tooltip formatter | `SpendingWidget.tsx` | TODO |
| T2.3 | Fix DashboardSpendingWidget tooltip formatter | `DashboardSpendingWidget.tsx` | TODO |
| T2.4 | Fix CashFlowWidget tooltip formatter | `CashFlowWidget.tsx` | DONE |

### Phase 3: Dashboard Filters (Priority: MEDIUM)

| Task ID | Description | File | Status |
|---------|-------------|------|--------|
| T3.1 | Create DashboardContext for filter state | `contexts/DashboardContext.tsx` | TODO |
| T3.2 | Add date range filter UI to Dashboard | `pages/Dashboard.tsx` | TODO |
| T3.3 | Update widgets to consume filter context | Multiple files | TODO |
| T3.4 | Add filter persistence to localStorage | `Dashboard.tsx` | TODO |

### Phase 4: Widget Persistence (Priority: MEDIUM)

| Task ID | Description | File | Status |
|---------|-------------|------|--------|
| T4.1 | Load widget config from displaySettings | `Dashboard.tsx` | TODO |
| T4.2 | Save widget config on reorder/toggle | `Dashboard.tsx` | TODO |
| T4.3 | Add debounced auto-save | `Dashboard.tsx` | TODO |

### Phase 5: Weekly Recap (Priority: HIGH)

| Task ID | Description | File | Status |
|---------|-------------|------|--------|
| T5.1 | Create WeeklyRecapContext | `weekly-recap/WeeklyRecapContext.tsx` | TODO |
| T5.2 | Create useWeeklyRecapData hook | `weekly-recap/hooks/useWeeklyRecapData.ts` | TODO |
| T5.3 | Create StepProgress component | `weekly-recap/components/StepProgress.tsx` | TODO |
| T5.4 | Create WeeklyChart component | `weekly-recap/components/WeeklyChart.tsx` | TODO |
| T5.5 | Create WelcomeStep | `weekly-recap/steps/WelcomeStep.tsx` | TODO |
| T5.6 | Create NetWorthStep | `weekly-recap/steps/NetWorthStep.tsx` | TODO |
| T5.7 | Create SpendingStep | `weekly-recap/steps/SpendingStep.tsx` | TODO |
| T5.8 | Create RecurringStep | `weekly-recap/steps/RecurringStep.tsx` | TODO |
| T5.9 | Create WrapUpStep | `weekly-recap/steps/WrapUpStep.tsx` | TODO |
| T5.10 | Create WeeklyRecapWizard modal | `weekly-recap/WeeklyRecapWizard.tsx` | TODO |
| T5.11 | Create WeeklyRecapWidget dashboard card | `weekly-recap/WeeklyRecapWidget.tsx` | TODO |
| T5.12 | Create feedback migration | `migrations/add-weekly-recap-feedback.sql` | TODO |
| T5.13 | Create feedback API endpoint | `server/routes/weekly-recap.ts` | TODO |
| T5.14 | Add WeeklyRecapProvider to App | `App.tsx` | TODO |
| T5.15 | Add Weekly Recap to dashboard widget list | `Dashboard.tsx` | TODO |

### Phase 6: Reports Alignment (Priority: MEDIUM)

| Task ID | Description | File | Status |
|---------|-------------|------|--------|
| T6.1 | Align reports filters and scope RBAC (scope/pending/transfers/aggregation/timezone/baseCurrency) | `server/repositories/ReportRepository.ts` | TODO |
| T6.2 | Expand report export support + persist metadata | `server/routes/reports.ts` | TODO |
| T6.3 | Add multi-currency + timezone handling for reports/dashboard | `server/repositories/ReportRepository.ts` | TODO |
| T6.4 | Add report export history + download endpoints | `server/routes/reports.ts` | TODO |
| T6.5 | Merchant-specific trend filtering in Reports Merchants tab | `client/src/pages/Reports.tsx` | TODO |
| T6.6 | Honor includeTransfers in Sankey flows (transfer-type, non-KPI) | `server/repositories/ReportRepository.ts` | TODO |
| T6.7 | Add reports transactions drill-down endpoint + pagination | `server/routes/reports.ts` | TODO |
| T6.8 | Align savings definitions (net vs contributions) + debt payment handling | `server/repositories/ReportRepository.ts` | TODO |
| T6.9 | Enforce custom chart limits and validation | `server/repositories/ReportRepository.ts` | TODO |

---

## File Structure

### Existing Files to Modify
```
client/src/
├── pages/
│   └── Dashboard.tsx                    # Add filters, widget persistence, recap integration
├── components/dashboard/
│   ├── DashboardBudgetWidget.tsx        # T1.1
│   ├── DashboardSpendingWidget.tsx      # T1.8, T2.3
│   ├── DashboardTransactionsWidget.tsx  # T1.9
│   ├── CashFlowWidget.tsx               # T1.4, T2.4
│   ├── SpendingWidget.tsx               # T1.5, T2.2
│   ├── BudgetStatusWidget.tsx           # T1.6
│   ├── RecurringExpensesWidget.tsx      # T1.2
│   ├── NetWorthWidget.tsx               # T1.3, T2.1
│   └── AnnualSummaryWidget.tsx          # T1.7
├── contexts/
│   └── (new) DashboardContext.tsx       # T3.1
└── App.tsx                              # T5.14
```

### New Files to Create
```
client/src/components/weekly-recap/
├── WeeklyRecapContext.tsx               # T5.1
├── WeeklyRecapWizard.tsx                # T5.10
├── WeeklyRecapWidget.tsx                # T5.11
├── components/
│   ├── StepProgress.tsx                 # T5.3
│   └── WeeklyChart.tsx                  # T5.4
├── steps/
│   ├── WelcomeStep.tsx                  # T5.5
│   ├── NetWorthStep.tsx                 # T5.6
│   ├── SpendingStep.tsx                 # T5.7
│   ├── RecurringStep.tsx                # T5.8
│   └── WrapUpStep.tsx                   # T5.9
└── hooks/
    └── useWeeklyRecapData.ts            # T5.2

server/routes/
└── weekly-recap.ts                      # T5.13

migrations/
└── add-weekly-recap-feedback.sql        # T5.12
```

---

## API Hooks Reference

### Available Hooks (from `client/src/hooks/use-reports.ts`)

| Hook | Parameters | Returns | Use Case |
|------|------------|---------|----------|
| `useReportsCashflow` | `{ from, to, aggregation }` | `{ series, totals }` | Income/expenses over time |
| `useReportsSpendingBreakdown` | `{ from, to, groupBy, limit }` | `{ items, total }` | Category/merchant breakdown |
| `useReportsSpendingTrend` | `{ from, to, aggregation, compare }` | `{ series, comparison }` | Spending trend with comparison |
| `useReportsNetWorth` | `{ from, to, aggregation }` | `{ series, current }` | Net worth history |
| `useReportsAnnual` | `{ year }` | `{ totals, monthly }` | Annual summary |
| `useReportsTransactions` | `{ from, to, filters, page, pageSize }` | `{ items, paging }` | Drill-down transaction list |
| `useCurrentMonthRange` | none | `{ from, to }` | Current month dates |
| `useLastNMonthsRange` | `months: number` | `{ from, to }` | Last N months dates |

### Other Hooks

| Hook | Source | Use Case |
|------|--------|----------|
| `useBudgetProgress` | `@/hooks/useBudgets` | Budget vs actual |
| `useUpcomingBills` | `@/hooks/useRecurring` | Upcoming recurring transactions |
| `useTransactions` | `@/hooks/useTransactions` | Transaction list |
| `useFormatters` | `@/contexts/SettingsContext` | Currency/date formatting |

---

## UI Components Reference

### Available Components (from `client/src/components/ui/`)

| Component | Usage |
|-----------|-------|
| `Dialog`, `DialogContent`, `DialogHeader` | Modal wrapper |
| `Card`, `CardHeader`, `CardContent` | Widget containers |
| `Select`, `SelectTrigger`, `SelectContent`, `SelectItem` | Dropdown filters |
| `Button` | Actions |
| `Progress` | Progress bars |
| `Tabs`, `TabsList`, `TabsTrigger`, `TabsContent` | Tab navigation |
| `Skeleton` | Loading states |

### Chart Components (Recharts)

| Component | Usage |
|-----------|-------|
| `AreaChart`, `Area` | Net worth trend |
| `BarChart`, `Bar` | Cash flow comparison |
| `PieChart`, `Pie`, `Cell` | Spending breakdown |
| `LineChart`, `Line` | Spending trend |
| `ResponsiveContainer` | Chart wrapper |
| `XAxis`, `YAxis`, `Tooltip` | Chart accessories |

---

## Testing Requirements

### Unit Tests
- [ ] Test each widget with mocked API responses
- [ ] Test currency formatting with different currencies
- [ ] Test date range calculations
- [ ] Test Weekly Recap step navigation

### Integration Tests
- [ ] Test widget data loading and display
- [ ] Test filter application across widgets
- [ ] Test widget preference save/load
- [ ] Test Weekly Recap flow end-to-end

### Manual Testing Checklist
- [ ] Verify all widgets show real data
- [ ] Verify currency displays correctly (ZMW default)
- [ ] Verify date filter updates all widgets
- [ ] Verify widget reorder persists on refresh
- [ ] Verify Weekly Recap wizard navigation
- [ ] Verify feedback submission works
- [ ] Test on mobile viewport
- [ ] Test with empty data states

---

## References

### Monarch Money Features
- [AI Features Help](https://help.monarch.com/hc/en-us/articles/16116906962452-About-Monarch-s-AI-Features)
- [Using Reports](https://help.monarch.com/hc/en-us/articles/21846787088916-Using-Reports)
- [Winter Release Blog](https://www.monarch.com/blog/winter-release)

### Codebase Patterns
- **Working Widget Example**: `client/src/components/dashboard/TopMerchantsWidget.tsx`
- **Wizard Context Pattern**: `client/src/components/import/ImportWizardContext.tsx`
- **Multi-step Wizard UI**: `client/src/components/goals/GoalCreationWizard.tsx`
- **Currency Formatting**: `client/src/lib/format.ts`

---

## Acceptance Criteria

1. **All 9 mock widgets display real data** from API hooks
2. **All currency values use `formatCurrency`** with user's currency setting
3. **Dashboard date filter** updates all applicable widgets
4. **Widget preferences persist** across page refreshes
5. **Weekly Recap widget** displays on dashboard with current week summary
6. **Weekly Recap wizard** navigates through all 5 steps smoothly
7. **Feedback is saved** to database when user provides thumbs up/down
8. **No console errors** or TypeScript warnings
9. **Loading states** shown while data fetches
10. **Empty states** handled gracefully for all widgets
