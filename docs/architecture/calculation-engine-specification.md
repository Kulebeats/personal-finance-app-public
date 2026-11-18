# Centralized Calculation Engine – Complete Requirements Specification

## Document Information

| Field             | Value                                                                                                                            |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Version           | 1.1                                                                                                                              |
| Created           | 2026-01-07                                                                                                                       |
| Last Updated      | 2026-01-07                                                                                                                       |
| Status            | Ready for Implementation                                                                                                         |
| Scope             | Server-side calculations for Reports, Goals, Budgets, Investments, Debt and FX                                                   |
| Related Documents | [annual-dashboard-requirements.md](../features/requirements/annual-dashboard-requirements.md), [dashboard-requirements.md](../features/requirements/dashboard-requirements.md) |

---

## 1. Executive Summary

The personal finance application currently performs financial calculations (e.g. savings rate, net worth, cash-flow, budget progress, goal projections, investment performance and FX conversions) in more than ten different files spread across multiple services. This scattering leads to duplicated logic, inconsistent number parsing and FX handling, and makes it difficult to audit or modify formulas. Moreover, industry research notes that siloed calculations across spreadsheets and point solutions limit understanding of the applied logic and hinder real-time analytics.

To address these issues, we will build a **Centralized Calculation Engine** that consolidates all financial formulas into a single module. The engine will follow international fintech standards for transparency, auditability and configurability by separating configuration (design), execution (run) and monitoring functions. It will expose pure functions for core formulas, centralize FX rate retrieval, provide configurable parameters with version control, support both real-time and batch calculations, and log every calculation's inputs, outputs and metadata for audit and analysis.

### 1.1 Key Decisions

| Decision                           | Choice                                                                                                        | Rationale                                                                    |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Use pure functions                 | All calculations implemented as pure TypeScript functions independent of data access                          | Facilitates unit testing, reusability and deterministic outputs              |
| Centralize FX rates                | Single fxRates module for latest rates and conversion logic                                                   | Eliminates five duplicate implementations and allows caching                 |
| Consistent number parsing          | Implement `toSafeNumber()` and `roundToDecimals()` helpers                                                    | Prevents inconsistent parsing across services                                |
| Design/Run/Monitor separation      | Create separate modules for parameter configuration, execution and logging                                    | Aligns with fintech best practices and supports auditing and version control |
| Parameter versioning and approval  | Parameters stored with effective dates, with a four-eyes approval process                                     | Ensures that formula changes are controlled and auditable                    |
| Support batch and simulation modes | Run module can execute calculations synchronously or asynchronously for simulations                           | Enables forecasting and stress testing                                       |
| Audit logging                      | Every calculation records input parameters, output values, formula version, execution time and context        | Provides traceability and performance metrics                                |
| Regulatory compliance              | Document business definitions aligned with GAAP/IFRS and local tax laws                                       | Supports audits and ensures consistent interpretation of metrics             |
| Branded types                      | Use TypeScript branded types for Money, Percentage, Ratio                                                     | Prevents unit confusion and improves type safety                             |
| Property-based testing             | Use fast-check for comprehensive formula testing                                                              | Catches edge cases that example-based tests miss                             |
| Shadow mode migration              | Run legacy and new calculations in parallel during transition                                                 | Validates correctness before full cutover                                    |
| Savings metrics definitions        | Track both Savings Contributions (category/account-based) and Net Savings (income - expenses - debt payments) | Aligns reporting with Annual Dashboard v1.1                                  |
| Transaction classification rules   | Transfers excluded; credit-card payments treated as debt payments; interest/fees stay as expenses             | Keeps cash flow totals consistent                                            |
| Reporting calendar defaults        | Default timezone Africa/Lusaka; fiscal year Jan 1 - Dec 31; ISO weeks for weekly aggregation                  | Matches reporting requirements                                               |
| Scope enforcement                  | Default scope mine; household scope requires owner/admin                                                      | Protects household data access                                               |

---

## 2. Objectives

### 2.1 Primary Objectives

1. **Single Source of Truth** – Consolidate all financial calculation formulas into a shared engine to remove duplication and inconsistency.

2. **Configurability and Transparency** – Expose parameters (e.g. rounding rules, thresholds, growth assumptions) in a design module with version control and approval workflows.

3. **Auditability and Monitoring** – Record input variables, outputs, parameter versions and execution metadata for every calculation, enabling audit trails and performance dashboards.

4. **Scalability and Performance** – Support both real-time individual requests and batch simulations with caching (e.g. FX rates) and concurrency control.

5. **Compliance** – Document business definitions using GAAP/IFRS consistent formulas and support tax and regulatory reporting requirements.

6. **Maintainability** – Decouple data access from calculations, use strict TypeScript types and unit tests to ensure reliability.

### 2.2 Success Metrics

| Metric                                                      | Target                            |
| ----------------------------------------------------------- | --------------------------------- |
| Test coverage of calculation functions                      | > 90%                             |
| Time to execute typical calculation (synchronous)           | < 20 ms                           |
| Time to execute batch simulation (e.g. 10,000 calculations) | < 1 s                             |
| FX rate consistency (identical results across services)     | 100%                              |
| Parameter change approval cycle time                        | < 1 day                           |
| Audit log completeness                                      | 100% of calculations logged       |
| Mean time to detect calculation errors                      | < 10 min via monitoring dashboard |
| Shadow mode validation pass rate                            | 100% match before migration       |

---

## 3. Current State Analysis

### 3.1 Problem: Calculations Are Scattered Across Many Locations

The following files contain calculation logic and data access intertwined:

| File                              | Calculations Performed                                | Approx. Lines |
| --------------------------------- | ----------------------------------------------------- | ------------- |
| `ReportRepository.ts`             | Savings rate, net worth, cash-flow, FX conversion     | 1,873         |
| `GoalService.ts`                  | Goal progress, projections, FX rates                  | 1,190         |
| `goalCalculations.ts`             | Goal status, percent complete, monthly projection     | 164           |
| `BudgetService.ts`                | Budget progress, alerts, averages                     | 692           |
| `PortfolioValuationService.ts`    | Holding metrics, investment value, FX rates           | 292           |
| `InvestmentPerformanceService.ts` | Time-weighted return (TWR)                            | 173           |
| `FXAttributionService.ts`         | Asset/FX return attribution                           | 211           |
| `DebtPayoffCalculator.ts`         | Debt payoff, snowball/avalanche amortization          | 247           |
| `GoalAccountAssignmentService.ts` | Account balance aggregation, FX rates                 | ~900          |
| `RecurringService.ts`             | Bill projections, pattern detection, recurring totals | 1,049         |
| `snapshotWorker.ts`               | Daily net worth snapshots, balance calculations       | ~200          |

### 3.2 Identified Duplications and Inconsistencies

1. **Multiple FX rate functions** – Five separate implementations of `getLatestFxRates()` exist across services.

2. **Savings rate formula duplication** – The same formula appears in three places; modifications risk drift.

3. **Inconsistent amount parsing** – Different files parse amounts using:

   - `parseFloat(String(value))`
   - `parseFloat(value ?? "0")`
   - `Number(row.total)`
   - Custom ternary checks

   This can lead to `NaN` or unexpected behaviour.

4. **Mixed data access and logic** – Many functions query the database, process rows, calculate metrics and return formatted results in one routine, making them hard to test or reuse.

These duplications increase the chance of inconsistent results, hinder modifications and make it difficult to apply broad changes (e.g. rounding rules).

### 3.3 Detailed Code Structure Observations

Our deep dive into the backend codebase (branch `feature/analytics-architecture`) revealed additional structural patterns and issues:

**Repository/Service pattern with embedded logic:**

- `ReportRepository.ts` exposes methods like `getSpendingBreakdown`, `getCashflow`, `getNetWorth`, `getIncome`, `getSavingsRate`, `getSankey` and `getTransactions`. Each method performs a Drizzle ORM query and then immediately computes derived values (e.g. summing income/expense, deriving savings rate, converting currencies) before returning the result. The file spans ~1,800 lines and mixes SQL with arithmetic, caching and CSV export logic.

- `GoalService.ts` implements CRUD and progress tracking for goals. It calls helper functions from `goalCalculations.ts` but still contains its own percent-complete, projection and status calculations. The service also handles notifications and activity logs, resulting in ~1,200 lines of mixed business logic and side effects.

- `goalCalculations.ts` provides pure functions (`getGoalTargetAmount`, `calculatePercentComplete`, `calculateMonthlyProjection`, etc.), but their logic is sometimes replicated or re-implemented in `GoalService.ts`, leading to drift.

- `BudgetService.ts` computes budget progress, threshold alerts and forecasting within the same class that handles database queries and updates (~700 lines).

- `PortfolioValuationService.ts`, `InvestmentPerformanceService.ts`, `FXAttributionService.ts`, `DebtPayoffCalculator.ts` and `GoalAccountAssignmentService.ts` each define their own financial calculations (holding metrics, TWR, FX attribution, amortisation schedules, goal balance aggregation). These services also contain local helper functions for FX rate lookup and number parsing.

**Function duplication:**

- `getLatestFxRates`: implemented at least five times across `ReportRepository.ts`, `PortfolioValuationService.ts`, `GoalService.ts`, `GoalAccountAssignmentService.ts` and an inline helper in the investments route. Each version selects the latest `fxRates` rows and builds a Map, but they differ slightly in error handling and optimisation.

- Savings rate formula: computed as `savingsRate = income > 0 ? (savings / income) * 100 : 0` in several places (three occurrences in `ReportRepository.ts` and at least one in `GoalService.ts`). Any change to rounding or negative-income handling must be replicated manually.

**Inconsistent amount parsing and rounding:**

Services parse numeric fields using different patterns: `parseFloat(String(value))`, `parseFloat(value ?? "0")`, `Number(row.total)`, or ternary checks on the type. Rounding rules are sometimes embedded inline and sometimes omitted. This inconsistency can produce `NaN`, truncated decimals or subtle rounding discrepancies.

**Mix of data access, computation and side effects:**

Many methods both query the database and perform calculations, then trigger notifications or updates. For example, `GoalAccountAssignmentService` recalculates goal balances, updates the goal row, logs activity and sends notifications, all within the same function. This coupling makes it hard to unit-test calculations in isolation or reuse them in other contexts.

