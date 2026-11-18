# Reports Module - Complete Requirements Specification

## Document Information

| Field | Value |
|-------|-------|
| Version | 2.0 |
| Created | 2026-01-07 |
| Last Updated | 2026-01-07 |
| Status | Ready for Implementation |
| Location | Reports Page (Annual Dashboard, Cash Flow, Spending, Merchants, Income, Net Worth, Savings) |

---

## 1. Executive Summary

This document defines the complete requirements for the Reports module in the personal finance application. The module covers the Annual Dashboard and the core report tabs (Cash Flow, Spending, Merchants, Income, Net Worth, Savings), delivering consistent, interactive insights aligned with industry best practices and Zambian user needs.

### 1.1 Key Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Expense Classification | Auto-detect from transaction patterns | Uses statistical analysis (stddev) to classify fixed vs variable |
| Implementation Scope | Full implementation | All features in single phase |
| Reporting Scope | Reports module (Annual Dashboard + Cash Flow + Spending + Merchants + Income + Net Worth + Savings) | Single source of truth for all report tabs |
| Debt Tracking | Use existing account-based approach | Leverage credit/loan account types already in schema |
| Savings Definition | Track Savings Contributions and Net Savings | Avoids ambiguity across reports and widgets |
| Transfers Handling | Transfers are excluded from income/expense KPIs by default | Prevents double counting across reports |
| Dashboard Location | Enhance existing Reports page tab | Consistent with current UI architecture |

### 1.2 Reports Tabs Overview

| Tab | Primary Purpose | Key Views | Core Endpoints |
|-----|-----------------|-----------|----------------|
| Annual Dashboard | Consolidated annual KPIs and widgets | KPI cards, goal progress, trends, category breakdowns, custom charts | `/api/reports/annual`, `/api/reports/financial-ratios`, `/api/reports/debt`, `/api/reports/net-worth/changes`, `/api/reports/expenses/classification`, `/api/reports/goals/progress`, `/api/reports/forecast`, `/api/reports/custom`, `/api/reports/transactions` |
| Cash Flow | Inflow/outflow analysis with flow visualization | Income vs expenses series, Sankey flow, monthly breakdown | `/api/reports/cashflow`, `/api/reports/sankey` |
| Spending | Category and trend analysis | Breakdown donut/treemap, trend line with comparison | `/api/reports/spending/breakdown`, `/api/reports/spending/trend` |
| Merchants | Merchant spending insights | Top merchants table, top 10 chart, merchant trend | `/api/reports/spending/breakdown` (groupBy=merchant), `/api/reports/spending/trend` (merchantId) |
| Income | Income tracking and sources | Income series, income by category/source | `/api/reports/income`, `/api/reports/cashflow` |
| Net Worth | Net worth trend and changes | Net worth line, assets vs liabilities, change deltas | `/api/reports/net-worth`, `/api/reports/net-worth/changes` |
| Savings | Savings rates and composition | Savings rate trend, net savings trend, contributions breakdown | `/api/reports/savings-rate`, `/api/reports/cashflow`, `/api/reports/financial-ratios` |

---

## 2. Module Scope & Objectives

### 2.1 Primary Objectives

1. **Comprehensive Reports Suite** - Provide annual dashboard and core report tabs covering all critical personal finance KPIs for Zambian users
2. **Modern Visualization Standards** - Follow best practices using bar charts for comparisons, line charts for trends, scatter plots for correlations
3. **Customizable Dashboard** - Allow users to toggle widgets, switch chart types, and create custom charts
4. **Interactive Features** - Enable drill-down from aggregates to transaction lists, YoY comparisons, and forecasting
5. **Scalable Implementation** - Fit existing React + Express + PostgreSQL architecture with Drizzle ORM
6. **Cross-Tab Consistency** - Standardize filters, definitions, and drill-down behaviors across Reports tabs

### 2.2 Success Metrics

| Metric | Target |
|--------|--------|
| Page Load Time | < 3 seconds |
| API Response Time | < 500ms per endpoint |
| Widget Render Time | < 200ms |
| Test Coverage | > 80% |
| User Preference Persistence | 100% reliable |

---

### 2.3 Data Volume & Performance Assumptions

- Typical household: <= 50,000 transactions per year
- Max custom chart result set: 5,000 rows returned (hard cap)
- Max group-by buckets: 25 categories/merchants per chart
- API timeout budget: 2 seconds per report query (server-side)
- Client pagination default: 50 items per page, max 200

### 2.4 Resolved Open Questions (v1.1 Decisions)

- Savings metrics: track both Savings Contributions (category/account-based) and Net Savings (income - expenses - debt payments).
- Transfers and credit-card payments: treat transfers between owned accounts as non-income/expense; credit-card payments are debt payments, while interest and fees remain expenses.
- Multi-currency and timezone: v1 reports are rendered in the user's base currency with conversion from transaction currency (daily FX at transaction date, fallback to month-end rate if missing); default timezone is Africa/Lusaka and fiscal year is Jan 1 to Dec 31.
- Household access: default scope is mine; household scope requires owner/admin role. Widget and custom chart preferences are per-user in v1 (no cross-user sharing).

### 2.5 Report Tabs Coverage (Non-Annual)

#### 2.5.1 Cash Flow
- Purpose: show inflows, outflows, and net savings trends with optional flow visualization.
- Core Views: income vs expenses series, net savings line, Sankey flow, monthly breakdown table.
- Filters: date range, aggregation, scope, includePending, includeTransfers.
- Endpoints: `/api/reports/cashflow`, `/api/reports/sankey`.

#### 2.5.2 Spending
- Purpose: show how spending is distributed and how it trends over time.
- Core Views: category/group breakdown, top categories, trend line with comparison.
- Filters: date range, groupBy, limit, scope, includePending, includeTransfers (default false).
- Endpoints: `/api/reports/spending/breakdown`, `/api/reports/spending/trend`.

#### 2.5.3 Merchants
- Purpose: show merchant-level spending insights for the Reports tab.
- Core Views: top merchants table, top 10 chart, merchant trend line.
- Filters: date range, merchant category, min/max amount, sort, scope.
- Endpoints: `/api/reports/spending/breakdown` (groupBy=merchant), `/api/reports/spending/trend` (merchantId).
- Interactions: click merchant row to drill down to transactions.

#### 2.5.4 Income
- Purpose: track income levels and sources over time.
- Core Views: income series, income by category/source, income vs expenses comparison.
- Filters: date range, aggregation, scope.
- Endpoints: `/api/reports/income`, `/api/reports/cashflow`.

#### 2.5.5 Net Worth
- Purpose: track net worth trend and changes over time.
- Core Views: net worth line, assets vs liabilities breakdown, period deltas.
- Filters: date range, aggregation, scope.
- Endpoints: `/api/reports/net-worth`, `/api/reports/net-worth/changes`.

#### 2.5.6 Savings
- Purpose: track savings rates and composition.
- Core Views: savings rate trend, net savings trend, contributions breakdown.
- Filters: date range, aggregation, scope.
- Endpoints: `/api/reports/savings-rate`, `/api/reports/cashflow`, `/api/reports/financial-ratios`.

---

## 3. Annual Dashboard Tab - Metrics & KPIs

This section defines Annual Dashboard-specific metrics and widgets. Non-annual tab requirements are summarized in section 2.5 and detailed in the API specifications.

### 3.1 Summary Metrics

| Metric | Description | Formula |
|--------|-------------|---------|
| Total Income | Sum of all income transactions in the year | `SUM(t.amount) WHERE type='income'` |
| Total Expenses | Sum of all expense transactions | `SUM(t.amount) WHERE type='expense'` |
| Total Savings Contributions | Sum of transfers to savings/investment accounts or transactions tagged as savings/investments | Category/account-based |
| Net Savings | Income minus expenses and debt payments (excludes transfers) | `Total Income - Total Expenses - Total Debt Paid` |
| Total Debt Paid | Sum of debt-repayment transactions | Payments to credit/loan accounts |
| Current Net Worth | Total assets minus liabilities at year-end | `SUM(assets) - SUM(liabilities)` |
| Average Monthly Income | Annual income divided by months in range | `Total Income / months_in_range` |
| Average Monthly Expenses | Annual expenses divided by months in range | `Total Expenses / months_in_range` |
| Average Net Worth Change | Average net worth change per month | Monthly delta average |

### 3.2 Financial Ratios (KPIs)

| KPI | Description | Calculation | Healthy Range |
|-----|-------------|-------------|---------------|
| Savings Rate | Percentage of income allocated to savings/investments | `(Total Savings Contributions / Total Income) * 100%` | > 20% |
| Net Savings Rate | Percentage of income remaining after expenses and debt | `(Net Savings / Total Income) * 100%` | Positive |
| Debt-to-Income (DTI) | Debt burden relative to income | `Total debt payments / Total income` | < 36% |
| Monthly Cash Flow | Net amount after expenses and debt payments (excludes transfers) | `Monthly income - Monthly expenses - Debt payments` | Positive |
| Net Worth Growth Rate | Percentage change in net worth | `(NW_current - NW_prev) / NW_prev * 100%` | Positive |
| Emergency Fund Coverage | Months of expenses covered by liquid savings | `Emergency fund balance / Monthly essential expenses` | > 6 months |
| Liquidity Ratio | Ability to cover short-term obligations | `Liquid assets / Short-term liabilities` | > 1.0 |
| Personal Burn Rate | Months before depleting cash | `Liquid savings / Monthly deficit` | > 6 months |

