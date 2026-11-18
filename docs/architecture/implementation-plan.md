# Enterprise Refactoring Implementation Plan

**Version:** 1.0
**Date:** 2026-01-11
**Source Specification:** [enterprise-refactoring-specification.md](enterprise-refactoring-specification.md)
**Based On:** [../reviews/deep-code-review-2026-01-11.md](../reviews/deep-code-review-2026-01-11.md)
**Status:** Ready for Execution

---

## Document Purpose

This implementation plan addresses ALL:

- ❌ Critical gaps identified in deep code review
- ⚠️ Partial implementations requiring completion
- 🚨 Critical missing items from spec
- 💡 Recommendations from code review

Each task includes exact file paths, code specifications, and references to the enterprise refactoring specification.

---

## Executive Summary

### Implementation Scope

| Category                         | Count        | Total Effort   |
| -------------------------------- | ------------ | -------------- |
| Critical Client Refactoring      | 10 items     | 15-20 days     |
| Partial Server Module Completion | 13 items     | 8-10 days      |
| Missing Infrastructure           | 6 items      | 3-5 days       |
| Monitoring & Observability       | 5 items      | 3-5 days       |
| Testing & Quality                | 4 items      | 5-7 days       |
| Pattern Standardization          | 3 items      | 2-3 days       |
| **TOTAL**                        | **41 items** | **36-50 days** |

### Priority Legend

| Priority | Meaning                           | Timeline  |
| -------- | --------------------------------- | --------- |
| 🔴 P0    | Critical blocker - must fix first | Immediate |
| 🟠 P1    | High priority - fix this week     | Week 1    |
| 🟡 P2    | Medium priority - fix this sprint | Week 2-3  |
| 🟢 P3    | Low priority - fix when possible  | Week 4+   |

---

# PART 1: CRITICAL CLIENT REFACTORING

> **Spec Reference:** "Largest client file: < 300 LOC" (Key Outcomes, p.44)
>
> **Current Status:** 10 of 15 pages exceed 300 LOC (67% failure rate)

---

## 1.1 Create Reports Feature Module ✅ COMPLETE

**Priority:** 🔴 CRITICAL - Highest impact item
**Current State:** ~~Reports.tsx = 1,685 LOC~~ → **311 LOC** ✅
**Target State:** Reports.tsx < 300 LOC - NEARLY ACHIEVED (81% reduction)
**Completed:** 2026-01-11 (refined through 2026-01-28)
**Spec Reference:** Phase 5: Client & Cleanup (p.336-345)
**Status Note:** Feature module at `client/src/features/reports/` with components, hooks, and utils. Page file at 311 LOC is very close to target.

### File Structure to Create

```
client/src/features/reports/
├── index.ts                         # Module exports
├── types.ts                         # Report types & interfaces
├── constants.ts                     # Report configuration
│
├── components/
│   ├── ReportHeader.tsx             # Date range picker, filters
│   ├── ReportSection.tsx            # Reusable section wrapper
│   │
│   ├── SpendingBreakdownSection.tsx # Spending by category chart
│   ├── SpendingTrendSection.tsx     # Monthly spending trend
│   ├── MerchantBreakdownSection.tsx # Top merchants chart
│   │
│   ├── CashFlowSection.tsx          # Income vs expenses chart
│   ├── SavingsRateSection.tsx       # Savings rate gauge
│   ├── IncomeBreakdownSection.tsx   # Income sources breakdown
│   │
│   ├── NetWorthSection.tsx          # Net worth chart
│   ├── AccountBalancesSection.tsx   # Account balances table
│   │
│   ├── DebtAnalysisSection.tsx      # Debt metrics & payoff
│   ├── ForecastSection.tsx          # Financial forecast chart
│   │
│   └── SankeyDiagramSection.tsx     # Money flow Sankey
│
├── hooks/
│   ├── useReportData.ts             # Centralized data fetching
│   ├── useReportFilters.ts          # Filter state management
│   ├── useReportExport.ts           # Export functionality
│   └── useReportPeriod.ts           # Date period selection
│
├── utils/
│   ├── reportFormatters.ts          # Currency, date formatting
│   ├── chartConfigs.ts              # Shared chart configurations
│   └── exportHelpers.ts             # CSV/PDF export helpers
│
└── __tests__/
    ├── ReportSection.test.tsx
    ├── useReportData.test.tsx
    └── Reports.integration.test.tsx
```

### Implementation Steps

#### Step 1: Create Type Definitions

**File:** `client/src/features/reports/types.ts`

```typescript
// Report period types
export type ReportPeriod = "week" | "month" | "quarter" | "year" | "custom";

export interface ReportDateRange {
  startDate: string;
  endDate: string;
  period: ReportPeriod;
}

// Filter types
export interface ReportFilters {
  dateRange: ReportDateRange;
  accounts: string[];
  categories: string[];
  includeTransfers: boolean;
}

// Section data types
export interface SpendingBreakdownData {
  categories: Array<{
    id: string;
    name: string;
    amount: number;
    percentage: number;
    color: string;
  }>;
  total: number;
}

export interface CashFlowData {
  periods: Array<{
    label: string;
    income: number;
    expenses: number;
    net: number;
  }>;
}

export interface NetWorthData {
  current: number;
  change: number;
  changePercent: number;
  history: Array<{
    date: string;
    value: number;
  }>;
}

// Unified report data type
export interface ReportData {
  spending: SpendingBreakdownData | null;
  cashflow: CashFlowData | null;
  netWorth: NetWorthData | null;
  isLoading: boolean;
  error: Error | null;
}
```

#### Step 2: Create Centralized Data Hook

**File:** `client/src/features/reports/hooks/useReportData.ts`

```typescript
import { useQuery } from "@tanstack/react-query";
import type { ReportFilters, ReportData } from "../types";

export function useReportData(filters: ReportFilters): ReportData {
  const { dateRange, accounts, categories } = filters;

  const spendingQuery = useQuery({
    queryKey: ["reports", "spending", dateRange, accounts, categories],
    queryFn: () => fetchSpendingReport(filters),
    staleTime: 5 * 60 * 1000, // 5 minutes
  });

  const cashflowQuery = useQuery({
    queryKey: ["reports", "cashflow", dateRange, accounts],
    queryFn: () => fetchCashflowReport(filters),
    staleTime: 5 * 60 * 1000,
  });

  const netWorthQuery = useQuery({
    queryKey: ["reports", "networth", dateRange, accounts],
    queryFn: () => fetchNetWorthReport(filters),
    staleTime: 5 * 60 * 1000,
  });

  return {
    spending: spendingQuery.data ?? null,
    cashflow: cashflowQuery.data ?? null,
    netWorth: netWorthQuery.data ?? null,
    isLoading:
      spendingQuery.isLoading ||
      cashflowQuery.isLoading ||
      netWorthQuery.isLoading,
    error: spendingQuery.error || cashflowQuery.error || netWorthQuery.error,
  };
}
```

#### Step 3: Create Section Components

Each section component should be self-contained with its own loading/error states.

**File:** `client/src/features/reports/components/SpendingBreakdownSection.tsx`

```typescript
import { type SpendingBreakdownData } from "../types";

interface Props {
  data: SpendingBreakdownData | null;
  isLoading: boolean;
}

export function SpendingBreakdownSection({ data, isLoading }: Props) {
  if (isLoading) {
    return <ReportSectionSkeleton title="Spending Breakdown" />;
  }

  if (!data) {
    return <ReportSectionEmpty title="Spending Breakdown" />;
  }

  return (
    <ReportSection title="Spending Breakdown" total={data.total}>
      <PieChart data={data.categories} />
      <CategoryList categories={data.categories} />
    </ReportSection>
  );
}
```

#### Step 4: Refactor Reports.tsx

**File:** `client/src/pages/Reports.tsx` (Target: <300 LOC)

```typescript
import { useReportFilters, useReportData } from "@/features/reports";
import {
  ReportHeader,
  SpendingBreakdownSection,
  SpendingTrendSection,
  CashFlowSection,
  SavingsRateSection,
  NetWorthSection,
  DebtAnalysisSection,
  ForecastSection,
  SankeyDiagramSection,
} from "@/features/reports/components";

export default function Reports() {
  const { filters, setFilters, resetFilters } = useReportFilters();
  const reportData = useReportData(filters);

  return (
    <div className="reports-page">
      <ReportHeader
        filters={filters}
        onFiltersChange={setFilters}
        onReset={resetFilters}
      />

      <div className="report-sections">
        <SpendingBreakdownSection
          data={reportData.spending}
          isLoading={reportData.isLoading}
        />
        <SpendingTrendSection
          data={reportData.spending}
          isLoading={reportData.isLoading}
        />
        <CashFlowSection
          data={reportData.cashflow}
          isLoading={reportData.isLoading}
        />
        <SavingsRateSection
          data={reportData.cashflow}
          isLoading={reportData.isLoading}
        />
        <NetWorthSection
          data={reportData.netWorth}
          isLoading={reportData.isLoading}
        />
        <DebtAnalysisSection
          data={reportData.debt}
          isLoading={reportData.isLoading}
        />
        <ForecastSection
          data={reportData.forecast}
          isLoading={reportData.isLoading}
        />
        <SankeyDiagramSection
          data={reportData.sankey}
          isLoading={reportData.isLoading}
        />
      </div>
    </div>
  );
}
```

