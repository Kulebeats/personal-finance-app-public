# CompositeReportRepository Split - Technical Specification

> **Target:** Split CompositeReportRepository (943 LOC) into 3 focused repositories
> **Priority:** MEDIUM
> **Estimated Effort:** 4 hours
> **Risk Level:** LOW (internal refactor, no API changes)

---

## Executive Summary

Split the current `CompositeReportRepository.ts` (943 LOC, 7 methods) into three focused repositories following single-responsibility principle:

| New Repository | Methods | LOC | Responsibility |
|----------------|---------|-----|----------------|
| AnalyticsReportRepository | 3 | ~300 | Financial health metrics |
| ProjectionsReportRepository | 2 | ~260 | Forward-looking analytics |
| CompositeReportRepository | 2 | ~320 | Orchestration/aggregation |

---

## Current State Analysis

### File: `server/repositories/reports/CompositeReportRepository.ts`

**Size:** 943 LOC | **Methods:** 7

| Method | Lines | LOC | Current Responsibility |
|--------|-------|-----|------------------------|
| `getAnnualReport` | 64-288 | 225 | Aggregates cashflow, spending, net worth |
| `getFinancialRatios` | 289-433 | 145 | DTI, emergency fund, liquidity, burn rate |
| `getDebtAnalysis` | 434-516 | 83 | Debt breakdown by account |
| `getSankey` | 517-609 | 93 | Sankey diagram (uses external helpers) |
| `getGoalsProgress` | 610-682 | 73 | Goals tracking and projections |
| `getForecast` | 683-775 | 93 | Linear forecasting |
| `executeCustomChart` | 776-943 | 168 | Dynamic chart queries |

### Dependencies

```typescript
// Current imports
import { SpendingReportRepository } from "./SpendingReportRepository";
import { CashflowReportRepository } from "./CashflowReportRepository";
import { NetWorthReportRepository } from "./NetWorthReportRepository";
```

### External Helpers (Sankey)

Located at top of file or extracted:
- `buildIncomeToExpenseGroups()`
- `buildAccountToExpenseGroups()`
- `buildIncomeToCategories()`

---

## Target Architecture

### Directory Structure

```
server/repositories/reports/
├── index.ts                        # Facade exports
├── types.ts                        # Shared types
├── BaseReportRepository.ts         # 154 LOC (unchanged)
├── SpendingReportRepository.ts     # 462 LOC (unchanged)
├── CashflowReportRepository.ts     # 463 LOC (unchanged)
├── NetWorthReportRepository.ts     # 316 LOC (unchanged)
├── TransactionReportRepository.ts  # 317 LOC (unchanged)
│
├── AnalyticsReportRepository.ts    # ~300 LOC (NEW)
├── ProjectionsReportRepository.ts  # ~260 LOC (NEW)
├── CompositeReportRepository.ts    # ~320 LOC (REDUCED)
│
├── helpers/
│   └── sankeyBuilders.ts           # ~250 LOC (extract if not already)
│
└── __tests__/
    ├── analytics.test.ts           # NEW
    ├── projections.test.ts         # NEW
    └── composite.test.ts           # UPDATED
```

---

## Detailed Specifications

### 1. AnalyticsReportRepository

**Purpose:** Financial health metrics and current-state analysis

**File:** `server/repositories/reports/AnalyticsReportRepository.ts`

**Target LOC:** ~300

#### Methods

| Method | Source Lines | Description |
|--------|--------------|-------------|
| `getFinancialRatios` | 289-433 | DTI, emergency fund, liquidity, burn rate, savings rate |
| `getDebtAnalysis` | 434-516 | Debt breakdown by account type |
| `getGoalsProgress` | 610-682 | Goals tracking with progress calculations |

#### Interface

