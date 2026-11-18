# CashFlow Module Overhaul - Technical Specification

**Date:** 2026-01-23
**Author:** Claude Opus 4.5
**Status:** Ready for Implementation
**Scope:** Full overhaul based on consolidated review reports

---

## Executive Summary

This specification details the implementation plan for the CashFlow module overhaul. The module is already production-ready (87/100 score) with excellent Money class compliance. The overhaul focuses on:

1. **P1 - Core Features:** Cashflow forecast and budget comparison
2. **P2 - Compliance:** Multi-currency metadata and warnings
3. **P2 - UX Polish:** Legend colors, responsive layouts, mobile Sankey
4. **P1/P2 - QA:** Missing test coverage for export, filters, empty states

**Estimated Files to Modify:** 18
**Estimated Files to Create:** 8
**Test Files to Add/Modify:** 6

---

## Current Architecture Summary

```
┌─────────────────────────────────────────────────────────────────┐
│                        CLIENT LAYER                              │
├─────────────────────────────────────────────────────────────────┤
│ CashFlow.tsx (191 LOC) - Page orchestrator                      │
│ ├─ CashFlowFilters.tsx (248 LOC)                                │
│ ├─ CashFlowSummary.tsx (92 LOC)                                 │
│ ├─ CashFlowChart.tsx (173 LOC) - Bar + Sankey                   │
│ ├─ CashFlowTable.tsx (157 LOC)                                  │
│ ├─ IncomeBreakdown.tsx (106 LOC)                                │
│ └─ ExpenseBreakdown.tsx (106 LOC)                               │
├─────────────────────────────────────────────────────────────────┤
│ useCashFlowData.ts (178 LOC) - Data transformation hook         │
│ useReportsCashflow() - React Query hook                         │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                        SERVER LAYER                              │
├─────────────────────────────────────────────────────────────────┤
│ reports.cashflow.controller.ts (68 LOC)                         │
│ CashflowReportRepository.ts (540 LOC)                           │
│ server/core/calculations/cashflow/ (305 LOC total)              │
│ └─ netSavings, netSavingsRate, netWorth, incomeAllocation       │
└─────────────────────────────────────────────────────────────────┘
```

---

## Part 1: Cashflow Forecast Feature (P1)

### 1.1 User Stories

- **US-1:** As a user, I want to see projected income/expenses for future months based on my recurring transactions
- **US-2:** As a user, I want to toggle between "Actual" and "Actual + Forecast" views
- **US-3:** As a user, I want forecast data visually distinguished from actual data
- **US-4:** As a user, I want to control the forecast horizon (1-12 months)

### 1.2 API Design

**Decision:** Extend existing `/api/reports/cashflow` endpoint with forecast parameters (Option A from plan)

**New Query Parameters:**
```typescript
// Add to existing ReportsCashflowQuery
interface ReportsCashflowQuery {
  // ... existing params
  includeForecast?: boolean;      // default: false
  forecastMonths?: number;        // default: 3, max: 12
}
```

**Response Extension:**
```typescript
interface CashflowSeriesPoint {
  period: string;           // "2026-01", "2026-W04", "2026-01-23"
  income: MoneyDto;
  expenses: MoneyDto;
  savings: MoneyDto;
  savingsRate: number;
  isForecast?: boolean;     // NEW: true for projected data
}

interface ReportsCashflowResponse {
  series: CashflowSeriesPoint[];
  totals: {
    income: MoneyDto;
    expenses: MoneyDto;
    savings: MoneyDto;
    savingsRate: number;
  };
  // NEW metadata section
  metadata: {
    currencyMode: "household" | "mixed";
    baseCurrency: string;
    generatedAt: string;
    forecastConfig?: {
      enabled: boolean;
      horizonMonths: number;
      dataSourcesUsed: ("recurring" | "budgets" | "averages")[];
    };
  };
}
```

### 1.3 Server Implementation

#### 1.3.1 New Calculation Module

**File:** `server/core/calculations/cashflow/forecast.ts` (~150 LOC)