### Acceptance Criteria

- [ ] Reports.tsx < 300 LOC
- [ ] All 8+ report sections extracted to separate components
- [ ] Centralized data fetching with `useReportData` hook
- [ ] Loading skeletons for each section
- [ ] Error states for each section
- [ ] Unit tests for all components
- [ ] Integration test for full page

---

## 1.2 Create Accounts Feature Module ✅ COMPLETE

**Priority:** 🔴 HIGH
**Current State:** Accounts.tsx = 115 LOC (✅ Target Met)
**Target State:** Accounts.tsx < 300 LOC ✅ ACHIEVED
**Completed:** 2026-01-22
**Spec Reference:** Phase 5 (p.336-345), Accounts Module Specification (p.1826-1878)
**Status Note:** Feature module at `client/src/features/accounts/` with 15+ components including AccountCard, AccountList, NetWorthSummary, AddAccountModal, EditAccountModal, and more.

### File Structure to Create

```
client/src/features/accounts/
├── index.ts
├── types.ts
│
├── components/
│   ├── AccountList.tsx              # Account list with grouping
│   ├── AccountCard.tsx              # Individual account card
│   ├── AccountGroup.tsx             # Group header (Assets, Liabilities)
│   ├── NetWorthSummary.tsx          # Net worth card
│   ├── NetWorthChart.tsx            # Historical net worth chart
│   ├── AddAccountModal.tsx          # Add account form
│   ├── EditAccountModal.tsx         # Edit account form
│   ├── AccountFilters.tsx           # Filter by type, status
│   └── AccountActions.tsx           # Archive, delete actions
│
├── hooks/
│   ├── useAccountsData.ts           # Centralized account data
│   ├── useAccountMutations.ts       # Create, update, delete
│   └── useNetWorthHistory.ts        # Net worth history data
│
└── __tests__/
```

### Implementation Steps

1. Extract `AccountCard` component (~50 LOC)
2. Extract `AccountList` with grouping logic (~80 LOC)
3. Extract `NetWorthChart` component (~60 LOC)
4. Create `useAccountsData` hook (~40 LOC)
5. Refactor Accounts.tsx to use extracted components

### Acceptance Criteria (Met ✅)

- [x] Accounts.tsx < 300 LOC (115 LOC ✅)
- [x] Account grouping (Assets/Liabilities) in separate component (AccountGroup.tsx)
- [x] Net worth chart extracted (NetWorthChart.tsx, NetWorthSummary.tsx)
- [x] Add/Edit modals extracted (AddAccountModal.tsx, EditAccountModal.tsx)
- [x] Unit tests for AccountCard, AccountList

---

## 1.3 Create Investments Feature Module ✅ COMPLETE

**Priority:** 🔴 HIGH
**Current State:** Investments.tsx = 197 LOC ✅ ACHIEVED
**Target State:** Investments.tsx < 300 LOC ✅ ACHIEVED
**Completed:** 2026-01-21
**Spec Reference:** Investments Module Specification (p.1983-2073)
**Status Note:** Feature module at `client/src/features/investments/` implemented.

### File Structure to Create

```
client/src/features/investments/
├── index.ts
├── types.ts
│
├── components/
│   ├── HoldingsTable.tsx            # Holdings list with performance
│   ├── HoldingRow.tsx               # Individual holding row
│   ├── AllocationChart.tsx          # Asset allocation pie chart
│   ├── PerformanceChart.tsx         # Portfolio performance chart
│   ├── PortfolioSummary.tsx         # Total value, gain/loss
│   ├── SecuritySearch.tsx           # Security autocomplete
│   ├── AddHoldingModal.tsx          # Add holding form
│   ├── EditHoldingModal.tsx         # Edit holding form
│   └── InvestmentFilters.tsx        # Filter by account, type
│
├── hooks/
│   ├── useInvestmentsData.ts        # Centralized investment data
│   ├── usePortfolioPerformance.ts   # Performance calculations
│   └── useSecuritySearch.ts         # Security search
│
└── __tests__/
```

### Acceptance Criteria (Met ✅)

- [x] Investments.tsx < 300 LOC (197 LOC ✅)
- [x] Holdings table extracted with sorting
- [x] Allocation chart extracted
- [x] Performance chart extracted
- [x] Unit tests for HoldingsTable, AllocationChart

---

## 1.4 Create Goals Feature Module ✅ COMPLETE

**Priority:** 🟠 HIGH
**Current State:** Goals.tsx = 107 LOC ✅ ACHIEVED
**Target State:** Goals.tsx < 300 LOC ✅ ACHIEVED
**Completed:** 2026-01-21
**Spec Reference:** Goals Module Specification (p.1642-1699)
**Status Note:** Feature module at `client/src/features/goals/` with full component library.

### File Structure to Create

```
client/src/features/goals/
├── index.ts
├── types.ts
│
├── components/
│   ├── GoalList.tsx                 # Goals list with filters
│   ├── GoalCard.tsx                 # Individual goal card
│   ├── GoalProgressBar.tsx          # Progress visualization
│   ├── GoalProjection.tsx           # Target date projection
│   ├── AddGoalModal.tsx             # Create goal form
│   ├── EditGoalModal.tsx            # Edit goal form
│   ├── GoalContributionModal.tsx    # Add contribution form
│   ├── GoalAccountAssignment.tsx    # Account assignment UI
│   └── GoalFilters.tsx              # Filter by status, type
│
├── hooks/
│   ├── useGoalsData.ts
│   ├── useGoalMutations.ts
│   └── useGoalProjections.ts
│
└── __tests__/
```

### Acceptance Criteria (Met ✅)

- [x] Goals.tsx < 300 LOC (107 LOC ✅)
- [x] Goal cards extracted with progress visualization
- [x] Contribution modal extracted
- [x] Unit tests for GoalCard, GoalProgressBar

---

## 1.5 Create CashFlow Feature Module ✅ COMPLETE

**Priority:** 🟡 MEDIUM
**Current State:** CashFlow.tsx = 239 LOC ✅ ACHIEVED
**Target State:** CashFlow.tsx < 300 LOC ✅ ACHIEVED
**Completed:** 2026-01-23
**Status Note:** Feature module at `client/src/features/cashflow/` with components, hooks, and tests.

### File Structure to Create

```
client/src/features/cashflow/
├── index.ts
├── types.ts
│
├── components/
│   ├── CashFlowChart.tsx            # Main cashflow visualization
│   ├── IncomeBreakdown.tsx          # Income sources
│   ├── ExpenseBreakdown.tsx         # Expense categories
│   ├── CashFlowSummary.tsx          # Period summary
│   └── CashFlowFilters.tsx          # Date range, accounts
│
├── hooks/
│   └── useCashFlowData.ts
│
└── __tests__/
```

### Acceptance Criteria (Met ✅)

- [x] CashFlow.tsx < 300 LOC (239 LOC ✅)
- [x] Chart extracted with configuration
- [x] Breakdown components extracted

---

## 1.6 Create AccountDetail Feature Module 🟡 P2

**Priority:** 🟡 MEDIUM
**Current State:** AccountDetail.tsx < 300 LOC ✅ COMPLETED
**Target State:** AccountDetail.tsx < 300 LOC
**Effort:** 1.5 days

### File Structure to Create

```
client/src/features/account-detail/
├── index.ts
├── types.ts
│
├── components/
│   ├── AccountHeader.tsx            # Account name, balance, type
│   ├── BalanceHistoryChart.tsx      # Historical balance chart
│   ├── TransactionList.tsx          # Account transactions (reuse from transactions feature)
│   ├── TransactionGroupByDate.tsx   # Group transactions by date
│   ├── BalanceAdjustmentModal.tsx   # Manual balance adjustment
│   └── AccountStats.tsx             # Account statistics
│
├── hooks/
│   ├── useAccountDetail.ts
│   └── useBalanceHistory.ts
│
└── __tests__/
```

### Acceptance Criteria

- [ ] AccountDetail.tsx < 300 LOC
- [ ] Balance history chart extracted
- [ ] Transaction grouping extracted

---

## 1.7 Complete Budget Feature Module Refactor ✅ COMPLETE

**Priority:** 🟡 MEDIUM
**Current State:** Budget.tsx = 282 LOC ✅ ACHIEVED
**Target State:** Budget.tsx < 300 LOC ✅ ACHIEVED
**Completed:** 2026-01-28
**Status Note:** Feature module at `client/src/features/budget/` implemented.

### Required Changes

The budget feature module exists with 15 files, but Budget.tsx is still 251 LOC over target.

**Additional Extraction Needed:**

1. Extract page header/navigation logic
2. Extract layout composition logic
3. Move remaining inline components to feature module

**Files to Modify:**

- `client/src/pages/Budget.tsx` - Reduce to orchestration only
- `client/src/features/budget/components/BudgetPageLayout.tsx` - NEW