**Large, monolithic files:**

Several services exceed 1,000 lines. For instance, `GoalService.ts` (~1,200 lines) and `GoalAccountAssignmentService.ts` (~900 lines) handle many responsibilities. Such size hampers readability and increases the likelihood of subtle bugs.

### 3.4 Benchmarking Industry Leaders and Best Practices

We benchmarked the app against leading personal finance platforms – Monarch Money, Mint, and Revolut – and gathered insights from user-experience research and fintech studies:

| Feature               | Industry Practice                                  | Our Implementation                            |
| --------------------- | -------------------------------------------------- | --------------------------------------------- |
| Instant budgeting     | Auto-categorize and show real-time budget vs spend | Compute budgets and forecasts in real time    |
| Categorization        | ML/rule-based with user feedback loop              | Implement categorization module with learning |
| Net worth calculation | Assets - Liabilities (GAAP/IFRS compliant)         | Enforce accounting identities in engine       |
| Multi-currency        | Consolidated views with automatic FX conversion    | Central FX service with daily rates           |
| User insights         | Proactive recommendations, not just dashboards     | Support insight generation and alerts         |
| Collaboration         | Shared household views, proper data segregation    | Multiple user profiles, shared budgets/goals  |
| Security              | Bank-grade security, no-data-selling policy        | Encryption, MFA, clear privacy policies       |

---

## 4. Core Principles & Fintech Standards

The centralized engine will adhere to the following principles:

### 4.1 Pure Functions

Each calculation is a pure function that depends only on its inputs and returns a deterministic result. It performs no database queries or side effects. Data access remains in repository/services layers.

```typescript
// Example: Pure savings rate calculation
export function calculateSavingsRate(
  income: Money,
  savingsContributions: Money
): Percentage {
  if (income <= 0) return toPercentage(0);
  return toPercentage((savingsContributions / income) * 100);
}
```

### 4.2 Branded Types for Type Safety

Use TypeScript branded types to prevent unit confusion:

```typescript
// types.ts
declare const MoneyBrand: unique symbol;
declare const PercentageBrand: unique symbol;
declare const RatioBrand: unique symbol;

export type Money = number & { readonly [MoneyBrand]: void };
export type Percentage = number & { readonly [PercentageBrand]: void };
export type Ratio = number & { readonly [RatioBrand]: void };

// Constructors with validation
export function toMoney(value: number): Money {
  if (!Number.isFinite(value))
    throw new CalculationError("INVALID_MONEY", value);
  return value as Money;
}

export function toPercentage(value: number): Percentage {
  if (!Number.isFinite(value))
    throw new CalculationError("INVALID_PERCENTAGE", value);
  return value as Percentage;
}

export function toRatio(value: number): Ratio {
  if (!Number.isFinite(value))
    throw new CalculationError("INVALID_RATIO", value);
  return value as Ratio;
}
```

### 4.3 Consistent Parsing

Introduce helper functions `toSafeNumber()` and `roundToDecimals()` to convert any input to a safe number and apply standardized rounding:

```typescript
// helpers.ts
export function toSafeNumber(value: unknown, fallback = 0): number {
  if (value === null || value === undefined) return fallback;
  const num = typeof value === "string" ? parseFloat(value) : Number(value);
  return Number.isFinite(num) ? num : fallback;
}

export function roundToDecimals(value: number, decimals: number = 2): number {
  const factor = Math.pow(10, decimals);
  return Math.round(value * factor) / factor;
}
```

### 4.4 Decimal.js for Financial Precision

For calculations requiring exact decimal arithmetic (especially FX and investment calculations), use Decimal.js:

```typescript
import Decimal from "decimal.js";

export function preciseMultiply(a: number, b: number): number {
  return new Decimal(a).times(b).toNumber();
}

export function preciseDivide(a: number, b: number): number {
  if (b === 0) throw new CalculationError("DIVISION_BY_ZERO");
  return new Decimal(a).dividedBy(b).toNumber();
}
```

### 4.5 Single FX Rate Service

Provide a shared `fxRates.ts` that retrieves latest FX rates from the database or external service and caches them. All conversions use the same rates, avoiding discrepancies.

### 4.6 Documented Business Definitions

Each calculation function includes JSDoc with clear formulas, rounding rules, edge-case behaviour and references to accounting standards:

```typescript
/**
 * Calculates the savings rate as a percentage of income.
 *
 * @formula savingsRate = (savingsContributions / income) * 100
 * @rounding 2 decimal places
 * @edge-cases
 *   - If income <= 0, returns 0%
 *   - If expenses > income, returns negative percentage
 * @compliance GAAP - consistent with personal finance reporting standards
 *
 * @param income - Total income in base currency
 * @param savingsContributions - Transfers into savings/investment accounts or tagged savings
 * @returns Savings rate as percentage (0-100+)
 */
export function calculateSavingsRate(
  income: Money,
  savingsContributions: Money
): Percentage {
  // ...
}
```

### 4.7 Design/Run/Monitor Separation

Following fintech best practices:

**Design module:** Stores configuration parameters (e.g. growth assumptions, thresholds, rounding rules) with versioning, effective dates, and approvals (four-eyes principle). Provides a cockpit for business owners to manage parameters.

**Run module:** Executes pure calculation functions using inputs and parameter values. Supports both synchronous calls (single calculations) and asynchronous batch executions (simulations, projections).

**Monitor module:** Records every execution's input variables, parameter versions, outputs, execution mode (simulation vs operational) and performance metrics. Exposes logs and statistics via monitoring dashboards.

### 4.8 Error Handling Strategy

Standardized error types with codes for consistent handling:

```typescript
// errors.ts
export type CalculationErrorCode =
  | "INVALID_INPUT"
  | "DIVISION_BY_ZERO"
  | "MISSING_FX_RATE"
  | "INVALID_DATE_RANGE"
  | "INSUFFICIENT_DATA"
  | "PARAMETER_NOT_FOUND"
  | "INVALID_MONEY"
  | "INVALID_PERCENTAGE"
  | "INVALID_RATIO";

export class CalculationError extends Error {
  constructor(
    public readonly code: CalculationErrorCode,
    public readonly context?: unknown,
    message?: string
  ) {
    super(message ?? `Calculation error: ${code}`);
    this.name = "CalculationError";
  }
}
```

## 5. Proposed Architecture

### 5.1 Directory Structure

```
server/core/calculations/
├── index.ts                    # Export all modules
├── types.ts                    # Money, Percentage, Ratio branded types
├── errors.ts                   # CalculationError, error codes
├── helpers.ts                  # toSafeNumber, roundToDecimals, Decimal.js wrappers
├── engine.ts                   # createCalculationEngine() factory
│
├── currency/
│   ├── fxRates.ts              # Single FX rate service (consolidate 5 implementations)
│   ├── conversion.ts           # convertToDisplayCurrency()
│   └── fallback.ts             # Historical rate fallback chain
│
├── cashflow/
│   ├── savingsRate.ts          # (savingsContributions / income) * 100
│   ├── netSavings.ts           # income - expenses - debtPayments
│   ├── netSavingsRate.ts       # (income - expenses - debt) / income * 100
│   ├── incomeAllocation.ts     # 100% stacked: expenses/savings/debt
│   └── netWorth.ts             # assets - liabilities
│
├── budget/
│   ├── progress.ts             # spent / budgeted * 100
│   ├── alerts.ts               # threshold detection (80%, 100%)
│   ├── rollover.ts             # carry forward logic
│   └── forecasting.ts          # project based on trend
│
├── goals/
│   ├── progress.ts             # percentComplete, progressAmount
│   ├── status.ts               # on_track, behind, at_risk, completed
│   ├── projections.ts          # monthlyProjection, completionDate
│   └── annualTargets.ts        # income/savings/debt annual goals
│
├── investments/
│   ├── twr.ts                  # Time-weighted return
│   ├── valuation.ts            # Holdings value
│   ├── costBasis.ts            # FIFO, average cost
│   ├── gainLoss.ts             # currentValue - costBasis
│   ├── fxAttribution.ts        # Asset vs FX return
│   └── taxSummary.ts           # Dividends, interest, WHT
│
├── debt/
│   ├── payoff.ts               # Snowball, avalanche, amortization
│   ├── dti.ts                  # Debt-to-Income ratio
│   └── interestCalc.ts         # balance * (apr/12/100)
│
├── ratios/
│   ├── dti.ts                  # debtPayments / income
│   ├── emergencyFund.ts        # liquidSavings / monthlyExpenses
│   ├── liquidity.ts            # liquidAssets / shortTermLiabilities
│   ├── burnRate.ts             # liquidSavings / monthlyDeficit
│   └── savingsRate.ts          # Re-export from cashflow
│
├── recurring/
│   ├── projections.ts          # Next due date, annual totals
│   ├── patternDetection.ts     # Frequency detection
│   └── billTotals.ts           # Monthly/annual sums
│
├── projections/
│   ├── linearForecast.ts       # Simple linear regression
│   ├── confidenceInterval.ts   # 95% CI calculation
│   └── scenarioAnalysis.ts     # What-if simulations
│
├── classification/
│   └── expenseType.ts          # Fixed vs Variable auto-detection
│
├── dates/
│   ├── ranges.ts               # Month, year, quarter ranges
│   ├── periods.ts              # Period aggregation
│   └── timezone.ts             # Timezone-aware calculations
│
├── design/
│   └── parameters.ts           # Configurable thresholds, rounding rules
│
├── monitor/
│   └── logger.ts               # Execution logging for audit
│
└── __tests__/
    ├── savingsRate.test.ts
    ├── fxRates.test.ts
    ├── goalProgress.test.ts
    ├── twr.test.ts
    ├── properties/             # Property-based tests
    │   ├── cashflow.property.test.ts
    │   ├── ratios.property.test.ts
    │   └── investments.property.test.ts
    └── ...
```

### 5.2 Module Descriptions

#### 5.2.1 Design Module

The design module provides a secure interface for business owners to configure formula parameters (e.g. rounding decimals, debt repayment ordering, growth rates). It stores each parameter set with a unique version, an effective date and metadata (creator, approver, timestamps). Only authorised users can create or edit parameter sets; changes require approval by a second user (four-eyes principle). The module supports drafts, scheduled activation dates and A/B testing scenarios. Parameter values are loaded by the run module based on their effective date. Parameter sets also carry reporting calendar defaults (timezone, fiscal year start, ISO week rules) consumed by date utilities and aggregation.