```typescript
import { Money } from "../../money";
import type { RecurringRule } from "@shared/schema";

export interface ForecastConfig {
  horizonMonths: number;
  householdId: string;
  baseCurrency: string;
  interval: "day" | "week" | "month";
}

export interface ForecastPoint {
  period: string;
  income: Money;
  expenses: Money;
  savings: Money;
  savingsRate: number;
  sources: {
    recurringIncome: Money;
    recurringExpenses: Money;
    budgetedExpenses: Money;
    averageIncome: Money;
    averageExpenses: Money;
  };
}

/**
 * Generate cashflow forecast based on:
 * 1. Active recurring rules (primary source)
 * 2. Budget allocations (where recurring not available)
 * 3. Category averages (fallback for unbudgeted categories)
 */
export function generateForecast(
  config: ForecastConfig,
  recurringRules: RecurringRule[],
  budgets: BudgetAllocation[],
  categoryAverages: CategoryAverage[]
): ForecastPoint[] {
  // Implementation logic
}

/**
 * Project recurring rule amounts to future periods
 * Handles: daily, weekly, monthly, yearly frequencies
 */
export function projectRecurringToperiod(
  rule: RecurringRule,
  period: string,
  interval: "day" | "week" | "month",
  baseCurrency: string
): Money {
  // Frequency normalization logic
}
```

#### 1.3.2 Repository Extension

**File:** `server/repositories/reports/CashflowReportRepository.ts`

**Add method (~80 LOC):**
```typescript
async getCashflowWithForecast(
  householdId: string,
  query: ReportsCashflowQuery
): Promise<ReportsCashflowResponse> {
  // 1. Get actual data (existing method)
  const actuals = await this.getCashflow(householdId, query);

  if (!query.includeForecast) {
    return actuals;
  }

  // 2. Get forecast inputs
  const [recurringRules, budgets, categoryAverages] = await Promise.all([
    this.getActiveRecurringRules(householdId),
    this.getBudgetsForPeriod(householdId, forecastStart, forecastEnd),
    this.getCategoryAverages(householdId, lookbackMonths: 6)
  ]);

  // 3. Generate forecast
  const forecastPoints = generateForecast({
    horizonMonths: query.forecastMonths ?? 3,
    householdId,
    baseCurrency: actuals.metadata.baseCurrency,
    interval: query.interval
  }, recurringRules, budgets, categoryAverages);

  // 4. Merge and return
  return {
    ...actuals,
    series: [...actuals.series, ...forecastPoints.map(toSeriesPoint)],
    metadata: {
      ...actuals.metadata,
      forecastConfig: {
        enabled: true,
        horizonMonths: query.forecastMonths ?? 3,
        dataSourcesUsed: determineSources(recurringRules, budgets, categoryAverages)
      }
    }
  };
}
```

#### 1.3.3 Controller Update

**File:** `server/modules/reports/reports.cashflow.controller.ts`

**Modify `getCashflow()`:**
```typescript
export async function getCashflow(req: Request, res: Response): Promise<void> {
  const { householdId } = req.householdContext!;

  const result = cashflowQuerySchema.safeParse(req.query);
  if (!result.success) {
    throw new ValidationError("Invalid query parameters", result.error.errors);
  }

  // Route to appropriate method
  const data = result.data.includeForecast
    ? await cashflowRepository.getCashflowWithForecast(householdId, result.data)
    : await cashflowRepository.getCashflow(householdId, result.data);

  success(res, data);
}
```

#### 1.3.4 Validation Schema Update

**File:** `server/modules/reports/reports.validation.ts`

```typescript
export const cashflowQuerySchema = z.object({
  // ... existing fields
  includeForecast: z.coerce.boolean().optional().default(false),
  forecastMonths: z.coerce.number().int().min(1).max(12).optional().default(3),
}).refine(
  (data) => !data.includeForecast || data.interval === "month",
  { message: "Forecast only available for monthly interval" }
);
```

### 1.4 Client Implementation

#### 1.4.1 Filter State Extension

**File:** `client/src/features/cashflow/types.ts`

```typescript
export interface CashFlowFiltersState {
  // ... existing
  includeForecast: boolean;      // NEW
  forecastMonths: number;        // NEW (1-12)
}

export const DEFAULT_FILTERS: CashFlowFiltersState = {
  // ... existing
  includeForecast: false,
  forecastMonths: 3,
};
```

#### 1.4.2 Filter UI Extension

**File:** `client/src/features/cashflow/components/CashFlowFilters.tsx`