---

### 3.3 Transaction Classification Rules

- Transfers: movements between owned accounts are not counted as income or expense.
- Savings Contributions: transfers into savings/investment accounts or transactions tagged as savings/investments.
- Debt Payments: payments to liability accounts (credit/loan/mortgage) are tracked as debt payments, not expenses.
- Credit-Card Treatment: credit-card payments are debt payments; interest and fees are recorded as expenses.
- Cash Flow Exclusions: internal transfers never affect income/expense totals or cash flow metrics.

---

## 4. Annual Dashboard Widget Specifications

### 4.1 Widget Categories

#### CORE WIDGETS (Always Visible - Cannot Disable)

| Widget | Description |
|--------|-------------|
| Summary Cards Row | 5-column cards: Income, Expenses, Savings, Debts, Net Worth |
| Goal Progress Row | Progress bars for Income, Savings, Debt Payoff goals + Assets vs Liabilities |
| Fixed vs Variable | Horizontal stacked bar showing expense classification |

#### OPTIONAL WIDGETS (User Can Toggle On/Off)

| Widget Group | Count | Description |
|--------------|-------|-------------|
| Monthly Charts | 5 | Income, Expenses, Savings, Debt, Net Worth per month |
| Comparison Trends | 5 | Income vs Expenses (monthly/quarterly), Income vs Savings Contributions, DTI, Net Worth Trend |
| Cumulative Charts | 5 | Cumulative Income, Expenses, Savings, Debt, Net Worth |
| Category Progress | 4 | Income, Expenses, Savings, Debt by category with targets |
| Category Donuts | 5 | Income, Expenses, Savings vs Investments, Loans vs Credit, Assets breakdown |
| Subcategory Progress | 4 | Income, Expenses, Savings, Debt by subcategory |
| Subcategory Donuts | 4 | Breakdown donuts for each type |
| KPI Cards | 1 | DTI, Emergency Fund, Liquidity, Burn Rate gauges |
| Forecast | 1 | Projections with confidence intervals |
| Custom Charts | 0-10 | User-created charts |

---

### 4.2 Detailed Widget Specifications

#### 4.2.1 Summary Cards Row

**File:** `client/src/components/reports/AnnualSummaryCards.tsx`