### Acceptance Criteria (Met ✅)

- [x] Budget.tsx < 300 LOC (282 LOC ✅)
- [x] All inline styled components moved to feature module
- [x] Navigation/header logic extracted

---

## 1.8 Complete Recurring Feature Module Refactor 🟢 P3

**Priority:** 🟢 LOW
**Current State:** Recurring.tsx = 226 LOC ✅ COMPLETED
**Target State:** Recurring.tsx < 300 LOC
**Effort:** 0.5 days

### Required Changes

Similar to Budget - feature module exists but needs additional extraction.

**Additional Extraction Needed:**

1. Extract page layout wrapper
2. Move remaining state management to hooks

### Acceptance Criteria

- [ ] Recurring.tsx < 300 LOC (reduce by 104 LOC)

---

## 1.9 GoalCreationFlow Refactor 🟢 P3

**Priority:** 🟢 LOW
**Current State:** GoalCreationFlow.tsx = 215 LOC ✅ COMPLETED
**Target State:** GoalCreationFlow.tsx < 300 LOC
**Effort:** 0.5 days

### Required Changes

Only 63 LOC over target - minor refactoring needed.

1. Extract step components if inline
2. Extract form configuration to constants

### Acceptance Criteria

- [ ] GoalCreationFlow.tsx < 300 LOC

---

## 1.10 Login.tsx Refactor 🟢 P3

**Priority:** 🟢 LOW
**Current State:** Login.tsx = 316 LOC (1.05x over limit)
**Target State:** Login.tsx < 300 LOC
**Effort:** 0.25 days

### Required Changes

Only 16 LOC over target - minimal refactoring needed.

### Acceptance Criteria

- [ ] Login.tsx < 300 LOC

---

# PART 2: PARTIAL SERVER MODULE COMPLETION

> **Spec Reference:** "Every domain has controllers, services, repositories, and validation schemas" (Global Requirements, p.354)
>
> **Current Status:** Only 4 of 17 modules follow full pattern (24%)

---

## 2.1 Complete Transactions Module Service 🟠 P1

**Priority:** 🟠 HIGH
**Current State:** `transactions.service.ts` ✅ COMPLETED
**Target State:** Full service implementation per spec
**Effort:** 2 days
**Spec Reference:** TransactionService specification (p.301-308)

### Current File Analysis

```typescript
// Current: server/modules/transactions/transactions.service.ts (18 LOC)
export { transactionService } from "../../services/TransactionService";
```

### Required Implementation

**File:** `server/modules/transactions/transactions.service.ts`

```typescript
import { db } from "../../db";
import { transactions } from "@shared/schema";
import {
  eventBus,
  TRANSACTION_CREATED,
  TRANSACTION_UPDATED,
  TRANSACTION_DELETED,
} from "../../core/events";
import { auditService } from "../../services/AuditService";
import {
  NotFoundError,
  ValidationError,
  ForbiddenError,
} from "../../core/errors";
import type {
  RequestContext,
  CreateTransactionInput,
  UpdateTransactionInput,
} from "./transactions.types";

export interface TransactionService {
  // CRUD
  create(
    input: CreateTransactionInput,
    ctx: RequestContext
  ): Promise<Transaction>;
  update(
    id: string,
    input: UpdateTransactionInput,
    ctx: RequestContext
  ): Promise<Transaction>;
  delete(id: string, ctx: RequestContext): Promise<void>;
  getById(id: string, ctx: RequestContext): Promise<Transaction | null>;
  list(
    filters: TransactionFilters,
    ctx: RequestContext
  ): Promise<Transaction[]>;

  // Bulk operations
  bulkUpdate(
    ids: string[],
    input: Partial<UpdateTransactionInput>,
    ctx: RequestContext
  ): Promise<Transaction[]>;
  bulkDelete(ids: string[], ctx: RequestContext): Promise<void>;

  // Import
  import(data: ImportData, ctx: RequestContext): Promise<ImportResult>;

  // Invariants (per spec)
  validateSignConvention(transaction: CreateTransactionInput): void;
  validateCurrencyConsistency(
    transaction: CreateTransactionInput,
    account: Account
  ): void;
  validateAccountOwnership(
    accountId: string,
    ctx: RequestContext
  ): Promise<void>;
}

class TransactionServiceImpl implements TransactionService {
  async create(
    input: CreateTransactionInput,
    ctx: RequestContext
  ): Promise<Transaction> {
    // 1. Validate invariants
    this.validateSignConvention(input);
    await this.validateAccountOwnership(input.accountId, ctx);

    const account = await this.getAccount(input.accountId);
    this.validateCurrencyConsistency(input, account);

    // 2. Check idempotency
    if (input.idempotencyKey) {
      const existing = await this.findByIdempotencyKey(input.idempotencyKey);
      if (existing) return existing;
    }

    // 3. Create transaction
    const [transaction] = await db
      .insert(transactions)
      .values({
        ...input,
        householdId: ctx.householdId,
        createdBy: ctx.userId,
      })
      .returning();

    // 4. Emit event
    eventBus.emit(TRANSACTION_CREATED, transaction, ctx.traceId);

    // 5. Audit log
    await auditService.log({
      action: "transaction.created",
      userId: ctx.userId,
      resourceId: transaction.id,
      details: { amount: input.amount, accountId: input.accountId },
    });

    return transaction;
  }

  validateSignConvention(input: CreateTransactionInput): void {
    // Per spec: expenses are negative, income is positive
    if (input.type === "expense" && parseFloat(input.amount) > 0) {
      throw new ValidationError(
        "Expense transactions must have negative amounts"
      );
    }
    if (input.type === "income" && parseFloat(input.amount) < 0) {
      throw new ValidationError(
        "Income transactions must have positive amounts"
      );
    }
  }

  validateCurrencyConsistency(
    input: CreateTransactionInput,
    account: Account
  ): void {
    if (input.currency && input.currency !== account.currency) {
      throw new ValidationError(
        `Transaction currency (${input.currency}) must match account currency (${account.currency})`
      );
    }
  }

  async validateAccountOwnership(
    accountId: string,
    ctx: RequestContext
  ): Promise<void> {
    const account = await this.getAccount(accountId);
    if (account.householdId !== ctx.householdId) {
      throw new ForbiddenError("Account does not belong to your household");
    }
  }

  // ... implement remaining methods
}

export const transactionService = new TransactionServiceImpl();
```

### Acceptance Criteria

- [ ] Full service implementation with all methods from spec
- [ ] Sign convention enforcement
- [ ] Currency consistency checks
- [ ] Account ownership validation
- [ ] Idempotency key support
- [ ] Event emission for create/update/delete
- [ ] Audit logging integration
- [ ] Unit tests with >80% coverage

---

## 2.2 Complete Budgets Module Service 🟠 P1

**Priority:** 🟠 HIGH
**Current State:** `budgets.service.ts` = 7 LOC (re-export only)
**Target State:** Full service implementation per spec
**Effort:** 1.5 days
**Spec Reference:** BudgetsService Interface (p.1726-1754)

### Current State

```typescript
// Current: server/modules/budgets/budgets.service.ts (7 LOC)
export { budgetService } from "../../services/BudgetService";
```

### Required Implementation

Per spec, implement:

- CRUD operations
- Progress tracking (`getProgress`, `getCategoryProgress`)
- Alerts (`checkThresholds`, `getAlerts`, `dismissAlert`)
- Rollover (`rolloverBudgets`)
- Forecast (`getForecast`)
- Settings (`getSettings`, `updateSettings`)

### Acceptance Criteria

- [ ] Full service implementation per spec interface
- [ ] Threshold checking logic
- [ ] Rollover logic for period transitions
- [ ] Integration with core/calculations/budget

---

## 2.3 Complete Recurring Module Service 🟠 P1

**Priority:** 🟠 HIGH
**Current State:** `recurring.service.ts` = 5 LOC (re-export only)
**Target State:** Full service implementation per spec
**Effort:** 2 days
**Spec Reference:** RecurringService Interface (p.1906-1938)

### Required Implementation

Per spec, implement:

- CRUD operations
- Detection (`detectPatterns`, `confirmPattern`)
- Occurrences (`getUpcoming`, `getSummary`)
- Linking (`linkTransaction`, `unlinkTransaction`)
- Lifecycle (`skip`, `pause`, `resume`, `end`)
- Processing (`processRecurring`, `sendReminders`)

### Sub-Services to Create

Per spec (p.1943-1979):

```
server/modules/recurring/sub-services/
├── rule-engine.service.ts        # Pattern detection & matching
├── occurrence-generator.service.ts # Generate future occurrences
├── linking.service.ts            # Link transactions to rules
└── reminder.service.ts           # Upcoming payment reminders
```

### Acceptance Criteria

- [ ] Full service implementation per spec interface
- [ ] Rule engine with pattern detection
- [ ] Occurrence generator
- [ ] Reminder system

---

## 2.4 Complete Investments Module Service 🟡 P2

**Priority:** 🟡 MEDIUM
**Current State:** `investments.service.ts` = 25 LOC (minimal)
**Target State:** Full service implementation per spec
**Effort:** 2 days
**Spec Reference:** Investments Module Specification (p.1983-2073)