**Add forecast toggle section (~30 LOC):**
```tsx
{/* Forecast Section - only show for monthly interval */}
{draftFilters.interval === "month" && (
  <div className="space-y-3">
    <div className="flex items-center justify-between">
      <Label htmlFor="includeForecast">Include Forecast</Label>
      <Switch
        id="includeForecast"
        checked={draftFilters.includeForecast}
        onCheckedChange={(checked) =>
          setDraftFilters((f) => ({ ...f, includeForecast: checked }))
        }
      />
    </div>

    {draftFilters.includeForecast && (
      <div className="space-y-2">
        <Label>Forecast Horizon</Label>
        <Select
          value={String(draftFilters.forecastMonths)}
          onValueChange={(v) =>
            setDraftFilters((f) => ({ ...f, forecastMonths: Number(v) }))
          }
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {[1, 3, 6, 12].map((n) => (
              <SelectItem key={n} value={String(n)}>
                {n} month{n > 1 ? "s" : ""}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          Forecast based on recurring transactions and budgets
        </p>
      </div>
    )}
  </div>
)}
```

#### 1.4.3 Chart Visualization Update

**File:** `client/src/features/cashflow/components/CashFlowChart.tsx`

**Add forecast styling (~40 LOC):**
```tsx
// Bar pattern for forecast data
const ForecastPattern = () => (
  <defs>
    <pattern id="forecast-pattern" patternUnits="userSpaceOnUse" width="4" height="4">
      <path d="M-1,1 l2,-2 M0,4 l4,-4 M3,5 l2,-2"
            stroke="currentColor"
            strokeWidth="0.5"
            opacity="0.3" />
    </pattern>
  </defs>
);

// In bar chart config:
const barColors = (bar: ComputedDatum<CashFlowBarData>) => {
  const isForecast = bar.data.isForecast;
  const baseColor = bar.id === "income"
    ? "hsl(var(--chart-income))"
    : "hsl(var(--chart-expense))";

  return isForecast ? `url(#forecast-pattern)` : baseColor;
};

// Add legend entry for forecast
{hasForecastData && (
  <div className="flex items-center gap-2 text-sm text-muted-foreground">
    <div className="w-4 h-4 border border-dashed" />
    <span>Projected (based on recurring)</span>
  </div>
)}
```

#### 1.4.4 Hook Update

**File:** `client/src/features/cashflow/hooks/useCashFlowData.ts`

**Add forecast handling (~20 LOC):**
```typescript
// Separate actual vs forecast for conditional styling
const { actualData, forecastData } = useMemo(() => {
  if (!data?.series) return { actualData: [], forecastData: [] };

  return {
    actualData: data.series.filter(p => !p.isForecast),
    forecastData: data.series.filter(p => p.isForecast)
  };
}, [data?.series]);

// Expose forecast metadata
const forecastConfig = data?.metadata?.forecastConfig;
const hasForecast = forecastConfig?.enabled ?? false;
```

#### 1.4.5 Export Exclusion Logic

**File:** `client/src/pages/CashFlow.tsx`

**Update export handler:**
```typescript
const handleExport = async () => {
  // Warn if forecast included
  if (filters.includeForecast) {
    const confirmed = await confirm({
      title: "Export Options",
      description: "Forecast data will be excluded from exports. Continue?",
    });
    if (!confirmed) return;
  }

  await createExport({
    reportType: "cashflow",
    format: "csv",
    ...filters,
    includeForecast: false, // Always exclude from export
  });
};
```

---

## Part 2: Budget Comparison Feature (P1)

### 2.1 User Stories

- **US-5:** As a user, I want to compare actual spending vs my budget
- **US-6:** As a user, I want to see variance (over/under budget) per category
- **US-7:** As a user, I want a visual overlay showing budget targets on my cashflow chart

### 2.2 API Design

**New Endpoint:** `GET /api/reports/cashflow/budget`

```typescript
interface CashflowBudgetQuery {
  from: string;
  to: string;
  interval: "day" | "week" | "month";
  scope: "household" | "mine";
}

interface BudgetComparisonPoint {
  period: string;
  category: string;
  actual: MoneyDto;
  budgeted: MoneyDto;
  variance: MoneyDto;
  variancePercent: number;  // negative = over budget
  status: "under" | "on_track" | "over";
}

interface CashflowBudgetResponse {
  comparison: BudgetComparisonPoint[];
  summary: {
    totalActual: MoneyDto;
    totalBudgeted: MoneyDto;
    totalVariance: MoneyDto;
    categoriesOverBudget: number;
    categoriesUnderBudget: number;
  };
  metadata: {
    budgetsCovered: number;
    categoriesWithoutBudget: string[];
    periodNormalization: "prorated" | "full";
  };
}
```

### 2.3 Server Implementation

#### 2.3.1 New Calculation Module

**File:** `server/core/calculations/cashflow/budgetComparison.ts` (~120 LOC)

```typescript
import { Money } from "../../money";