**Parameter Configuration:**

```typescript
// design/parameters.ts
export interface CalculationParameters {
  version: string;
  effectiveDate: string;

  rounding: {
    money: number; // Default: 2
    percentage: number; // Default: 2
    ratio: number; // Default: 4
  };

  thresholds: {
    dti: { good: number; warning: number }; // 0.20, 0.36
    emergencyFund: { good: number; warning: number }; // 6, 3 months
    liquidity: { good: number; warning: number }; // 2.0, 1.0
    burnRate: { good: number; warning: number }; // 12, 6 months
    savingsRate: { good: number; warning: number }; // 0.20, 0.10
    budgetWarning: number; // 0.80
    budgetAlert: number; // 1.00
  };

  goals: {
    onTrackThreshold: number; // 0.90 (90% of expected)
    atRiskThreshold: number; // 0.70 (70% of expected)
  };

  forecasting: {
    defaultProjectionMonths: number; // 6
    confidenceLevel: number; // 0.95
    minDataPoints: number; // 3
  };

  calendar: {
    defaultTimezone: string; // Africa/Lusaka
    fiscalYearStartMonth: number; // 1 (Jan)
    useIsoWeeks: boolean; // true
  };

  fx: {
    cacheTtlSeconds: number; // 3600 (1 hour)
    fallbackDays: number; // 30 (days to look back)
    triangulationBaseCurrency: string; // USD
  };
}

export const DEFAULT_PARAMETERS: CalculationParameters = {
  version: "1.0.0",
  effectiveDate: "2026-01-01",
  rounding: { money: 2, percentage: 2, ratio: 4 },
  thresholds: {
    dti: { good: 0.2, warning: 0.36 },
    emergencyFund: { good: 6, warning: 3 },
    liquidity: { good: 2.0, warning: 1.0 },
    burnRate: { good: 12, warning: 6 },
    savingsRate: { good: 0.2, warning: 0.1 },
    budgetWarning: 0.8,
    budgetAlert: 1.0,
  },
  goals: { onTrackThreshold: 0.9, atRiskThreshold: 0.7 },
  forecasting: {
    defaultProjectionMonths: 6,
    confidenceLevel: 0.95,
    minDataPoints: 3,
  },
  calendar: {
    defaultTimezone: "Africa/Lusaka",
    fiscalYearStartMonth: 1,
    useIsoWeeks: true,
  },
  fx: { cacheTtlSeconds: 3600, fallbackDays: 30, triangulationBaseCurrency: "USD" },
};
```

**Concurrency & Versioning:**

Use optimistic locking when persisting parameter sets or derived aggregates. Persist a `row_version` integer and require updates to include the last-seen version.

```typescript
export interface CalculationContext {
  userId: string;
  householdId: string;
  requestId: string; // Trace ID for logging and cache routing
  dataVersion?: number; // Optimistic locking for derived data
  parameterVersion?: string;
}
```

#### 5.2.2 Run Module

The run module contains pure calculation functions organised by domain (cash-flow, budget, goals, investments, debt). Each function accepts primitive inputs (numbers, strings, enums) and parameter values (injected from the design module) and returns a deterministic result. The run module does not perform database queries; it is agnostic to the data source.