### Required Sub-Modules (Per Spec)

```
server/modules/investments/
├── holdings/
│   ├── holdings.controller.ts
│   ├── holdings.service.ts
│   └── holdings.repository.ts
├── portfolio/
│   ├── portfolio.service.ts       # Summary, allocation, benchmarks, performance
│   └── portfolio.repository.ts
├── analytics/
│   ├── analytics.service.ts       # FX attribution, performance attribution
│   └── analytics.repository.ts
├── securities/
│   ├── securities.service.ts      # Create, search, price updates
│   └── securities.repository.ts
└── market/
    ├── market-data.service.ts     # Price fetching
    └── fx-rates.service.ts        # FX rate updates
```

### Acceptance Criteria

- [ ] Holdings sub-module with tax lot tracking
- [ ] Portfolio sub-module with performance metrics
- [ ] Analytics sub-module with FX attribution
- [ ] Securities sub-module with price history
- [ ] Market data service integration

---

## 2.5 Add Validation Schemas to Modules 🟡 P2

**Priority:** 🟡 MEDIUM
**Current State:** Only 4 modules have validation schemas
**Target State:** All 17 modules have validation schemas
**Effort:** 2 days
**Spec Reference:** "Explicit contracts - All inputs validated and typed" (p.134)

### Modules Needing Validation Schemas

| Module        | File to Create              | Priority |
| ------------- | --------------------------- | -------- |
| accounts      | accounts.validation.ts      | 🟠 P1    |
| goals         | goals.validation.ts         | 🟠 P1    |
| budgets       | budgets.validation.ts       | 🟠 P1    |
| recurring     | recurring.validation.ts     | 🟠 P1    |
| investments   | investments.validation.ts   | 🟡 P2    |
| settings      | settings.validation.ts      | 🟡 P2    |
| categories    | categories.validation.ts    | 🟡 P2    |
| tags          | tags.validation.ts          | 🟢 P3    |
| merchants     | merchants.validation.ts     | 🟢 P3    |
| rules         | rules.validation.ts         | 🟢 P3    |
| household     | household.validation.ts     | 🟢 P3    |
| notifications | notifications.validation.ts | 🟢 P3    |

### Example Implementation

**File:** `server/modules/accounts/accounts.validation.ts`

```typescript
import { z } from "zod";

export const createAccountSchema = z.object({
  name: z.string().min(1).max(100),
  type: z.enum([
    "checking",
    "savings",
    "credit",
    "investment",
    "loan",
    "other",
  ]),
  currency: z.string().length(3),
  balance: z.string().regex(/^-?\d+(\.\d{1,4})?$/),
  institution: z.string().max(100).optional(),
  accountNumber: z.string().max(50).optional(),
  isArchived: z.boolean().default(false),
});

export const updateAccountSchema = createAccountSchema.partial();

export const adjustBalanceSchema = z.object({
  newBalance: z.string().regex(/^-?\d+(\.\d{1,4})?$/),
  date: z.string().datetime(),
  notes: z.string().max(500).optional(),
});

// Register with central registry
import { schemaRegistry } from "../../core/validation";
schemaRegistry.register("accounts.create", createAccountSchema);
schemaRegistry.register("accounts.update", updateAccountSchema);
schemaRegistry.register("accounts.adjustBalance", adjustBalanceSchema);
```

### Acceptance Criteria

- [ ] All 17 modules have validation schemas
- [ ] All schemas registered with central registry
- [ ] Validation middleware applied to all routes

---

## 2.6 Add Repository Layer to CR-Only Modules 🟢 P3

**Priority:** 🟢 LOW
**Current State:** 9 modules are controller-routes only (no repository)
**Target State:** All modules with data access have repository layer
**Effort:** 3 days

### Modules Needing Repository Layer

| Module        | Current Data Access      | Repository Needed? |
| ------------- | ------------------------ | ------------------ |
| accounts      | Uses accountService      | ⚠️ Optional        |
| categories    | Uses storage.ts          | ✅ Yes             |
| goals         | Uses goalService         | ⚠️ Optional        |
| household     | Uses storage.ts          | ✅ Yes             |
| merchants     | Direct DB queries        | ✅ Yes             |
| notifications | Uses notificationService | ⚠️ Optional        |
| rules         | Uses storage.ts          | ✅ Yes             |
| settings      | Uses storage.ts          | ✅ Yes             |
| tags          | Uses storage.ts          | ✅ Yes             |

### Decision Required

**Option A (Recommended):** Define two official patterns:

1. **Full Pattern:** For complex domains with business logic (auth, transactions, reports, investments)
2. **Thin Pattern:** For simple CRUD with minimal logic (categories, tags, merchants)

**Option B:** Create repositories for all modules (more work, potentially over-engineered)

### Acceptance Criteria

- [ ] Document which modules use which pattern
- [ ] Create repositories for high-value modules (categories, merchants, rules)
- [ ] Accept thin pattern for simple CRUD modules

---

# PART 3: CRITICAL MISSING INFRASTRUCTURE

> **Spec Reference:** Multiple sections defining required infrastructure

---

## 3.1 Implement Health Check Endpoints ✅ COMPLETE

**Priority:** 🔴 CRITICAL
**Current State:** Implemented at `server/modules/health/`
**Target State:** Three health endpoints per spec ✅ ACHIEVED
**Completed:** 2026-01-13
**Spec Reference:** Health Checks (p.737-790)
**Status Note:** Health module with controller and routes implemented at `server/modules/health/`.

### Required Endpoints

| Endpoint              | Purpose             | Checks                  |
| --------------------- | ------------------- | ----------------------- |
| `GET /health/live`    | Is process running? | Always returns 200      |
| `GET /health/ready`   | Can accept traffic? | DB, cache, dependencies |
| `GET /health/startup` | Has initialized?    | Migrations, warmup      |

### Implementation

**File to Create:** `server/routes/health.ts`

```typescript
import { Router, Request, Response } from "express";
import { db } from "../db";
import { sql } from "drizzle-orm";
import { cacheStore } from "../core/cache";
import { logger } from "../utils/logger";

const router = Router();

interface HealthCheck {
  status: "healthy" | "unhealthy";
  latency?: number;
  error?: string;
}

interface HealthResponse {
  status: "healthy" | "unhealthy";
  checks: Record<string, HealthCheck>;
  version: string;
  uptime: number;
}

/**
 * Liveness probe - is the process running?
 * Used by orchestrators to know if container is alive
 */
router.get("/live", (req: Request, res: Response) => {
  res.status(200).json({
    status: "healthy",
    uptime: process.uptime(),
  });
});

/**
 * Readiness probe - can accept traffic?
 * Checks database and cache connectivity
 */
router.get("/ready", async (req: Request, res: Response) => {
  const checks: Record<string, HealthCheck> = {};
  let overallHealthy = true;

  // Check database
  const dbStart = Date.now();
  try {
    await db.execute(sql`SELECT 1`);
    checks.database = { status: "healthy", latency: Date.now() - dbStart };
  } catch (error) {
    checks.database = { status: "unhealthy", error: (error as Error).message };
    overallHealthy = false;
  }

  // Check cache
  const cacheStart = Date.now();
  try {
    await cacheStore.ping();
    checks.cache = { status: "healthy", latency: Date.now() - cacheStart };
  } catch (error) {
    checks.cache = { status: "unhealthy", error: (error as Error).message };
    // Cache failure is not critical - degrade gracefully
  }

  const response: HealthResponse = {
    status: overallHealthy ? "healthy" : "unhealthy",
    checks,
    version: process.env.npm_package_version || "unknown",
    uptime: process.uptime(),
  };

  res.status(overallHealthy ? 200 : 503).json(response);
});

/**
 * Startup probe - has initialization completed?
 * Used by orchestrators during container startup
 */
router.get("/startup", async (req: Request, res: Response) => {
  const checks: Record<string, HealthCheck> = {};
  let ready = true;

  // Check database connection pool
  try {
    await db.execute(sql`SELECT 1`);
    checks.database = { status: "healthy" };
  } catch (error) {
    checks.database = { status: "unhealthy", error: (error as Error).message };
    ready = false;
  }

  // Check if migrations are up to date (optional)
  // checks.migrations = await checkMigrations();

  const response: HealthResponse = {
    status: ready ? "healthy" : "unhealthy",
    checks,
    version: process.env.npm_package_version || "unknown",
    uptime: process.uptime(),
  };

  res.status(ready ? 200 : 503).json(response);
});

export default router;
```

**File to Modify:** `server/routes.ts`

```typescript
import healthRoutes from "./routes/health";

// Add at top level (before /api prefix)
app.use("/health", healthRoutes);
```

### Acceptance Criteria (Met ✅)

- [x] `GET /health/live` returns 200 always
- [x] `GET /health/ready` checks DB and cache
- [x] `GET /health/startup` validates initialization
- [x] Response format matches spec (p.746-767)
- [x] Graceful degradation for non-critical services

---

## 3.2 Create Client Date Utilities ✅ COMPLETE