export interface BudgetComparisonConfig {
  interval: "day" | "week" | "month";
  periodStart: Date;
  periodEnd: Date;
}

/**
 * Normalize budget amounts to the requested interval
 * Handles monthly budgets viewed as weekly, etc.
 */
export function normalizeBudgetToInterval(
  budget: { amount: Money; periodType: "monthly" | "yearly" },
  targetInterval: "day" | "week" | "month",
  periodDays: number
): Money {
  // Daily: budget / days_in_month * periodDays
  // Weekly: budget / 4.33 (avg weeks/month)
  // Monthly: budget as-is
}

/**
 * Calculate variance with status classification
 * - under: actual < 90% of budget
 * - on_track: actual 90-100% of budget
 * - over: actual > 100% of budget
 */
export function calculateVariance(
  actual: Money,
  budgeted: Money
): { variance: Money; variancePercent: number; status: "under" | "on_track" | "over" } {
  const variance = budgeted.subtract(actual);
  const percent = budgeted.isZero()
    ? 0
    : variance.divide(budgeted.toNumber()).toNumber() * 100;

  const status = percent < -10 ? "over"
    : percent > 10 ? "under"
    : "on_track";

  return { variance, variancePercent: percent, status };
}
```

#### 2.3.2 Repository Method

**File:** `server/repositories/reports/CashflowReportRepository.ts`

**Add method (~100 LOC):**
```typescript
async getBudgetComparison(
  householdId: string,
  query: CashflowBudgetQuery
): Promise<CashflowBudgetResponse> {
  // 1. Get actual spending by category
  const actuals = await this.getSpendingByCategory(householdId, query);

  // 2. Get budgets for the period
  const budgets = await budgetRepository.findForPeriod(
    householdId,
    query.from,
    query.to
  );

  // 3. Normalize budgets to interval
  const normalizedBudgets = budgets.map(b => ({
    ...b,
    normalizedAmount: normalizeBudgetToInterval(
      b,
      query.interval,
      daysBetween(query.from, query.to)
    )
  }));

  // 4. Match and compare
  const comparison = actuals.map(actual => {
    const budget = normalizedBudgets.find(b => b.categoryId === actual.categoryId);
    if (!budget) {
      return { ...actual, budgeted: Money.zero(currency), variance: null, status: "unbudgeted" };
    }
    return {
      period: actual.period,
      category: actual.categoryName,
      actual: toMoneyDto(actual.amount),
      budgeted: toMoneyDto(budget.normalizedAmount),
      ...calculateVariance(actual.amount, budget.normalizedAmount)
    };
  });

  // 5. Build summary
  return {
    comparison,
    summary: buildSummary(comparison),
    metadata: {
      budgetsCovered: budgets.length,
      categoriesWithoutBudget: getUnbudgetedCategories(actuals, budgets),
      periodNormalization: query.interval === "month" ? "full" : "prorated"
    }
  };
}
```

#### 2.3.3 Controller and Routes

**File:** `server/modules/reports/reports.cashflow.controller.ts`

```typescript
export async function getBudgetComparison(req: Request, res: Response): Promise<void> {
  const { householdId } = req.householdContext!;

  const result = budgetComparisonQuerySchema.safeParse(req.query);
  if (!result.success) {
    throw new ValidationError("Invalid parameters", result.error.errors);
  }

  const data = await cashflowRepository.getBudgetComparison(householdId, result.data);
  success(res, data);
}
```

**File:** `server/modules/reports/reports.routes.ts`

```typescript
router.get("/cashflow/budget", analyticsLimiter, cashflowController.getBudgetComparison);
```

### 2.4 Client Implementation

#### 2.4.1 New Hook

**File:** `client/src/hooks/use-reports.ts`

```typescript
export function useReportsCashflowBudget(
  filters: CashFlowFiltersState,
  options?: { enabled?: boolean }
) {
  return useQuery({
    queryKey: reportKeys.cashflowBudget(filters),
    queryFn: () => api.get<CashflowBudgetResponse>("/reports/cashflow/budget", {
      params: {
        from: filters.from,
        to: filters.to,
        interval: filters.interval,
        scope: filters.scope,
      }
    }).then(r => r.data),
    enabled: options?.enabled ?? true,
    staleTime: 1000 * 60 * 3, // 3 minutes
  });
}
```

#### 2.4.2 New Component

**File:** `client/src/features/cashflow/components/BudgetComparison.tsx` (~200 LOC)

```tsx
import { ResponsiveBar } from "@nivo/bar";
import { formatMoney } from "@/lib/money";