```typescript
// server/repositories/reports/AnalyticsReportRepository.ts

import { db } from "../../db";
import { sql, and, eq, isNull } from "drizzle-orm";
import { accounts, goals } from "@shared/schema";
import { BaseReportRepository } from "./BaseReportRepository";
import { CashflowReportRepository } from "./CashflowReportRepository";

/**
 * Analytics Report Repository
 *
 * Handles financial health metrics and current-state analysis:
 * - Financial ratios (DTI, emergency fund, liquidity, burn rate)
 * - Debt analysis by account
 * - Goals progress tracking
 *
 * @module repositories/reports/AnalyticsReportRepository
 */
export class AnalyticsReportRepository extends BaseReportRepository {
  constructor(
    private cashflow: CashflowReportRepository = new CashflowReportRepository()
  ) {
    super();
  }

  /**
   * Calculate financial health ratios
   *
   * Ratios calculated:
   * - DTI (Debt-to-Income): Monthly debt payments / Monthly income
   * - Emergency Fund: Liquid assets / Monthly expenses (in months)
   * - Liquidity Ratio: Liquid assets / Current liabilities
   * - Burn Rate: Liquid assets / Monthly expenses (runway in months)
   * - Savings Rate: Savings / Income (percentage)
   * - Net Savings Rate: (Income - Expenses) / Income
   *
   * @param householdId - Household ID
   * @param query - Query parameters (from, to, scope, userId)
   * @returns Financial ratios with status indicators
   */
  async getFinancialRatios(
    householdId: string,
    query: {
      from: string;
      to: string;
      scope?: "household" | "mine";
      userId?: string;
    }
  ): Promise<FinancialRatiosResponse> {
    // Implementation from lines 289-433
  }

  /**
   * Analyze debt by account
   *
   * Returns breakdown of debt accounts with:
   * - Account details (name, type, balance)
   * - Interest rates (if available)
   * - Payment information
   *
   * @param householdId - Household ID
   * @param query - Query parameters
   * @returns Debt analysis with account breakdown
   */
  async getDebtAnalysis(
    householdId: string,
    query: {
      from: string;
      to: string;
      scope?: "household" | "mine";
      userId?: string;
    }
  ): Promise<DebtAnalysisResponse> {
    // Implementation from lines 434-516
  }

  /**
   * Get goals progress
   *
   * Returns all active goals with:
   * - Current progress percentage
   * - Monthly contribution required to meet target
   * - On-track status
   *
   * @param householdId - Household ID
   * @param query - Query parameters
   * @returns Goals list with progress summary
   */
  async getGoalsProgress(
    householdId: string,
    query: {
      year?: number;
      scope?: "household" | "mine";
      userId?: string;
    }
  ): Promise<GoalsProgressResponse> {
    // Implementation from lines 610-682
  }
}

// Singleton export
export const analyticsReportRepository = new AnalyticsReportRepository();
```

#### Response Types

```typescript
// Add to server/repositories/reports/types.ts

export interface FinancialRatiosResponse {
  range: { from: string; to: string; baseCurrency: string };
  ratios: {
    dti: {
      value: number;
      monthlyDebt: number;
      monthlyIncome: number;
      status: "good" | "warning" | "bad";
    };
    emergencyFund: {
      value: number;
      months: number;
      monthlyExpenses: number;
      liquidAssets: number;
      status: "good" | "warning" | "bad";
    };
    liquidityRatio: {
      value: number;
      liquidAssets: number;
      currentLiabilities: number;
      status: "good" | "warning" | "bad";
    };
    burnRate: {
      value: number;
      months: number;
      liquidAssets: number;
      monthlyExpenses: number;
      status: "good" | "warning" | "bad";
    };
    savingsRate: {
      value: number;
      savings: number;
      income: number;
    };
    netSavingsRate: {
      value: number;
      netSavings: number;
      income: number;
    };
  };
}

export interface DebtAnalysisResponse {
  range: { from: string; to: string; baseCurrency: string };
  totalDebt: number;
  accounts: Array<{
    id: string;
    name: string;
    type: string;
    balance: number;
    interestRate?: number;
    minimumPayment?: number;
  }>;
  summary: {
    highInterestDebt: number;
    lowInterestDebt: number;
    averageInterestRate: number;
  };
}

export interface GoalsProgressResponse {
  goals: Array<{
    id: string;
    name: string;
    type: "save_up" | "pay_down" | "investment";
    targetAmount: number;
    currentAmount: number;
    progress: number;
    projectedCompletion: string | null;
    onTrack: boolean;
    monthlyRequired: number | null;
  }>;
  summary: {
    totalGoals: number;
    onTrackCount: number;
    behindCount: number;
    completedCount: number;
  };
}
```