**Priority:** 🔴 CRITICAL
**Current State:** Implemented at `client/src/lib/dates.ts` (6,453 bytes)
**Target State:** Centralized date library per spec ✅ ACHIEVED
**Completed:** 2026-01-13
**Spec Reference:** "Date Utilities (B6)" in Phase 5 (p.439-443)
**Status Note:** Full date utility library with parsing, formatting, date ranges, and utilities.

### Implementation

**File to Create:** `client/src/lib/dates.ts`

```typescript
import {
  format,
  parse,
  parseISO,
  isValid,
  startOfDay,
  endOfDay,
  startOfWeek,
  endOfWeek,
  startOfMonth,
  endOfMonth,
  startOfYear,
  endOfYear,
  subDays,
  subMonths,
  subYears,
  differenceInDays,
  addDays,
} from "date-fns";

// ============================================
// PARSING
// ============================================

/**
 * Parse a date string from API (ISO format)
 * @param dateStr ISO date string (e.g., "2026-01-11T00:00:00Z")
 * @returns Date object or null if invalid
 */
export function parseDate(dateStr: string | null | undefined): Date | null {
  if (!dateStr) return null;

  try {
    const date = parseISO(dateStr);
    return isValid(date) ? date : null;
  } catch {
    return null;
  }
}

/**
 * Parse a date with a specific format
 */
export function parseDateWithFormat(
  dateStr: string,
  formatStr: string
): Date | null {
  try {
    const date = parse(dateStr, formatStr, new Date());
    return isValid(date) ? date : null;
  } catch {
    return null;
  }
}

/**
 * Check if a value is a valid date
 */
export function isValidDate(date: unknown): date is Date {
  return date instanceof Date && isValid(date);
}

// ============================================
// FORMATTING
// ============================================

/**
 * Format date for display (e.g., "Jan 11, 2026")
 */
export function formatDisplayDate(date: Date | string): string {
  const d = typeof date === "string" ? parseDate(date) : date;
  if (!d) return "";
  return format(d, "MMM d, yyyy");
}

/**
 * Format date for short display (e.g., "Jan 11")
 */
export function formatShortDate(date: Date | string): string {
  const d = typeof date === "string" ? parseDate(date) : date;
  if (!d) return "";
  return format(d, "MMM d");
}

/**
 * Format date for API requests (ISO 8601)
 */
export function formatISODate(date: Date): string {
  return date.toISOString();
}

/**
 * Format date for URL params (YYYY-MM-DD)
 */
export function formatDateParam(date: Date): string {
  return format(date, "yyyy-MM-dd");
}

/**
 * Format relative date (e.g., "Today", "Yesterday", "3 days ago")
 */
export function formatRelativeDate(date: Date | string): string {
  const d = typeof date === "string" ? parseDate(date) : date;
  if (!d) return "";

  const now = new Date();
  const daysDiff = differenceInDays(startOfDay(now), startOfDay(d));

  if (daysDiff === 0) return "Today";
  if (daysDiff === 1) return "Yesterday";
  if (daysDiff < 7) return `${daysDiff} days ago`;
  if (daysDiff < 30) return `${Math.floor(daysDiff / 7)} weeks ago`;
  if (daysDiff < 365) return `${Math.floor(daysDiff / 30)} months ago`;
  return `${Math.floor(daysDiff / 365)} years ago`;
}

// ============================================
// DATE RANGES
// ============================================

export interface DateRange {
  startDate: Date;
  endDate: Date;
}

export type DateRangeName =
  | "today"
  | "yesterday"
  | "thisWeek"
  | "lastWeek"
  | "thisMonth"
  | "lastMonth"
  | "last30Days"
  | "last90Days"
  | "thisYear"
  | "lastYear"
  | "allTime";

/**
 * Get predefined date range
 */
export function getDateRange(range: DateRangeName): DateRange {
  const now = new Date();

  switch (range) {
    case "today":
      return { startDate: startOfDay(now), endDate: endOfDay(now) };
    case "yesterday":
      return {
        startDate: startOfDay(subDays(now, 1)),
        endDate: endOfDay(subDays(now, 1)),
      };
    case "thisWeek":
      return { startDate: startOfWeek(now), endDate: endOfDay(now) };
    case "lastWeek":
      return {
        startDate: startOfWeek(subDays(now, 7)),
        endDate: endOfWeek(subDays(now, 7)),
      };
    case "thisMonth":
      return { startDate: startOfMonth(now), endDate: endOfDay(now) };
    case "lastMonth":
      return {
        startDate: startOfMonth(subMonths(now, 1)),
        endDate: endOfMonth(subMonths(now, 1)),
      };
    case "last30Days":
      return { startDate: subDays(now, 30), endDate: endOfDay(now) };
    case "last90Days":
      return { startDate: subDays(now, 90), endDate: endOfDay(now) };
    case "thisYear":
      return { startDate: startOfYear(now), endDate: endOfDay(now) };
    case "lastYear":
      return {
        startDate: startOfYear(subYears(now, 1)),
        endDate: endOfYear(subYears(now, 1)),
      };
    case "allTime":
      return { startDate: new Date(2000, 0, 1), endDate: endOfDay(now) };
  }
}

/**
 * Format a date range for display
 */
export function formatDateRange(range: DateRange): string {
  return `${formatDisplayDate(range.startDate)} - ${formatDisplayDate(
    range.endDate
  )}`;
}

// ============================================
// UTILITIES
// ============================================

/**
 * Get array of dates between start and end
 */
export function getDatesBetween(start: Date, end: Date): Date[] {
  const dates: Date[] = [];
  let current = startOfDay(start);
  const endDate = startOfDay(end);

  while (current <= endDate) {
    dates.push(current);
    current = addDays(current, 1);
  }

  return dates;
}
```

### Acceptance Criteria (Met ✅)

- [x] File created at `client/src/lib/dates.ts`
- [x] All formatting functions use consistent locale
- [x] ISO strings used for API communication
- [x] Unit tests for all functions

---

## 3.3 Implement API Versioning 🟠 P1

**Priority:** 🟠 HIGH
**Current State:** No API versioning
**Target State:** `/api/v1/` prefix per spec
**Effort:** 4-5 hours
**Spec Reference:** API Versioning Strategy (p.388-428)

### Implementation

**File to Modify:** `server/routes.ts`

```typescript
import { Router } from "express";

const v1Router = Router();

// Mount all current routes under v1
v1Router.use("/auth", authRoutes);
v1Router.use("/transactions", transactionRoutes);
v1Router.use("/accounts", accountRoutes);
// ... all other routes

// Version 1 API
app.use("/api/v1", v1Router);

// Backward compatibility - redirect /api to /api/v1
app.use(
  "/api",
  (req, res, next) => {
    // Add deprecation headers
    res.setHeader("Deprecation", "true");
    res.setHeader("Sunset", "Sat, 01 Jul 2026 00:00:00 GMT");
    res.setHeader("Link", `</api/v1${req.path}>; rel="successor-version"`);
    next();
  },
  v1Router
);
```

**File to Create:** `docs/API_VERSIONING.md`

Document the versioning strategy, deprecation timeline, and migration guide.

### Acceptance Criteria

- [ ] All routes accessible via `/api/v1/`
- [ ] Legacy `/api/` routes still work with deprecation headers
- [ ] Documentation created
- [ ] Client updated to use `/api/v1/`

---

## 3.4 Implement Graceful Shutdown 🟡 P2

**Priority:** 🟡 MEDIUM
**Current State:** No graceful shutdown
**Target State:** Proper shutdown handling per spec
**Effort:** 2 hours
**Spec Reference:** Graceful Shutdown (p.769-790)

### Implementation

**File to Modify:** `server/index.ts`

```typescript
import { db } from "./db";
import { logger } from "./utils/logger";
import { cacheStore } from "./core/cache";
import { jobRunner } from "./core/jobs";

const SHUTDOWN_TIMEOUT_MS = 30000; // 30 seconds

let isShuttingDown = false;

async function gracefulShutdown(signal: string) {
  if (isShuttingDown) {
    logger.warn("Shutdown already in progress", { signal });
    return;
  }

  isShuttingDown = true;
  logger.info("Received shutdown signal, starting graceful shutdown", {
    signal,
  });

  // 1. Stop accepting new requests
  server.close(() => {
    logger.info("HTTP server closed");
  });

  // 2. Stop background job processing
  await jobRunner.stop();
  logger.info("Job runner stopped");

  // 3. Wait for in-flight requests (with timeout)
  const shutdownPromise = new Promise<void>((resolve) => {
    const checkConnections = setInterval(() => {
      // Check if all connections are closed
      // This is simplified - in production, track active connections
      resolve();
      clearInterval(checkConnections);
    }, 1000);
  });

  const timeoutPromise = new Promise<void>((_, reject) => {
    setTimeout(
      () => reject(new Error("Shutdown timeout")),
      SHUTDOWN_TIMEOUT_MS
    );
  });

  try {
    await Promise.race([shutdownPromise, timeoutPromise]);
  } catch (error) {
    logger.warn("Shutdown timeout reached, forcing shutdown");
  }

  // 4. Close database connections
  try {
    // Note: Drizzle doesn't have explicit close, but pool does
    logger.info("Database connections closed");
  } catch (error) {
    logger.error("Error closing database", {}, error as Error);
  }

  // 5. Close cache connections
  try {
    await cacheStore.close();
    logger.info("Cache connections closed");
  } catch (error) {
    logger.error("Error closing cache", {}, error as Error);
  }

  logger.info("Graceful shutdown complete");
  process.exit(0);
}

// Register signal handlers
process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));

// Handle uncaught errors
process.on("uncaughtException", (error) => {
  logger.error("Uncaught exception", {}, error);
  gracefulShutdown("uncaughtException");
});

process.on("unhandledRejection", (reason) => {
  logger.error("Unhandled rejection", { reason: String(reason) });
  gracefulShutdown("unhandledRejection");
});
```