For synchronous calls (e.g. computing savings rate for a report), service layers call the appropriate functions and pass them data. For batch or simulation runs (e.g. forecasting next year's net worth across many scenarios), a job orchestrator feeds datasets to the run module asynchronously.

**Engine Factory:**

```typescript
// engine.ts
export interface CalculationEngine {
  // Cash flow
  savingsRate(income: Money, savingsContributions: Money): Percentage;
  netSavings(income: Money, expenses: Money, debtPayments: Money): Money;
  netSavingsRate(
    income: Money,
    expenses: Money,
    debtPayments: Money
  ): Percentage;
  netWorth(assets: Money, liabilities: Money): Money;
  incomeAllocation(
    income: Money,
    expenses: Money,
    savings: Money,
    debt: Money
  ): IncomeAllocation;

  // Budgets
  budgetProgress(spent: Money, budgeted: Money): BudgetProgress;
  budgetStatus(percentUsed: Percentage): BudgetStatus;

  // Goals
  goalProgress(current: Money, target: Money): GoalProgress;
  goalStatus(progress: GoalProgress, expectedProgress: Percentage): GoalStatus;
  goalProjection(
    current: Money,
    monthlyContribution: Money,
    target: Money
  ): GoalProjection;

  // Investments
  timeWeightedReturn(periods: TWRPeriod[]): Percentage;
  holdingGainLoss(currentValue: Money, costBasis: Money): GainLoss;

  // Debt
  debtToIncome(monthlyDebtPayments: Money, monthlyIncome: Money): Ratio;
  debtPayoffSchedule(debts: Debt[], strategy: PayoffStrategy): PayoffSchedule;

  // Ratios
  emergencyFundCoverage(liquidSavings: Money, monthlyExpenses: Money): number;
  liquidityRatio(liquidAssets: Money, shortTermLiabilities: Money): Ratio;
  burnRate(liquidSavings: Money, monthlyDeficit: Money): number;

  // FX
  convertCurrency(
    amount: Money,
    from: string,
    to: string,
    date?: string
  ): Promise<Money>;

  // Forecasting
  linearForecast(data: DataPoint[], projectionMonths: number): Forecast;

  // Batch (internal jobs only in v1)
  batch<T, R>(
    request: BatchCalculationRequest<T, R>
  ): Promise<BatchCalculationResult<R>>;
}

export interface BatchCalculationRequest<T, R> {
  functionName: Exclude<keyof CalculationEngine, "batch">;
  items: T[];
  options?: {
    parallelism?: number; // Default: CPU cores
    chunkSize?: number; // Default: 100
    continueOnError?: boolean; // Default: false
  };
}

export interface BatchCalculationResult<R> {
  results: Array<{ index: number; result?: R; error?: CalculationError }>;
  summary: {
    total: number;
    successful: number;
    failed: number;
    executionTimeMs: number;
  };
}

export function createCalculationEngine(
  params: CalculationParameters = DEFAULT_PARAMETERS,
  fxService: FXRateService,
  logger?: CalculationLogger
): CalculationEngine {
  return {
    savingsRate: (income, savingsContributions) => {
      const result = calculateSavingsRate(income, savingsContributions);
      logger?.log("savingsRate", { income, savingsContributions }, result);
      return result;
    },
    // ... other methods
  };
}
```

Batch execution is intended for internal jobs (e.g., nightly recalculation, simulations) in v1 and is not exposed as a public API.

#### 5.2.3 Monitor Module

The monitor module captures metadata for each calculation execution: inputs, outputs, parameter version, execution context (simulation vs operational), timestamps, requesting user/channel and execution duration. These logs are stored in a separate database table to support audit trails, error diagnostics, and performance monitoring dashboards.

**Logging Interface:**

```typescript
// monitor/logger.ts
export interface CalculationLog {
  id: string;
  timestamp: string;
  functionName: string;
  inputs: Record<string, unknown>;
  output: unknown;
  parameterVersion: string;
  executionMode: "operational" | "simulation" | "shadow";
  executionTimeMs: number;
  userId?: string;
  householdId?: string;
  channel?: string;
  error?: {
    code: string;
    message: string;
  };
}

export interface CalculationLogger {
  log(
    functionName: string,
    inputs: Record<string, unknown>,
    output: unknown
  ): void;
  logError(
    functionName: string,
    inputs: Record<string, unknown>,
    error: CalculationError
  ): void;
}

export function createCalculationLogger(
  store: CalculationLogStore,
  context: LogContext
): CalculationLogger {
  return {
    log(functionName, inputs, output) {
      const start = performance.now();
      store.insert({
        id: generateId(),
        timestamp: new Date().toISOString(),
        functionName,
        inputs,
        output,
        parameterVersion: context.parameterVersion,
        executionMode: context.mode,
        executionTimeMs: performance.now() - start,
        userId: context.userId,
        householdId: context.householdId,
        channel: context.channel,
      });
    },
    // ...
  };
}
```

---

## 6. Calculation Specifications

### 6.1 Cash Flow Calculations

#### 6.1.0 Transaction Classification and Metric Definitions

Cash flow metrics depend on consistent transaction classification (aligned with Annual Dashboard v1.1):

- Transfers: movements between owned accounts are excluded from income and expenses.
- Savings Contributions: transfers into savings/investment accounts or transactions tagged as savings/investments.
- Debt Payments: payments to liability accounts (credit/loan/mortgage) are tracked as debt payments, not expenses.
- Credit-Card Treatment: credit-card payments are debt payments; interest and fees are expenses.
- Net Savings: income - expenses - debt payments (excludes transfers).

These rules are applied before aggregation so income, expenses, savings contributions, debt payments, and net savings share the same basis.

#### 6.1.1 Savings Rate

```typescript
/**
 * Calculates savings rate (Savings Contributions method).
 *
 * @formula savingsRate = (savingsContributions / income) * 100
 * @rounding 2 decimal places
 * @edge-cases
 *   - income <= 0: returns 0%
 *   - savingsContributions < 0: returns negative %
 */
export function calculateSavingsRate(
  income: Money,
  savingsContributions: Money
): Percentage {
  if (income <= 0) return toPercentage(0);
  return toPercentage(
    roundToDecimals((savingsContributions / income) * 100, 2)
  );
}
```

#### 6.1.2 Net Savings

```typescript
/**
 * Calculates net savings (after expenses and debt).
 *
 * @formula netSavings = income - expenses - debtPayments
 * @note excludes transfers between owned accounts
 */
export function calculateNetSavings(
  income: Money,
  expenses: Money,
  debtPayments: Money
): Money {
  return toMoney(income - expenses - debtPayments);
}
```

#### 6.1.3 Net Savings Rate

```typescript
/**
 * Calculates net savings rate (after expenses and debt, excludes transfers).
 *
 * @formula netSavingsRate = ((income - expenses - debtPayments) / income) * 100
 * @rounding 2 decimal places
 * @edge-cases
 *   - income <= 0: returns 0%
 *   - Can be negative if expenses + debt > income
 */
export function calculateNetSavingsRate(
  income: Money,
  expenses: Money,
  debtPayments: Money
): Percentage {
  if (income <= 0) return toPercentage(0);
  const netSavings = income - expenses - debtPayments;
  return toPercentage(roundToDecimals((netSavings / income) * 100, 2));
}
```

#### 6.1.4 Net Worth

```typescript
/**
 * Calculates net worth.
 *
 * @formula netWorth = totalAssets - totalLiabilities
 * @compliance GAAP/IFRS balance sheet identity
 * @edge-cases
 *   - Can be negative (liabilities > assets)
 */
export function calculateNetWorth(assets: Money, liabilities: Money): Money {
  return toMoney(assets - liabilities);
}
```

#### 6.1.5 Income Allocation

```typescript
/**
 * Calculates how income is allocated between expenses, savings, and debt.
 *
 * @formula Each category as percentage of income
 * @returns Object with amounts and percentages for each category
 */
export interface IncomeAllocation {
  expenses: { amount: Money; percent: Percentage };
  savings: { amount: Money; percent: Percentage };
  debt: { amount: Money; percent: Percentage };
  unallocated: { amount: Money; percent: Percentage };
}

export function calculateIncomeAllocation(
  income: Money,
  expenses: Money,
  savings: Money,
  debt: Money
): IncomeAllocation {
  if (income <= 0) {
    return {
      expenses: { amount: toMoney(expenses), percent: toPercentage(0) },
      savings: { amount: toMoney(savings), percent: toPercentage(0) },
      debt: { amount: toMoney(debt), percent: toPercentage(0) },
      unallocated: { amount: toMoney(0), percent: toPercentage(0) },
    };
  }

  const unallocated = income - expenses - savings - debt;

  return {
    expenses: {
      amount: toMoney(expenses),
      percent: toPercentage(roundToDecimals((expenses / income) * 100, 2)),
    },
    savings: {
      amount: toMoney(savings),
      percent: toPercentage(roundToDecimals((savings / income) * 100, 2)),
    },
    debt: {
      amount: toMoney(debt),
      percent: toPercentage(roundToDecimals((debt / income) * 100, 2)),
    },
    unallocated: {
      amount: toMoney(unallocated),
      percent: toPercentage(roundToDecimals((unallocated / income) * 100, 2)),
    },
  };
}
```

### 6.2 Budget Calculations

#### 6.2.1 Budget Progress

```typescript
/**
 * Calculates budget utilization percentage.
 *
 * @formula percentUsed = (spent / budgeted) * 100
 * @edge-cases
 *   - budgeted <= 0: returns 0%
 *   - Can exceed 100% if overspent
 */
export interface BudgetProgress {
  spent: Money;
  budgeted: Money;
  remaining: Money;
  percentUsed: Percentage;
}

export function calculateBudgetProgress(
  spent: Money,
  budgeted: Money
): BudgetProgress {
  const remaining = toMoney(budgeted - spent);
  const percentUsed =
    budgeted > 0
      ? toPercentage(roundToDecimals((spent / budgeted) * 100, 2))
      : toPercentage(0);

  return { spent, budgeted, remaining, percentUsed };
}
```

#### 6.2.2 Budget Status

```typescript
export type BudgetStatus = "on_track" | "warning" | "exceeded";

export function determineBudgetStatus(
  percentUsed: Percentage,
  params: CalculationParameters
): BudgetStatus {
  const { budgetWarning, budgetAlert } = params.thresholds;

  if (percentUsed >= budgetAlert * 100) return "exceeded";
  if (percentUsed >= budgetWarning * 100) return "warning";
  return "on_track";
}
```

### 6.3 Goal Calculations

#### 6.3.1 Goal Progress

```typescript
export interface GoalProgress {
  currentAmount: Money;
  targetAmount: Money;
  remainingAmount: Money;
  percentComplete: Percentage;
}

export function calculateGoalProgress(
  currentAmount: Money,
  targetAmount: Money
): GoalProgress {
  const remainingAmount = toMoney(Math.max(0, targetAmount - currentAmount));
  const percentComplete =
    targetAmount > 0
      ? toPercentage(roundToDecimals((currentAmount / targetAmount) * 100, 2))
      : toPercentage(currentAmount > 0 ? 100 : 0);

  return { currentAmount, targetAmount, remainingAmount, percentComplete };
}
```

#### 6.3.2 Goal Status

```typescript
export type GoalStatus = "on_track" | "behind" | "at_risk" | "completed";

export function determineGoalStatus(
  percentComplete: Percentage,
  expectedPercent: Percentage,
  params: CalculationParameters
): GoalStatus {
  if (percentComplete >= 100) return "completed";

  const ratio = percentComplete / expectedPercent;
  const { onTrackThreshold, atRiskThreshold } = params.goals;

  if (ratio >= onTrackThreshold) return "on_track";
  if (ratio >= atRiskThreshold) return "behind";
  return "at_risk";
}
```

#### 6.3.3 Goal Projection

```typescript
export interface GoalProjection {
  monthlyRequired: Money;
  projectedCompletionDate: string | null;
  monthsToComplete: number | null;
  isOnTrack: boolean;
}

export function calculateGoalProjection(
  currentAmount: Money,
  targetAmount: Money,
  monthlyContribution: Money,
  targetDate?: string
): GoalProjection {
  const remaining = targetAmount - currentAmount;

  if (remaining <= 0) {
    return {
      monthlyRequired: toMoney(0),
      projectedCompletionDate: null,
      monthsToComplete: 0,
      isOnTrack: true,
    };
  }

  if (monthlyContribution <= 0) {
    return {
      monthlyRequired: toMoney(remaining),
      projectedCompletionDate: null,
      monthsToComplete: null,
      isOnTrack: false,
    };
  }

  const monthsToComplete = Math.ceil(remaining / monthlyContribution);
  const projectedDate = addMonths(new Date(), monthsToComplete);

  let isOnTrack = true;
  if (targetDate) {
    const targetDateObj = new Date(targetDate);
    isOnTrack = projectedDate <= targetDateObj;
  }

  const monthsUntilTarget = targetDate
    ? differenceInMonths(new Date(targetDate), new Date())
    : monthsToComplete;

  const monthlyRequired =
    monthsUntilTarget > 0
      ? toMoney(remaining / monthsUntilTarget)
      : toMoney(remaining);

  return {
    monthlyRequired,
    projectedCompletionDate: projectedDate.toISOString().split("T")[0],
    monthsToComplete,
    isOnTrack,
  };
}
```

### 6.4 Investment Calculations

#### 6.4.1 Time-Weighted Return (TWR)

```typescript
export interface TWRPeriod {
  startValue: Money;
  endValue: Money;
  cashFlow: Money;
  periodReturn?: Percentage;
}

/**
 * Calculates Time-Weighted Return.
 *
 * @formula TWR = ((1 + r1) * (1 + r2) * ... * (1 + rn)) - 1
 * @description Eliminates impact of cash flows, measures pure investment performance
 */
export function calculateTimeWeightedReturn(periods: TWRPeriod[]): Percentage {
  if (periods.length === 0) return toPercentage(0);

  let cumulativeReturn = 1;

  for (const period of periods) {
    const { startValue, endValue, cashFlow } = period;
    const adjustedStart = startValue + cashFlow;

    if (adjustedStart <= 0) continue;

    const periodReturn = (endValue - adjustedStart) / adjustedStart;
    cumulativeReturn *= 1 + periodReturn;
  }

  return toPercentage(roundToDecimals((cumulativeReturn - 1) * 100, 4));
}
```

#### 6.4.2 Gain/Loss

```typescript
export interface GainLoss {
  currentValue: Money;
  costBasis: Money;
  gainLoss: Money;
  gainLossPercent: Percentage;
  isGain: boolean;
}

export function calculateGainLoss(
  currentValue: Money,
  costBasis: Money
): GainLoss {
  const gainLoss = toMoney(currentValue - costBasis);
  const gainLossPercent =
    costBasis !== 0
      ? toPercentage(roundToDecimals((gainLoss / costBasis) * 100, 2))
      : toPercentage(0);

  return {
    currentValue,
    costBasis,
    gainLoss,
    gainLossPercent,
    isGain: gainLoss >= 0,
  };
}
```

### 6.5 Debt Calculations

#### 6.5.1 Debt-to-Income Ratio

```typescript
/**
 * Calculates Debt-to-Income ratio.
 *
 * @formula DTI = monthlyDebtPayments / monthlyIncome
 * @healthy < 36% (0.36)
 */
export function calculateDebtToIncome(
  monthlyDebtPayments: Money,
  monthlyIncome: Money
): Ratio {
  if (monthlyIncome <= 0) return toRatio(0);
  return toRatio(roundToDecimals(monthlyDebtPayments / monthlyIncome, 4));
}
```

#### 6.5.2 Debt Payoff Schedule

```typescript
export type PayoffStrategy = "snowball" | "avalanche" | "custom";

export interface Debt {
  id: string;
  name: string;
  balance: Money;
  interestRate: Percentage;
  minimumPayment: Money;
  priority?: number;
}

export interface PayoffScheduleItem {
  month: number;
  debtId: string;
  payment: Money;
  principal: Money;
  interest: Money;
  remainingBalance: Money;
}

export interface PayoffSchedule {
  strategy: PayoffStrategy;
  totalMonths: number;
  totalInterest: Money;
  totalPaid: Money;
  schedule: PayoffScheduleItem[];
  payoffOrder: string[];
}

export function calculateDebtPayoffSchedule(
  debts: Debt[],
  strategy: PayoffStrategy,
  extraPayment: Money = toMoney(0)
): PayoffSchedule {
  // Sort debts based on strategy
  const sortedDebts = [...debts].sort((a, b) => {
    if (strategy === "snowball") {
      return a.balance - b.balance; // Smallest balance first
    } else if (strategy === "avalanche") {
      return b.interestRate - a.interestRate; // Highest rate first
    } else {
      return (a.priority ?? 0) - (b.priority ?? 0);
    }
  });

  // ... implementation details for amortization schedule

  return {
    strategy,
    totalMonths: 0,
    totalInterest: toMoney(0),
    totalPaid: toMoney(0),
    schedule: [],
    payoffOrder: sortedDebts.map((d) => d.id),
  };
}
```

### 6.6 Financial Ratio Calculations

#### 6.6.1 Emergency Fund Coverage

```typescript
/**
 * Calculates months of expenses covered by emergency fund.
 *
 * @formula coverage = liquidSavings / monthlyEssentialExpenses
 * @healthy > 6 months
 */
export function calculateEmergencyFundCoverage(
  liquidSavings: Money,
  monthlyEssentialExpenses: Money
): number {
  if (monthlyEssentialExpenses <= 0) return Infinity;
  return roundToDecimals(liquidSavings / monthlyEssentialExpenses, 1);
}
```

#### 6.6.2 Liquidity Ratio

```typescript
/**
 * Calculates ability to cover short-term obligations.
 *
 * @formula liquidityRatio = liquidAssets / shortTermLiabilities
 * @healthy > 1.0
 */
export function calculateLiquidityRatio(
  liquidAssets: Money,
  shortTermLiabilities: Money
): Ratio {
  if (shortTermLiabilities <= 0) return toRatio(Infinity);
  return toRatio(roundToDecimals(liquidAssets / shortTermLiabilities, 2));
}
```

#### 6.6.3 Personal Burn Rate

```typescript
/**
 * Calculates months until liquid savings depleted.
 *
 * @formula burnRate = liquidSavings / monthlyDeficit
 * @healthy > 6 months
 */
export function calculateBurnRate(
  liquidSavings: Money,
  monthlyDeficit: Money
): number {
  if (monthlyDeficit <= 0) return Infinity; // No deficit = infinite runway
  return roundToDecimals(liquidSavings / monthlyDeficit, 1);
}
```

### 6.7 Currency Calculations

#### 6.7.1 FX Rate Service

Direct rates are preferred; if missing, the service attempts inverse lookup and finally triangulation through a base currency (`params.fx.triangulationBaseCurrency`, default `USD`).

```typescript
export interface FXRate {
  fromCurrency: string;
  toCurrency: string;
  rate: number;
  date: string;
  source: string;
}

export interface FXRateService {
  getLatestRate(from: string, to: string): Promise<number>;
  getHistoricalRate(from: string, to: string, date: string): Promise<number>;
  getRateWithTriangulation(
    from: string,
    to: string,
    baseCurrency?: string
  ): Promise<number>;
  convert(
    amount: Money,
    from: string,
    to: string,
    date?: string
  ): Promise<Money>;
}

export function createFXRateService(
  repository: FXRateRepository,
  cache: Cache,
  params: CalculationParameters
): FXRateService {
  return {
    async getLatestRate(from, to) {
      if (from === to) return 1;

      const cacheKey = `fx:${from}:${to}`;
      const cached = cache.get(cacheKey);
      if (cached) return cached;

      const rate = await repository.getLatestRate(from, to);
      if (!rate) {
        throw new CalculationError("MISSING_FX_RATE", { from, to });
      }

      cache.set(cacheKey, rate.rate, params.fx.cacheTtlSeconds);
      return rate.rate;
    },

    async getHistoricalRate(from, to, date) {
      if (from === to) return 1;

      const fetchDirectRate = async (fromCurrency, toCurrency) => {
        let rate = await repository.getRateForDate(fromCurrency, toCurrency, date);
        if (!rate) {
          rate = await repository.getMostRecentRateBefore(fromCurrency, toCurrency, date);
        }
        if (!rate) {
          const monthEnd = getMonthEnd(date);
          rate = await repository.getRateForDate(fromCurrency, toCurrency, monthEnd);
        }
        return rate ? rate.rate : null;
      };

      const directRate = await fetchDirectRate(from, to);
      if (directRate) return directRate;

      const inverseRate = await fetchDirectRate(to, from);
      if (inverseRate) return 1 / inverseRate;

      const baseCurrency = params.fx.triangulationBaseCurrency;
      if (from !== baseCurrency && to !== baseCurrency) {
        const fromToBase = await fetchDirectRate(from, baseCurrency);
        const baseToTarget = await fetchDirectRate(baseCurrency, to);
        if (fromToBase && baseToTarget) return fromToBase * baseToTarget;
      }

      throw new CalculationError("MISSING_FX_RATE", { from, to, date });
    },

    async getRateWithTriangulation(from, to, baseCurrency = params.fx.triangulationBaseCurrency) {
      if (from === to) return 1;

      // Try direct rate first
      try {
        return await this.getLatestRate(from, to);
      } catch (error) {
        if (!(error instanceof CalculationError) || error.code !== "MISSING_FX_RATE") {
          throw error;
        }
      }

      // Try inverse rate
      try {
        const inverseRate = await this.getLatestRate(to, from);
        return 1 / inverseRate;
      } catch (error) {
        if (!(error instanceof CalculationError) || error.code !== "MISSING_FX_RATE") {
          throw error;
        }
      }

      // Triangulate through base currency
      const fromToBase = await this.getLatestRate(from, baseCurrency);
      const baseToTarget = await this.getLatestRate(baseCurrency, to);
      return fromToBase * baseToTarget;
    },

    async convert(amount, from, to, date) {
      const rate = date
        ? await this.getHistoricalRate(from, to, date)
        : await this.getRateWithTriangulation(from, to);

      return toMoney(roundToDecimals(amount * rate, 2));
    },
  };
}
```

### 6.8 Forecasting Calculations

#### 6.8.1 Linear Regression Forecast

```typescript
export interface DataPoint {
  date: string;
  value: number;
}

export interface Forecast {
  projections: Array<{
    period: string;
    periodStart: string;
    periodEnd: string;
    projected: number;
    confidenceMin: number;
    confidenceMax: number;
  }>;
  trend: "increasing" | "decreasing" | "stable";
  slope: number;
  r2: number;
}

/**
 * Calculates linear regression forecast with confidence intervals.
 */
export function calculateLinearForecast(
  historicalData: DataPoint[],
  projectionMonths: number,
  confidenceLevel: number = 0.95
): Forecast {
  if (historicalData.length < 3) {
    throw new CalculationError("INSUFFICIENT_DATA", {
      required: 3,
      provided: historicalData.length,
    });
  }

  // Convert dates to numeric index
  const data = historicalData.map((point, i) => ({
    x: i,
    y: point.value,
    date: point.date,
  }));

  // Calculate linear regression
  const n = data.length;
  const sumX = data.reduce((sum, p) => sum + p.x, 0);
  const sumY = data.reduce((sum, p) => sum + p.y, 0);
  const sumXY = data.reduce((sum, p) => sum + p.x * p.y, 0);
  const sumX2 = data.reduce((sum, p) => sum + p.x * p.x, 0);

  const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
  const intercept = (sumY - slope * sumX) / n;

  // Calculate R-squared
  const meanY = sumY / n;
  const ssTotal = data.reduce((sum, p) => sum + Math.pow(p.y - meanY, 2), 0);
  const ssResidual = data.reduce((sum, p) => {
    const predicted = intercept + slope * p.x;
    return sum + Math.pow(p.y - predicted, 2);
  }, 0);
  const r2 = 1 - ssResidual / ssTotal;

  // Calculate standard error for confidence interval
  const se = Math.sqrt(ssResidual / (n - 2));
  const tValue = getTValue(n - 2, confidenceLevel);

  // Generate projections
  const lastDate = new Date(historicalData[historicalData.length - 1].date);
  const projections: Forecast["projections"] = [];

  for (let i = 1; i <= projectionMonths; i++) {
    const x = n - 1 + i;
    const projected = intercept + slope * x;
    const margin =
      tValue *
      se *
      Math.sqrt(
        1 + 1 / n + Math.pow(x - sumX / n, 2) / (sumX2 - (sumX * sumX) / n)
      );

    const periodStart = addMonths(lastDate, i);
    const periodEnd = endOfMonth(periodStart);

    projections.push({
      period: format(periodStart, "MMM yyyy"),
      periodStart: format(periodStart, "yyyy-MM-dd"),
      periodEnd: format(periodEnd, "yyyy-MM-dd"),
      projected: roundToDecimals(projected, 2),
      confidenceMin: roundToDecimals(projected - margin, 2),
      confidenceMax: roundToDecimals(projected + margin, 2),
    });
  }

  // Determine trend
  let trend: Forecast["trend"];
  if (Math.abs(slope) < 0.01 * meanY) {
    trend = "stable";
  } else if (slope > 0) {
    trend = "increasing";
  } else {
    trend = "decreasing";
  }

  return {
    projections,
    trend,
    slope: roundToDecimals(slope, 4),
    r2: roundToDecimals(r2, 4),
  };
}
```

### 6.9 Expense Classification

#### 6.9.1 Fixed vs Variable Auto-Detection

```typescript
export type ExpenseClassification = "fixed" | "variable" | "discretionary";

export interface ClassifiedExpense {
  categoryId: string;
  categoryName: string;
  classification: ExpenseClassification;
  avgAmount: Money;
  stddevAmount: number;
  monthsActive: number;
  confidence: Percentage;
}

/**
 * Auto-classifies expenses as fixed, variable, or discretionary.
 *
 * @algorithm
 * - Fixed: stddev < 5% of mean AND occurs 3+ months
 * - Variable: Occurs 2+ months with varying amounts
 * - Discretionary: Irregular frequency
 */
export function classifyExpenses(
  categoryStats: Array<{
    categoryId: string;
    categoryName: string;
    amounts: number[];
    dates: string[];
  }>
): ClassifiedExpense[] {
  return categoryStats.map((category) => {
    const { amounts, dates } = category;

    if (amounts.length === 0) {
      return {
        categoryId: category.categoryId,
        categoryName: category.categoryName,
        classification: "discretionary" as ExpenseClassification,
        avgAmount: toMoney(0),
        stddevAmount: 0,
        monthsActive: 0,
        confidence: toPercentage(0),
      };
    }

    const avgAmount = amounts.reduce((a, b) => a + b, 0) / amounts.length;
    const variance =
      amounts.reduce((sum, val) => sum + Math.pow(val - avgAmount, 2), 0) /
      amounts.length;
    const stddevAmount = Math.sqrt(variance);

    // Count unique months
    const uniqueMonths = new Set(dates.map((d) => d.substring(0, 7))).size;

    // Calculate coefficient of variation
    const cv = avgAmount > 0 ? stddevAmount / avgAmount : 0;

    let classification: ExpenseClassification;
    let confidence: number;

    if (cv < 0.05 && uniqueMonths >= 3) {
      // Very consistent amounts across multiple months = fixed
      classification = "fixed";
      confidence = Math.min(95, 70 + uniqueMonths * 5);
    } else if (uniqueMonths >= 2) {
      // Occurs regularly but with varying amounts = variable
      classification = "variable";
      confidence = Math.min(90, 60 + uniqueMonths * 5);
    } else {
      // Irregular = discretionary
      classification = "discretionary";
      confidence = 50;
    }

    return {
      categoryId: category.categoryId,
      categoryName: category.categoryName,
      classification,
      avgAmount: toMoney(roundToDecimals(avgAmount, 2)),
      stddevAmount: roundToDecimals(stddevAmount, 2),
      monthsActive: uniqueMonths,
      confidence: toPercentage(confidence),
    };
  });
}
```

### 6.10 Date Utility Functions

Defaults:

- Timezone defaults to `params.calendar.defaultTimezone` (Africa/Lusaka) when not provided by the caller.
- Fiscal year uses `params.calendar.fiscalYearStartMonth` (1 = Jan).
- Weekly aggregation uses ISO weeks in the selected timezone.

```typescript
// dates/ranges.ts
export function getCurrentMonthRange(timezone: string): {
  from: string;
  to: string;
} {
  const now = DateTime.now().setZone(timezone);
  return {
    from: now.startOf("month").toISODate()!,
    to: now.endOf("month").toISODate()!,
  };
}

export function getCurrentYearRange(timezone: string): {
  from: string;
  to: string;
} {
  const now = DateTime.now().setZone(timezone);
  return {
    from: now.startOf("year").toISODate()!,
    to: now.endOf("year").toISODate()!,
  };
}

export function getLastNMonthsRange(
  months: number,
  timezone: string
): { from: string; to: string } {
  const now = DateTime.now().setZone(timezone);
  return {
    from: now.minus({ months }).startOf("month").toISODate()!,
    to: now.endOf("month").toISODate()!,
  };
}

export function getPreviousPeriodRange(current: { from: string; to: string }): {
  from: string;
  to: string;
} {
  const fromDate = DateTime.fromISO(current.from);
  const toDate = DateTime.fromISO(current.to);
  const duration = toDate.diff(fromDate, "days").days;

  return {
    from: fromDate.minus({ days: duration + 1 }).toISODate()!,
    to: fromDate.minus({ days: 1 }).toISODate()!,
  };
}

export function getQuarterRange(
  year: number,
  quarter: 1 | 2 | 3 | 4,
  timezone: string
): { from: string; to: string } {
  const startMonth = (quarter - 1) * 3 + 1;
  const start = DateTime.fromObject(
    { year, month: startMonth, day: 1 },
    { zone: timezone }
  );

  return {
    from: start.toISODate()!,
    to: start.plus({ months: 2 }).endOf("month").toISODate()!,
  };
}

export function getFiscalYearRange(
  year: number,
  fiscalYearStartMonth: number,
  timezone: string
): { from: string; to: string } {
  const start = DateTime.fromObject(
    {
      year: fiscalYearStartMonth > 6 ? year - 1 : year,
      month: fiscalYearStartMonth,
      day: 1,
    },
    { zone: timezone }
  );

  return {
    from: start.toISODate()!,
    to: start.plus({ years: 1 }).minus({ days: 1 }).toISODate()!,
  };
}
```

### 6.11 Historical Recalculation Policy

Parameter changes are effective-date only by default. Historical periods are not auto-recomputed to avoid silent drift in reporting.

**Recalculation options:**
- On-demand recalculation for specific reports (client requests with a parameter version).
- Admin-triggered batch recalculation for a date range and function set.
- Shadow comparisons stored for audit when backfilling.

```typescript
export interface RecalculationRequest {
  householdId: string;
  fromDate: string;
  toDate: string;
  functions: Array<Exclude<keyof CalculationEngine, "batch">>;
  reason: string;
  dryRun?: boolean; // Compare only, do not persist
}
```

---

## 7. Consolidated Formula Reference

| Formula               | Current Location(s)                          | Engine Module                       | Status         |
| --------------------- | -------------------------------------------- | ----------------------------------- | -------------- |
| Savings Rate          | ReportRepository, GoalService, BudgetService | `cashflow/savingsRate.ts`           | To migrate     |
| Net Savings           | (new)                                        | `cashflow/netSavings.ts`            | New            |
| Net Savings Rate      | (new)                                        | `cashflow/netSavingsRate.ts`        | New            |
| Net Worth             | snapshotWorker, ReportRepository             | `cashflow/netWorth.ts`              | To migrate     |
| Income Allocation     | (new)                                        | `cashflow/incomeAllocation.ts`      | New            |
| Goal Progress %       | goalCalculations.ts                          | `goals/progress.ts`                 | To migrate     |
| Goal Status           | goalCalculations.ts                          | `goals/status.ts`                   | To migrate     |
| Goal Projection       | goalCalculations.ts, GoalService             | `goals/projections.ts`              | To migrate     |
| Budget % Used         | BudgetService                                | `budget/progress.ts`                | To migrate     |
| Budget Alerts         | BudgetService                                | `budget/alerts.ts`                  | To migrate     |
| FX Conversion         | 5 different files                            | `currency/conversion.ts`            | To consolidate |
| TWR                   | InvestmentPerformanceService                 | `investments/twr.ts`                | To migrate     |
| Gain/Loss %           | PortfolioValuationService                    | `investments/gainLoss.ts`           | To migrate     |
| Cost Basis            | PortfolioValuationService                    | `investments/costBasis.ts`          | To migrate     |
| FX Attribution        | FXAttributionService                         | `investments/fxAttribution.ts`      | To migrate     |
| Debt Payoff           | DebtPayoffCalculator                         | `debt/payoff.ts`                    | To migrate     |
| DTI Ratio             | (new)                                        | `ratios/dti.ts`                     | New            |
| Emergency Fund        | (new)                                        | `ratios/emergencyFund.ts`           | New            |
| Liquidity Ratio       | (new)                                        | `ratios/liquidity.ts`               | New            |
| Burn Rate             | (new)                                        | `ratios/burnRate.ts`                | New            |
| Linear Forecast       | (new)                                        | `projections/linearForecast.ts`     | New            |
| Confidence Interval   | (new)                                        | `projections/confidenceInterval.ts` | New            |
| Fixed vs Variable     | (new)                                        | `classification/expenseType.ts`     | New            |
| Recurring Projections | RecurringService                             | `recurring/projections.ts`          | To migrate     |
| Pattern Detection     | RecurringService                             | `recurring/patternDetection.ts`     | To migrate     |
| Date Ranges           | Multiple services                            | `dates/ranges.ts`                   | To consolidate |

---

## 8. Integration with Consumers

### 8.1 Annual Dashboard Integration

The Calculation Engine directly supports the Annual Dashboard widgets defined in [annual-dashboard-requirements.md](../features/requirements/annual-dashboard-requirements.md):

| Widget            | Engine Function(s)                                           | Notes                                                         |
| ----------------- | ------------------------------------------------------------ | ------------------------------------------------------------- |
| Summary Cards     | Aggregated totals + `netSavings`, `netWorth`                 | Income, Expenses, Savings Contributions, Debt Paid, Net Worth |
| Goal Progress     | `goalProgress`, `goalStatus`, `goalProjection`               | Income, Savings, Debt Payoff goals                            |
| Fixed vs Variable | `classifyExpenses`                                           | Auto-classification                                           |
| KPI Cards         | `dti`, `emergencyFundCoverage`, `liquidityRatio`, `burnRate` | Financial ratios                                              |
| Forecast          | `linearForecast`                                             | Net worth, savings projections                                |
| Income Allocation | `incomeAllocation`                                           | 100% stacked bar                                              |
| Ratio Gauges      | `savingsRate`, `dti`                                         | Gauge visualizations                                          |

### 8.2 Main Dashboard Integration

The main Dashboard widgets from [dashboard-requirements.md](../features/requirements/dashboard-requirements.md) also consume engine functions:

| Widget              | Engine Function(s)                   |
| ------------------- | ------------------------------------ |
| Net Worth Widget    | `netWorth`                           |
| Budget Widget       | `budgetProgress`, `budgetStatus`     |
| Savings Rate Widget | `savingsRate`                        |
| Recurring Expenses  | `recurringProjections`, `billTotals` |

### 8.3 Service Layer Integration

Services call the engine through dependency injection:

```typescript
// Example: ReportRepository integration
export class ReportRepository {
  constructor(private db: Database, private engine: CalculationEngine) {}

  async getCashflow(params: CashflowParams): Promise<CashflowResponse> {
    // 1. Fetch raw data from database
    const transactions = await this.db.query.transactions.findMany({
      where: and(
        eq(transactions.householdId, params.householdId),
        gte(transactions.date, params.from),
        lte(transactions.date, params.to)
      ),
    });

    // 2. Aggregate by period
    const aggregated = this.aggregateByPeriod(
      transactions,
      params.aggregation ?? "monthly"
    );

    // 3. Calculate metrics using engine
    return aggregated.map((period) => ({
      ...period,
      savingsRate: this.engine.savingsRate(
        toMoney(period.income),
        toMoney(period.savingsContributions)
      ),
      netWorth: this.engine.netWorth(
        toMoney(period.assets),
        toMoney(period.liabilities)
      ),
    }));
  }
}
```

### 8.4 Common Reporting Query Options

All report endpoints should accept a shared set of query options passed into aggregation and date utilities:

```typescript
export type AggregationType =
  | "daily"
  | "weekly"
  | "monthly"
  | "quarterly"
  | "biannual"
  | "annual";

export interface ReportQueryOptions {
  from: string;
  to: string;
  aggregation?: AggregationType; // Default: monthly
  timezone?: string; // Default: params.calendar.defaultTimezone
  baseCurrency?: string; // Default: user base currency
  scope?: "mine" | "household"; // Default: mine
}
```

Aggregation boundaries respect the selected timezone, and weekly aggregation uses ISO weeks.

---

## 9. Testing Strategy

### 9.1 Unit Tests

Each calculation function has comprehensive unit tests covering:

- Normal cases
- Edge cases (zero, negative, infinity)
- Boundary conditions
- Rounding behavior

```typescript
// __tests__/savingsRate.test.ts
import { describe, it, expect } from "vitest";
import {
  calculateSavingsRate,
  toMoney,
  toPercentage,
} from "../cashflow/savingsRate";

describe("calculateSavingsRate", () => {
  it("calculates correct savings rate for positive income", () => {
    const result = calculateSavingsRate(toMoney(8000), toMoney(1000));
    expect(result).toBe(toPercentage(12.5));
  });

  it("returns 0 when income is zero", () => {
    const result = calculateSavingsRate(toMoney(0), toMoney(1000));
    expect(result).toBe(toPercentage(0));
  });

  it("returns 0 when income is negative", () => {
    const result = calculateSavingsRate(toMoney(-500), toMoney(1000));
    expect(result).toBe(toPercentage(0));
  });

  it("handles savings contributions greater than income", () => {
    const result = calculateSavingsRate(toMoney(10000), toMoney(15000));
    expect(result).toBe(toPercentage(150));
  });

  it("rounds to 2 decimal places", () => {
    const result = calculateSavingsRate(toMoney(10000), toMoney(3333.33));
    expect(result).toBe(toPercentage(33.33));
  });
});
```

### 9.2 Property-Based Testing

Use fast-check for property-based testing to catch edge cases:

```typescript
// __tests__/properties/cashflow.property.test.ts
import { describe, it } from "vitest";
import fc from "fast-check";
import { calculateSavingsRate, calculateNetWorth } from "../../cashflow";

describe("Cashflow Properties", () => {
  it("savings rate is always between negative infinity and positive infinity", () => {
    fc.assert(
      fc.property(
        fc.float({ min: 0, max: 1_000_000, noNaN: true }),
        fc.float({ min: 0, max: 1_000_000, noNaN: true }),
        (income, savingsContributions) => {
          const rate = calculateSavingsRate(
            toMoney(income),
            toMoney(savingsContributions)
          );
          return Number.isFinite(rate) || (income === 0 && rate === 0);
        }
      )
    );
  });

  it("net worth equals assets minus liabilities", () => {
    fc.assert(
      fc.property(
        fc.float({ min: 0, max: 10_000_000, noNaN: true }),
        fc.float({ min: 0, max: 10_000_000, noNaN: true }),
        (assets, liabilities) => {
          const netWorth = calculateNetWorth(
            toMoney(assets),
            toMoney(liabilities)
          );
          return Math.abs(netWorth - (assets - liabilities)) < 0.01;
        }
      )
    );
  });

  it("goal progress never exceeds 100% when current <= target", () => {
    fc.assert(
      fc.property(
        fc.float({ min: 0, max: 100_000, noNaN: true }),
        fc.float({ min: 0.01, max: 100_000, noNaN: true }),
        (current, target) => {
          if (current > target) return true; // Skip invalid cases
          const progress = calculateGoalProgress(
            toMoney(current),
            toMoney(target)
          );
          return progress.percentComplete <= 100;
        }
      )
    );
  });
});
```

### 9.3 FX Rate Tests

```typescript
describe("FX Rate Service", () => {
  it("returns 1 for same currency conversion", async () => {
    const service = createFXRateService(
      mockRepo,
      mockCache,
      DEFAULT_PARAMETERS
    );
    const rate = await service.getLatestRate("USD", "USD");
    expect(rate).toBe(1);
  });

  it("uses cached rate when available", async () => {
    mockCache.get.mockReturnValue(25.43);
    const service = createFXRateService(
      mockRepo,
      mockCache,
      DEFAULT_PARAMETERS
    );

    const rate = await service.getLatestRate("USD", "ZMW");

    expect(rate).toBe(25.43);
    expect(mockRepo.getLatestRate).not.toHaveBeenCalled();
  });

  it("throws MISSING_FX_RATE when rate not found", async () => {
    mockRepo.getLatestRate.mockResolvedValue(null);
    mockRepo.getMostRecentRateBefore.mockResolvedValue(null);

    const service = createFXRateService(
      mockRepo,
      mockCache,
      DEFAULT_PARAMETERS
    );

    await expect(
      service.getHistoricalRate("XYZ", "ZMW", "2026-01-01")
    ).rejects.toThrow(CalculationError);
  });
});
```

### 9.4 Integration Tests

Test that services correctly integrate with the engine:

```typescript
describe("ReportRepository with Engine", () => {
  it("calculates savings rate using engine", async () => {
    const engine = createCalculationEngine();
    const repo = new ReportRepository(db, engine);

    const result = await repo.getCashflow({
      householdId: "test-household",
      from: "2026-01-01",
      to: "2026-01-31",
      aggregation: "monthly",
    });

    expect(result.totals.savingsRate).toBeDefined();
    expect(typeof result.totals.savingsRate).toBe("number");
  });
});
```

---

## 10. Migration Strategy

### 10.1 Shadow Mode Migration

Before fully migrating to the new engine, run both legacy and new calculations in parallel:

```typescript
// Shadow mode wrapper
export function withShadowMode<T>(
  legacyFn: () => T,
  newFn: () => T,
  functionName: string,
  logger: ShadowLogger
): T {
  const legacyResult = legacyFn();
  const newResult = newFn();

  // Compare results
  const match = deepEqual(legacyResult, newResult);

  logger.logComparison({
    functionName,
    legacyResult,
    newResult,
    match,
    timestamp: new Date().toISOString(),
  });

  if (!match) {
    logger.alertMismatch(functionName, legacyResult, newResult);
  }

  // Return legacy result during shadow period
  return legacyResult;
}
```

### 10.2 Migration Phases

| Phase                                         | Duration | Activities                                                                                                                                                                                                                        |
| --------------------------------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **1. Core Scaffolding**                       | Week 1   | Create `core/calculations` directory structure. Implement common helpers (`toSafeNumber`, `roundToDecimals`), type definitions and FX rate service. Write baseline unit tests for helpers.                                        |
| **2. FX Service Consolidation**               | Week 1   | Move all existing `getLatestFxRates()` implementations into `core/calculations/currency/fxRates.ts`. Update all services to import from this module. Maintain backward compatibility via re-exports until all calls are migrated. |
| **3. Migrate Report Calculations**            | Week 2   | Extract savings rate, net worth, cash-flow and other calculations from `ReportRepository.ts` into pure functions under `core/calculations/cashflow`. Refactor repository to call these functions. Enable shadow mode.             |
| **4. Migrate Goal & Budget Calculations**     | Week 2   | Move goal progress, status and projection formulas into `core/calculations/goals`. Move budget progress and alert formulas into `core/calculations/budget`. Update `GoalService` and `BudgetService` to use the engine.           |
| **5. Migrate Investment & Debt Calculations** | Week 3   | Consolidate investment holding metrics, TWR and FX attribution into `core/calculations/investments`. Move debt payoff algorithms into `core/calculations/debt`. Refactor corresponding services.                                  |
| **6. Implement Design & Monitor Modules**     | Week 3-4 | Create design module with parameter storage, approval workflow and API endpoints. Implement monitor module and logging infrastructure. Integrate parameter loading in calculation functions.                                      |
| **7. Refactor Services to Use Parameters**    | Week 4   | Update all services to retrieve parameter values based on effective dates and pass them into calculation functions. Implement default parameter sets.                                                                             |
| **8. New Calculations**                       | Week 5   | Implement new calculations (forecasting, classification, ratios) that don't exist in legacy code.                                                                                                                                 |
| **9. Shadow Mode Validation**                 | Week 5-6 | Run shadow mode for all migrated calculations. Fix any discrepancies. Achieve 100% match rate.                                                                                                                                    |
| **10. Full Cutover**                          | Week 6   | Disable shadow mode. Remove legacy calculation code. Update documentation.                                                                                                                                                        |

### 10.3 Rollback Plan

If issues are detected after migration:

1. **Feature flag**: Each calculation has a feature flag to revert to legacy
2. **A/B testing**: Route percentage of traffic to new engine
3. **Quick rollback**: Single config change to disable new engine

---

## 11. Performance & Caching

### 11.1 Caching Strategy

| Data Type               | Cache Location   | TTL        | Invalidation          |
| ----------------------- | ---------------- | ---------- | --------------------- |
| FX Rates                | Redis/In-memory  | 1 hour     | On new rate import    |
| Parameter Values        | In-memory        | 10 minutes | On parameter approval |
| Aggregated Transactions | None (computed)  | -          | -                     |
| Calculation Results     | Optional (Redis) | 5 minutes  | On transaction change |

### 11.1.1 Cache Key Strategy

All cached calculation results must include scope, parameter versioning, and data versions to avoid cross-scope leakage or stale reads.

```
calc:{function}:{householdId}:{scope}:{aggregation}:{timezone}:{baseCurrency}:{parameterVersion}:{dataVersion}:{inputsHash}
```

Example:
`calc:cashflow.netSavingsRate:household_123:mine:monthly:Africa/Lusaka:ZMW:1.0.0:tx_8891:8f3c2a`

### 11.1.2 Invalidation Triggers

| Change Event | Invalidate |
| ------------ | ---------- |
| Transaction insert/update/delete | `cashflow/*`, `budget/*`, `goals/*`, `ratios/*` |
| Account balance update | `cashflow/netWorth`, `ratios/*` |
| FX rate import | `currency/*`, all currency-dependent caches |
| Parameter approval | All caches for affected parameter version |
| Household scope change | All caches for household |

### 11.2 Performance Targets

| Operation            | Target Latency | Notes              |
| -------------------- | -------------- | ------------------ |
| Single calculation   | < 20 ms        | Pure function call |
| FX conversion        | < 50 ms        | With cache hit     |
| Batch (10,000 items) | < 1 s          | Parallelized       |
| Full annual report   | < 500 ms       | With warm cache    |

### 11.3 Optimization Techniques

1. **Memoization**: Cache expensive calculations within request scope
2. **Lazy evaluation**: Only calculate what's needed
3. **Batch processing**: Group FX conversions to reduce lookups
4. **Pre-aggregation**: Store daily/monthly aggregates for common queries

### 11.4 Validation & Guardrails

- Max 5,000 rows returned per report query.
- Max 25 group-by buckets per chart.
- Report query timeout budget: 2 seconds server-side.
- Access scope validation is enforced before aggregation (see 12.4).

---

## 12. Security & Compliance

### 12.1 Role-Based Access Control

| Role          | Parameter View | Parameter Edit | Parameter Approve | Audit View |
| ------------- | -------------- | -------------- | ----------------- | ---------- |
| Finance Admin | Yes            | Yes            | Yes               | Yes        |
| Developer     | Yes            | Yes            | No                | Yes        |
| Auditor       | Yes            | No             | No                | Yes        |
| User          | No             | No             | No                | No         |

### 12.2 Audit Requirements

- All parameter changes require approval (four-eyes principle)
- Every calculation execution is logged with full metadata
- Audit logs retained for 7 years (configurable)
- Read-only access for external auditors

### 12.3 Compliance Standards

| Standard  | Requirement                   | Implementation                  |
| --------- | ----------------------------- | ------------------------------- |
| GAAP/IFRS | Consistent financial formulas | Documented business definitions |
| GDPR/CCPA | No PII in logs                | Anonymized identifiers          |
| SOC 2     | Access controls, audit trails | RBAC, calculation logging       |
| PCI DSS   | Secure handling               | Encryption, access controls     |

### 12.4 Data Scope and Household Access

- Requests accept `scope: 'mine' | 'household'` (default `mine`).
- `household` scope requires owner/admin role and is enforced before data fetch.
- `mine` scope filters by `userId`; `household` scope filters by `householdId`.
- No cross-household data access; cache keys are scope-aware and include household identifiers where applicable.
- Widget and custom chart preferences remain per-user in v1; the engine does not share preferences across users.

---

## 13. Alignment with International Standards

### 13.1 Financial Data Formats (ISO 20022)

Use ISO 20022 concepts for transaction messages and account structures:

- Standardized amount, currency, timestamp fields
- Enables integration with banking APIs and payment networks

### 13.2 Accounting Principles (GAAP/IFRS)

All calculations consistent with Generally Accepted Accounting Principles:

- Net Worth = Assets - Liabilities
- Savings = Income - Expenses
- Document formulas for auditor traceability

---

## 14. Data Visualization Recommendations

### 14.1 Chart Types by Use Case

| Use Case            | Recommended Chart | Rationale             |
| ------------------- | ----------------- | --------------------- |
| Category comparison | Bar (vertical)    | Clear comparison      |
| Time trends         | Line, Area        | Shows direction       |
| Proportions         | Donut, Treemap    | Part-of-whole         |
| Income allocation   | 100% Stacked Bar  | Relative proportions  |
| KPI status          | Gauge             | Quick status read     |
| Correlations        | Scatter           | Relationship analysis |

### 14.2 Accessibility

- Consistent color coding (green=income, red=expenses, blue=savings, orange=debt)
- Sufficient contrast for color-blind users
- Redundant encodings (patterns, labels)
- Screen reader compatible

---

## 15. Success Criteria

| Criterion                      | Measurement                                | Target                                  |
| ------------------------------ | ------------------------------------------ | --------------------------------------- |
| Calculation accuracy           | Compare outputs before and after migration | No deviation beyond rounding tolerances |
| Test coverage                  | Code coverage report                       | > 90%                                   |
| Parameter change approval time | Time from creation to activation           | < 24 hours                              |
| FX rate consistency            | Results across services                    | 100% match                              |
| Latency (sync calculation)     | Average time per call                      | < 20 ms                                 |
| Latency (batch job)            | Time to process 10,000 calculations        | < 1 s                                   |
| Audit log completeness         | Percentage of calls logged                 | 100%                                    |
| Shadow mode validation         | Legacy vs new match rate                   | 100%                                    |
| Annual Dashboard support       | All widgets using engine                   | 100%                                    |
| Documentation completeness     | All formulas documented                    | 100%                                    |

---

## 16. References

1. **The value of a centralized finance calculation engine** - Explains that calculations scattered across systems limit understanding and real-time analytics, advocating for centralized automation.

2. **Calculation engines in Financial Services** - Describes design, run and monitor modules: configuration with versioning and approval; support for real-time and batch execution; and detailed logging for auditing and monitoring.

3. **Monarch Money** - Modern personal finance app with comprehensive aggregation and insights.

4. **Mint** - Pioneer in auto-categorization and budget visualization.

5. **Revolut** - Multi-currency handling and predictive budgeting.

6. **ISO 20022** - International standard for financial message formats.

7. **GAAP/IFRS** - Generally Accepted Accounting Principles and International Financial Reporting Standards.

---

## 17. Roadmap Enhancements

**Now (v1):**
- FX triangulation fallback through base currency (default USD).
- Batch interfaces for internal jobs (no public API in v1).
- Historical recalculation policy (effective-date only; explicit backfill job).
- Cache key strategy + invalidation triggers.
- Optimistic locking for parameter updates.

**Next (post-v1):**
- Observability metrics interface (counters, histograms, gauges).
- Richer `CalculationError` context (function name, inputs, parameter version, requestId).
- Per-function feature flag schema for gradual rollout.

**Later (polish/consistency):**
- Decimal.js usage guidelines and enforcement rules.
- Locale-aware rounding modes (banker's rounding, half-up, etc.).
- Zod response schemas for calculation outputs.
- Formal DI wiring patterns and lifecycle guidance.

**Open questions (confirm assumptions):**
- Do we expect FX pairs to always be directly available, or should triangulation via USD be required for edge currencies?
- Should parameter changes apply only to future periods, or trigger historical recomputation/backfill?
- Is batch execution intended for internal jobs only, or should it be exposed as a public API surface?

---

## Appendix A: Existing Code Locations for Migration

| Current File                                      | Functions to Extract                                              | Target Module                  |
| ------------------------------------------------- | ----------------------------------------------------------------- | ------------------------------ |
| `server/repositories/ReportRepository.ts`         | `getSavingsRate()`, `getNetWorth()`, `getCashflow()` calculations | `cashflow/*`                   |
| `server/services/GoalService.ts`                  | Goal progress, projections                                        | `goals/*`                      |
| `server/services/goalCalculations.ts`             | All functions                                                     | `goals/*`                      |
| `server/services/BudgetService.ts`                | Progress, alerts, forecasting                                     | `budget/*`                     |
| `server/services/PortfolioValuationService.ts`    | Holdings, FX rates                                                | `investments/*`, `currency/*`  |
| `server/services/InvestmentPerformanceService.ts` | TWR calculation                                                   | `investments/twr.ts`           |
| `server/services/FXAttributionService.ts`         | Return attribution                                                | `investments/fxAttribution.ts` |
| `server/services/DebtPayoffCalculator.ts`         | Payoff schedules                                                  | `debt/payoff.ts`               |
| `server/services/RecurringService.ts`             | Projections, pattern detection                                    | `recurring/*`                  |
| `server/jobs/snapshotWorker.ts`                   | Net worth snapshot                                                | `cashflow/netWorth.ts`         |

---

## Appendix B: Widget-to-Engine Function Mapping

### Annual Dashboard Widgets

| Widget                    | Engine Functions                                                                              | Response Type                    |
| ------------------------- | --------------------------------------------------------------------------------------------- | -------------------------------- |
| Summary Cards (Totals)    | Aggregated totals (income, expenses, savingsContributions, debtPayments)                      | `Money`                          |
| Summary Cards (Net Worth) | `netWorth()`                                                                                  | `Money`                          |
| Goal Progress             | `goalProgress()`, `goalStatus()`                                                              | `GoalProgress`, `GoalStatus`     |
| Fixed vs Variable         | `classifyExpenses()`                                                                          | `ClassifiedExpense[]`            |
| Savings Trends            | `savingsRate()`, `netSavings()`, `netSavingsRate()`                                           | `Percentage[]`, `Money[]`        |
| Monthly Charts            | Aggregated totals per period (income, expenses, savingsContributions, debtPayments, netWorth) | `Money[]`                        |
| Income Allocation         | `incomeAllocation()`                                                                          | `IncomeAllocation`               |
| DTI Gauge                 | `debtToIncome()`                                                                              | `Ratio`                          |
| Emergency Fund            | `emergencyFundCoverage()`                                                                     | `number` (months)                |
| Liquidity                 | `liquidityRatio()`                                                                            | `Ratio`                          |
| Burn Rate                 | `burnRate()`                                                                                  | `number` (months)                |
| Forecast                  | `linearForecast()`                                                                            | `Forecast`                       |
| Budget Summary            | `budgetProgress()`, `budgetStatus()`                                                          | `BudgetProgress`, `BudgetStatus` |
| Investment Summary        | `timeWeightedReturn()`, `gainLoss()`                                                          | `Percentage`, `GainLoss`         |

---

## Appendix C: Database Schema Additions

### Calculation Parameters Table

```sql
CREATE TABLE calculation_parameters (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  version VARCHAR(20) NOT NULL,
  effective_date DATE NOT NULL,
  parameters JSONB NOT NULL,
  row_version INTEGER NOT NULL DEFAULT 1,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  approved_by UUID REFERENCES users(id),
  approved_at TIMESTAMPTZ,
  status VARCHAR(20) DEFAULT 'draft', -- draft, pending, approved, archived
  UNIQUE(version)
);
```

### Calculation Audit Log Table

```sql
CREATE TABLE calculation_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  timestamp TIMESTAMPTZ DEFAULT NOW(),
  function_name VARCHAR(100) NOT NULL,
  inputs JSONB NOT NULL,
  output JSONB NOT NULL,
  parameter_version VARCHAR(20),
  execution_mode VARCHAR(20), -- operational, simulation, shadow
  execution_time_ms INTEGER,
  user_id UUID REFERENCES users(id),
  household_id UUID REFERENCES households(id),
  channel VARCHAR(50),
  error_code VARCHAR(50),
  error_message TEXT
);

CREATE INDEX idx_calc_logs_timestamp ON calculation_logs(timestamp);
CREATE INDEX idx_calc_logs_function ON calculation_logs(function_name);
CREATE INDEX idx_calc_logs_household ON calculation_logs(household_id);
```

---

_Document Version: 1.0_
_Last Updated: 2026-01-07_
_Status: Ready for Implementation_