---

### 2. ProjectionsReportRepository

**Purpose:** Forward-looking analytics and custom visualizations

**File:** `server/repositories/reports/ProjectionsReportRepository.ts`

**Target LOC:** ~260

#### Methods

| Method | Source Lines | Description |
|--------|--------------|-------------|
| `getForecast` | 683-775 | Linear forecasting with confidence intervals |
| `executeCustomChart` | 776-943 | Dynamic chart query execution |

#### Interface

```typescript
// server/repositories/reports/ProjectionsReportRepository.ts

import { db } from "../../db";
import { sql, and, eq, gte, lte, isNull } from "drizzle-orm";
import { transactions, accounts, categories, categoryGroups } from "@shared/schema";
import { BaseReportRepository } from "./BaseReportRepository";
import { CashflowReportRepository } from "./CashflowReportRepository";

/**
 * Projections Report Repository
 *
 * Handles forward-looking analytics and custom visualizations:
 * - Linear forecasting with confidence intervals
 * - Custom chart query execution
 *
 * @module repositories/reports/ProjectionsReportRepository
 */
export class ProjectionsReportRepository extends BaseReportRepository {
  constructor(
    private cashflow: CashflowReportRepository = new CashflowReportRepository()
  ) {
    super();
  }

  /**
   * Generate forecast projections
   *
   * Uses historical data to project future values with:
   * - Linear regression trend line
   * - Confidence intervals (default 95%)
   * - Seasonality detection (optional)
   *
   * Supported metrics:
   * - income: Monthly income projection
   * - expenses: Monthly expense projection
   * - savings: Monthly savings projection
   * - net_worth: Net worth projection
   *
   * @param householdId - Household ID
   * @param query - Forecast parameters
   * @returns Forecast data with projections and confidence bounds
   */
  async getForecast(
    householdId: string,
    query: {
      metric: "income" | "expenses" | "savings" | "net_worth";
      projectionMonths: number;
      baselineMonths?: number;
      confidenceLevel?: number;
      scope?: "household" | "mine";
      userId?: string;
    }
  ): Promise<ForecastResponse> {
    // Implementation from lines 683-775
  }

  /**
   * Execute custom chart query
   *
   * Flexible chart generation supporting:
   * - Multiple aggregation types (sum, avg, count, min, max)
   * - Various groupings (category, merchant, account, time)
   * - Custom filters
   * - Time-based intervals
   *
   * @param householdId - Household ID
   * @param query - Custom chart configuration
   * @returns Chart data in requested format
   */
  async executeCustomChart(
    householdId: string,
    query: {
      chartType: "bar" | "line" | "pie" | "area";
      metric: string;
      aggregation: "sum" | "avg" | "count" | "min" | "max";
      groupBy: "category" | "categoryGroup" | "merchant" | "account" | "month" | "week";
      from: string;
      to: string;
      filters?: {
        categoryIds?: string[];
        accountIds?: string[];
        merchantIds?: string[];
        type?: "income" | "expense";
      };
      scope?: "household" | "mine";
      userId?: string;
    }
  ): Promise<CustomChartResponse> {
    // Implementation from lines 776-943
  }
}

// Singleton export
export const projectionsReportRepository = new ProjectionsReportRepository();
```

#### Response Types