| Card | Primary Value | Secondary Value | Color |
|------|---------------|-----------------|-------|
| INCOME | Total Income Earned this Year | Average Monthly Income | Green (#10b981) |
| EXPENSES | Total Spend this Year | Average Monthly Expenses | Red (#f43f5e) |
| SAVINGS/INVESTMENTS | Total Savings Contributions | Avg Monthly Savings Contributions | Blue (#3b82f6) |
| DEBTS | Total Debt Paid this Year | Average Monthly Debt Payments | Orange (#f97316) |
| NETWORTH | Current Net Worth | Avg Net Worth Change | Purple (#8b5cf6) |

**Layout:** 5-column responsive grid, equal width

---

#### 4.2.2 Goal Progress Widgets

**Files:**
- `IncomeGoalProgressWidget.tsx`
- `SavingsGoalProgressWidget.tsx`
- `DebtPayoffGoalProgressWidget.tsx`
- `AssetsVsLiabilitiesWidget.tsx`

**Display Elements:**
- Progress bar with dual colors (AMOUNT EARNED = filled, AMOUNT LEFT = empty)
- Percentage complete label
- Target amount
- Current amount

**Progress Bar Styling:**
```
┌────────────────────────────────────────┐
│ INCOME GOAL              PROGRESS      │
│ ████████████████░░░░░░░░░░░  84.7%    │
│ AMOUNT EARNED  │  AMOUNT LEFT          │
│ ZMW 677,800    │  ZMW 122,200          │
└────────────────────────────────────────┘
```

---

#### 4.2.3 Fixed vs Variable Expenses Widget

**File:** `client/src/components/reports/FixedVsVariableWidget.tsx`

**Auto-Classification Logic:**
```sql
-- Classification Algorithm
WITH category_stats AS (
  SELECT category_id,
    AVG(amount) as avg_amount,
    STDDEV(amount) as stddev_amount,
    COUNT(*) as txn_count,
    COUNT(DISTINCT DATE_TRUNC('month', date)) as months_active
  FROM transactions
  WHERE type = 'expense' AND date >= :from AND date <= :to
  GROUP BY category_id
)
SELECT category_id,
  CASE
    -- Fixed: Consistent amount (stddev < 5%) and appears in 3+ months
    WHEN stddev_amount / NULLIF(avg_amount, 0) < 0.05
         AND months_active >= 3 THEN 'fixed'
    -- Variable: Appears in 2+ months but varying amounts
    WHEN months_active >= 2 THEN 'variable'
    -- Discretionary: Irregular/one-time
    ELSE 'discretionary'
  END as classification
FROM category_stats
```

**Visual:**
```
FIXED Vs. VARIABLE EXPENSES
┌─────────────────────────────────────────┐
│ ██████████████████████│░░░░░░░░░░░░░░░░│
│       54.25%          │    45.75%       │
│       FIXED           │    VARIABLE     │
└─────────────────────────────────────────┘
```

---

#### 4.2.4 Monthly Charts Row

**Files:**
- `IncomePerMonthWidget.tsx`
- `ExpensesPerMonthWidget.tsx`
- `SavingsPerMonthWidget.tsx`
- `DebtPaymentPerMonthWidget.tsx`
- `NetWorthChangePerMonthWidget.tsx`

**Chart Type:** Bar chart with average line overlay

**Features:**
- X-axis: JAN, FEB, MAR, APR, MAY, JUN, JUL, AUG, SEP, OCT, NOV, DEC
- Y-axis: Amount in user's currency
- Bar: Monthly value
- Line: Running average
- Tooltips: Exact values on hover
- Savings series uses Savings Contributions by default (Net Savings available via custom charts).

**Color Coding:**
| Widget | Bar Color | Average Line |
|--------|-----------|--------------|
| Income | Green | Dark Green |
| Expenses | Red | Dark Red |
| Savings | Blue | Dark Blue |
| Debt Payment | Orange | Dark Orange |
| Net Worth Change | Purple (positive) / Red (negative) | Gray |

---

#### 4.2.5 Comparison Trend Charts

**Files:**
- `IncomeVsExpensesMonthlyWidget.tsx` - Line chart
- `IncomeVsExpensesQuarterlyWidget.tsx` - Grouped bar chart (Q1-Q4)
- `IncomeVsSavedInvestedWidget.tsx` - Line chart
- `DebtToIncomeComparisonWidget.tsx` - Line chart
- `NetWorthTrendWidget.tsx` - Multi-line (Actual, Liabilities, Assets)

**Note:** "Saved/Invested" uses Savings Contributions (category/account-based).

**Income vs Expenses Monthly:**
```
INCOME Vs. EXPENSES    MONTHLY TREND
          ▲ INCOME  ▲ EXPENSES
800,000 │    *
        │   / \
600,000 │  /   \    *
        │ /     \  / \
400,000 │*       \/   \    *
        │              \  / \
200,000 │               \/   \
        │                     \___*
      0 └─────────────────────────────→
         JAN FEB MAR APR MAY JUN ... DEC
```

**Income vs Expenses Quarterly:**
```
INCOME Vs. EXPENSES    QUARTERLY TREND
1,000,000 │
          │ ██
  750,000 │ ██ ░░
          │ ██ ░░     ██
  500,000 │ ██ ░░     ██ ░░     ██
          │ ██ ░░     ██ ░░     ██ ░░     ██
  250,000 │ ██ ░░     ██ ░░     ██ ░░     ██ ░░
          │ ██ ░░     ██ ░░     ██ ░░     ██ ░░
        0 └───────────────────────────────────→
              Q1         Q2         Q3         Q4
           ██ INCOME  ░░ EXPENSES
```

---

#### 4.2.6 Cumulative Charts Row

**Files:**
- `CumulativeIncomeWidget.tsx`
- `CumulativeExpensesWidget.tsx`
- `CumulativeSavingsWidget.tsx`
- `CumulativeDebtPayoffWidget.tsx`
- `NetWorthTrendLineWidget.tsx`

**Chart Type:** Horizontal bar chart showing running totals

**Layout:**
```
CUMMULATIVE INCOME
JAN │████████████████                          33,110
FEB │████████████████████████████████         156,405
MAR │████████████████████████████████████     203,767
APR │██████████████████████████████████████   324,567
MAY │████████████████████████████████████████ 694,101
...
DEC │████████████████████████████████████████ 1,830,668
    └─────────────────────────────────────────────────→
     0     500,000   1,000,000  1,500,000   2,000,000
```

---

#### 4.2.7 Category Progress Widgets

**Files:**
- `IncomeByCategoryProgressWidget.tsx`
- `ExpensesByCategoryWidget.tsx`
- `SavingsByCategoryProgressWidget.tsx`
- `DebtPayoffByCategoryWidget.tsx`

**Display:** Horizontal stacked bars showing AMOUNT EARNED vs AMOUNT LEFT per category

**Example - Income Progress by Category:**
```
INCOME  PROGRESS    BY CATEGORY
        AMOUNT EARNED █  AMOUNT LEFT ░

MAIN INCOME    │████████████████████████████████│░░░░░░│
               │       663,971                  │   0   │

SIDE INCOME    │████████████████████████████████████████│
               │           1,081,545                    │
               └────────────────────────────────────────→
                0      200,000   400,000   600,000  800,000
```

---

#### 4.2.8 Category Breakdown Donuts

**Files:**
- `IncomeBreakdownDonutWidget.tsx`
- `ExpensesBreakdownDonutWidget.tsx`
- `SavingsVsInvestmentsDonutWidget.tsx`
- `LoansVsCreditCardsDonutWidget.tsx`
- `AssetsByCategoryDonutWidget.tsx`

**Features:**
- Donut/pie chart with percentage labels
- Legend with category names and colors
- Click segment to drill-down to transactions
- Center text: Total amount

**Example - Income Breakdown:**
```
    INCOME BREAKDOWN BY CATEGORY
         ● MAIN INCOME  ● SIDE INCOME

              ╭─────────╮
           ╭──│  38.0%  │──╮
          │   │ SIDE    │   │
         │    ╰─────────╯    │
         │                   │
        │    ╭─────────╮      │
        │ ╭──│  62.0%  │──╮   │
         │   │  MAIN   │   │ │
          │  ╰─────────╯  │ │
           ╰──────────────╯
```

---

#### 4.2.9 Subcategory Progress Widgets

**Files:**
- `IncomeSubcategoryProgressWidget.tsx`
- `ExpensesSubcategoryBreakdownWidget.tsx` (with category dropdown selector)
- `SavingsSubcategoryProgressWidget.tsx`
- `DebtSubcategoryProgressWidget.tsx`

**Expense Widget Special Feature:** Dropdown selector to filter by expense category

```
┌────────────────────────────────────────────────────┐
│ SELECT EXPENSE CATEGORY ➡  [▼ SUPPORT          ]  │
├────────────────────────────────────────────────────┤
│ EXPENSES BREAKDOWN   BY SUBCATEGORY               │
│                                                    │
│ MUM SUPPORT     │████████████████        │ 56,040  │
│ MOSES SUPPORT   │███████                 │ 12,700  │
│ FAMILY SUPPORT  │██████████████          │ 37,901  │
│ FRIEND SUPPORT  │██████████████████████████154,434 │
│ CONTRIBUTIONS   │████                    │ 10,700  │
│ HELPER SUPPORT  │██                      │  3,055  │
│ WIFEY SUPPORT   │████████████████████    │ 57,382  │
│ THE KIDS        │██████████████          │ 45,650  │
└────────────────────────────────────────────────────┘
```

---

#### 4.2.10 Subcategory Breakdown Donuts

**Files:**
- `IncomeSubcategoryDonutWidget.tsx`
- `ExpensesSubcategoryDonutWidget.tsx`
- `SavingsSubcategoryDonutWidget.tsx`
- `DebtSubcategoryDonutWidget.tsx`

**Features:**
- Multi-segment donut charts
- Percentage labels per segment
- Color-coded by subcategory
- Tooltips with exact amounts

---

#### 4.2.11 KPI Cards Widget

**File:** `client/src/components/reports/KPICardsWidget.tsx`

**Display:** Gauge visualizations with color-coded thresholds

| KPI | Display | Good (Green) | Warning (Yellow) | Bad (Red) |
|-----|---------|--------------|------------------|-----------|
| DTI Ratio | Percentage gauge | < 20% | 20-36% | > 36% |
| Emergency Fund | Months display | > 6 mo | 3-6 mo | < 3 mo |
| Liquidity Ratio | Ratio value | > 2.0 | 1.0-2.0 | < 1.0 |
| Burn Rate | Months display | > 12 mo | 6-12 mo | < 6 mo |
| Savings Rate (Contributions) | Percentage gauge | > 20% | 10-20% | < 10% |

---

#### 4.2.12 Forecast Widget

**File:** `client/src/components/reports/ForecastWidget.tsx`

**Features:**
- Line chart with historical data + projected values
- Confidence interval shaded region (95% CI, default)
- Confidence level default: 0.95 (API override supported)
- Metric selector dropdown (Net Worth, Net Savings, Savings Contributions, Expenses, Income)
- Projection period: 1-12 months ahead

**Forecast Algorithm:** Simple linear regression
```typescript
function calculateLinearForecast(
  historicalData: { date: string; value: number }[],
  projectionMonths: number,
  confidenceLevel: number = 0.95
): {
  projections: { period: string; projected: number; min: number; max: number }[];
  trend: 'increasing' | 'decreasing' | 'stable';
  slope: number;
  r2: number;  // R-squared value for fit quality
}
```

---

## 5. Annual Dashboard Chart Type Switching

### 5.1 Available Chart Types

| Type | Icon | Best For | @nivo Component |
|------|------|----------|-----------------|
| Bar (Vertical) | 📊 | Comparing categories, monthly values | ResponsiveBar |
| Column (Horizontal) | 📉 | Ranked lists, cumulative totals | ResponsiveBar (horizontal) |
| Line | 📈 | Trends over time | ResponsiveLine |
| Area | 🏔️ | Cumulative trends, stacked values | ResponsiveLine (area fill) |
| Pie/Donut | 🥧 | Proportions, breakdowns | ResponsivePie |
| Combo (Bar + Line) | 📊📈 | Value + average overlay | Custom composite |
| Stacked Bar | 📊 | Part-to-whole comparisons | ResponsiveBar (stacked) |
| Treemap | 🟩 | Hierarchical proportions | ResponsiveTreeMap |

### 5.2 Widget → Supported Chart Types Matrix

| Widget Group | Bar | Line | Area | Pie | Combo | Stacked | Treemap |
|--------------|-----|------|------|-----|-------|---------|---------|
| Monthly Charts | ✅ | ✅ | ✅ | ❌ | ✅ | ❌ | ❌ |
| Comparison Trends | ✅ | ✅ | ✅ | ❌ | ✅ | ❌ | ❌ |
| Cumulative Charts | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| Category Progress | ✅ | ❌ | ❌ | ❌ | ❌ | ✅ | ❌ |
| Category Donuts | ✅ | ❌ | ❌ | ✅ | ❌ | ❌ | ✅ |
| Subcategory Progress | ✅ | ❌ | ❌ | ❌ | ❌ | ✅ | ❌ |
| Subcategory Donuts | ✅ | ❌ | ❌ | ✅ | ❌ | ❌ | ✅ |

### 5.3 Chart Type Switcher Component

**File:** `client/src/components/reports/ChartTypeSwitcher.tsx`

**Props:**
```typescript
interface ChartTypeSwitcherProps {
  widgetId: string;
  availableTypes: ChartType[];
  currentType: ChartType;
  onTypeChange: (type: ChartType) => void;
  size?: 'sm' | 'md';
}

type ChartType = 'bar' | 'line' | 'area' | 'pie' | 'donut' | 'combo' | 'stacked' | 'treemap';
```

**UI:** Small icon buttons in widget header
```
┌─────────────────────────────────────────────┐
│ INCOME PER MONTH           [📊][📈][🏔️][📊📈] │
│ ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓│
└─────────────────────────────────────────────┘
```

---

## 6. Annual Dashboard Time Period Aggregation Filter

### 6.1 Available Periods

| Period | Aggregation | Data Points | Use Case |
|--------|-------------|-------------|----------|
| Monthly | Per calendar month | 12 (Jan-Dec) | Default view, detailed analysis |
| Quarterly | Q1, Q2, Q3, Q4 | 4 | Executive summary |
| Bi-Annually | H1 (Jan-Jun), H2 (Jul-Dec) | 2 | Semi-annual review |
| Annually | Full year total | 1 | Year-over-year comparison |
| Weekly | Per ISO week | 52 | Detailed tracking |
| Custom | User-defined date range | Variable | Ad-hoc analysis |

**Note:** Daily aggregation is supported for non-annual tabs (Cash Flow, Spending, Income, Savings) but is not exposed in the Annual Dashboard filter UI.

### 6.2 Filter UI

**Location:** Top of Annual Dashboard, next to Year selector

**Component:** `client/src/components/reports/AggregationFilter.tsx`

```
┌──────────────────────────────────────────────────────────┐
│ Annual Dashboard 2025  │▼ Monthly    │  [⚙️ Customize]   │
│                        ├─────────────┤                   │
│                        │ ○ Monthly   │                   │
│                        │ ○ Quarterly │                   │
│                        │ ○ Bi-Annual │                   │
│                        │ ○ Annually  │                   │
│                        │ ○ Weekly    │                   │
│                        │ ○ Custom... │                   │
│                        └─────────────┘                   │
└──────────────────────────────────────────────────────────┘
```

### 6.3 Backend Support

Add `aggregation` parameter to all report endpoints:

```typescript
// Query parameter
aggregation?: 'daily' | 'monthly' | 'quarterly' | 'biannual' | 'annual' | 'weekly'

// SQL aggregation
const periodSql = {
  daily: "DATE_TRUNC('day', date)",
  monthly: "DATE_TRUNC('month', date)",
  quarterly: "DATE_TRUNC('quarter', date)",
  biannual: "CASE WHEN EXTRACT(MONTH FROM date) <= 6 THEN 'H1' ELSE 'H2' END",
  annual: "DATE_TRUNC('year', date)",
  weekly: "DATE_TRUNC('week', date)"
};
```

---

### 6.4 Timezone and Fiscal Year

- Default timezone: Africa/Lusaka (user can override via settings in future).
- Fiscal year: calendar year (Jan 1 to Dec 31).
- Aggregation boundaries respect the selected timezone for all date truncation.
- Weekly aggregation uses ISO weeks in the selected timezone.

---

## 7. Annual Dashboard Custom Chart Builder

### 7.1 Overview

Allow users to create personalized charts by selecting metrics, groupings, and visualization types.

**Constraints:**
- Maximum 10 custom charts per user
- Stored in `userDisplaySettings.customCharts` (JSONB)
- Can edit/delete existing custom charts

### 7.2 Custom Chart Configuration

```typescript
interface CustomChartConfig {
  id: string;                          // UUID
  name: string;                        // User-defined name (max 50 chars)
  chartType: ChartType;                // bar, line, pie, etc.
  primaryMetric: MetricType;           // income, expenses, net savings, savings contributions, etc.
  secondaryMetric?: MetricType;        // Optional for combo charts
  groupBy?: GroupByType;               // category, merchant, account, tag
  filterBy?: FilterConfig;             // Optional filters
  aggregation: AggregationType;        // monthly, quarterly, etc.
  colorScheme: string;                 // Theme colors
  showAverage: boolean;                // Show average line
  showComparison: boolean;             // Show YoY comparison
  enabled: boolean;                    // Show on dashboard
  order: number;                       // Display order
  createdAt: string;                   // ISO timestamp
  updatedAt: string;                   // ISO timestamp
}
```

### 7.3 Available Metrics

| Metric | ID | Description | Compatible Charts |
|--------|-----|-------------|-------------------|
| Income | `income` | Total income | All |
| Expenses | `expenses` | Total expenses | All |
| Net Savings | `netSavings` | Income - Expenses - Debt Payments (excludes transfers) | All |
| Savings Contributions | `savingsContributions` | Transfers into savings/investment accounts | All |
| Savings Rate | `savingsRate` | Savings Contributions / Income % | Line, Bar, Area |
| Net Savings Rate | `netSavingsRate` | Net Savings / Income % | Line, Bar, Area |
| Debt | `debt` | Debt payments | All |
| Net Worth | `netWorth` | Assets - Liabilities | Line, Bar, Area |
| Net Worth Change | `netWorthChange` | Monthly delta | Bar, Line |
| DTI Ratio | `dti` | Debt-to-Income ratio | Line, Bar |
| Category Spend | `categorySpend` | Spending by category | Pie, Bar, Treemap |
| Merchant Spend | `merchantSpend` | Spending by merchant | Pie, Bar, Treemap |

### 7.4 Available Group By Options

| Group By | ID | Description |
|----------|-----|-------------|
| None | `none` | Aggregate total (single value per period) |
| Category | `category` | Group by transaction category |
| Category Group | `categoryGroup` | Group by category parent group |
| Merchant | `merchant` | Group by merchant |
| Account | `account` | Group by account |
| Tag | `tag` | Group by transaction tag |

### 7.5 Validation & Limits

- Name length: 1-50 chars, unique per user.
- Filters: max 5 filters per chart.
- Buckets: max 25 group-by buckets in a single chart.
- Rows: max 5,000 rows returned per query.
- Scope: honors `mine` vs `household` access rules (no cross-household data).

### 7.6 Custom Chart Builder Modal

**File:** `client/src/components/reports/CustomChartBuilder.tsx`

```
┌─────────────────────────────────────────────────────────┐
│  Create Custom Chart                                [X] │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  Chart Name:                                            │
│  ┌─────────────────────────────────────────────────┐   │
│  │ Monthly Savings by Account                      │   │
│  └─────────────────────────────────────────────────┘   │
│                                                         │
│  Primary Metric:        Secondary Metric (optional):    │
│  ┌──────────────────┐   ┌──────────────────┐           │
│  │ ▼ Savings        │   │ ▼ None           │           │
│  └──────────────────┘   └──────────────────┘           │
│                                                         │
│  Group By:              Chart Type:                     │
│  ┌──────────────────┐   ┌──────────────────┐           │
│  │ ▼ Account        │   │ ▼ Stacked Bar    │           │
│  └──────────────────┘   └──────────────────┘           │
│                                                         │
│  Time Aggregation:                                      │
│  ┌──────────────────┐                                  │
│  │ ▼ Monthly        │                                  │
│  └──────────────────┘                                  │
│                                                         │
│  Options:                                               │
│  ☑ Show average line                                   │
│  ☐ Show YoY comparison                                 │
│  ☑ Include in dashboard                                │
│                                                         │
│  Preview:                                               │
│  ┌─────────────────────────────────────────────────┐   │
│  │                                                 │   │
│  │          [Live Chart Preview]                   │   │
│  │                                                 │   │
│  └─────────────────────────────────────────────────┘   │
│                                                         │
├─────────────────────────────────────────────────────────┤
│  [Cancel]                                    [Create]   │
└─────────────────────────────────────────────────────────┘
```

---

## 8. Annual Dashboard Widget Customization

### 8.1 Customize Modal

**File:** `client/src/components/reports/CustomizeAnnualDashboard.tsx`

```
┌─────────────────────────────────────────────────────────┐
│  Customize Annual Dashboard                         [X] │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  CORE WIDGETS (Always On)                               │
│  ┌─────────────────────────────────────────────────┐   │
│  │ ☑ Summary Cards                        (locked) │   │
│  │ ☑ Goal Progress                        (locked) │   │
│  │ ☑ Fixed vs Variable                    (locked) │   │
│  └─────────────────────────────────────────────────┘   │
│                                                         │
│  OPTIONAL WIDGETS                                       │
│  ┌─────────────────────────────────────────────────┐   │
│  │ ☑ Monthly Charts (5)                    ≡ drag  │   │
│  │ ☑ Comparison Trends (5)                 ≡ drag  │   │
│  │ ☑ Cumulative Charts (5)                 ≡ drag  │   │
│  │ ☑ Category Progress (4)                 ≡ drag  │   │
│  │ ☑ Category Donuts (5)                   ≡ drag  │   │
│  │ ☐ Subcategory Progress (4)              ≡ drag  │   │
│  │ ☐ Subcategory Donuts (4)                ≡ drag  │   │
│  │ ☑ KPI Cards                             ≡ drag  │   │
│  │ ☐ Forecast                              ≡ drag  │   │
│  └─────────────────────────────────────────────────┘   │
│                                                         │
│  CUSTOM CHARTS                                          │
│  ┌─────────────────────────────────────────────────┐   │
│  │ ☑ Monthly Savings by Account      [✏️] [🗑️]    │   │
│  │ ☐ DTI Trend                       [✏️] [🗑️]    │   │
│  │                                                 │   │
│  │ [+ Add Custom Chart]                            │   │
│  └─────────────────────────────────────────────────┘   │
│                                                         │
├─────────────────────────────────────────────────────────┤
│  [Reset to Default]                          [Save]     │
└─────────────────────────────────────────────────────────┘
```

### 8.2 Widget Preference Schema

```typescript
interface WidgetPreferences {
  version: number;                     // Schema version for migrations
  lastUpdated: string;                 // ISO timestamp
  aggregation: AggregationType;        // Global aggregation setting

  widgets: {
    id: string;                        // Widget identifier
    enabled: boolean;                  // Visible on dashboard
    order: number;                     // Display order
    chartType?: ChartType;             // Selected chart type (if applicable)
    expanded?: boolean;                // Expanded/collapsed state
  }[];

  customCharts: CustomChartConfig[];   // User-created charts
}
```

### 8.3 Persistence

**Storage Location:** `userDisplaySettings.reportWidgetPreferences` (JSONB)

**Auto-save:** Debounced 500ms after any change

**API Endpoints:**
- `GET /api/settings/report-widgets` - Fetch preferences
- `PATCH /api/settings/report-widgets` - Save preferences

---

### 8.4 Access Control & Sharing

- Preferences are stored per user by default (no cross-user sharing in v1).
- Household admins/owners can view household-scope dashboards but do not overwrite other users' widget/custom chart settings.
- Future enhancement: optional "household template" that admins can publish for new members.

---

## 9. Backend API Specifications (Reports Module)

### 9.0 Global API Conventions

**Common Query Params (all report endpoints):**
```typescript
{
  from: string;            // YYYY-MM-DD
  to: string;              // YYYY-MM-DD
  aggregation?: AggregationType;   // Non-annual tabs support daily/weekly/monthly
  timezone?: string;       // IANA, default: Africa/Lusaka
  scope?: 'household' | 'mine';
  baseCurrency?: string;   // ISO 4217, default: user base currency
}
```

**Common Response Range:**
```typescript
range: {
  from: string;
  to: string;
  aggregation: AggregationType;
  timezone: string;
  baseCurrency: string;
}
```

**Authorization Rules:**
- `mine` is always allowed for the authenticated user.
- `household` requires owner/admin role for the household.

**Currency Rules:**
- All report responses return values in the resolved base currency.
- Conversion uses daily FX rate at transaction date, with month-end fallback when missing.

### 9.1 Reports Endpoints Summary

| Endpoint | Method | Description | Cache TTL |
|----------|--------|-------------|-----------|
| `/api/reports/annual` | GET | Annual dashboard composite report | 10 min |
| `/api/reports/cashflow` | GET | Cash flow series (income/expense/net savings) | 5 min |
| `/api/reports/sankey` | GET | Cash flow Sankey | 5 min |
| `/api/reports/spending/breakdown` | GET | Spending breakdown by category/merchant/tag | 10 min |
| `/api/reports/spending/trend` | GET | Spending trend with comparison | 5 min |
| `/api/reports/income` | GET | Income series | 10 min |
| `/api/reports/net-worth` | GET | Net worth series + latest snapshot | 10 min |
| `/api/reports/savings-rate` | GET | Savings rate trend | 10 min |
| `/api/reports/financial-ratios` | GET | DTI, liquidity, burn rate, savings rates | 10 min |
| `/api/reports/debt` | GET | Debt analysis, payment trends | 10 min |
| `/api/reports/net-worth/changes` | GET | Net worth deltas | 10 min |
| `/api/reports/expenses/classification` | GET | Fixed vs variable breakdown | 5 min |
| `/api/reports/goals/progress` | GET | Goal tracking with projections | 5 min |
| `/api/reports/spending/subcategory` | GET | Subcategory drill-down | 5 min |
| `/api/reports/forecast` | GET | Linear projections | 15 min |
| `/api/reports/transactions` | GET | Drill-down to transaction list | No cache |
| `/api/reports/custom` | POST | Execute custom chart query | 5 min |

### 9.2 Financial Ratios Endpoint

**Route:** `GET /api/reports/financial-ratios`

**Query Parameters:**
```typescript
{
  from: string;        // YYYY-MM-DD
  to: string;          // YYYY-MM-DD
  aggregation?: AggregationType;
  timezone?: string;   // IANA
  scope?: 'household' | 'mine';
  baseCurrency?: string;   // ISO 4217
}
```

**Response:**
```typescript
interface ReportsFinancialRatiosResponse {
  range: { from: string; to: string; aggregation: AggregationType; timezone: string; baseCurrency: string };
  ratios: {
    debtToIncome: number | null;           // DTI = debt payments / income
    emergencyFundCoverage: number | null;  // months of expenses covered
    liquidityRatio: number | null;         // liquid assets / short-term liabilities
    personalBurnRate: number | null;       // months of runway
    savingsRate: number | null;            // savings contributions / income %
    netSavingsRate: number | null;         // net savings / income %
  };
  breakdown: {
    totalDebtPayments: number;
    totalIncome: number;
    savingsContributions: number;
    netSavings: number;
    liquidSavings: number;
    monthlyEssentialExpenses: number;
    liquidAssets: number;
    shortTermLiabilities: number;
    monthlyDeficit: number;
  };
  thresholds: {
    dti: { good: number; warning: number };     // 0.20, 0.36
    emergency: { good: number; warning: number }; // 6, 3
    liquidity: { good: number; warning: number }; // 2.0, 1.0
    burnRate: { good: number; warning: number }; // 12, 6
    savings: { good: number; warning: number };  // 0.20, 0.10 (Savings Contributions Rate)
  };
}
```

### 9.3 Debt Analysis Endpoint

**Route:** `GET /api/reports/debt`

**Query Parameters:**
```typescript
{
  from: string;
  to: string;
  aggregation?: AggregationType;
  timezone?: string;   // IANA
  scope?: 'household' | 'mine';
  baseCurrency?: string;   // ISO 4217
}
```

**Response:**
```typescript
interface ReportsDebtResponse {
  range: { from: string; to: string; aggregation: AggregationType; timezone: string; baseCurrency: string };
  summary: {
    totalDebt: number;              // Outstanding balance
    totalDebtPayments: number;      // Payments made in period
    monthlyPayment: number;         // Average monthly payment
    avgInterestRate: number;        // Weighted average (if tracked)
  };
  debtByType: Array<{
    type: 'credit' | 'loan' | 'mortgage' | 'other';
    balance: number;
    monthlyPayment: number;
    accountCount: number;
  }>;
  paymentTrend: Array<{
    period: string;                 // Period label per aggregation
    periodStart: string;
    periodEnd: string;
    payments: number;
    cumulativePayments: number;
  }>;
}
```

### 9.4 Net Worth Changes Endpoint

**Route:** `GET /api/reports/net-worth/changes`

**Query Parameters:**
```typescript
{
  from: string;
  to: string;
  aggregation?: AggregationType;
  timezone?: string;   // IANA
  scope?: 'household' | 'mine';
  baseCurrency?: string;   // ISO 4217
}
```

**Response:**
```typescript
interface ReportsNetWorthChangesResponse {
  range: { from: string; to: string; aggregation: AggregationType; timezone: string; baseCurrency: string };
  series: Array<{
    period: string;                 // Period label per aggregation
    periodStart: string;
    periodEnd: string;
    netWorthStart: number;
    netWorthEnd: number;
    change: number;                 // Absolute change
    changePercent: number;          // Percentage change
  }>;
  totals: {
    totalChange: number;
    totalChangePercent: number;
    avgMonthlyChange: number;
  };
}
```

### 9.5 Expense Classification Endpoint

**Route:** `GET /api/reports/expenses/classification`

**Query Parameters:**
```typescript
{
  from: string;
  to: string;
  aggregation?: AggregationType;
  timezone?: string;   // IANA
  scope?: 'household' | 'mine';
  baseCurrency?: string;   // ISO 4217
}
```

**Response:**
```typescript
interface ReportsExpenseClassificationResponse {
  range: { from: string; to: string; aggregation: AggregationType; timezone: string; baseCurrency: string };
  classification: {
    fixed: {
      total: number;
      percent: number;
      items: Array<{
        categoryId: string;
        categoryName: string;
        amount: number;
        avgMonthly: number;
        consistency: number;        // 0-1 (stddev-based)
      }>;
    };
    variable: {
      total: number;
      percent: number;
      items: Array<{
        categoryId: string;
        categoryName: string;
        amount: number;
        avgMonthly: number;
        variance: number;
      }>;
    };
    discretionary: {
      total: number;
      percent: number;
      items: Array<{
        categoryId: string;
        categoryName: string;
        amount: number;
        frequency: number;          // Months with transactions
      }>;
    };
  };
}
```

### 9.6 Goals Progress Endpoint

**Route:** `GET /api/reports/goals/progress`

**Query Parameters:**
```typescript
{
  year?: number;        // Defaults to selected year
  aggregation?: AggregationType;
  timezone?: string;    // IANA
  scope?: 'household' | 'mine';
  baseCurrency?: string;    // ISO 4217
}
```

**Response:**
```typescript
interface ReportsGoalsProgressResponse {
  range: { year: number; aggregation: AggregationType; timezone: string; baseCurrency: string };
  year: number;
  baseCurrency: string;
  goals: Array<{
    id: string;
    name: string;
    type: 'save_up' | 'pay_down' | 'investment' | 'income';
    targetAmount: number;
    currentAmount: number;
    progressPercent: number;
    targetDate: string | null;
    projectedCompletionDate: string | null;
    status: 'on_track' | 'behind' | 'at_risk' | 'completed';
    monthlyContribution: number;        // Avg monthly progress
    requiredMonthlyToComplete: number | null;
  }>;
  totals: {
    totalTargetAmount: number;
    totalCurrentAmount: number;
    overallProgress: number;
    goalsOnTrack: number;
    goalsBehind: number;
    goalsAtRisk: number;
    goalsCompleted: number;
  };
}
```

### 9.7 Forecast Endpoint

**Route:** `GET /api/reports/forecast`
**Status:** Planned (not implemented in current API)

**Query Parameters:**
```typescript
{
  metric: 'net-worth' | 'net-savings' | 'savings-contributions' | 'expenses' | 'income';
  projectionMonths: number;          // 1-12
  baselineMonths?: number;           // Historical period (default: 6)
  confidenceLevel?: number;          // Default: 0.95
  aggregation?: AggregationType;
  timezone?: string;                 // IANA
  scope?: 'household' | 'mine';
  baseCurrency?: string;                 // ISO 4217
}
```

**Response:**
```typescript
interface ReportsForecastResponse {
  metric: string;
  baseCurrency: string;
  confidenceLevel: number;
  range: { from: string; to: string; aggregation: AggregationType; timezone: string; baseCurrency: string };
  baseline: {
    from: string;
    to: string;
    avgValue: number;
    trend: 'increasing' | 'decreasing' | 'stable';
    r2: number;                      // Regression fit quality
  };
  projections: Array<{
    period: string;
    periodStart: string;
    periodEnd: string;
    projected: number;
    confidenceMin: number;           // Lower bound (95% CI)
    confidenceMax: number;           // Upper bound (95% CI)
  }>;
}
```

### 9.8 Transaction Drill-Down Endpoint

**Route:** `GET /api/reports/transactions`

**Query Parameters:**
```typescript
{
  from: string;
  to: string;
  aggregation?: 'daily' | 'weekly' | 'monthly';
  scope?: 'household' | 'mine';
  includePending?: boolean;
  includeTransfers?: boolean;
  timezone?: string;                 // IANA
  baseCurrency?: string;             // ISO 4217
  type?: 'income' | 'expense' | 'transfer';
  categoryId?: string;
  categoryGroupId?: string;
  merchantId?: string;
  accountId?: string;
  tagId?: string;
  search?: string;
  sort?: 'date_desc' | 'date_asc' | 'amount_desc' | 'amount_asc';
  limit?: number;                    // max 200
  cursor?: string;
}
```
**Note:** At least one filter (category, merchant, account, tag, search, or type) is required.

**Response:**
```typescript
interface ReportsTransactionsResponse {
  page: { limit: number; nextCursor?: string | null };
  items: Array<{
    id: string;
    date: string;
    name: string;
    merchant?: { id: string; name: string } | null;
    category?: { id: string; name: string; groupId: string } | null;
    account?: { id: string; name: string } | null;
    type: 'income' | 'expense' | 'transfer';
    amount: number;
    signedAmount: number;
    baseCurrency: string;
    originalCurrency?: string | null;
    originalAmount?: number | null;
    notes?: string | null;
    isPending: boolean;
    reviewedAt?: string | null;
    tags?: Array<{ id: string; name: string }> | null;
  }>;
}
```

### 9.9 Custom Chart Execution Endpoint

**Route:** `POST /api/reports/custom`
**Status:** Planned (not implemented in current API)

**Request:**
```typescript
interface ReportsCustomRequest {
  config: CustomChartConfig;
  from: string;
  to: string;
  aggregation?: AggregationType;
  timezone?: string;                 // IANA
  scope?: 'household' | 'mine';
  baseCurrency?: string;                 // ISO 4217
}
```

**Response:**
```typescript
interface ReportsCustomResponse {
  range: { from: string; to: string; aggregation: AggregationType; timezone: string; baseCurrency: string };
  metadata: {
    metric: MetricType;
    groupBy: GroupByType;
    chartType: ChartType;
    rowCount: number;
    truncated: boolean;
  };
  series: Array<{
    period?: string;                 // Present for time-based aggregations
    key: string;
    value: number;
  }>;
}
```

**Validation & Limits:**
- Reject requests exceeding 5,000 rows or 25 buckets.
- Enforce allowed metrics/groupings from section 7.
- Time window max: 36 months per custom query.

---

### 9.10 Subcategory Breakdown Endpoint

**Route:** `GET /api/reports/spending/subcategory`
**Status:** Planned (not implemented in current API)

**Query Parameters:**
```typescript
{
  from: string;
  to: string;
  aggregation?: AggregationType;
  timezone?: string;                 // IANA
  scope?: 'household' | 'mine';
  baseCurrency?: string;                 // ISO 4217
  type?: 'income' | 'expense' | 'savingsContributions' | 'debt';
  categoryId?: string;               // Required when type=expense
}
```

**Response:**
```typescript
interface ReportsSubcategoryBreakdownResponse {
  range: { from: string; to: string; aggregation: AggregationType; timezone: string; baseCurrency: string };
  summary: {
    total: number;
    categoryId: string | null;
    categoryName: string | null;
  };
  items: Array<{
    subcategoryId: string;
    subcategoryName: string;
    amount: number;
    percent: number;
    avgMonthly: number;
  }>;
}
```

### 9.11 Annual Report Endpoint

**Route:** `GET /api/reports/annual`

**Query Parameters:**
```typescript
{
  year: number;
  compareYear?: number;              // Default: year - 1
  scope?: 'household' | 'mine';
  timezone?: string;                 // IANA
  baseCurrency?: string;                 // ISO 4217
}
```

**Response (composite, summary-level):**
```typescript
interface ReportsAnnualResponse {
  year: number;
  range: { from: string; to: string; aggregation: AggregationType; timezone: string; baseCurrency: string };
  totals: {
    income: number;
    expenses: number;
    debtPayments: number;
    netSavings: number;
    savingsContributions: number;
    netSavingsRate: number;
    savingsRate: number;
    netWorthEnd: number;
  };
  comparison?: {
    year: number;
    income: number;
    expenses: number;
    netSavings: number;
    netWorthEnd: number;
    deltas: { income: number; expenses: number; netSavings: number; netWorthEnd: number };
  };
  monthly: Array<{
    period: string;
    periodStart: string;
    periodEnd: string;
    income: number;
    expenses: number;
    debtPayments: number;
    netSavings: number;
    savingsContributions: number;
    netWorthChange: number;
  }>;
}
```

### 9.12 Cash Flow Endpoint

**Route:** `GET /api/reports/cashflow`

**Additional Query Parameters:**
```typescript
{
  aggregation?: 'daily' | 'weekly' | 'monthly';
  includePending?: boolean;
  includeTransfers?: boolean;
}
```

**Response:**
```typescript
interface ReportsCashflowResponse {
  range: { from: string; to: string; aggregation: AggregationType; timezone: string; baseCurrency: string };
  series: Array<{
    period: string;
    periodStart: string;
    periodEnd: string;
    income: number;
    expenses: number;
    debtPayments: number;
    netSavings: number;
    netSavingsRate: number;
    savingsContributions: number;
    savingsRate: number;
  }>;
  totals: {
    income: number;
    expenses: number;
    debtPayments: number;
    netSavings: number;
    netSavingsRate: number;
    savingsContributions: number;
    savingsRate: number;
  };
}
```

### 9.13 Sankey Endpoint

**Route:** `GET /api/reports/sankey`

**Additional Query Parameters:**
```typescript
{
  mode: 'income_to_expense_groups' | 'account_to_expense_groups' | 'expense_groups_to_categories';
  maxNodes?: number;                 // Default: 25
  includeSavingsNode?: boolean;      // Default: true
  includePending?: boolean;
  includeTransfers?: boolean;
}
```

**Response:**
```typescript
interface ReportsSankeyResponse {
  range: { from: string; to: string; aggregation: AggregationType; timezone: string; baseCurrency: string };
  nodes: Array<{ id: string; label: string }>;
  links: Array<{ source: string; target: string; value: number }>;
}
```

### 9.14 Spending Breakdown Endpoint

**Route:** `GET /api/reports/spending/breakdown`

**Additional Query Parameters:**
```typescript
{
  groupBy: 'categoryGroup' | 'category' | 'merchant' | 'tag';
  limit?: number;                    // Default: 10
  includePending?: boolean;
  includeTransfers?: boolean;        // Default: false
  merchantCategory?: string;
}
```

**Response:**
```typescript
interface ReportsSpendingBreakdownResponse {
  range: { from: string; to: string; aggregation: AggregationType; timezone: string; baseCurrency: string };
  total: number;
  items: Array<{
    id: string;
    name: string;
    amount: number;
    percent: number;
    transactionCount: number;
    avgTransaction: number;
  }>;
}
```

### 9.15 Spending Trend Endpoint

**Route:** `GET /api/reports/spending/trend`

**Additional Query Parameters:**
```typescript
{
  aggregation?: 'daily' | 'weekly' | 'monthly';
  compare?: 'previous_period' | 'previous_year' | 'none';
  merchantId?: string;
  includePending?: boolean;
  includeTransfers?: boolean;        // Default: false
}
```

**Response:**
```typescript
interface ReportsSpendingTrendResponse {
  range: { from: string; to: string; aggregation: AggregationType; timezone: string; baseCurrency: string };
  current: Array<{ period: string; periodStart: string; periodEnd: string; amount: number }>;
  comparison?: Array<{ period: string; periodStart: string; periodEnd: string; amount: number }>;
}
```

### 9.16 Income Endpoint

**Route:** `GET /api/reports/income`

**Additional Query Parameters:**
```typescript
{
  aggregation?: 'daily' | 'weekly' | 'monthly';
  includePending?: boolean;
}
```

**Response:**
```typescript
interface ReportsIncomeResponse {
  range: { from: string; to: string; aggregation: AggregationType; timezone: string; baseCurrency: string };
  series: Array<{ period: string; periodStart: string; periodEnd: string; income: number }>;
  totals: { income: number };
}
```

### 9.17 Net Worth Endpoint

**Route:** `GET /api/reports/net-worth`

**Additional Query Parameters:**
```typescript
{
  aggregation?: 'daily' | 'monthly';
}
```

**Response:**
```typescript
interface ReportsNetWorthResponse {
  range: { from: string; to: string; aggregation: AggregationType; timezone: string; baseCurrency: string };
  latest: { date: string; netWorth: number; assets: number; liabilities: number };
  series: Array<{ id: 'Net Worth'; data: Array<{ x: string; y: number }> }>;
  breakdown?: {
    assetsByType: Array<{ type: string; value: number }>;
    liabilitiesByType: Array<{ type: string; value: number }>;
  };
}
```

### 9.18 Savings Rate Endpoint

**Route:** `GET /api/reports/savings-rate`

**Additional Query Parameters:**
```typescript
{
  aggregation?: 'daily' | 'weekly' | 'monthly';
  includePending?: boolean;
}
```

**Response:**
```typescript
interface ReportsSavingsRateResponse {
  range: { from: string; to: string; aggregation: AggregationType; timezone: string; baseCurrency: string };
  series: Array<{
    period: string;
    periodStart: string;
    periodEnd: string;
    savingsContributions: number;
    savingsRate: number;
    netSavings: number;
    netSavingsRate: number;
  }>;
}
```

---

## 10. Frontend Components

### 10.1 Annual Dashboard - New Files to Create

```
client/src/components/reports/
├── annual/
│   ├── AnnualSummaryCards.tsx
│   ├── AnnualDashboardLayout.tsx
│   └── CustomizeAnnualDashboard.tsx
│
├── goals/
│   ├── IncomeGoalProgressWidget.tsx
│   ├── SavingsGoalProgressWidget.tsx
│   ├── DebtPayoffGoalProgressWidget.tsx
│   └── AssetsVsLiabilitiesWidget.tsx
│
├── monthly/
│   ├── IncomePerMonthWidget.tsx
│   ├── ExpensesPerMonthWidget.tsx
│   ├── SavingsPerMonthWidget.tsx
│   ├── DebtPaymentPerMonthWidget.tsx
│   └── NetWorthChangePerMonthWidget.tsx
│
├── trends/
│   ├── IncomeVsExpensesMonthlyWidget.tsx
│   ├── IncomeVsExpensesQuarterlyWidget.tsx
│   ├── IncomeVsSavedInvestedWidget.tsx
│   ├── DebtToIncomeComparisonWidget.tsx
│   └── NetWorthTrendWidget.tsx
│
├── cumulative/
│   ├── CumulativeIncomeWidget.tsx
│   ├── CumulativeExpensesWidget.tsx
│   ├── CumulativeSavingsWidget.tsx
│   ├── CumulativeDebtPayoffWidget.tsx
│   └── NetWorthTrendLineWidget.tsx
│
├── category/
│   ├── IncomeByCategoryProgressWidget.tsx
│   ├── ExpensesByCategoryWidget.tsx
│   ├── SavingsByCategoryProgressWidget.tsx
│   ├── DebtPayoffByCategoryWidget.tsx
│   ├── IncomeBreakdownDonutWidget.tsx
│   ├── ExpensesBreakdownDonutWidget.tsx
│   ├── SavingsVsInvestmentsDonutWidget.tsx
│   ├── LoansVsCreditCardsDonutWidget.tsx
│   └── AssetsByCategoryDonutWidget.tsx
│
├── subcategory/
│   ├── IncomeSubcategoryProgressWidget.tsx
│   ├── ExpensesSubcategoryBreakdownWidget.tsx
│   ├── SavingsSubcategoryProgressWidget.tsx
│   ├── DebtSubcategoryProgressWidget.tsx
│   ├── IncomeSubcategoryDonutWidget.tsx
│   ├── ExpensesSubcategoryDonutWidget.tsx
│   ├── SavingsSubcategoryDonutWidget.tsx
│   └── DebtSubcategoryDonutWidget.tsx
│
├── kpi/
│   ├── KPICardsWidget.tsx
│   ├── FixedVsVariableWidget.tsx
│   └── ForecastWidget.tsx
│
├── shared/
│   ├── ChartTypeSwitcher.tsx
│   ├── UniversalChart.tsx
│   ├── AggregationFilter.tsx
│   ├── WidgetWrapper.tsx
│   └── ChartTooltip.tsx
│
└── custom/
    ├── CustomChartBuilder.tsx
    ├── CustomChartWidget.tsx
    └── CustomChartPreview.tsx
```

### 10.2 React Query Hooks

**File:** `client/src/hooks/use-reports.ts`

Implemented hooks:
```typescript
export function useReportsAnnual(params, options?)
export function useReportsCashflow(params, options?)
export function useReportsSankey(params, options?)
export function useReportsSpendingBreakdown(params, options?)
export function useReportsSpendingTrend(params, options?)
export function useReportsIncome(params, options?)
export function useReportsNetWorth(params, options?)
export function useReportsSavingsRate(params, options?)
export function useReportsTransactions(params)
export function useReportsTransactionsInfinite(params)
```

Planned hooks (not yet in code):
```typescript
export function useReportsFinancialRatios(params, options?)
export function useReportsDebt(params, options?)
export function useReportsNetWorthChanges(params, options?)
export function useReportsExpenseClassification(params, options?)
export function useReportsGoalsProgress(params, options?)
export function useReportsSubcategoryBreakdown(params, options?)
export function useReportsForecast(params, options?)
export function useReportsCustomChart(config, options?)
```

**File:** `client/src/hooks/use-report-widget-preferences.ts`

```typescript
export function useReportWidgetPreferences() {
  // Fetch preferences
  // Save preferences (debounced)
  // Reset to defaults
  // Update single widget
  // Reorder widgets
  // Toggle widget
  // Change chart type
}
```

**File:** `client/src/hooks/use-custom-charts.ts`

```typescript
export function useCustomCharts() {
  // List custom charts
  // Create custom chart
  // Update custom chart
  // Delete custom chart
  // Execute custom chart query
}
```

### 10.3 Reports Tabs (Cash Flow, Spending, Merchants, Income, Net Worth, Savings)

**Pages:**
- `client/src/pages/Reports.tsx` (tab container for Spending, Merchants, Income, Net Worth, Savings)
- `client/src/pages/CashFlow.tsx` (Cash Flow report)

**Core tab behaviors:**
- Shared filters: date range, aggregation, scope, includePending, includeTransfers.
- Drill-down: click chart segments to open `/api/reports/transactions` results.
- Export: use `/api/reports/export` for CSV downloads.

---

## 11. Database Changes

### 11.1 Schema Updates

**File:** `shared/schema.ts`

Add to `userDisplaySettings` table:
```typescript
reportWidgetPreferences: jsonb('report_widget_preferences')
  .$type<WidgetPreferences>()
  .default({
    version: 1,
    lastUpdated: new Date().toISOString(),
    aggregation: 'monthly',
    widgets: [],
    customCharts: []
  })
```

### 11.2 Migration

**File:** `migrations/add-report-widget-preferences.sql`

```sql
-- Add report widget preferences column
ALTER TABLE user_display_settings
ADD COLUMN IF NOT EXISTS report_widget_preferences JSONB
DEFAULT '{"version":1,"aggregation":"monthly","widgets":[],"customCharts":[]}'::jsonb;

-- Add index for performance
CREATE INDEX IF NOT EXISTS idx_user_display_settings_report_widgets
ON user_display_settings USING GIN (report_widget_preferences);
```

### 11.3 Indexes for Performance

```sql
-- For financial ratios queries
CREATE INDEX IF NOT EXISTS idx_transactions_account_type_date
ON transactions(account_id, date)
WHERE deleted_at IS NULL;

-- For goals progress
CREATE INDEX IF NOT EXISTS idx_goal_contributions_goal_date
ON goal_contributions(goal_id, date);

-- For debt analysis
CREATE INDEX IF NOT EXISTS idx_accounts_type_household
ON accounts(household_id, type)
WHERE deleted_at IS NULL;

-- For expense classification
CREATE INDEX IF NOT EXISTS idx_transactions_category_month
ON transactions(category_id, DATE_TRUNC('month', date))
WHERE deleted_at IS NULL AND type = 'expense';
```

---

## 12. Implementation Schedule

### Phase 0: Core Reports Tabs (Week 0-1)

| Task | File | Priority |
|------|------|----------|
| Implement `getCashflow()` + `getSankey()` | `ReportRepository.ts` | High |
| Implement `getSpendingBreakdown()` | `ReportRepository.ts` | High |
| Implement `getSpendingTrend()` | `ReportRepository.ts` | High |
| Implement `getIncome()` (derived from cashflow) | `ReportRepository.ts` | Medium |
| Implement `getNetWorth()` | `ReportRepository.ts` | High |
| Implement `getSavingsRate()` (contributions + net) | `ReportRepository.ts` | Medium |
| Add merchants report support (groupBy=merchant + trend filter) | `ReportRepository.ts` | Medium |
| Add reports tab filters to `Reports.tsx` | `client/src/pages/Reports.tsx` | Medium |

### Phase 1: Backend Foundation (Week 1-2)

| Task | File | Priority |
|------|------|----------|
| Add response types | `shared/reports.ts` | High |
| Add validation schemas | `server/validation/reports.ts` | High |
| Implement `getFinancialRatios()` | `ReportRepository.ts` | High |
| Implement `getDebtAnalysis()` | `ReportRepository.ts` | High |
| Implement `getExpenseClassification()` | `ReportRepository.ts` | High |
| Add scope/permission validation | `routes/reports.ts` | High |
| Add currency conversion helper | `server/utils/currency.ts` | Medium |
| Add routes and cache TTLs | `routes/reports.ts` | High |
| Write unit tests | `__tests__/` | High |

### Phase 2: Backend Completion (Week 2-3)

| Task | File | Priority |
|------|------|----------|
| Implement `getNetWorthChanges()` | `ReportRepository.ts` | High |
| Implement `getGoalsProgress()` | `ReportRepository.ts` | High |
| Implement `getSubcategoryBreakdown()` | `ReportRepository.ts` | High |
| Implement `getForecast()` | `ReportRepository.ts` | Medium |
| Create forecasting utility | `server/utils/forecasting.ts` | Medium |
| Implement `getTransactionsDrilldown()` | `ReportRepository.ts` | High |
| Implement custom chart execution + limits | `ReportRepository.ts` | High |
| Add aggregation parameter support | All endpoints | High |
| Enhance `getAnnualReport()` | `ReportRepository.ts` | High |

### Phase 3: Frontend Hooks & Core Widgets (Week 3-4)

| Task | File | Priority |
|------|------|----------|
| Add all new React Query hooks | `use-reports.ts` | High |
| Create AnnualSummaryCards | `annual/` | High |
| Create Goal Progress widgets | `goals/` | High |
| Create FixedVsVariableWidget | `kpi/` | High |
| Create KPICardsWidget | `kpi/` | High |

### Phase 4: Frontend Chart Widgets (Week 4-5)

| Task | Files | Priority |
|------|-------|----------|
| Create Monthly Charts (5) | `monthly/` | High |
| Create Comparison Trends (5) | `trends/` | High |
| Create Cumulative Charts (5) | `cumulative/` | Medium |
| Create Category Progress (4) | `category/` | Medium |
| Create Category Donuts (5) | `category/` | Medium |
| Create Subcategory widgets (8) | `subcategory/` | Low |

### Phase 5: Interactivity (Week 5-6)

| Task | Files | Priority |
|------|-------|----------|
| Create ChartTypeSwitcher | `shared/` | High |
| Create UniversalChart | `shared/` | High |
| Create AggregationFilter | `shared/` | High |
| Create CustomChartBuilder | `custom/` | Medium |
| Create ForecastWidget | `kpi/` | Medium |

### Phase 6: Integration & Polish (Week 6)

| Task | Files | Priority |
|------|-------|----------|
| Redesign Reports.tsx Annual tab | `pages/Reports.tsx` | High |
| Create CustomizeAnnualDashboard | `annual/` | High |
| Create AnnualDashboardLayout | `annual/` | High |
| Add widget preferences hooks | `hooks/` | High |
| Database migration | `migrations/` | High |
| Integration tests | `__tests__/` | High |
| Performance optimization | Various | Medium |
| Error handling | Various | High |

---

## 13. Testing Requirements

### 13.1 Unit Tests

| Area | Coverage Target | Key Tests |
|------|-----------------|-----------|
| Repository methods | 90% | SQL query results, edge cases |
| Forecasting utility | 95% | Accuracy, boundary conditions |
| Auto-classification | 90% | Various transaction patterns |
| React hooks | 85% | Data fetching, caching, errors |
| Widget components | 80% | Rendering, interactions |

### 13.2 Integration Tests

| Test Scenario | Endpoint/Component |
|---------------|-------------------|
| Financial ratios calculation | `/api/reports/financial-ratios` |
| Debt analysis accuracy | `/api/reports/debt` |
| Expense classification | `/api/reports/expenses/classification` |
| Goals progress tracking | `/api/reports/goals/progress` |
| Cash flow accuracy | `/api/reports/cashflow` |
| Sankey flow integrity | `/api/reports/sankey` |
| Spending breakdown totals | `/api/reports/spending/breakdown` |
| Spending trend comparison | `/api/reports/spending/trend` |
| Income series accuracy | `/api/reports/income` |
| Net worth series accuracy | `/api/reports/net-worth` |
| Savings rate accuracy | `/api/reports/savings-rate` |
| Transaction drill-down | `/api/reports/transactions` |
| Widget preference persistence | `/api/settings/report-widgets` |
| Custom chart execution | `/api/reports/custom` |
| Scope enforcement (mine vs household) | `/api/reports/*` |
| Merchants report (top merchants + trend) | `/api/reports/spending/breakdown`, `/api/reports/spending/trend` |

### 13.3 E2E Tests

| User Flow | Steps |
|-----------|-------|
| View Annual Dashboard | Navigate, verify all widgets load |
| View Cash Flow tab | Navigate, verify cashflow + Sankey load |
| View Spending tab | Navigate, verify breakdown + trend load |
| View Merchants tab | Navigate, verify top merchants + trend load |
| View Income tab | Navigate, verify income series load |
| View Net Worth tab | Navigate, verify net worth line load |
| View Savings tab | Navigate, verify savings rate load |
| Switch chart types | Click switcher, verify chart updates |
| Change aggregation | Select quarterly, verify data updates |
| Customize widgets | Toggle widgets, verify persistence |
| Create custom chart | Open builder, configure, save, verify |
| Drill-down | Click chart segment, verify transactions |

---

## 14. Success Criteria

| Criterion | Measurement | Target |
|-----------|-------------|--------|
| All API endpoints functional | Automated tests pass | 100% |
| Auto-classification accuracy | Manual verification | > 90% |
| Widget render performance | Lighthouse metrics | < 200ms |
| Page load time | Lighthouse metrics | < 3s |
| Chart type switching | User testing | Smooth transitions |
| Widget preferences persist | Session tests | 100% |
| Custom charts work | Feature tests | All metrics/groupings |
| No console errors | Browser console | 0 errors |
| Test coverage | Coverage report | > 80% |
| Mobile responsiveness | Device testing | All breakpoints |

---

## 15. References

### 15.1 Existing Codebase Files

| File | Purpose |
|------|---------|
| `shared/reports.ts` | Response type definitions |
| `server/repositories/ReportRepository.ts` | SQL query implementations |
| `server/routes/reports.ts` | API route handlers |
| `server/services/AnalyticsService.ts` | Business logic orchestration |
| `server/services/AnalyticsCache.ts` | Redis caching |
| `client/src/hooks/use-reports.ts` | React Query hooks |
| `client/src/pages/Reports.tsx` | Reports page component |
| `client/src/pages/CashFlow.tsx` | Cash Flow report page |
| `client/src/components/reports/` | Existing report widgets |

### 15.2 External References

| Resource | URL |
|----------|-----|
| @nivo Charts | https://nivo.rocks/ |
| Recharts | https://recharts.org/ |
| @dnd-kit | https://dndkit.com/ |
| Radix UI | https://www.radix-ui.com/ |
| TanStack Query | https://tanstack.com/query |

---

### 15.3 Additional Internal References

- `docs/analytics-reporting-architecture.md`
- `docs/phase-2-analytics-implementation.md`
- `docs/cashflow-implementation-plan.md`
- `docs/cashflow-review.md`
- `docs/merchant-requirements.md`

## Appendix A: Annual Dashboard Widget List

| # | Widget | Category | Core? | Chart Types |
|---|--------|----------|-------|-------------|
| 1 | Summary Cards | Summary | Yes | Cards |
| 2 | Income Goal Progress | Goals | Yes | Progress |
| 3 | Savings Goal Progress | Goals | Yes | Progress |
| 4 | Debt Payoff Progress | Goals | Yes | Progress |
| 5 | Assets vs Liabilities | Goals | Yes | Bar |
| 6 | Fixed vs Variable | KPI | Yes | Stacked |
| 7 | Income Per Month | Monthly | No | Bar/Line/Area/Combo |
| 8 | Expenses Per Month | Monthly | No | Bar/Line/Area/Combo |
| 9 | Savings Per Month | Monthly | No | Bar/Line/Area/Combo |
| 10 | Debt Payment Per Month | Monthly | No | Bar/Line/Area/Combo |
| 11 | Net Worth Change Per Month | Monthly | No | Bar/Line/Area/Combo |
| 12 | Income vs Expenses Monthly | Trends | No | Line/Bar/Area/Combo |
| 13 | Income vs Expenses Quarterly | Trends | No | Bar |
| 14 | Income vs Savings Contributions | Trends | No | Line/Bar/Area/Combo |
| 15 | Debt to Income Comparison | Trends | No | Line/Bar |
| 16 | Net Worth Trend | Trends | No | Line/Area |
| 17 | Cumulative Income | Cumulative | No | Bar/Line/Area |
| 18 | Cumulative Expenses | Cumulative | No | Bar/Line/Area |
| 19 | Cumulative Savings | Cumulative | No | Bar/Line/Area |
| 20 | Cumulative Debt Payoff | Cumulative | No | Bar/Line/Area |
| 21 | Net Worth Trend Line | Cumulative | No | Line |
| 22 | Income by Category Progress | Category | No | Bar/Stacked |
| 23 | Expenses by Category | Category | No | Bar/Stacked |
| 24 | Savings by Category Progress | Category | No | Bar/Stacked |
| 25 | Debt Payoff by Category | Category | No | Bar/Stacked |
| 26 | Income Breakdown Donut | Donuts | No | Pie/Donut/Treemap/Bar |
| 27 | Expenses Breakdown Donut | Donuts | No | Pie/Donut/Treemap/Bar |
| 28 | Savings vs Investments Donut | Donuts | No | Pie/Donut |
| 29 | Loans vs Credit Cards Donut | Donuts | No | Pie/Donut |
| 30 | Assets by Category Donut | Donuts | No | Pie/Donut/Treemap/Bar |
| 31 | Income Subcategory Progress | Subcategory | No | Bar |
| 32 | Expenses Subcategory Breakdown | Subcategory | No | Bar |
| 33 | Savings Subcategory Progress | Subcategory | No | Bar |
| 34 | Debt Subcategory Progress | Subcategory | No | Bar |
| 35 | Income Subcategory Donut | Subcategory | No | Pie/Donut |
| 36 | Expenses Subcategory Donut | Subcategory | No | Pie/Donut |
| 37 | Savings Subcategory Donut | Subcategory | No | Pie/Donut |
| 38 | Debt Subcategory Donut | Subcategory | No | Pie/Donut |
| 39 | KPI Cards | KPI | No | Gauges |
| 40 | Forecast | KPI | No | Line |
| 41-50 | Custom Charts (up to 10) | Custom | No | User-defined |

---

## Appendix B: Annual Dashboard Color Palette

| Use Case | Color | Hex |
|----------|-------|-----|
| Income | Emerald | #10b981 |
| Expenses | Rose | #f43f5e |
| Savings | Blue | #3b82f6 |
| Debt | Orange | #f97316 |
| Net Worth | Purple | #8b5cf6 |
| Assets | Teal | #14b8a6 |
| Liabilities | Red | #ef4444 |
| Fixed | Slate | #64748b |
| Variable | Amber | #f59e0b |
| Positive Change | Green | #22c55e |
| Negative Change | Red | #ef4444 |
| Average Line | Gray | #6b7280 |
| Forecast | Indigo (dashed) | #6366f1 |
| Confidence Interval | Indigo (10% opacity) | #6366f1/10 |