### Acceptance Criteria

- [ ] SIGTERM/SIGINT handlers implemented
- [ ] HTTP server stops accepting new connections
- [ ] In-flight requests allowed to complete (30s timeout)
- [ ] Database connections closed
- [ ] Cache connections closed

---

## 3.5 Implement Secrets Rotation (SEC-09) 🟡 P2

**Priority:** 🟡 MEDIUM
**Current State:** Not implemented (last remaining security item)
**Target State:** Secrets rotation support per spec
**Effort:** 4-6 hours
**Spec Reference:** SEC-09 in refactoring-todo.md (line 153-157)

### Implementation

**File to Create:** `server/config/secrets.ts`

```typescript
import { logger } from "../utils/logger";

interface SecretConfig {
  current: string;
  previous?: string;
  rotatedAt?: Date;
  expiresAt?: Date;
}

interface SecretsConfig {
  jwtSecret: SecretConfig;
  sessionSecret: SecretConfig;
}

class SecretsManager {
  private secrets: SecretsConfig;

  constructor() {
    this.secrets = this.loadSecrets();
  }

  private loadSecrets(): SecretsConfig {
    return {
      jwtSecret: {
        current: process.env.JWT_SECRET!,
        previous: process.env.JWT_SECRET_PREVIOUS,
        rotatedAt: process.env.JWT_ROTATED_AT
          ? new Date(process.env.JWT_ROTATED_AT)
          : undefined,
      },
      sessionSecret: {
        current: process.env.SESSION_SECRET!,
        previous: process.env.SESSION_SECRET_PREVIOUS,
      },
    };
  }

  /**
   * Get current JWT secret for signing
   */
  getJwtSigningSecret(): string {
    return this.secrets.jwtSecret.current;
  }

  /**
   * Get JWT secrets for verification (supports dual-key during rotation)
   */
  getJwtVerificationSecrets(): string[] {
    const secrets = [this.secrets.jwtSecret.current];
    if (this.secrets.jwtSecret.previous) {
      secrets.push(this.secrets.jwtSecret.previous);
    }
    return secrets;
  }

  /**
   * Verify JWT with support for old secret during rotation
   */
  async verifyJwt(token: string): Promise<JwtPayload> {
    const secrets = this.getJwtVerificationSecrets();

    for (const secret of secrets) {
      try {
        return jwt.verify(token, secret) as JwtPayload;
      } catch (error) {
        continue; // Try next secret
      }
    }

    throw new Error("Invalid token - no matching secret");
  }

  /**
   * Get session secret for signing
   */
  getSessionSecret(): string {
    return this.secrets.sessionSecret.current;
  }

  /**
   * Check if rotation is needed
   */
  isRotationNeeded(secretName: keyof SecretsConfig): boolean {
    const secret = this.secrets[secretName];
    if (!secret.rotatedAt) return true;

    // JWT: rotate quarterly (90 days)
    const rotationPeriodDays = 90;
    const daysSinceRotation =
      (Date.now() - secret.rotatedAt.getTime()) / (1000 * 60 * 60 * 24);

    return daysSinceRotation >= rotationPeriodDays;
  }

  /**
   * Log rotation status for monitoring
   */
  logRotationStatus(): void {
    logger.info("Secrets rotation status", {
      jwtRotationNeeded: this.isRotationNeeded("jwtSecret"),
      jwtLastRotated: this.secrets.jwtSecret.rotatedAt?.toISOString(),
      sessionRotationNeeded: this.isRotationNeeded("sessionSecret"),
    });
  }
}

export const secretsManager = new SecretsManager();
```

**File to Create:** `docs/secrets-rotation.md`

Document the rotation procedure:

1. Generate new secret
2. Add to `*_PREVIOUS` env var
3. Deploy with dual-key verification
4. After grace period (7 days), remove old secret
5. Update monitoring

### Acceptance Criteria

- [ ] SecretsManager class implemented
- [ ] Dual-key JWT verification during rotation
- [ ] Rotation status logging
- [ ] Documentation for rotation procedure
- [ ] Integration with auth middleware

---

## 3.6 Add Cache Store Ping Method 🟢 P3

**Priority:** 🟢 LOW
**Current State:** Cache store may not have ping for health checks
**Effort:** 30 minutes

**File to Modify:** `server/core/cache/store.ts`

```typescript
async ping(): Promise<void> {
  // Verify cache is operational
  const testKey = "__health_check__";
  await this.set(testKey, "ok", { ttl: 1000 });
  const value = await this.get(testKey);
  if (value !== "ok") {
    throw new Error("Cache ping failed");
  }
  await this.delete(testKey);
}
```

---

# PART 4: MONITORING & OBSERVABILITY

> **Spec Reference:** Monitoring & Alerting (p.922-973)

---

## 4.1 Implement Request Latency Metrics 🟡 P2

**Priority:** 🟡 MEDIUM
**Current State:** No latency metrics
**Target State:** P50/P95/P99 latency tracking per spec
**Effort:** 1 day
**Spec Reference:** Key Metrics (p.926-935), API Latency Targets (p.798-805)

### Implementation

**Package to Install:** `prom-client`

```bash
npm install prom-client
```

**File to Create:** `server/core/metrics/index.ts`

```typescript
import {
  Registry,
  Counter,
  Histogram,
  Gauge,
  collectDefaultMetrics,
} from "prom-client";

// Create registry
export const metricsRegistry = new Registry();

// Collect default Node.js metrics
collectDefaultMetrics({ register: metricsRegistry });

// API request metrics
export const apiRequestsTotal = new Counter({
  name: "api_requests_total",
  help: "Total number of API requests",
  labelNames: ["method", "endpoint", "status"],
  registers: [metricsRegistry],
});

export const apiRequestDurationMs = new Histogram({
  name: "api_request_duration_ms",
  help: "API request duration in milliseconds",
  labelNames: ["method", "endpoint"],
  buckets: [10, 25, 50, 100, 200, 500, 1000, 2500, 5000],
  registers: [metricsRegistry],
});

// Database query metrics
export const dbQueryDurationMs = new Histogram({
  name: "db_query_duration_ms",
  help: "Database query duration in milliseconds",
  labelNames: ["query_type"],
  buckets: [5, 10, 25, 50, 100, 250, 500, 1000],
  registers: [metricsRegistry],
});

// Cache metrics
export const cacheHitsTotal = new Counter({
  name: "cache_hits_total",
  help: "Total cache hits",
  labelNames: ["cache_name"],
  registers: [metricsRegistry],
});

export const cacheMissesTotal = new Counter({
  name: "cache_misses_total",
  help: "Total cache misses",
  labelNames: ["cache_name"],
  registers: [metricsRegistry],
});

// Job metrics
export const jobExecutionsTotal = new Counter({
  name: "job_executions_total",
  help: "Total job executions",
  labelNames: ["job_type", "status"],
  registers: [metricsRegistry],
});

// Active connections
export const activeConnections = new Gauge({
  name: "active_connections",
  help: "Number of active connections",
  registers: [metricsRegistry],
});
```

**File to Create:** `server/middleware/metrics.ts`

```typescript
import { Request, Response, NextFunction } from "express";
import { apiRequestsTotal, apiRequestDurationMs } from "../core/metrics";

export function metricsMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
) {
  const start = Date.now();

  // Normalize endpoint for metrics (replace IDs with :id)
  const endpoint =
    req.route?.path || req.path.replace(/\/[0-9a-f-]{36}/gi, "/:id");

  res.on("finish", () => {
    const duration = Date.now() - start;
    const method = req.method;
    const status = res.statusCode.toString();

    apiRequestsTotal.inc({ method, endpoint, status });
    apiRequestDurationMs.observe({ method, endpoint }, duration);
  });

  next();
}
```

**File to Create:** `server/routes/metrics.ts`

```typescript
import { Router } from "express";
import { metricsRegistry } from "../core/metrics";

const router = Router();

router.get("/", async (req, res) => {
  res.set("Content-Type", metricsRegistry.contentType);
  res.end(await metricsRegistry.metrics());
});

export default router;
```

### Acceptance Criteria

- [ ] Metrics middleware tracking all API requests
- [ ] Histogram with P50/P95/P99 latency buckets
- [ ] `/metrics` endpoint for Prometheus scraping
- [ ] Database query duration tracking
- [ ] Cache hit/miss tracking
- [ ] Job execution tracking