```typescript
// Add to server/repositories/reports/types.ts

export interface ForecastResponse {
  range: {
    historicalFrom: string;
    historicalTo: string;
    projectionFrom: string;
    projectionTo: string;
    baseCurrency: string;
  };
  metric: string;
  historical: Array<{
    date: string;
    value: number;
  }>;
  projection: Array<{
    date: string;
    value: number;
    lowerBound: number;
    upperBound: number;
  }>;
  trend: {
    direction: "up" | "down" | "flat";
    monthlyChange: number;
    percentageChange: number;
  };
  confidence: number;
}

export interface CustomChartResponse {
  range: { from: string; to: string; baseCurrency: string };
  chartType: string;
  metric: string;
  aggregation: string;
  groupBy: string;
  data: Array<{
    label: string;
    value: number;
    color?: string;
    entityType?: string;
    entityId?: string;
  }>;
  totals?: {
    sum: number;
    avg: number;
    count: number;
    min: number;
    max: number;
  };
}
```

---

### 3. CompositeReportRepository (Reduced)

**Purpose:** Orchestration and aggregation of other repositories

**File:** `server/repositories/reports/CompositeReportRepository.ts`

**Target LOC:** ~320

#### Methods

| Method | Source Lines | Description |
|--------|--------------|-------------|
| `getAnnualReport` | 64-288 | Aggregates multiple report types |
| `getSankey` | 517-609 | Sankey diagram (uses external helpers) |

#### Interface

```typescript
// server/repositories/reports/CompositeReportRepository.ts

import { BaseReportRepository } from "./BaseReportRepository";
import { SpendingReportRepository } from "./SpendingReportRepository";
import { CashflowReportRepository } from "./CashflowReportRepository";
import { NetWorthReportRepository } from "./NetWorthReportRepository";
import { AnalyticsReportRepository } from "./AnalyticsReportRepository";
import {
  buildIncomeToExpenseGroups,
  buildAccountToExpenseGroups,
  buildIncomeToCategories,
  type SankeyFilters,
} from "./helpers/sankeyBuilders";
import type { ReportsAnnualResponse, ReportsSankeyResponse } from "@shared/reports";
import type { ReportsAnnualQuery, ReportsSankeyQuery } from "../../validation/reports";
import type { QueryWithUser } from "./types";

/**
 * Composite Report Repository
 *
 * Orchestrates complex reports that aggregate data from multiple domains:
 * - Annual report (combines cashflow, spending, net worth, ratios)
 * - Sankey diagram (income flow visualization)
 *
 * Uses dependency injection for all sub-repositories.
 *
 * @module repositories/reports/CompositeReportRepository
 */
export class CompositeReportRepository extends BaseReportRepository {
  constructor(
    private spending: SpendingReportRepository = new SpendingReportRepository(),
    private cashflow: CashflowReportRepository = new CashflowReportRepository(),
    private netWorth: NetWorthReportRepository = new NetWorthReportRepository(),
    private analytics: AnalyticsReportRepository = new AnalyticsReportRepository()
  ) {
    super();
  }

  /**
   * Generate annual report
   *
   * Comprehensive yearly report aggregating:
   * - Monthly cashflow (income, expenses, savings)
   * - Spending breakdown by category
   * - Net worth changes
   * - Year-over-year comparison (optional)
   * - Financial health summary
   *
   * @param householdId - Household ID
   * @param query - Annual report parameters
   * @returns Complete annual financial summary
   */
  async getAnnualReport(
    householdId: string,
    query: QueryWithUser<ReportsAnnualQuery>
  ): Promise<ReportsAnnualResponse> {
    // Implementation from lines 64-288
    // Uses: this.cashflow, this.spending, this.netWorth
  }

  /**
   * Generate Sankey diagram data
   *
   * Visualizes money flow with nodes and links:
   * - income_to_expense_groups: Income sources → Category groups
   * - income_to_categories: Income sources → Categories
   * - account_to_expense_groups: Accounts → Category groups
   *
   * @param householdId - Household ID
   * @param query - Sankey diagram parameters
   * @returns Nodes and links for Sankey visualization
   */
  async getSankey(
    householdId: string,
    query: QueryWithUser<ReportsSankeyQuery>
  ): Promise<ReportsSankeyResponse> {
    // Implementation from lines 517-609
    // Uses: buildIncomeToExpenseGroups, buildAccountToExpenseGroups, buildIncomeToCategories
  }
}

// Singleton export
export const compositeReportRepository = new CompositeReportRepository();
```