interface BudgetComparisonProps {
  data: CashflowBudgetResponse;
  currency: string;
}

export function BudgetComparison({ data, currency }: BudgetComparisonProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Budget vs Actual</CardTitle>
        <CardDescription>
          {data.summary.categoriesOverBudget} categories over budget
        </CardDescription>
      </CardHeader>
      <CardContent>
        {/* Summary Cards */}
        <div className="grid grid-cols-3 gap-4 mb-6">
          <SummaryCard
            label="Total Budgeted"
            amount={data.summary.totalBudgeted}
          />
          <SummaryCard
            label="Total Spent"
            amount={data.summary.totalActual}
          />
          <SummaryCard
            label="Variance"
            amount={data.summary.totalVariance}
            variant={data.summary.totalVariance.amount.startsWith("-") ? "destructive" : "success"}
          />
        </div>

        {/* Stacked Bar Chart */}
        <div className="h-[300px]">
          <ResponsiveBar
            data={transformForChart(data.comparison)}
            keys={["actual", "remaining"]}
            indexBy="category"
            layout="horizontal"
            colors={["hsl(var(--chart-expense))", "hsl(var(--muted))"]}
            // ... chart config
          />
        </div>

        {/* Detailed Table */}
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Category</TableHead>
              <TableHead className="text-right">Budgeted</TableHead>
              <TableHead className="text-right">Actual</TableHead>
              <TableHead className="text-right">Variance</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.comparison.map(row => (
              <TableRow key={row.category}>
                <TableCell>{row.category}</TableCell>
                <TableCell className="text-right">
                  {formatMoney(row.budgeted, currency)}
                </TableCell>
                <TableCell className="text-right">
                  {formatMoney(row.actual, currency)}
                </TableCell>
                <TableCell className={cn(
                  "text-right",
                  row.status === "over" && "text-destructive"
                )}>
                  {formatMoney(row.variance, currency)}
                </TableCell>
                <TableCell>
                  <Badge variant={statusVariant(row.status)}>
                    {row.status}
                  </Badge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
```

#### 2.4.3 Page Integration

**File:** `client/src/pages/CashFlow.tsx`

**Add view toggle and component (~30 LOC):**
```tsx
const [view, setView] = useState<"cashflow" | "budget">("cashflow");

// In render:
<Tabs value={view} onValueChange={setView}>
  <TabsList>
    <TabsTrigger value="cashflow">Cash Flow</TabsTrigger>
    <TabsTrigger value="budget">Budget Comparison</TabsTrigger>
  </TabsList>
</Tabs>

{view === "budget" ? (
  <BudgetComparison data={budgetData} currency={household.currency} />
) : (
  <>{/* Existing cashflow components */}</>
)}
```

---

## Part 3: Multi-Currency Handling (P2)

### 3.1 Problem Statement

Currently, multi-currency aggregation is performed server-side using FX rates, but:
1. Response doesn't indicate if mixed currencies were aggregated
2. Users can't tell if amounts are converted or native
3. No warning when FX rates may be stale

### 3.2 Server Changes

#### 3.2.1 Metadata Addition

**File:** `server/repositories/reports/CashflowReportRepository.ts`

**Add to response building (~30 LOC):**
```typescript
private async buildMetadata(
  householdId: string,
  transactionCurrencies: string[]
): Promise<CashflowMetadata> {
  const household = await householdRepository.findById(householdId);
  const baseCurrency = household!.currency;

  const uniqueCurrencies = [...new Set(transactionCurrencies)];
  const isMixed = uniqueCurrencies.length > 1 ||
    (uniqueCurrencies.length === 1 && uniqueCurrencies[0] !== baseCurrency);

  return {
    currencyMode: isMixed ? "mixed" : "household",
    baseCurrency,
    generatedAt: new Date().toISOString(),
    mixedCurrencies: isMixed ? uniqueCurrencies : undefined,
  };
}
```

### 3.3 Client Changes

#### 3.3.1 Warning Banner

**File:** `client/src/features/cashflow/components/CurrencyWarning.tsx` (~50 LOC)

```tsx
import { AlertTriangle } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

interface CurrencyWarningProps {
  metadata: CashflowMetadata;
}

export function CurrencyWarning({ metadata }: CurrencyWarningProps) {
  if (metadata.currencyMode !== "mixed") return null;

  return (
    <Alert variant="warning">
      <AlertTriangle className="h-4 w-4" />
      <AlertTitle>Mixed Currencies</AlertTitle>
      <AlertDescription>
        This report includes transactions in {metadata.mixedCurrencies?.join(", ")}.
        Amounts have been converted to {metadata.baseCurrency} using current exchange rates.
      </AlertDescription>
    </Alert>
  );
}
```

#### 3.3.2 Integration in Page

**File:** `client/src/pages/CashFlow.tsx`

```tsx
{data?.metadata && <CurrencyWarning metadata={data.metadata} />}
```

---

## Part 4: UX and Code Quality Fixes (P2)

### 4.1 Legend Color Fix

**Issue:** Hardcoded `#999` doesn't respect dark mode

**Files to modify:**
- `client/src/features/cashflow/components/IncomeBreakdown.tsx:81`
- `client/src/features/cashflow/components/ExpenseBreakdown.tsx:81`

**Change:**
```tsx
// Before
legends={[{
  // ...
  itemTextColor: "#999",
}]}

// After
legends={[{
  // ...
  itemTextColor: "hsl(var(--muted-foreground))",
}]}
```

### 4.2 Responsive Legend Positioning

**Issue:** Pie chart legends truncate on mobile

**Files to modify:**
- `client/src/features/cashflow/components/IncomeBreakdown.tsx`
- `client/src/features/cashflow/components/ExpenseBreakdown.tsx`

**Implementation (~20 LOC per file):**
```tsx
const { width } = useWindowSize();
const isMobile = width < 640;

// In chart config:
legends={isMobile ? [] : [{
  anchor: "right",
  direction: "column",
  // ... existing config
}]}

// Add mobile legend below chart
{isMobile && (
  <div className="flex flex-wrap gap-2 mt-4 justify-center">
    {data.slice(0, 5).map(item => (
      <div key={item.id} className="flex items-center gap-1 text-xs">
        <div
          className="w-3 h-3 rounded-full"
          style={{ backgroundColor: item.color }}
        />
        <span className="truncate max-w-[80px]">{item.label}</span>
      </div>
    ))}
  </div>
)}
```

### 4.3 Mobile Sankey Fallback

**Issue:** Sankey diagram is unreadable on small screens

**File:** `client/src/features/cashflow/components/CashFlowChart.tsx`

**Implementation (~30 LOC):**
```tsx
const { width } = useWindowSize();
const isMobileWidth = width < 768;

// Show warning and fallback on mobile
{chartType === "sankey" && isMobileWidth ? (
  <div className="space-y-4">
    <Alert>
      <Info className="h-4 w-4" />
      <AlertDescription>
        Sankey diagram works best on larger screens.
        <Button variant="link" onClick={() => setChartType("bar")}>
          Switch to bar chart
        </Button>
      </AlertDescription>
    </Alert>
    {/* Simplified mobile sankey or bar fallback */}
    <ResponsiveBar
      data={barChartData}
      // ... simplified config for mobile
    />
  </div>
) : (
  // Existing chart rendering
)}
```

### 4.4 @ts-ignore Replacement

**Issue:** `@ts-ignore` at `CashFlowChart.tsx:105`

**File:** `client/src/features/cashflow/components/CashFlowChart.tsx`

**Change:**
```tsx
// Before
// @ts-ignore
const handleBarClick = (bar: ComputedDatum<CashFlowBarData>) => { ... }

// After
import type { ComputedDatum } from "@nivo/bar";

// Nivo's ComputedDatum type requires explicit generic, but our data
// structure extends beyond their base type. This is a known Nivo typing
// limitation documented at: https://github.com/plouc/nivo/issues/2124
const handleBarClick = (bar: ComputedDatum<CashFlowBarData> & { data: { period: string } }) => {
  // ... implementation
};
```

### 4.5 Export Button Styling

**Issue:** Hardcoded color instead of Button variant

**File:** `client/src/pages/CashFlow.tsx`

**Change:**
```tsx
// Before
<Button style={{ backgroundColor: "#4CAF50" }}>Export</Button>

// After
<Button variant="outline">
  <Download className="mr-2 h-4 w-4" />
  Export
</Button>
```

---

## Part 5: Test Coverage Expansion (P1/P2)

### 5.1 Export Flow Test (P1)

**File:** `client/src/features/cashflow/__tests__/CashFlowExport.test.tsx` (NEW)

```typescript
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CashFlow } from "@/pages/CashFlow";
import { server } from "@/test/mocks/server";
import { rest } from "msw";

describe("CashFlow Export", () => {
  it("should create export with current filters", async () => {
    const user = userEvent.setup();
    let capturedBody: any;

    server.use(
      rest.post("/api/reports/exports", async (req, res, ctx) => {
        capturedBody = await req.json();
        return res(ctx.json({ id: "export-123" }));
      })
    );

    render(<CashFlow />);

    // Apply filters
    await user.click(screen.getByRole("button", { name: /filters/i }));
    await user.selectOptions(screen.getByLabelText(/interval/i), "week");
    await user.click(screen.getByRole("button", { name: /apply/i }));

    // Export
    await user.click(screen.getByRole("button", { name: /export/i }));

    await waitFor(() => {
      expect(capturedBody).toMatchObject({
        reportType: "cashflow",
        interval: "week",
      });
    });
  });

  it("should exclude forecast from export", async () => {
    // Test forecast exclusion
  });

  it("should show error toast on export failure", async () => {
    // Test error handling
  });
});
```

### 5.2 Filter Interaction Tests (P2)

**File:** `client/src/features/cashflow/__tests__/CashFlowFilters.test.tsx` (NEW)

```typescript
describe("CashFlowFilters", () => {
  it("should apply date range filter", async () => {});
  it("should toggle pending transactions", async () => {});
  it("should toggle transfer inclusion", async () => {});
  it("should reset to defaults", async () => {});
  it("should disable forecast for non-monthly intervals", async () => {});
});
```

### 5.3 Empty State Tests (P2)

**File:** `client/src/features/cashflow/__tests__/CashFlowEmptyStates.test.tsx` (NEW)

```typescript
describe("CashFlow Empty States", () => {
  it("should show empty state when no data", async () => {
    server.use(
      rest.get("/api/reports/cashflow", (req, res, ctx) => {
        return res(ctx.json({ series: [], totals: { income: { amount: "0", currency: "USD" } } }));
      })
    );

    render(<CashFlow />);

    await waitFor(() => {
      expect(screen.getByText(/no transactions/i)).toBeInTheDocument();
    });
  });

  it("should show empty state for individual components", async () => {});
});
```

### 5.4 Error Boundary Tests (P2)

**File:** `client/src/features/cashflow/__tests__/CashFlowErrorBoundary.test.tsx` (NEW)

```typescript
describe("CashFlow Error Handling", () => {
  it("should show error boundary on component crash", async () => {
    // Mock component that throws
    jest.spyOn(console, "error").mockImplementation(() => {});

    // Force error in chart component
    server.use(
      rest.get("/api/reports/cashflow", (req, res, ctx) => {
        return res(ctx.status(500), ctx.json({ error: "Server error" }));
      })
    );

    render(<CashFlow />);

    await waitFor(() => {
      expect(screen.getByText(/something went wrong/i)).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
    });
  });
});
```

### 5.5 Keyboard Navigation E2E Test (P2)

**File:** `client/src/features/cashflow/__tests__/CashFlowA11y.test.tsx` (NEW)

```typescript
describe("CashFlow Accessibility", () => {
  it("should navigate chart with keyboard", async () => {
    const user = userEvent.setup();
    render(<CashFlow />);

    // Tab to chart area
    await user.tab();
    await user.tab();

    // Use arrow keys
    await user.keyboard("{ArrowRight}");

    // Verify focus indicator or tooltip
  });

  it("should have no a11y violations", async () => {
    const { container } = render(<CashFlow />);
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});
```

---

## Part 6: File Change Summary

### New Files to Create

| File | LOC Est. | Purpose |
|------|----------|---------|
| `server/core/calculations/cashflow/forecast.ts` | 150 | Forecast calculation logic |
| `server/core/calculations/cashflow/budgetComparison.ts` | 120 | Budget comparison logic |
| `client/src/features/cashflow/components/BudgetComparison.tsx` | 200 | Budget vs actual UI |
| `client/src/features/cashflow/components/CurrencyWarning.tsx` | 50 | Mixed currency alert |
| `client/src/features/cashflow/__tests__/CashFlowExport.test.tsx` | 80 | Export flow tests |
| `client/src/features/cashflow/__tests__/CashFlowFilters.test.tsx` | 100 | Filter tests |
| `client/src/features/cashflow/__tests__/CashFlowEmptyStates.test.tsx` | 60 | Empty state tests |
| `client/src/features/cashflow/__tests__/CashFlowErrorBoundary.test.tsx` | 50 | Error boundary tests |

### Files to Modify

| File | Changes | LOC Delta |
|------|---------|-----------|
| `server/repositories/reports/CashflowReportRepository.ts` | Add forecast + budget methods | +180 |
| `server/modules/reports/reports.cashflow.controller.ts` | Add budget endpoint | +30 |
| `server/modules/reports/reports.routes.ts` | Add route | +5 |
| `server/modules/reports/reports.validation.ts` | Add schemas | +20 |
| `client/src/features/cashflow/types.ts` | Add filter fields | +10 |
| `client/src/features/cashflow/hooks/useCashFlowData.ts` | Add forecast handling | +30 |
| `client/src/features/cashflow/components/CashFlowFilters.tsx` | Add forecast toggle | +40 |
| `client/src/features/cashflow/components/CashFlowChart.tsx` | Forecast styling, mobile fallback, fix @ts-ignore | +60 |
| `client/src/features/cashflow/components/IncomeBreakdown.tsx` | Legend color fix, responsive | +20 |
| `client/src/features/cashflow/components/ExpenseBreakdown.tsx` | Legend color fix, responsive | +20 |
| `client/src/pages/CashFlow.tsx` | View toggle, currency warning, export fix | +50 |
| `client/src/hooks/use-reports.ts` | Add budget comparison hook | +25 |

---

## Implementation Order

### Phase 1 - Core Features (P1) - Week 1-2

1. **Day 1-2:** Forecast calculation module + repository method
2. **Day 3:** Forecast controller + validation updates
3. **Day 4-5:** Client forecast toggle + chart styling
4. **Day 6-7:** Budget comparison API (server)
5. **Day 8-9:** Budget comparison UI (client)
6. **Day 10:** Export flow test

### Phase 2 - Compliance (P2) - Week 3

1. **Day 1:** Multi-currency metadata in repository
2. **Day 2:** Currency warning component + integration

### Phase 3 - UX Polish (P2) - Week 3-4

1. **Day 1:** Legend color fixes (both files)
2. **Day 2:** Responsive legend positioning
3. **Day 3:** Mobile Sankey fallback
4. **Day 4:** @ts-ignore fix + export button styling

### Phase 4 - QA Expansion (P1/P2) - Week 4

1. **Day 1-2:** Filter interaction tests
2. **Day 3:** Empty state tests
3. **Day 4:** Error boundary tests
4. **Day 5:** Keyboard navigation e2e test

---

## Verification Plan

### Automated Tests

```bash
# After each phase
npm run check
npm run test:client:run -- client/src/features/cashflow/
npm run test:server:run -- server/modules/reports/
npm run test:server:run -- server/core/calculations/cashflow/
```

### Manual Testing Checklist

- [ ] Toggle forecast on/off across daily/weekly/monthly intervals
- [ ] Verify forecast excluded from exports
- [ ] Compare budget vs actual for multi-category budget
- [ ] Verify mixed-currency warning appears when applicable
- [ ] Check legends on 320px, 768px, 1024px widths
- [ ] Verify Sankey fallback on mobile
- [ ] Test dark mode for all new components
- [ ] Verify keyboard navigation through charts

---

## Risk Mitigation

| Risk | Mitigation |
|------|------------|
| Forecast assumptions misleading | Add disclaimer tooltip, allow horizon control |
| Budget period normalization errors | Unit test edge cases (partial months, leap years) |
| Mixed currency confusion | Clear warning badge + metadata in response |
| Mobile Sankey performance | Implement simplified fallback view |
| Breaking existing tests | Run full test suite after each file change |

---

## Dependencies

- Budget module must have correct period normalization (see `budget-module-overhaul-plan.md`)
- Recurring rules must be queryable by household for forecast baseline
- FX rates must be current for multi-currency aggregation

---

## Success Criteria

1. **Forecast Feature:**
   - Users can toggle forecast on/off
   - Forecast visually distinct from actuals
   - Forecast excluded from exports by default

2. **Budget Comparison:**
   - Users see variance per category
   - Over-budget categories highlighted
   - Summary shows total variance

3. **Multi-Currency:**
   - Response includes currency metadata
   - Warning shown when mixed currencies detected

4. **UX Polish:**
   - Charts respect dark mode
   - Legends readable on mobile
   - No @ts-ignore in production code

5. **Test Coverage:**
   - Export flow tested
   - Filter interactions tested
   - Empty states tested
   - Error boundaries tested