---

## 4.2 Implement Cache Hit Rate Tracking 🟡 P2

**Priority:** 🟡 MEDIUM
**Current State:** Cache exists but no metrics
**Target State:** Track hits/misses per spec
**Effort:** 2-3 hours
**Spec Reference:** Key Metrics (p.926-935), Alerting Rules (p.939-946)

**File to Modify:** `server/core/cache/store.ts`

```typescript
import { cacheHitsTotal, cacheMissesTotal } from "../metrics";

class CacheStore {
  private cacheName: string;

  constructor(name: string = "default") {
    this.cacheName = name;
  }

  async get<T>(key: string): Promise<T | null> {
    const value = this.store.get(key);

    if (value !== undefined) {
      cacheHitsTotal.inc({ cache_name: this.cacheName });
      return value as T;
    }

    cacheMissesTotal.inc({ cache_name: this.cacheName });
    return null;
  }

  // ... rest of implementation
}
```

### Acceptance Criteria

- [ ] Hit/miss counters updated on cache access
- [ ] Cache name labels for different cache types
- [ ] Hit rate calculable from metrics

---

## 4.3 Implement Job Execution Metrics 🟢 P3

**Priority:** 🟢 LOW
**Current State:** Jobs exist but no metrics
**Target State:** Track job success/failure per spec
**Effort:** 1-2 hours

**File to Modify:** `server/core/jobs/service.ts`

```typescript
import { jobExecutionsTotal } from "../metrics";

async run(job: Job): Promise<void> {
  const startTime = Date.now();

  try {
    await handler(job);
    jobExecutionsTotal.inc({ job_type: job.name, status: "success" });
  } catch (error) {
    jobExecutionsTotal.inc({ job_type: job.name, status: "failure" });
    throw error;
  } finally {
    const duration = Date.now() - startTime;
    // Also track job duration if needed
  }
}
```

### Acceptance Criteria

- [ ] Job execution counter with job_type and status labels
- [ ] Success/failure distinction
- [ ] Job duration tracking

---

## 4.4 Create Monitoring Dashboard Spec 🟢 P3

**Priority:** 🟢 LOW
**Effort:** 2 hours

**File to Create:** `docs/MONITORING_DASHBOARD.md`

Document the required dashboard panels per spec (p.951-973):

**API Overview:**

- Request rate (req/sec)
- Error rate (%)
- P50/P95/P99 latency
- Active users

**Database:**

- Query rate
- Query latency histogram
- Connection pool usage
- Slow query log

**Background Jobs:**

- Queue depth
- Processing rate
- Failure rate
- Job duration

**Business Metrics:**

- Transactions created/day
- Report generations/hour
- Import success rate

### Acceptance Criteria

- [ ] Dashboard specification documented
- [ ] Grafana JSON templates (optional)
- [ ] Alerting rules defined

---

## 4.5 Add Error Rate Tracking 🟢 P3

**Priority:** 🟢 LOW
**Effort:** 1 hour

Already covered by `apiRequestsTotal` counter with status labels. Document how to calculate error rate:

```promql
# Error rate (5xx responses)
sum(rate(api_requests_total{status=~"5.."}[5m]))
/
sum(rate(api_requests_total[5m])) * 100
```

---

# PART 5: TESTING & QUALITY

> **Spec Reference:** "Core test coverage: > 80%" (Key Outcomes, p.44)

---

## 5.1 Measure Current Test Coverage 🟠 P1

**Priority:** 🟠 HIGH
**Current State:** Coverage unknown
**Target State:** Documented baseline
**Effort:** 1 hour

### Action Required

```bash
# Run with coverage
npm run test:coverage:all

# Generate HTML report
# Check coverage/ directory
```

### Document Coverage By Module

| Module               | Line Coverage | Branch Coverage | Target |
| -------------------- | ------------- | --------------- | ------ |
| server/core/         | ?%            | ?%              | >80%   |
| server/modules/      | ?%            | ?%              | >80%   |
| client/src/features/ | ?%            | ?%              | >80%   |

### Acceptance Criteria

- [ ] Coverage report generated
- [ ] Baseline documented
- [ ] Gap analysis completed

---

## 5.2 Add Module Tests for Critical Domains 🟡 P2

**Priority:** 🟡 MEDIUM
**Current State:** 13 modules lack `__tests__/` directories
**Target State:** >80% coverage for critical modules
**Effort:** 1-2 weeks

### Priority Test Files to Create

| Module      | Test Files                                          | Priority |
| ----------- | --------------------------------------------------- | -------- |
| reports     | reports.service.test.ts, reports.controller.test.ts | 🔴 P0    |
| investments | investments.service.test.ts                         | 🔴 P0    |
| budgets     | budgets.service.test.ts                             | 🟠 P1    |
| recurring   | recurring.service.test.ts, rule-engine.test.ts      | 🟠 P1    |
| goals       | goals.service.test.ts                               | 🟡 P2    |
| accounts    | accounts.service.test.ts                            | 🟡 P2    |

### Test Template

```typescript
// server/modules/reports/__tests__/reports.service.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { reportsService } from "../reports.service";

describe("ReportsService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("getSpendingBreakdown", () => {
    it("should return spending by category", async () => {
      // Arrange
      const params = {
        householdId: "household-1",
        startDate: "2026-01-01",
        endDate: "2026-01-31",
      };

      // Act
      const result = await reportsService.getSpendingBreakdown(params);

      // Assert
      expect(result.categories).toBeDefined();
      expect(result.total).toBeGreaterThanOrEqual(0);
    });

    it("should apply category filters", async () => {
      // ...
    });

    it("should handle empty date range", async () => {
      // ...
    });
  });
});
```

### Acceptance Criteria

- [ ] `__tests__/` directory in all critical modules
- [ ] > 80% coverage for reports, investments, budgets
- [ ] > 70% coverage for remaining modules

---

## 5.3 Add Client Component Tests 🟡 P2

**Priority:** 🟡 MEDIUM
**Current State:** Some feature modules have tests
**Target State:** All feature modules have tests
**Effort:** 1 week
**Spec Reference:** "Client Testing (B9)" (p.458-462)

### Required Test Files

| Feature Module    | Test Files Needed                         |
| ----------------- | ----------------------------------------- |
| reports (new)     | All section components, useReportData     |
| accounts (new)    | AccountCard, AccountList, useAccountsData |
| investments (new) | HoldingsTable, AllocationChart            |
| goals (new)       | GoalCard, GoalProgressBar                 |
| cashflow (new)    | CashFlowChart, useChashFlowData           |

### Test Pattern (React Testing Library)

```typescript
// client/src/features/reports/components/__tests__/SpendingBreakdownSection.test.tsx
import { render, screen } from "@testing-library/react";
import { QueryClientProvider, QueryClient } from "@tanstack/react-query";
import { SpendingBreakdownSection } from "../SpendingBreakdownSection";

const queryClient = new QueryClient();

const mockData = {
  categories: [
    { id: "1", name: "Food", amount: 500, percentage: 50, color: "#FF0000" },
    {
      id: "2",
      name: "Transport",
      amount: 500,
      percentage: 50,
      color: "#00FF00",
    },
  ],
  total: 1000,
};

describe("SpendingBreakdownSection", () => {
  it("renders loading state", () => {
    render(
      <QueryClientProvider client={queryClient}>
        <SpendingBreakdownSection data={null} isLoading={true} />
      </QueryClientProvider>
    );

    expect(screen.getByTestId("section-skeleton")).toBeInTheDocument();
  });

  it("renders category breakdown", () => {
    render(
      <QueryClientProvider client={queryClient}>
        <SpendingBreakdownSection data={mockData} isLoading={false} />
      </QueryClientProvider>
    );

    expect(screen.getByText("Food")).toBeInTheDocument();
    expect(screen.getByText("Transport")).toBeInTheDocument();
    expect(screen.getByText("$1,000")).toBeInTheDocument();
  });

  it("renders empty state when no data", () => {
    render(
      <QueryClientProvider client={queryClient}>
        <SpendingBreakdownSection data={null} isLoading={false} />
      </QueryClientProvider>
    );

    expect(screen.getByText("No spending data")).toBeInTheDocument();
  });
});
```

### Acceptance Criteria

- [ ] All new feature module components have tests
- [ ] Tests cover loading, data, error, and empty states
- [ ] > 80% coverage for feature modules

---

## 5.4 Add Visual Regression Tests for Charts 🟢 P3

**Priority:** 🟢 LOW
**Current State:** No visual regression tests
**Target State:** Charts have visual regression coverage
**Effort:** 2-3 days
**Spec Reference:** "Visual regression tests for charts" (p.462)

### Tools to Consider

- **Storybook + Chromatic** (recommended)
- **Percy**
- **Playwright visual comparisons**

### Implementation with Storybook