---

### 4. Sankey Helpers (Extract if needed)

**Purpose:** Sankey diagram building utilities

**File:** `server/repositories/reports/helpers/sankeyBuilders.ts`

**Target LOC:** ~250

```typescript
// server/repositories/reports/helpers/sankeyBuilders.ts

import { db } from "../../../db";
import { sql, and, eq, gte, lte, isNull, or } from "drizzle-orm";
import { transactions, accounts, categories, categoryGroups, households } from "@shared/schema";
import { getLatestFxRates } from "../../../core/calculations";

export interface SankeyFilters {
  householdId: string;
  from: string;
  to: string;
  baseCurrency: string;
  scope: "household" | "mine";
  userId?: string;
  includePending: boolean;
  includeTransfers: boolean;
}

export interface SankeyNode {
  id: string;
  nodeColor?: string;
  entityType?: "categoryGroup" | "category" | "merchant" | "account" | "synthetic";
  entityId?: string;
}

export interface SankeyLink {
  source: string;
  target: string;
  value: number;
  meta?: { entityType: string; entityId: string };
}

export interface SankeyResult {
  nodes: SankeyNode[];
  links: SankeyLink[];
  totalIncome: number;
  totalExpenses: number;
}

/**
 * Build Sankey: Income → Category Groups
 */
export async function buildIncomeToExpenseGroups(
  filters: SankeyFilters,
  maxNodes: number,
  includeSavingsNode: boolean
): Promise<SankeyResult> {
  // Implementation
}

/**
 * Build Sankey: Accounts → Category Groups
 */
export async function buildAccountToExpenseGroups(
  filters: SankeyFilters,
  maxNodes: number
): Promise<SankeyResult> {
  // Implementation
}

/**
 * Build Sankey: Income → Categories
 */
export async function buildIncomeToCategories(
  filters: SankeyFilters,
  maxNodes: number
): Promise<SankeyResult> {
  // Implementation
}
```

---

## Updated Index File

```typescript
// server/repositories/reports/index.ts

/**
 * Report Repositories - Modular Exports
 *
 * ARCHITECTURE:
 * - BaseReportRepository: Shared utilities (currency, FX, filters)
 * - SpendingReportRepository: Spending analytics
 * - CashflowReportRepository: Cashflow, income, savings
 * - NetWorthReportRepository: Net worth tracking
 * - TransactionReportRepository: Transaction drilldown
 * - AnalyticsReportRepository: Financial health metrics
 * - ProjectionsReportRepository: Forecasting and custom charts
 * - CompositeReportRepository: Orchestration/aggregation
 *
 * @module repositories/reports
 */

// Backward compatible export
export { reportRepository, ReportRepository } from "../ReportRepository";

// Base infrastructure
export { BaseReportRepository } from "./BaseReportRepository";
export type { QueryWithUser, ReportContext, DateRangeFilter } from "./types";

// Domain repositories
export { SpendingReportRepository, spendingReportRepository } from "./SpendingReportRepository";
export { CashflowReportRepository, cashflowReportRepository } from "./CashflowReportRepository";
export { NetWorthReportRepository, netWorthReportRepository } from "./NetWorthReportRepository";
export { TransactionReportRepository, transactionReportRepository } from "./TransactionReportRepository";

// NEW: Split from CompositeReportRepository
export { AnalyticsReportRepository, analyticsReportRepository } from "./AnalyticsReportRepository";
export { ProjectionsReportRepository, projectionsReportRepository } from "./ProjectionsReportRepository";

// Orchestration
export { CompositeReportRepository, compositeReportRepository } from "./CompositeReportRepository";

// Sankey helpers
export {
  buildIncomeToExpenseGroups,
  buildAccountToExpenseGroups,
  buildIncomeToCategories,
  type SankeyFilters,
  type SankeyNode,
  type SankeyLink,
  type SankeyResult,
} from "./helpers/sankeyBuilders";
```

---

## Implementation Steps

### Step 1: Create AnalyticsReportRepository (~1 hour)

1. Create `AnalyticsReportRepository.ts`
2. Move `getFinancialRatios` (lines 289-433)
3. Move `getDebtAnalysis` (lines 434-516)
4. Move `getGoalsProgress` (lines 610-682)
5. Add response types to `types.ts`
6. Export from `index.ts`
7. Update CompositeReportRepository imports

### Step 2: Create ProjectionsReportRepository (~1 hour)

1. Create `ProjectionsReportRepository.ts`
2. Move `getForecast` (lines 683-775)
3. Move `executeCustomChart` (lines 776-943)
4. Add response types to `types.ts`
5. Export from `index.ts`
6. Update CompositeReportRepository imports

### Step 3: Extract Sankey Helpers (~30 min)

1. Create `helpers/sankeyBuilders.ts`
2. Extract Sankey builder functions
3. Add types for filters, nodes, links
4. Update CompositeReportRepository imports

### Step 4: Update CompositeReportRepository (~30 min)

1. Remove migrated methods
2. Add imports for new repositories
3. Update constructor with new dependencies
4. Verify remaining methods work

### Step 5: Update Backward Compatibility (~30 min)

1. Update `ReportRepository.ts` facade to delegate to new repositories
2. Ensure all existing imports continue to work
3. Update any route handlers if needed

### Step 6: Testing (~30 min)

1. Run existing tests: `npm run test:server:run`
2. Create new test files for each repository
3. Verify no regressions

---

## File Size Summary

### Before

| File | LOC |
|------|-----|
| CompositeReportRepository.ts | 943 |

### After

| File | LOC | Change |
|------|-----|--------|
| AnalyticsReportRepository.ts | ~300 | NEW |
| ProjectionsReportRepository.ts | ~260 | NEW |
| CompositeReportRepository.ts | ~320 | -623 |
| helpers/sankeyBuilders.ts | ~250 | NEW (if not already extracted) |

### Total Repository Structure

| Repository | LOC | Methods |
|------------|-----|---------|
| BaseReportRepository | 154 | 5 |
| SpendingReportRepository | 462 | 3 |
| CashflowReportRepository | 463 | 4 |
| NetWorthReportRepository | 316 | 2 |
| TransactionReportRepository | 317 | 1 |
| AnalyticsReportRepository | ~300 | 3 |
| ProjectionsReportRepository | ~260 | 2 |
| CompositeReportRepository | ~320 | 2 |
| **Total** | **~2,592** | **22** |

All files now under **500 LOC** with clear single responsibility.

---

## Verification Plan

### Automated Tests

```bash
# Run all report repository tests
npm run test:server:run -- server/repositories/__tests__/reportRepository.test.ts

# Run full server test suite
npm run test:server:run
```

### Manual Verification

1. Start dev server: `npm run dev`
2. Navigate to Reports page
3. Verify each feature:
   - [ ] Financial ratios display correctly
   - [ ] Debt analysis shows account breakdown
   - [ ] Goals progress updates
   - [ ] Forecast projections render
   - [ ] Custom charts work
   - [ ] Annual report generates
   - [ ] Sankey diagram displays

---

## Rollback Plan

If issues arise:

1. Revert to single CompositeReportRepository
2. All changes are internal - no API changes required
3. Facade pattern ensures backward compatibility

---

## Acceptance Criteria

- [ ] AnalyticsReportRepository created with 3 methods
- [ ] ProjectionsReportRepository created with 2 methods
- [ ] CompositeReportRepository reduced to 2 methods
- [ ] All files under 500 LOC
- [ ] All existing tests pass
- [ ] No breaking changes to API contracts
- [ ] Index exports updated
- [ ] Types documented in types.ts