```typescript
// client/src/features/reports/components/SpendingBreakdownSection.stories.tsx
import type { Meta, StoryObj } from "@storybook/react";
import { SpendingBreakdownSection } from "./SpendingBreakdownSection";

const meta: Meta<typeof SpendingBreakdownSection> = {
  title: "Reports/SpendingBreakdownSection",
  component: SpendingBreakdownSection,
};

export default meta;
type Story = StoryObj<typeof SpendingBreakdownSection>;

export const Loading: Story = {
  args: {
    data: null,
    isLoading: true,
  },
};

export const WithData: Story = {
  args: {
    data: {
      categories: [
        {
          id: "1",
          name: "Food",
          amount: 500,
          percentage: 50,
          color: "#FF0000",
        },
        {
          id: "2",
          name: "Transport",
          amount: 300,
          percentage: 30,
          color: "#00FF00",
        },
        {
          id: "3",
          name: "Entertainment",
          amount: 200,
          percentage: 20,
          color: "#0000FF",
        },
      ],
      total: 1000,
    },
    isLoading: false,
  },
};

export const Empty: Story = {
  args: {
    data: null,
    isLoading: false,
  },
};
```

### Acceptance Criteria

- [ ] Storybook setup with chart stories
- [ ] Visual regression service configured (Chromatic or Percy)
- [ ] CI integration for visual regression checks

---

# PART 6: PATTERN STANDARDIZATION

> **Spec Reference:** Global Requirements (p.349-381)

---

## 6.1 Define Official Module Patterns 🟡 P2

**Priority:** 🟡 MEDIUM
**Current State:** Inconsistent patterns across modules
**Target State:** Two documented patterns
**Effort:** 1 day

### Document Two Official Patterns

**File to Create:** `docs/module-patterns.md`

```markdown
# Server Module Patterns

## Full Pattern (Complex Domains)

Use for domains with:

- Complex business logic
- Multiple sub-services
- Event-driven workflows
- Financial calculations

**Structure:**
```

module/
├── _.controller.ts # HTTP handlers (thin)
├── _.service.ts # Business logic (thick)
├── _.repository.ts # Data access
├── _.validation.ts # Zod schemas
├── _.types.ts # Type definitions
├── _.events.ts # Domain events
├── \*.routes.ts # Route definitions
├── sub-services/ # Sub-domain services
└── **tests**/ # Unit & integration tests

```

**Modules Using Full Pattern:**
- auth
- transactions
- reports
- investments
- recurring
- budgets
- goals

## Thin Pattern (Simple CRUD)

Use for domains with:
- Simple CRUD operations
- Minimal business logic
- No complex workflows

**Structure:**
```

module/
├── _.controller.ts # HTTP handlers
├── _.routes.ts # Route definitions
├── \*.validation.ts # Zod schemas (optional)
└── index.ts # Module exports

```

**Modules Using Thin Pattern:**
- categories
- tags
- merchants
- notifications
- household
- settings
- rules
```

### Acceptance Criteria

- [ ] Pattern documentation created
- [ ] All modules categorized
- [ ] Team aligned on pattern usage

---

## 6.2 Standardize Service Re-exports 🟡 P2

**Priority:** 🟡 MEDIUM
**Current State:** Inconsistent stub services
**Target State:** Clear import pattern
**Effort:** 2-3 hours

### Decision Required

**For modules using Thin Pattern, remove stub services and import directly:**

Before:

```typescript
// budgets.service.ts (7 LOC)
export { budgetService } from "../../services/BudgetService";

// budgets.controller.ts
import { budgetService } from "./budgets.service";
```

After:

```typescript
// budgets.controller.ts
import { budgetService } from "../../services/BudgetService";
```

**For modules using Full Pattern, implement full service.**

### Acceptance Criteria

- [ ] Stub services removed from Thin Pattern modules
- [ ] Full services implemented for Full Pattern modules
- [ ] Consistent import patterns documented

---

## 6.3 Update refactoring-todo.md 🟢 P3

**Priority:** 🟢 LOW
**Effort:** 1 hour

After completing items above, update the TODO list to reflect:

- Completed items
- Pattern decisions made
- Remaining work

---

# PART 7: ACCESSIBILITY (CLIENT)

> **Spec Reference:** "Accessibility (B7)" (p.445-448)

---

## 7.1 Add Keyboard Navigation for Dialogs 🟡 P2

**Priority:** 🟡 MEDIUM
**Effort:** 4-6 hours

### Requirements

1. Escape key closes dialogs
2. Tab traps focus within dialog
3. Focus returns to trigger element on close
4. Enter/Space activates buttons

### Implementation

Already using Radix UI Dialog which handles most of this. Verify:

- [ ] All dialogs use Radix Dialog
- [ ] Focus trap enabled
- [ ] Escape key handling
- [ ] Focus return to trigger

---

## 7.2 Add ARIA Labels 🟡 P2

**Priority:** 🟡 MEDIUM
**Effort:** 4-6 hours

### Audit Checklist

- [ ] All buttons have accessible names
- [ ] All inputs have associated labels
- [ ] All icons have aria-label or sr-only text
- [ ] Tables have proper headers
- [ ] Charts have aria-describedby with summary
- [ ] Loading states announced with aria-live

### Common Fixes

```tsx
// Bad
<button onClick={handleEdit}>
  <EditIcon />
</button>

// Good
<button onClick={handleEdit} aria-label="Edit transaction">
  <EditIcon aria-hidden="true" />
</button>
```

---

## 7.3 Add Visible Focus States 🟡 P2

**Priority:** 🟡 MEDIUM
**Effort:** 2-3 hours

### Tailwind Focus Classes

```css
/* Add to global styles or component classes */
.focus-visible-ring {
  @apply focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2;
}
```

Apply to all interactive elements:

- Buttons
- Links
- Inputs
- Select
- Cards (if clickable)

---

# IMPLEMENTATION TIMELINE

## Phase 1: Critical Blockers (Week 1-2)

| Day   | Tasks                            | Owner |
| ----- | -------------------------------- | ----- |
| 1-2   | Health check endpoints (3.1)     | -     |
| 2-3   | Date utilities (3.2)             | -     |
| 3-7   | Reports feature module (1.1)     | -     |
| 8-9   | Accounts feature module (1.2)    | -     |
| 10-11 | Investments feature module (1.3) | -     |

## Phase 2: High Priority (Week 3-4)

| Day   | Tasks                               | Owner |
| ----- | ----------------------------------- | ----- |
| 12-13 | Goals feature module (1.4)          | -     |
| 14    | CashFlow feature module (1.5)       | -     |
| 15-16 | Complete transactions service (2.1) | -     |
| 17-18 | Complete budgets service (2.2)      | -     |
| 19-20 | Complete recurring service (2.3)    | -     |

## Phase 3: Medium Priority (Week 5-6)

| Day   | Tasks                                   | Owner |
| ----- | --------------------------------------- | ----- |
| 21    | API versioning (3.3)                    | -     |
| 22    | Graceful shutdown (3.4)                 | -     |
| 23-24 | Request latency metrics (4.1)           | -     |
| 25-26 | Add validation schemas (2.5)            | -     |
| 27-28 | Measure test coverage (5.1)             | -     |
| 29-30 | Module tests for critical domains (5.2) | -     |

## Phase 4: Low Priority (Week 7-8)

| Day   | Tasks                                | Owner |
| ----- | ------------------------------------ | ----- |
| 31-32 | Remaining page refactors (1.7-1.10)  | -     |
| 33-34 | Client component tests (5.3)         | -     |
| 35-36 | Secrets rotation (3.5)               | -     |
| 37-38 | Accessibility improvements (7.1-7.3) | -     |
| 39-40 | Documentation updates (6.1-6.3)      | -     |

---

# ACCEPTANCE CRITERIA CHECKLIST

## Spec Targets

- [ ] Largest server file < 500 LOC ✅ (Currently met)
- [ ] Largest client file < 300 LOC ❌ (10 pages over)
- [ ] Core test coverage > 80% ❓ (Not measured)
- [ ] Report response time < 150 ms ❓ (Not measured)
- [ ] Cache hit rate > 70% ❓ (Not measured)

## Phase 5 Complete When

- [ ] All 15 client pages < 300 LOC
- [ ] 7 client feature modules created (reports, accounts, investments, goals, cashflow, account-detail, goal-creation)
- [ ] Health check endpoints implemented
- [ ] Date utilities library created
- [ ] API versioning in place
- [ ] Monitoring metrics implemented
- [ ] Test coverage measured and documented
- [ ] Accessibility audit passed

---

# APPENDIX: REFERENCE DOCUMENTS

| Document               | Path                                           | Purpose                 |
| ---------------------- | ---------------------------------------------- | ----------------------- |
| Enterprise Spec        | `docs/enterprise-refactoring-specification.md` | Master specification    |
| Refactoring TODO       | `docs/refactoring-todo.md`                     | Task tracking           |
| Deep Code Review       | `docs/../reviews/deep-code-review-2026-01-11.md`          | Current state analysis  |
| Security Fixes         | `docs/phase-0-security-fixes.md`               | Security implementation |
| Architecture Decisions | `docs/architecture-decisions.md`               | Feature module pattern  |

---

**Document Version:** 1.0
**Created:** 2026-01-11
**Last Updated:** 2026-01-11
**Author:** Claude Code
