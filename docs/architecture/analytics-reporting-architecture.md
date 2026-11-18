# Analytics & Reporting Architecture

Defines how the app's dashboards and report graphs (Annual Dashboard, Cash Flow, Spending, Income, Net Worth, Savings, and Sankey) should be powered by real backend data and served to the frontend in chart-ready formats.

## Document Overview

This comprehensive architecture document includes:

- **Current State Analysis** - What exists today and what needs to change
- **Business Definitions** - Explicit definitions for metrics to prevent bugs
- **Complete Schema Definitions** - All Drizzle ORM table schemas
- **API Contracts** - Request/response shapes for each endpoint
- **Zod Validation Schemas** - Query parameter and response validation
- **Query Plans** - SQL and Drizzle pseudo-code for each endpoint
- **Database Index Strategy** - Performance-critical indexes
- **Caching Architecture** - Multi-layer caching strategy
- **Rate Limiting** - Protection against abuse
- **Background Workers** - Snapshot generation jobs
- **Error Handling** - Consistent error response contracts
- **Performance Benchmarks** - Target response times
- **Security Model** - Authorization and data sanitization
- **Observability** - Logging and health checks
- **Implementation Order** - Practical phased approach

---

## Table of Contents

1. [Current State](#1-current-state-repo-reality)
2. [Graph Inventory](#2-graph-inventory--required-data)
3. [Reporting Definitions](#3-reporting-definitions-must-be-explicit)
4. [API Design Principles](#4-api-design-principles-v1)
5. [Schema Definitions](#5-schema-definitions-phase-0)
6. [API Contracts](#6-v1-analytics-endpoints-contracts)
7. [Zod Validation Schemas](#7-zod-validation-schemas-query--response)
8. [Query Plans](#8-concrete-query-plans-sql--drizzle-pseudo-code)
9. [Database Index Strategy](#9-database-index-strategy)
10. [Caching Architecture](#10-caching-architecture)
11. [Rate Limiting](#11-rate-limiting)
12. [Snapshot Worker](#12-snapshot-worker-specification)
13. [Error Response Contracts](#13-error-response-contracts)
14. [Performance Benchmarks](#14-performance-benchmarks)
15. [Security Model](#15-security-model)
16. [Observability](#16-observability)
17. [Server Folder Structure](#17-suggested-server-folder-structure)
18. [Client React Query Hooks](#18-client-react-query-hook-shapes)
19. [Implementation Order](#19-implementation-order-practical)
20. [Monarch Alignment](#20-monarch-alignment-public-marketing-only)

---

## 1) Current State (Repo Reality)

Today the UI contains many hardcoded/prototype datasets:

- `client/src/pages/Reports.tsx` (Sankey, Pie, Bar, Line)
- `client/src/pages/CashFlow.tsx`
- `client/src/pages/Accounts.tsx`, `AccountDetail.tsx`, `Investments.tsx`
- Most dashboard widgets in `client/src/components/dashboard/*`

Some "real" data is currently coming from a localStorage prototype layer:

- `client/src/lib/storage.ts`
- `client/src/hooks/use-finance-data.ts`

The server currently exposes settings/categories/merchants/rules but does **not yet** expose accounts/transactions/budgets/goals/reports APIs:

- `server/routes.ts` mounts: `/api/auth`, `/api/settings`, `/api/household`, `/api/categories`, `/api/merchants`, `/api/rules`.

This document defines the target analytics architecture and the endpoint/hook contracts required to replace those hardcoded arrays.

---

## 2) Graph Inventory → Required Data

This is the contract-level mapping between UI charts and backend endpoints.

### 2.1 Dashboard (`client/src/pages/Dashboard.tsx`)

| Widget                         | File                                                           | Backend Endpoint                                                                   |
| ------------------------------ | -------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Net Worth (value + history)    | `client/src/components/dashboard/NetWorthWidget.tsx`           | `GET /api/reports/net-worth` (history) + `latest`                                  |
| Cash Flow (income vs expenses) | `client/src/components/dashboard/CashFlowWidget.tsx`           | `GET /api/reports/cashflow`                                                        |
| Top Categories donut           | `client/src/components/dashboard/SpendingWidget.tsx`           | `GET /api/reports/spending/breakdown`                                              |
| Spending trend (this vs last)  | `client/src/components/dashboard/DashboardSpendingWidget.tsx`  | `GET /api/reports/spending/trend`                                                  |
| Recent Transactions            | `client/src/components/dashboard/RecentTransactionsWidget.tsx` | `GET /api/reports/transactions` (or `/api/transactions` list)                      |
| Budget Status / Budget Summary | `DashboardBudgetWidget.tsx`, `BudgetStatusWidget.tsx`          | `GET /api/budgets/summary` (recommended) or `GET /api/reports/dashboard` aggregate |
| Goals                          | `GoalsWidget.tsx`                                              | `GET /api/goals` (recommended) or `GET /api/reports/dashboard`                     |
| Upcoming Bills                 | `RecurringExpensesWidget.tsx`                                  | `GET /api/recurring/upcoming` (recommended) or `GET /api/reports/dashboard`        |

### 2.2 Cash Flow Page (`client/src/pages/CashFlow.tsx`)

- Trends chart: `GET /api/reports/cashflow`
- Sankey: `GET /api/reports/sankey`
- Monthly breakdown table: same cashflow series

### 2.3 Reports Page (`client/src/pages/Reports.tsx`)

| Tab              | Current Chart Type                           | Backend Endpoint                                                 |
| ---------------- | -------------------------------------------- | ---------------------------------------------------------------- |
| Annual Dashboard | cards + grouped bar + cumulative line + pies | `GET /api/reports/annual`                                        |
| Cash Flow        | Sankey                                       | `GET /api/reports/sankey`                                        |
| Spending         | Pie                                          | `GET /api/reports/spending/breakdown`                            |
| Income           | Bar (income vs expenses)                     | `GET /api/reports/income` (or cashflow with income/expense keys) |
| Net Worth        | Line                                         | `GET /api/reports/net-worth`                                     |
| Savings          | Bar (% rate)                                 | `GET /api/reports/savings-rate`                                  |

---

## 3) Reporting Definitions (Must Be Explicit)

These definitions prevent "why doesn't this match?" bugs.

### 3.1 Transaction Types

- `income`: money in
- `expense`: money out
- `transfer`: money moved between accounts (internal movement)
- `balance_adjustment`: manual balance corrections (e.g., opening balance, reconciliation)

**INVARIANT**: The `amount` field is ALWAYS positive. The sign/direction is determined by the `type` field.

**Transfer Model (Two-Row Representation)**:

- Transfers create TWO linked transactions with the same `transfer_transaction_id`
- Row 1: `type='transfer'`, `is_transfer_in=false`, `account_id=source` (money leaving)
- Row 2: `type='transfer'`, `is_transfer_in=true`, `account_id=destination` (money arriving)
- This model simplifies per-account balance calculations

**Default analytics behavior**:

- Exclude transfers from income/spending totals unless explicitly requested (`includeTransfers=true`).
- Exclude `balance_adjustment` from income/spending totals (they're reconciliation entries).

### 3.2 Savings and Savings Rate

v1 definition:

- `savings = income - expenses`
- `savingsRate = income === 0 ? 0 : (savings / income) * 100`

If later you want "savings" = "transfers into savings/investment accounts", that requires more semantics (account classes + transfer direction).

### 3.3 Pending + Exclusions

Filters:

- Default: exclude pending (`is_pending=true`) unless `includePending=true`.
- Default: exclude `is_excluded_from_reports=true` always.
- Budget analytics exclude `is_excluded_from_budget=true`.

### 3.4 Splits

If a transaction is split into multiple categories, analytics must sum the split rows, not the parent. Recommended model: `transaction_splits` table.

### 3.5 Household vs Mine

Support `scope=household|mine`:

- household: all household transactions
- mine: only transactions where `ownerUserId = currentUserId`

Requires `transactions.ownerUserId`.

### 3.6 Dates and Timezone

Transactions are stored as `DATE`.

- Use the stored date for bucketing.
- If you ingest timestamps, convert to local date at ingestion.

### 3.7 Currency

For v1:

- Analytics currency = `households.currency` (already exists).
- If multi-currency arrives later, introduce home-currency amounts.

---

## 4) API Design Principles (v1)

1. **Chart-ready** responses: endpoints should return data in shapes that directly feed Nivo/Recharts.
2. **Stable IDs**: breakdown items include `entityType` + `entityId` to enable drilldown.
3. **Safe defaults**: pending excluded, transfers excluded, hard limits on date ranges and limits.
4. **Pagination** for drilldowns: cursor-based pagination recommended.
5. **Deterministic rounding**: all money numbers in responses should be rounded to 2 decimals.

---

## 5) Schema Definitions (Phase 0)

These Drizzle ORM schema definitions are required before any analytics work begins. They have been added to `shared/schema.ts`.

### 5.1 Accounts Table

```typescript
// ============================================================================
// ACCOUNTS
// ============================================================================

export const accountTypes = pgEnum("account_type", [
  "checking",
  "savings",
  "credit_card",
  "investment",
  "loan",
  "mortgage",
  "cash",
  "mobile_money", // Added: Zambian context
  "real_estate", // Added: Property assets
  "vehicle", // Added: Vehicle assets
  "other",
]);

export const accounts = pgTable("accounts", {
  id: uuid("id").primaryKey().defaultRandom(),
  householdId: uuid("household_id")
    .notNull()
    .references(() => households.id, { onDelete: "cascade" }),

  // Basic info
  name: varchar("name", { length: 255 }).notNull(),
  type: accountTypes("type").notNull(),
  subtype: varchar("subtype", { length: 50 }), // e.g., "brokerage", "401k", "roth_ira"
  institution: varchar("institution", { length: 255 }),
  institutionLogo: text("institution_logo"),

  // Balance tracking
  initialBalance: decimal("initial_balance", { precision: 15, scale: 2 })
    .notNull()
    .default("0"), // Starting balance when account was added
  balance: decimal("balance", { precision: 15, scale: 2 })
    .notNull()
    .default("0"), // Current balance (computed: initial + sum of transactions)
  availableBalance: decimal("available_balance", { precision: 15, scale: 2 }),
  creditLimit: decimal("credit_limit", { precision: 15, scale: 2 }), // For credit accounts
  currency: varchar("currency", { length: 3 }).notNull().default("ZMW"),

  // Classification for net worth
  isAsset: boolean("is_asset").notNull().default(true), // false for credit cards, loans
  isHidden: boolean("is_hidden").notNull().default(false),
  isArchived: boolean("is_archived").notNull().default(false),

  // Display
  color: varchar("color", { length: 7 }),
  icon: varchar("icon", { length: 50 }),
  displayOrder: integer("display_order").notNull().default(0),


  // Metadata
  notes: text("notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  deletedAt: timestamp("deleted_at"),
});
```

### 5.2 Transactions Table

```typescript
// ============================================================================
// TRANSACTIONS
// ============================================================================

export const transactionTypes = pgEnum("transaction_type", [
  "income",
  "expense",
  "transfer",
  "balance_adjustment", // Manual balance corrections
]);

// CANONICAL TRANSFER MODEL (Two-Row Representation):
// Transfers create TWO linked transactions:
//   Row 1: type='transfer', is_transfer_in=false, account_id=source
//   Row 2: type='transfer', is_transfer_in=true, account_id=destination
// Both rows have the same transfer_transaction_id linking them.
// This model simplifies per-account balance calculations.

export const transactions = pgTable("transactions", {
  id: uuid("id").primaryKey().defaultRandom(),
  householdId: uuid("household_id")
    .notNull()
    .references(() => households.id, { onDelete: "cascade" }),
  accountId: uuid("account_id")
    .notNull()
    .references(() => accounts.id, { onDelete: "cascade" }),

  // Ownership for "mine" vs "household" scope
  ownerUserId: uuid("owner_user_id").references(() => users.id, {
    onDelete: "set null",
  }),

  // Idempotency for duplicate prevention
  idempotencyKey: uuid("idempotency_key").unique(),

  // Core transaction data
  date: date("date").notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  originalName: varchar("original_name", { length: 255 }), // Pre-rule/cleanup name
  // INVARIANT: amount is ALWAYS positive. Sign determined by type.
  amount: decimal("amount", { precision: 15, scale: 2 }).notNull(),
  type: transactionTypes("type").notNull(),

  // Categorization
  categoryId: uuid("category_id").references(() => categories.id, {
    onDelete: "set null",
  }),
  merchantId: uuid("merchant_id").references(() => merchants.id, {
    onDelete: "set null",
  }),

  // For transfers (two-row model)
  isTransferIn: boolean("is_transfer_in").notNull().default(false), // true = receiving side
  transferAccountId: uuid("transfer_account_id").references(() => accounts.id, {
    onDelete: "set null",
  }),
  transferTransactionId: uuid("transfer_transaction_id"), // Links the pair

  // Status flags
  isPending: boolean("is_pending").notNull().default(false),
  isRecurring: boolean("is_recurring").notNull().default(false),
  recurringTransactionId: uuid("recurring_transaction_id"),

  // Exclusion flags for analytics
  isExcludedFromReports: boolean("is_excluded_from_reports")
    .notNull()
    .default(false),
  isExcludedFromBudget: boolean("is_excluded_from_budget")
    .notNull()
    .default(false),

  // Review workflow
  reviewedAt: timestamp("reviewed_at"),
  reviewedBy: uuid("reviewed_by").references(() => users.id),

  // User notes
  notes: text("notes"),


  // CSV Import tracking (for batch operations and rollback)
  importBatchId: uuid("import_batch_id").references(() => importBatches.id, {
    onDelete: "set null",
  }),

  // Metadata
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  deletedAt: timestamp("deleted_at"),
});
```

### 5.3 Import Batches (CSV Import Tracking)

```typescript
// ============================================================================
// IMPORT BATCHES
// ============================================================================

export const importBatches = pgTable("import_batches", {
  id: uuid("id").primaryKey().defaultRandom(),
  householdId: uuid("household_id")
    .notNull()
    .references(() => households.id, { onDelete: "cascade" }),
  accountId: uuid("account_id")
    .notNull()
    .references(() => accounts.id, { onDelete: "cascade" }),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),

  // Import metadata
  fileName: varchar("file_name", { length: 255 }).notNull(),
  status: varchar("status", { length: 20 }).notNull().default("pending"),
  // Status: 'pending' | 'processing' | 'completed' | 'failed' | 'rolled_back'

  // Results
  totalRows: integer("total_rows").notNull().default(0),
  importedCount: integer("imported_count").notNull().default(0),
  skippedCount: integer("skipped_count").notNull().default(0),
  errorCount: integer("error_count").notNull().default(0),

  // Mapping configuration used
  columnMapping: jsonb("column_mapping"),
  // { date: "Transaction Date", amount: "Amount", description: "Description" }

  dateFormat: varchar("date_format", { length: 50 }),
  amountFormat: varchar("amount_format", { length: 20 }), // 'signed' | 'separate_columns'

  // Error details
  errors: jsonb("errors"), // [{ row: 5, field: "date", message: "Invalid format" }]

  createdAt: timestamp("created_at").notNull().defaultNow(),
  completedAt: timestamp("completed_at"),
});
```

### 5.4 Transaction Tags (Many-to-Many)

```typescript
// ============================================================================
// TRANSACTION TAGS
// ============================================================================

export const transactionTags = pgTable(
  "transaction_tags",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    transactionId: uuid("transaction_id")
      .notNull()
      .references(() => transactions.id, { onDelete: "cascade" }),
    tagId: uuid("tag_id")
      .notNull()
      .references(() => tags.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => ({
    uniqueTransactionTag: unique().on(table.transactionId, table.tagId),
  })
);
```

### 5.4 Transaction Splits

```typescript
// ============================================================================
// TRANSACTION SPLITS
// ============================================================================

export const transactionSplits = pgTable("transaction_splits", {
  id: uuid("id").primaryKey().defaultRandom(),
  transactionId: uuid("transaction_id")
    .notNull()
    .references(() => transactions.id, { onDelete: "cascade" }),

  // Split details
  amount: decimal("amount", { precision: 15, scale: 2 }).notNull(),
  categoryId: uuid("category_id").references(() => categories.id, {
    onDelete: "set null",
  }),
  merchantId: uuid("merchant_id").references(() => merchants.id, {
    onDelete: "set null",
  }),
  notes: text("notes"),

  // Order for display
  displayOrder: integer("display_order").notNull().default(0),

  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// CONSTRAINT: Sum of splits must equal parent transaction amount
// Enforced at application layer, not DB
```

### 5.5 Net Worth Snapshots

```typescript
// ============================================================================
// NET WORTH SNAPSHOTS
// ============================================================================

export const netWorthSnapshots = pgTable(
  "net_worth_snapshots",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    householdId: uuid("household_id")
      .notNull()
      .references(() => households.id, { onDelete: "cascade" }),

    date: date("date").notNull(),

    // Aggregated values
    totalAssets: decimal("total_assets", { precision: 15, scale: 2 }).notNull(),
    totalLiabilities: decimal("total_liabilities", {
      precision: 15,
      scale: 2,
    }).notNull(),
    netWorth: decimal("net_worth", { precision: 15, scale: 2 }).notNull(),

    // Breakdown by account type (JSONB for flexibility)
    assetsByType: jsonb("assets_by_type"), // { checking: 5000, savings: 10000, ... }
    liabilitiesByType: jsonb("liabilities_by_type"), // { credit_card: 2000, loan: 5000, ... }

    // Individual account balances at snapshot time
    accountBalances: jsonb("account_balances"), // [{ accountId, balance }, ...]

    currency: varchar("currency", { length: 3 }).notNull().default("ZMW"),

    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => ({
    // One snapshot per household per day
    uniqueHouseholdDate: unique().on(table.householdId, table.date),
  })
);
```

### 5.6 Account Balance Snapshots

```typescript
// ============================================================================
// ACCOUNT BALANCE SNAPSHOTS
// ============================================================================

export const accountBalanceSnapshots = pgTable(
  "account_balance_snapshots",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),

    date: date("date").notNull(),
    balance: decimal("balance", { precision: 15, scale: 2 }).notNull(),
    availableBalance: decimal("available_balance", { precision: 15, scale: 2 }),

    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => ({
    uniqueAccountDate: unique().on(table.accountId, table.date),
  })
);
```

### 5.7 Budgets and Budget Periods

```typescript
// ============================================================================
// BUDGETS
// ============================================================================

export const budgets = pgTable("budgets", {
  id: uuid("id").primaryKey().defaultRandom(),
  householdId: uuid("household_id")
    .notNull()
    .references(() => households.id, { onDelete: "cascade" }),

  name: varchar("name", { length: 255 }).notNull(),
  categoryId: uuid("category_id").references(() => categories.id, {
    onDelete: "cascade",
  }),
  categoryGroupId: uuid("category_group_id").references(
    () => categoryGroups.id,
    { onDelete: "cascade" }
  ),

  // Budget configuration
  amount: decimal("amount", { precision: 15, scale: 2 }).notNull(),
  period: varchar("period", { length: 20 }).notNull().default("monthly"), // monthly, yearly, custom

  // Rollover settings
  rolloverEnabled: boolean("rollover_enabled").notNull().default(false),
  rolloverAmount: decimal("rollover_amount", {
    precision: 15,
    scale: 2,
  }).default("0"),

  // Alert thresholds
  warningThreshold: integer("warning_threshold").default(80), // Percentage
  alertThreshold: integer("alert_threshold").default(100),

  isActive: boolean("is_active").notNull().default(true),

  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const budgetPeriods = pgTable("budget_periods", {
  id: uuid("id").primaryKey().defaultRandom(),
  budgetId: uuid("budget_id")
    .notNull()
    .references(() => budgets.id, { onDelete: "cascade" }),

  startDate: date("start_date").notNull(),
  endDate: date("end_date").notNull(),

  // Computed/cached values
  budgetAmount: decimal("budget_amount", { precision: 15, scale: 2 }).notNull(),
  spentAmount: decimal("spent_amount", { precision: 15, scale: 2 })
    .notNull()
    .default("0"),
  rolloverIn: decimal("rollover_in", { precision: 15, scale: 2 }).default("0"),

  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
```

### 5.8 Goals

```typescript
// ============================================================================
// GOALS
// ============================================================================

export const goals = pgTable("goals", {
  id: uuid("id").primaryKey().defaultRandom(),
  householdId: uuid("household_id")
    .notNull()
    .references(() => households.id, { onDelete: "cascade" }),

  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  icon: varchar("icon", { length: 50 }),
  color: varchar("color", { length: 7 }),

  // Target
  targetAmount: decimal("target_amount", { precision: 15, scale: 2 }).notNull(),
  currentAmount: decimal("current_amount", { precision: 15, scale: 2 })
    .notNull()
    .default("0"),
  currency: varchar("currency", { length: 3 }).notNull().default("ZMW"),

  // Timeline
  targetDate: date("target_date"),
  startDate: date("start_date").notNull().defaultNow(),

  // Linked account (optional - for tracking)
  linkedAccountId: uuid("linked_account_id").references(() => accounts.id, {
    onDelete: "set null",
  }),

  // Status
  isCompleted: boolean("is_completed").notNull().default(false),
  completedAt: timestamp("completed_at"),
  isArchived: boolean("is_archived").notNull().default(false),

  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const goalContributions = pgTable("goal_contributions", {
  id: uuid("id").primaryKey().defaultRandom(),
  goalId: uuid("goal_id")
    .notNull()
    .references(() => goals.id, { onDelete: "cascade" }),

  amount: decimal("amount", { precision: 15, scale: 2 }).notNull(),
  date: date("date").notNull(),
  notes: text("notes"),

  // Optional link to transaction
  transactionId: uuid("transaction_id").references(() => transactions.id, {
    onDelete: "set null",
  }),

  createdAt: timestamp("created_at").notNull().defaultNow(),
});
```

### 5.9 Recurring Transactions

```typescript
// ============================================================================
// RECURRING TRANSACTIONS
// ============================================================================

export const recurringFrequency = pgEnum("recurring_frequency", [
  "daily",
  "weekly",
  "biweekly",
  "monthly",
  "quarterly",
  "yearly",
]);

export const recurringTransactions = pgTable("recurring_transactions", {
  id: uuid("id").primaryKey().defaultRandom(),
  householdId: uuid("household_id")
    .notNull()
    .references(() => households.id, { onDelete: "cascade" }),
  accountId: uuid("account_id")
    .notNull()
    .references(() => accounts.id, { onDelete: "cascade" }),

  // Template data
  name: varchar("name", { length: 255 }).notNull(),
  amount: decimal("amount", { precision: 15, scale: 2 }).notNull(),
  type: transactionTypes("type").notNull(),
  categoryId: uuid("category_id").references(() => categories.id, {
    onDelete: "set null",
  }),
  merchantId: uuid("merchant_id").references(() => merchants.id, {
    onDelete: "set null",
  }),

  // Schedule
  frequency: recurringFrequency("frequency").notNull(),
  startDate: date("start_date").notNull(),
  endDate: date("end_date"),
  nextDueDate: date("next_due_date").notNull(),

  // Day of month/week for scheduling
  dayOfMonth: integer("day_of_month"), // 1-31
  dayOfWeek: integer("day_of_week"), // 0-6 (Sunday = 0)

  // Notifications
  reminderDays: integer("reminder_days").default(3), // Days before to remind

  isActive: boolean("is_active").notNull().default(true),
  isPaused: boolean("is_paused").notNull().default(false),

  notes: text("notes"),

  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
```

---

## 6) v1 Analytics Endpoints (Contracts)

All routes require auth (`requireAuth`) and household membership.

### 6.1 Shared Query Params (Most Endpoints)

- `from`: `YYYY-MM-DD` (inclusive)
- `to`: `YYYY-MM-DD` (inclusive)
- `interval`: `day|week|month`
- `scope`: `household|mine`
- `includePending`: boolean
- `includeTransfers`: boolean

### 6.2 `GET /api/reports/annual`

#### Query

- `year` (required)
- `compareYear` (optional; default `year-1`)
- `scope`, `includePending`, `includeTransfers`

#### Response (chart-ready)

```ts
export type ReportsAnnualResponse = {
  year: number;
  compareYear?: number;
  currency: string;

  totals: {
    income: number;
    expenses: number;
    savings: number;
    savingsRate: number;
  };
  comparison?: {
    incomeChangePct: number;
    expensesChangePct: number;
    savingsChangePct: number;
  };

  // MonthlyTrendsWidget-ready
  monthly: Array<{
    month: string; // "Jan".."Dec"
    monthIndex: number; // 1..12
    income: number;
    expenses: number;
    savings: number;
    savingsRate: number;
  }>;

  // CumulativeGrowthWidget-ready (Nivo line series)
  cumulativeSeries: Array<{
    id: "Income" | "Expenses";
    color?: string;
    data: Array<{ x: string; y: number }>;
  }>;

  // CategoryBreakdownWidget-ready (Nivo pie inputs)
  breakdown: {
    income: Array<{
      id: string;
      label: string;
      value: number;
      color?: string;
      entityId: string;
    }>;
    expenses: Array<{
      id: string;
      label: string;
      value: number;
      color?: string;
      entityId: string;
    }>;
    savings: Array<{
      id: string;
      label: string;
      value: number;
      color?: string;
      entityId: string;
    }>;
  };
};
```

### 6.3 `GET /api/reports/cashflow`

**Query**: `from`, `to`, `interval`, `scope`, `includePending`, `includeTransfers`

#### Response

```ts
export type ReportsCashflowResponse = {
  range: {
    from: string;
    to: string;
    interval: "day" | "week" | "month";
    currency: string;
  };
  series: Array<{
    periodStart: string;
    periodEnd: string;
    label: string;
    income: number;
    expenses: number;
    savings: number;
    savingsRate: number;
  }>;
  totals: {
    income: number;
    expenses: number;
    savings: number;
    savingsRate: number;
  };
};
```

### 6.4 `GET /api/reports/sankey`

#### Query

- `from`, `to`
- `mode`: `income_to_expense_groups | account_to_expense_groups | expense_groups_to_categories`
- `maxNodes` (default 25)
- `includeSavingsNode` (default true)

#### Response (Nivo-ready)

```ts
export type ReportsSankeyResponse = {
  range: { from: string; to: string; currency: string };
  mode: string;
  totals: { income: number; expenses: number; savings: number };
  sankey: {
    nodes: Array<{
      id: string;
      nodeColor?: string;
      entityType?:
        | "categoryGroup"
        | "category"
        | "merchant"
        | "account"
        | "synthetic";
      entityId?: string;
    }>;
    links: Array<{
      source: string;
      target: string;
      value: number;
      meta?: { entityType?: string; entityId?: string };
    }>;
  };
};
```

### 6.5 `GET /api/reports/spending/breakdown`

#### Query

- `from`, `to`
- `groupBy`: `categoryGroup|category|merchant|tag` (default categoryGroup)
- `limit` (default 10)
- `includeOther` (default true)

#### Response (Nivo Pie-ready)

```ts
export type ReportsSpendingBreakdownResponse = {
  range: { from: string; to: string; currency: string };
  groupBy: string;
  total: number;
  items: Array<{
    id: string;
    label: string;
    value: number;
    percent: number;
    color?: string;
    entityType: "categoryGroup" | "category" | "merchant" | "tag";
    entityId: string;
  }>;
};
```

### 6.6 `GET /api/reports/spending/trend`

#### Query

- `from`, `to`
- `interval` (default day)
- `compare` (default `previous_period`)

#### Response (Recharts Area-ready)

```ts
export type ReportsSpendingTrendResponse = {
  range: { from: string; to: string; interval: string; currency: string };
  compare: string;
  totals: { current: number; previous?: number; changePct?: number };
  series: Array<{ date: string; current: number; previous?: number }>;
};
```

### 6.7 `GET /api/reports/income`

**Query**: `from`, `to`, `interval`, `scope`, `includePending`

#### Response

```ts
export type ReportsIncomeResponse = {
  range: { from: string; to: string; interval: string; currency: string };
  series: Array<{
    label: string;
    income: number;
    expenses: number;
    net: number;
  }>;
  totals: { income: number; expenses: number; net: number };
};
```

### 6.8 `GET /api/reports/net-worth`

**Query**: `from`, `to`, `interval=day|month`

#### Response (Nivo Line-ready)

```ts
export type ReportsNetWorthResponse = {
  range: { from: string; to: string; interval: string; currency: string };
  latest: {
    date: string;
    netWorth: number;
    assets: number;
    liabilities: number;
  };
  series: Array<{ id: "Net Worth"; data: Array<{ x: string; y: number }> }>;
  breakdown?: {
    assetsByType: Array<{ type: string; value: number }>;
    liabilitiesByType: Array<{ type: string; value: number }>;
  };
};
```

### 6.9 `GET /api/reports/savings-rate`

**Query**: `from`, `to`, `interval=week|month`

#### Response

```ts
export type ReportsSavingsRateResponse = {
  range: { from: string; to: string; interval: string; currency: string };
  series: Array<{
    label: string;
    savingsRate: number;
    income: number;
    expenses: number;
    savings: number;
  }>;
};
```

### 6.10 `GET /api/reports/transactions` (drilldown)

#### Query

- `from`, `to`
- entity filters: `categoryId|categoryGroupId|merchantId|accountId|tagId` (optional but at least one filter/search/type required)
- `type`, `search`, `sort`, `limit`, `cursor`

#### Response

```ts
export type ReportsTransactionsResponse = {
  page: { limit: number; nextCursor?: string | null };
  items: Array<{
    id: string;
    date: string;
    name: string;
    merchant?: { id: string; name: string } | null;
    category?: { id: string; name: string; groupId: string } | null;
    account?: { id: string; name: string } | null;
    type: "income" | "expense" | "transfer";
    amount: number;
    signedAmount: number;
    notes?: string | null;
    isPending: boolean;
    reviewedAt?: string | null;
    tags?: Array<{ id: string; name: string }> | null;
  }>;
};
```

---

## 7) Zod Validation Schemas (Query + Response)

Implemented in `server/validation/reports.ts` (query parsing). Keep these schemas in sync with the endpoint contracts in this document.

### 7.1 Helpers

```ts
import { z } from "zod";

const zBool = z.preprocess((val) => {
  if (val === undefined) return undefined;
  if (Array.isArray(val)) return val[0];
  if (val === "true" || val === "1" || val === 1) return true;
  if (val === "false" || val === "0" || val === 0) return false;
  return val;
}, z.coerce.boolean());

const zInt = z.preprocess(
  (val) => (Array.isArray(val) ? val[0] : val),
  z.coerce.number().int()
);
const zString = z.preprocess(
  (val) => (Array.isArray(val) ? val[0] : val),
  z.string()
);

export const zIsoDate = zString.regex(
  /^\d{4}-\d{2}-\d{2}$/,
  "Expected YYYY-MM-DD"
);
export const zUuid = zString.uuid();

export const zInterval = z.enum(["day", "week", "month"]);
export const zScope = z.enum(["household", "mine"]);
export const zTxnType = z.enum(["income", "expense", "transfer"]);
export const zSort = z.enum([
  "date_desc",
  "date_asc",
  "amount_desc",
  "amount_asc",
]);
```

### 7.2 Query schemas

```ts
export const baseReportQuerySchema = z.object({
  from: zIsoDate.optional(),
  to: zIsoDate.optional(),
  interval: zInterval.optional(),
  scope: zScope.optional(),
  includePending: zBool.optional(),
  includeTransfers: zBool.optional(),
});

export const reportsAnnualQuerySchema = z.object({
  year: zInt.min(1900).max(2100),
  compareYear: zInt.min(1900).max(2100).optional(),
  scope: zScope.optional(),
  includePending: zBool.optional(),
  includeTransfers: zBool.optional(),
});

export const reportsCashflowQuerySchema = baseReportQuerySchema.extend({
  from: zIsoDate,
  to: zIsoDate,
});

export const reportsSankeyQuerySchema = baseReportQuerySchema.extend({
  from: zIsoDate,
  to: zIsoDate,
  mode: z.enum([
    "income_to_expense_groups",
    "account_to_expense_groups",
    "expense_groups_to_categories",
  ]),
  maxNodes: zInt.min(5).max(200).optional(),
  includeSavingsNode: zBool.optional(),
});

export const reportsSpendingBreakdownQuerySchema = baseReportQuerySchema.extend(
  {
    from: zIsoDate,
    to: zIsoDate,
    groupBy: z
      .enum(["categoryGroup", "category", "merchant", "tag"])
      .optional(),
    limit: zInt.min(1).max(200).optional(),
    includeOther: zBool.optional(),
  }
);

export const reportsSpendingTrendQuerySchema = baseReportQuerySchema.extend({
  from: zIsoDate,
  to: zIsoDate,
  compare: z.enum(["previous_period", "previous_year", "none"]).optional(),
});

export const reportsIncomeQuerySchema = baseReportQuerySchema.extend({
  from: zIsoDate,
  to: zIsoDate,
});

export const reportsNetWorthQuerySchema = baseReportQuerySchema.extend({
  from: zIsoDate,
  to: zIsoDate,
  interval: z.enum(["day", "month"]).optional(),
});

export const reportsSavingsRateQuerySchema = baseReportQuerySchema.extend({
  from: zIsoDate,
  to: zIsoDate,
  interval: z.enum(["week", "month"]).optional(),
});

export const reportsTransactionsQuerySchema = baseReportQuerySchema
  .extend({
    from: zIsoDate,
    to: zIsoDate,

    categoryId: zUuid.optional(),
    categoryGroupId: zUuid.optional(),
    merchantId: zUuid.optional(),
    accountId: zUuid.optional(),
    tagId: zUuid.optional(),

    type: zTxnType.optional(),
    search: zString.max(200).optional(),
    sort: zSort.optional(),
    limit: zInt.min(1).max(200).optional(),
    cursor: zString.optional(),
  })
  .refine(
    (q) =>
      Boolean(
        q.categoryId ||
          q.categoryGroupId ||
          q.merchantId ||
          q.accountId ||
          q.tagId ||
          q.search ||
          q.type
      ),
    {
      message: "At least one filter (or search/type) is required.",
    }
  );
```

### 7.3 Response schemas (optional but recommended)

Server responses can be validated in dev/test mode to prevent contract drift.

Example for pie breakdown:

```ts
export const spendingItemSchema = z.object({
  id: z.string(),
  label: z.string(),
  value: z.number(),
  percent: z.number(),
  color: z.string().optional(),
  entityType: z.enum(["categoryGroup", "category", "merchant", "tag"]),
  entityId: z.string(),
});

export const reportsSpendingBreakdownResponseSchema = z.object({
  range: z.object({ from: zIsoDate, to: zIsoDate, currency: z.string() }),
  groupBy: z.string(),
  total: z.number(),
  items: z.array(spendingItemSchema),
});
```

Repeat similarly for each endpoint response type.

---

## 8) Concrete Query Plans (SQL + Drizzle Pseudo-code)

### 8.1 Base filters (apply everywhere)

#### Base WHERE conditions

- `household_id = $householdId`
- `date BETWEEN $from AND $to`
- `deleted_at IS NULL`
- pending handling:
  - if `includePending=false`, add `is_pending IS FALSE`
- report exclusion:
  - always `is_excluded_from_reports IS FALSE`
- transfers:
  - if `includeTransfers=false`, add `type <> 'transfer'`
- scope:
  - if `scope=mine`, add `owner_user_id = $userId`

### 8.2 `/api/reports/cashflow`

#### SQL (interval=month)

```sql
SELECT
  date_trunc('month', t.date)::date AS period_start,
  (date_trunc('month', t.date) + interval '1 month - 1 day')::date AS period_end,
  SUM(CASE WHEN t.type = 'income' THEN t.amount ELSE 0 END) AS income,
  SUM(CASE WHEN t.type = 'expense' THEN t.amount ELSE 0 END) AS expenses
FROM transactions t
WHERE ...base filters...
GROUP BY 1,2
ORDER BY 1;
```

Post-process each row:

- `savings = income - expenses`
- `savingsRate = income === 0 ? 0 : savings / income * 100`
- `label = toMonthShort(period_start)` (Jan, Feb, ...)

#### Drizzle pseudo-code

```ts
const rows = await db.execute(sql`
  SELECT
    date_trunc('month', t.date)::date AS "periodStart",
    (date_trunc('month', t.date) + interval '1 month - 1 day')::date AS "periodEnd",
    SUM(CASE WHEN t.type = 'income' THEN t.amount ELSE 0 END) AS "income",
    SUM(CASE WHEN t.type = 'expense' THEN t.amount ELSE 0 END) AS "expenses"
  FROM transactions t
  WHERE ...
  GROUP BY 1,2
  ORDER BY 1;
`);
```

### 8.3 `/api/reports/income`

This is effectively the same aggregation as cashflow but returned as `{ label, income, expenses, net }`.

### 8.4 `/api/reports/savings-rate`

Compute from cashflow series:

```ts
series.map((p) => ({
  label: p.label,
  savingsRate: p.income === 0 ? 0 : ((p.income - p.expenses) / p.income) * 100,
  income: p.income,
  expenses: p.expenses,
  savings: p.income - p.expenses,
}));
```

### 8.5 `/api/reports/spending/breakdown`

#### SQL: breakdown by category group

```sql
SELECT cg.id AS entity_id, cg.name AS label, SUM(t.amount) AS value, MAX(cg.type) as group_type
FROM transactions t
JOIN categories c ON c.id = t.category_id
JOIN category_groups cg ON cg.id = c.group_id
WHERE ...base filters...
  AND t.type = 'expense'
GROUP BY cg.id, cg.name
ORDER BY value DESC;
```

Implementation details:

- Compute `total = sum(value)` across all groups (either separate query or window function).
- Apply `limit` and roll remainder into "Other" if `includeOther=true`.
- Include `entityId = group_id` for drilldown.

### 8.6 `/api/reports/spending/trend`

Algorithm:

1. Determine current range `[from,to]` and previous range based on `compare`:
   - `previous_period`: same length directly before `from`
   - `previous_year`: shift range by -1 year
2. Query daily expense totals for each range.
3. Normalize into aligned list:
   - index = day offset from start
   - output `series[i] = { date: currentDate, current: currentValue, previous: previousValue }`
4. totals:
   - currentTotal = sum(current)
   - previousTotal = sum(previous)
   - changePct = previousTotal === 0 ? undefined : (currentTotal-previousTotal)/previousTotal\*100

#### SQL daily totals

```sql
SELECT t.date, SUM(t.amount) AS value
FROM transactions t
WHERE ...base filters...
  AND t.type='expense'
GROUP BY t.date
ORDER BY t.date;
```

### 8.7 `/api/reports/net-worth`

Use snapshots table:

```sql
SELECT date, total_assets, total_liabilities, net_worth
FROM net_worth_snapshots
WHERE household_id = $1
  AND date BETWEEN $2 AND $3
ORDER BY date;
```

If interval=month:

- Either store monthly snapshots or downsample daily snapshots server-side.

### 8.8 `/api/reports/annual`

Plan:

1. Define year range: `YYYY-01-01` -> `YYYY-12-31`.
2. Query monthly income/expense (group by month).
3. Compute totals + savings rate.
4. Compute cumulative series.
5. Query breakdown:
   - expenses by category group (best matches your Annual pies)
   - income by category group or merchant (choose one; category group is simplest)

#### SQL: monthly

```sql
SELECT
  EXTRACT(MONTH FROM t.date)::int AS month_index,
  SUM(CASE WHEN t.type='income' THEN t.amount ELSE 0 END) AS income,
  SUM(CASE WHEN t.type='expense' THEN t.amount ELSE 0 END) AS expenses
FROM transactions t
WHERE ...base filters for year...
GROUP BY 1
ORDER BY 1;
```

#### SQL: expense breakdown by group

```sql
SELECT cg.id AS entity_id, cg.name AS label, SUM(t.amount) AS value
FROM transactions t
JOIN categories c ON c.id = t.category_id
JOIN category_groups cg ON cg.id = c.group_id
WHERE ...base filters for year...
  AND t.type='expense'
GROUP BY cg.id, cg.name
ORDER BY value DESC;
```

### 8.9 `/api/reports/sankey`

For `mode=income_to_expense_groups`:

1. totals query:

```sql
SELECT
  SUM(CASE WHEN t.type='income' THEN t.amount ELSE 0 END) AS income,
  SUM(CASE WHEN t.type='expense' THEN t.amount ELSE 0 END) AS expenses
FROM transactions t
WHERE ...base filters...
```

2. group breakdown query (expenses by category group) (same as spending breakdown).
3. nodes:
   - Income (synthetic)
   - Expenses (synthetic)
   - Savings (synthetic) if enabled
   - each category group (entityType=categoryGroup)
4. links:
   - Income -> Expenses = expenseTotal
   - Income -> Savings = max(income-expenses, 0) (or include "Deficit" node if negative)
   - Expenses -> group = groupValue

For `mode=expense_groups_to_categories`:

- Add a query:

```sql
SELECT c.id AS category_id, c.name, cg.id AS group_id, SUM(t.amount) AS value
FROM transactions t
JOIN categories c ON c.id = t.category_id
JOIN category_groups cg ON cg.id = c.group_id
WHERE ...base filters...
  AND t.type='expense'
GROUP BY c.id, c.name, cg.id
ORDER BY value DESC;
```

- Apply `maxNodes` at the category level per group (roll remainder to "Other" per group).

### 8.10 `/api/reports/transactions` (drilldown)

Implement cursor pagination using `(date,id)` tuple for stable ordering.

Example for `sort=date_desc`:

```sql
SELECT ...
FROM transactions t
LEFT JOIN merchants m ON m.id=t.merchant_id
LEFT JOIN categories c ON c.id=t.category_id
WHERE ...base filters...
  AND (...) -- entity filter
  AND (t.date, t.id) < ($cursorDate, $cursorId) -- if cursor exists
ORDER BY t.date DESC, t.id DESC
LIMIT $limit;
```

Cursor encoding:

- cursor = base64(`${lastRow.date}|${lastRow.id}`)

---

## 9) Database Index Strategy

### 9.1 Critical Indexes for Analytics Performance

```sql
-- ============================================================================
-- TRANSACTIONS INDEXES (Most Critical)
-- ============================================================================

-- Primary analytics query pattern: filter by household + date range
CREATE INDEX idx_transactions_household_date
  ON transactions(household_id, date DESC)
  WHERE deleted_at IS NULL;

-- Type filtering (income/expense breakdown)
CREATE INDEX idx_transactions_household_type_date
  ON transactions(household_id, type, date DESC)
  WHERE deleted_at IS NULL;

-- Category breakdown queries
CREATE INDEX idx_transactions_category_date
  ON transactions(category_id, date DESC)
  WHERE deleted_at IS NULL AND is_excluded_from_reports = FALSE;

-- Merchant breakdown queries
CREATE INDEX idx_transactions_merchant_date
  ON transactions(merchant_id, date DESC)
  WHERE deleted_at IS NULL;

-- Account filtering
CREATE INDEX idx_transactions_account_date
  ON transactions(account_id, date DESC)
  WHERE deleted_at IS NULL;

-- Scope "mine" queries
CREATE INDEX idx_transactions_owner_date
  ON transactions(owner_user_id, date DESC)
  WHERE deleted_at IS NULL;

-- Pending transactions filter
CREATE INDEX idx_transactions_pending
  ON transactions(household_id, is_pending)
  WHERE deleted_at IS NULL AND is_pending = TRUE;

-- Drilldown cursor pagination
CREATE INDEX idx_transactions_cursor
  ON transactions(date DESC, id DESC)
  WHERE deleted_at IS NULL;

-- ============================================================================
-- SNAPSHOT INDEXES
-- ============================================================================

-- Net worth history queries
CREATE INDEX idx_net_worth_snapshots_household_date
  ON net_worth_snapshots(household_id, date DESC);

-- Account balance history
CREATE INDEX idx_account_balance_snapshots_account_date
  ON account_balance_snapshots(account_id, date DESC);

-- ============================================================================
-- ACCOUNT INDEXES
-- ============================================================================

-- Household accounts listing
CREATE INDEX idx_accounts_household
  ON accounts(household_id, display_order)
  WHERE deleted_at IS NULL AND is_archived = FALSE;

-- Net worth calculation (assets vs liabilities)
CREATE INDEX idx_accounts_household_asset
  ON accounts(household_id, is_asset)
  WHERE deleted_at IS NULL AND is_hidden = FALSE;

-- ============================================================================
-- CATEGORY INDEXES
-- ============================================================================

-- Category group lookups for breakdowns
CREATE INDEX idx_categories_group
  ON categories(group_id, display_order)
  WHERE deleted_at IS NULL;

-- ============================================================================
-- BUDGET INDEXES
-- ============================================================================

-- Budget period lookups
CREATE INDEX idx_budget_periods_budget_date
  ON budget_periods(budget_id, start_date, end_date);

-- Active budgets by household
CREATE INDEX idx_budgets_household_active
  ON budgets(household_id)
  WHERE is_active = TRUE;

-- ============================================================================
-- TRANSACTION SPLITS
-- ============================================================================

CREATE INDEX idx_transaction_splits_transaction
  ON transaction_splits(transaction_id, display_order);

-- ============================================================================
-- TRANSACTION TAGS
-- ============================================================================

CREATE INDEX idx_transaction_tags_transaction
  ON transaction_tags(transaction_id);

CREATE INDEX idx_transaction_tags_tag
  ON transaction_tags(tag_id);
```

### 9.2 Index Maintenance Notes

1. **Partial indexes** with `WHERE deleted_at IS NULL` reduce index size significantly
2. **Composite indexes** ordered by selectivity (household_id first, then date)
3. **Covering indexes** not used here to keep indexes small; rely on heap fetches
4. Run `ANALYZE` after bulk imports
5. Monitor with `pg_stat_user_indexes` for unused indexes

---

## 10) Caching Architecture

### 10.1 Cache Strategy Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        Cache Layers                              │
├─────────────────────────────────────────────────────────────────┤
│  L1: React Query (Client)     │  TTL: 30s-60s, per-user         │
├─────────────────────────────────────────────────────────────────┤
│  L2: In-Memory (Server)       │  TTL: 5min, per-household       │
├─────────────────────────────────────────────────────────────────┤
│  L3: Pre-computed Snapshots   │  Daily cron, materialized       │
└─────────────────────────────────────────────────────────────────┘
```

### 10.2 Server-Side Cache Configuration

```typescript
// server/config/cache.ts

export const ANALYTICS_CACHE_CONFIG = {
  // Dashboard endpoints - moderate TTL, frequently accessed
  dashboard: {
    ttl: 300_000, // 5 minutes
    staleWhileRevalidate: true,
  },

  // Cashflow - moderate TTL
  cashflow: {
    ttl: 300_000, // 5 minutes
    staleWhileRevalidate: true,
  },

  // Spending breakdown - moderate TTL
  spendingBreakdown: {
    ttl: 300_000, // 5 minutes
    staleWhileRevalidate: true,
  },

  // Spending trend - shorter TTL (comparison data)
  spendingTrend: {
    ttl: 180_000, // 3 minutes
    staleWhileRevalidate: true,
  },

  // Annual reports - longer TTL (less volatile)
  annual: {
    ttl: 900_000, // 15 minutes
    staleWhileRevalidate: true,
  },

  // Net worth - longer TTL (snapshot-based)
  netWorth: {
    ttl: 600_000, // 10 minutes
    staleWhileRevalidate: true,
  },

  // Sankey - expensive query, longer TTL
  sankey: {
    ttl: 600_000, // 10 minutes
    staleWhileRevalidate: true,
  },

  // Transaction drilldown - short TTL (pagination)
  transactions: {
    ttl: 60_000, // 1 minute
    staleWhileRevalidate: false,
  },
} as const;

// Cache key generation
export function analyticsKey(
  endpoint: string,
  householdId: string,
  params: Record<string, unknown>
): string {
  const sortedParams = Object.keys(params)
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join("&");
  return `analytics:${endpoint}:${householdId}:${sortedParams}`;
}
```

### 10.3 In-Memory Cache Implementation

```typescript
// server/services/AnalyticsCache.ts

import NodeCache from "node-cache";
import { ANALYTICS_CACHE_CONFIG, analyticsKey } from "../config/cache";

class AnalyticsCache {
  private cache: NodeCache;

  constructor() {
    this.cache = new NodeCache({
      stdTTL: 300, // Default 5 minutes
      checkperiod: 60, // Check for expired keys every minute
      useClones: false, // Return references for performance
      maxKeys: 10000, // Limit memory usage
    });
  }

  async getOrCompute<T>(
    endpoint: keyof typeof ANALYTICS_CACHE_CONFIG,
    householdId: string,
    params: Record<string, unknown>,
    compute: () => Promise<T>
  ): Promise<T> {
    const key = analyticsKey(endpoint, householdId, params);
    const config = ANALYTICS_CACHE_CONFIG[endpoint];

    // Check cache
    const cached = this.cache.get<T>(key);
    if (cached !== undefined) {
      return cached;
    }

    // Compute and cache
    const result = await compute();
    this.cache.set(key, result, config.ttl / 1000);

    return result;
  }

  invalidateHousehold(householdId: string): void {
    const keys = this.cache.keys();
    const toDelete = keys.filter((k) => k.includes(`:${householdId}:`));
    this.cache.del(toDelete);
  }

  invalidateEndpoint(endpoint: string, householdId: string): void {
    const keys = this.cache.keys();
    const toDelete = keys.filter((k) =>
      k.startsWith(`analytics:${endpoint}:${householdId}:`)
    );
    this.cache.del(toDelete);
  }
}

export const analyticsCache = new AnalyticsCache();
```

### 10.4 Cache Invalidation Triggers

```typescript
// server/services/CacheInvalidation.ts

import { analyticsCache } from "./AnalyticsCache";

export const INVALIDATION_MAP = {
  // When a transaction is created/updated/deleted
  transaction: [
    "cashflow",
    "spendingBreakdown",
    "spendingTrend",
    "annual",
    "sankey",
    "income",
    "savingsRate",
    "transactions",
  ],

  // When an account balance changes
  account: ["netWorth", "dashboard"],

  // When a category is modified
  category: ["spendingBreakdown", "annual", "sankey"],

  // When budget is modified
  budget: ["dashboard"],
} as const;

export function invalidateOnChange(
  entity: keyof typeof INVALIDATION_MAP,
  householdId: string
): void {
  const endpoints = INVALIDATION_MAP[entity];
  endpoints.forEach((endpoint) => {
    analyticsCache.invalidateEndpoint(endpoint, householdId);
  });
}
```

### 10.5 Redis Cache Versioning Strategy

For production deployments with Redis, use cache versioning to enable instant global cache invalidation during deployments or schema changes.

```typescript
// server/services/RedisCacheService.ts
import { Redis } from "ioredis";
import { createHash } from "crypto";

export class RedisCacheService {
  private redis: Redis;
  private cacheVersion: number = 1; // Increment to invalidate ALL caches globally

  constructor(redisUrl: string) {
    this.redis = new Redis(redisUrl);
  }

  // Versioned cache key generation
  private getCacheKey(
    type: string,
    householdId: string,
    params: object
  ): string {
    const hash = createHash("md5")
      .update(JSON.stringify(params))
      .digest("hex")
      .substring(0, 8);
    return `report:v${this.cacheVersion}:${type}:${householdId}:${hash}`;
  }

  async getOrCompute<T>(
    type: string,
    householdId: string,
    params: object,
    ttlSeconds: number,
    compute: () => Promise<T>
  ): Promise<T> {
    const key = this.getCacheKey(type, householdId, params);

    // Try cache first
    const cached = await this.redis.get(key);
    if (cached) {
      return JSON.parse(cached);
    }

    // Compute and cache
    const result = await compute();
    await this.redis.setex(key, ttlSeconds, JSON.stringify(result));
    return result;
  }

  // Invalidate all caches for a household
  async invalidateHouseholdCache(householdId: string): Promise<void> {
    const pattern = `report:v${this.cacheVersion}:*:${householdId}:*`;
    const keys = await this.redis.keys(pattern);
    if (keys.length > 0) {
      await this.redis.del(...keys);
    }
  }

  // Invalidate specific endpoint type for household
  async invalidateEndpoint(type: string, householdId: string): Promise<void> {
    const pattern = `report:v${this.cacheVersion}:${type}:${householdId}:*`;
    const keys = await this.redis.keys(pattern);
    if (keys.length > 0) {
      await this.redis.del(...keys);
    }
  }
}

// Cache TTLs by report type (in seconds)
export const REDIS_CACHE_TTLS: Record<string, number> = {
  dashboard: 5 * 60, // 5 minutes
  spending: 15 * 60, // 15 minutes
  trends: 60 * 60, // 1 hour
  annual: 24 * 60 * 60, // 24 hours (historical data rarely changes)
  net_worth: 30 * 60, // 30 minutes
  sankey: 10 * 60, // 10 minutes (expensive query)
  cashflow: 5 * 60, // 5 minutes
};
```

**Version Bump Strategy**:

- Increment `cacheVersion` during:
  - Schema migrations that affect report calculations
  - Business logic changes in report computation
  - Major deployments requiring fresh cache
- Old keys will naturally expire via TTL

### 10.6 React Query Client Configuration

```typescript
// client/src/lib/queryClient.ts

import { QueryClient } from "@tanstack/react-query";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Don't refetch on window focus for analytics (too expensive)
      refetchOnWindowFocus: false,

      // Retry failed requests twice
      retry: 2,

      // Consider data stale after 30 seconds
      staleTime: 30_000,

      // Keep unused data in cache for 5 minutes
      gcTime: 300_000,
    },
  },
});

// Analytics-specific defaults
export const ANALYTICS_QUERY_OPTIONS = {
  dashboard: {
    staleTime: 60_000,
    gcTime: 300_000,
  },
  annual: {
    staleTime: 300_000, // 5 minutes - data doesn't change often
    gcTime: 600_000,
  },
  netWorth: {
    staleTime: 300_000,
    gcTime: 600_000,
  },
  transactions: {
    staleTime: 10_000, // 10 seconds - more real-time
    gcTime: 60_000,
  },
} as const;
```

---

## 11) Rate Limiting

### 11.1 Rate Limit Configuration

```typescript
// server/middleware/rateLimit.ts

import rateLimit from "express-rate-limit";

// General API rate limit
export const apiLimiter = rateLimit({
  windowMs: 60_000, // 1 minute
  max: 100, // 100 requests per minute
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: {
      code: "RATE_LIMITED",
      message: "Too many requests. Please try again later.",
    },
  },
});

// Stricter limit for expensive analytics endpoints
export const analyticsLimiter = rateLimit({
  windowMs: 60_000, // 1 minute
  max: 30, // 30 requests per minute for analytics
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    // Rate limit per user, not IP
    return req.session?.userId || req.ip;
  },
  message: {
    success: false,
    error: {
      code: "RATE_LIMITED",
      message:
        "Analytics rate limit exceeded. Please wait before requesting more reports.",
    },
  },
});

// Very strict limit for Sankey (most expensive)
export const sankeyLimiter = rateLimit({
  windowMs: 60_000,
  max: 10, // Only 10 sankey requests per minute
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.session?.userId || req.ip,
});
```

### 11.2 Apply Rate Limits to Routes

```typescript
// server/routes/reports.ts

import { analyticsLimiter, sankeyLimiter } from "../middleware/rateLimit";

// Apply analytics limiter to all report routes
router.use(analyticsLimiter);

// Extra strict limit for sankey
router.get("/sankey", sankeyLimiter, async (req, res) => {
  // ...
});
```

---

## 12) Snapshot Worker Specification

### 12.1 Daily Snapshot Job

````typescript
// server/jobs/snapshotWorker.ts

import cron from "node-cron";
import { db } from "../db";
import {
  accounts,
  netWorthSnapshots,
  accountBalanceSnapshots,
} from "@shared/schema";
import { eq, and, isNull } from "drizzle-orm";

interface SnapshotConfig {
  schedule: string; // Cron expression
  retryAttempts: number;
  retryDelayMs: number;
}

const config: SnapshotConfig = {
  schedule: "0 0 * * *", // Daily at midnight
  retryAttempts: 3,
  retryDelayMs: 60_000, // 1 minute between retries
};

async function createDailySnapshots(): Promise<void> {
  const today = new Date().toISOString().split("T")[0];

  // Get all active households
  const householdsWithAccounts = await db
    .selectDistinct({ householdId: accounts.householdId })
    .from(accounts)
    .where(and(isNull(accounts.deletedAt), eq(accounts.isHidden, false)));

  for (const { householdId } of householdsWithAccounts) {
    await createHouseholdSnapshot(householdId, today);
  }
}

async function createHouseholdSnapshot(
  householdId: string,
  date: string
): Promise<void> {
  // Get all visible accounts
  const householdAccounts = await db
    .select()
    .from(accounts)
    .where(
      and(
        eq(accounts.householdId, householdId),
        isNull(accounts.deletedAt),
        eq(accounts.isHidden, false)
      )
    );

  // Calculate totals
  let totalAssets = 0;
  let totalLiabilities = 0;
  const assetsByType: Record<string, number> = {};
  const liabilitiesByType: Record<string, number> = {};
  const accountBalances: Array<{ accountId: string; balance: number }> = [];

  for (const account of householdAccounts) {
    const balance = Number(account.balance);
    accountBalances.push({ accountId: account.id, balance });

    if (account.isAsset) {
      totalAssets += balance;
      assetsByType[account.type] = (assetsByType[account.type] || 0) + balance;
    } else {
      totalLiabilities += Math.abs(balance);
      liabilitiesByType[account.type] =
        (liabilitiesByType[account.type] || 0) + Math.abs(balance);
    }

    // Create individual account snapshot
    await db
      .insert(accountBalanceSnapshots)
      .values({
        accountId: account.id,
        date,
        balance: account.balance,
        availableBalance: account.availableBalance,
      })
      .onConflictDoUpdate({
        target: [
          accountBalanceSnapshots.accountId,
          accountBalanceSnapshots.date,
        ],
        set: {
          balance: account.balance,
          availableBalance: account.availableBalance,
        },
      });
  }

  // Create net worth snapshot
  await db
    .insert(netWorthSnapshots)
    .values({
      householdId,
      date,
      totalAssets: totalAssets.toFixed(2),
      totalLiabilities: totalLiabilities.toFixed(2),
      netWorth: (totalAssets - totalLiabilities).toFixed(2),
      assetsByType,
      liabilitiesByType,
      accountBalances,
      currency: "ZMW", // TODO: Get from household
    })
    .onConflictDoUpdate({
      target: [netWorthSnapshots.householdId, netWorthSnapshots.date],
      set: {
        totalAssets: totalAssets.toFixed(2),
        totalLiabilities: totalLiabilities.toFixed(2),
        netWorth: (totalAssets - totalLiabilities).toFixed(2),
        assetsByType,
        liabilitiesByType,
        accountBalances,
      },
    });
}

// Start the cron job
export function startSnapshotWorker(): void {
  cron.schedule(config.schedule, async () => {
    console.log("[SnapshotWorker] Starting daily snapshot job...");

    for (let attempt = 1; attempt <= config.retryAttempts; attempt++) {
      try {
        await createDailySnapshots();
        console.log("[SnapshotWorker] Daily snapshots completed successfully");
        return;
      } catch (error) {
        console.error(`[SnapshotWorker] Attempt ${attempt} failed:`, error);
        if (attempt < config.retryAttempts) {
          await new Promise((r) => setTimeout(r, config.retryDelayMs));
        }
      }
    }

    console.error("[SnapshotWorker] All retry attempts exhausted");
  });

  console.log(`[SnapshotWorker] Scheduled: ${config.schedule}`);
}

// Manual trigger for backfilling
export async function backfillSnapshots(
  householdId: string,
  startDate: string,
  endDate: string
): Promise<void> {
  // Implementation for historical backfill
  // Would need to reconstruct balances from transaction history
}

### 12.2 Serverless Considerations (Vercel/Netlify)

`node-cron` is not reliable in serverless environments as the server instance spins down. For serverless deployments:

1. Expose a secured API endpoint: `POST /api/cron/snapshot` protected by a secret key.
2. Trigger using **GitHub Actions** (scheduled workflow) or **Vercel Cron** (vercel.json).

### 12.3 Historical Backfill Strategy

"Replaying" historical net worth purely from transactions is mathematically difficult without a known "start balance".
**Recommendation**: Implement a "Balance Adjustment" transaction type.
- Create a specific transaction type or category for "Opening Balance" and "Reconciliation Adjustment".
- This makes the mathematical replay strictly deterministic (`sum(transactions) = balance`).

### 12.4 Snapshot Concurrency Locks

To prevent duplicate snapshots when multiple server instances or cron triggers occur simultaneously, use distributed locking:

```typescript
// server/services/SnapshotLockService.ts
import { Redis } from "ioredis";

export class SnapshotLockService {
  private redis: Redis;
  private lockPrefix = "snapshot:lock:";
  private lockTtlSeconds = 300; // 5 minute lock timeout

  constructor(redis: Redis) {
    this.redis = redis;
  }

  // Acquire lock for a household's daily snapshot
  async acquireLock(householdId: string, date: string): Promise<boolean> {
    const key = `${this.lockPrefix}${householdId}:${date}`;
    // SET NX ensures atomic "set if not exists"
    const result = await this.redis.set(key, "locked", "EX", this.lockTtlSeconds, "NX");
    return result === "OK";
  }

  // Release lock after completion
  async releaseLock(householdId: string, date: string): Promise<void> {
    const key = `${this.lockPrefix}${householdId}:${date}`;
    await this.redis.del(key);
  }

  // Mark snapshot as completed (permanent marker, different from lock)
  async markCompleted(householdId: string, date: string): Promise<void> {
    const key = `snapshot:completed:${householdId}:${date}`;
    await this.redis.set(key, "1", "EX", 86400 * 7); // Keep for 7 days
  }

  // Check if snapshot already completed today
  async isCompleted(householdId: string, date: string): Promise<boolean> {
    const key = `snapshot:completed:${householdId}:${date}`;
    const result = await this.redis.get(key);
    return result === "1";
  }
}

// Usage in snapshot worker
async function createHouseholdSnapshotWithLock(
  householdId: string,
  date: string,
  lockService: SnapshotLockService
): Promise<void> {
  // Skip if already completed
  if (await lockService.isCompleted(householdId, date)) {
    console.log(`[Snapshot] Already completed for ${householdId} on ${date}`);
    return;
  }

  // Try to acquire lock
  const acquired = await lockService.acquireLock(householdId, date);
  if (!acquired) {
    console.log(`[Snapshot] Another instance processing ${householdId}`);
    return;
  }

  try {
    await createHouseholdSnapshot(householdId, date);
    await lockService.markCompleted(householdId, date);
  } finally {
    await lockService.releaseLock(householdId, date);
  }
}
````

**Lock Strategy Notes**:

- Use Redis `SET NX` for atomic lock acquisition
- TTL prevents deadlocks if worker crashes
- Separate "completed" marker prevents re-processing
- In non-Redis environments, use PostgreSQL advisory locks:

```sql
SELECT pg_try_advisory_lock(hashtext('snapshot:' || household_id || ':' || date));
```

---

## 13) Error Response Contracts

### 13.1 Standard Error Format

```typescript
// shared/types/api.ts

export interface ApiError {
  code: ApiErrorCode;
  message: string;
  details?: unknown;
  field?: string; // For validation errors
}

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: ApiError;
}

export type ApiErrorCode =
  | "VALIDATION_ERROR"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "RATE_LIMITED"
  | "INTERNAL_ERROR"
  | "NOT_IMPLEMENTED"
  | "BAD_REQUEST"
  | "CONFLICT";
```

### 13.2 Analytics-Specific Error Codes

```typescript
// Additional error codes for analytics
export type AnalyticsErrorCode =
  | "INVALID_DATE_RANGE" // from > to
  | "DATE_RANGE_TOO_LARGE" // > 5 years
  | "MISSING_REQUIRED_FILTER" // Transaction drilldown without filter
  | "INVALID_INTERVAL" // Unsupported interval for endpoint
  | "NO_DATA_AVAILABLE" // No transactions in range
  | "SNAPSHOT_NOT_FOUND"; // Net worth snapshot missing
```

### 13.3 Error Response Examples

```typescript
// Validation error
{
  success: false,
  error: {
    code: "VALIDATION_ERROR",
    message: "Invalid query parameters",
    details: [
      { path: ["from"], message: "Expected YYYY-MM-DD format" },
      { path: ["interval"], message: "Must be 'day', 'week', or 'month'" }
    ]
  }
}

// Date range error
{
  success: false,
  error: {
    code: "INVALID_DATE_RANGE",
    message: "Start date must be before end date",
    details: { from: "2024-12-01", to: "2024-01-01" }
  }
}

// Rate limit error
{
  success: false,
  error: {
    code: "RATE_LIMITED",
    message: "Analytics rate limit exceeded. Please wait before requesting more reports.",
    details: { retryAfter: 45 } // seconds
  }
}
```

---

## 14) Performance Benchmarks

### 14.1 Target Response Times

| Endpoint                      | Target P50 | Target P95 | Max Acceptable |
| ----------------------------- | ---------- | ---------- | -------------- |
| `/reports/dashboard`          | 200ms      | 500ms      | 1000ms         |
| `/reports/cashflow`           | 150ms      | 400ms      | 800ms          |
| `/reports/spending/breakdown` | 100ms      | 300ms      | 600ms          |
| `/reports/spending/trend`     | 150ms      | 400ms      | 800ms          |
| `/reports/annual`             | 300ms      | 800ms      | 2000ms         |
| `/reports/net-worth`          | 100ms      | 250ms      | 500ms          |
| `/reports/sankey`             | 400ms      | 1000ms     | 2500ms         |
| `/reports/savings-rate`       | 100ms      | 300ms      | 600ms          |
| `/reports/transactions`       | 50ms       | 150ms      | 300ms          |

### 14.2 Query Complexity Limits

- Maximum date range: 5 years
- Maximum transactions in single query: 10,000 (use pagination beyond)
- Maximum Sankey nodes: 200
- Maximum breakdown items: 200

### 14.3 Monitoring Metrics

Track these metrics in production:

```typescript
// Recommended metrics to collect
interface AnalyticsMetrics {
  // Latency
  responseTimeMs: number;
  dbQueryTimeMs: number;

  // Cache
  cacheHit: boolean;
  cacheTtlRemaining?: number;

  // Query characteristics
  dateRangeDays: number;
  transactionCount: number;

  // Errors
  errorCode?: string;

  // Resource usage
  resultSizeBytes: number;
}
```

### 14.4 Verification Strategy

To verify these benchmarks before deployment:
**Create a seed script** that generates:

- 10,000 transactions distributed over 2 years
- 20 active categories
- 5 accounts
- Run the benchmark suite against this dataset locally.

---

## 15) Security Model

### 15.1 Authorization Checks

Every analytics endpoint must verify:

1. **Authentication**: User is logged in (`requireAuth` middleware)
2. **Household membership**: User belongs to requested household
3. **Entity ownership**: Filtered entities (accounts, categories) belong to household

```typescript
// server/middleware/analyticsAuth.ts

export async function validateAnalyticsAccess(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const userId = req.session.userId;

  // Get user's household
  const household = await storage.getHouseholdByUserId(userId);
  if (!household) {
    res.status(403).json({
      success: false,
      error: {
        code: "FORBIDDEN",
        message: "User does not belong to any household",
      },
    });
    return;
  }

  // Attach to request for downstream use
  req.householdId = household.id;
  req.householdCurrency = household.currency;

  // Validate any entity IDs in query params belong to this household
  const { accountId, categoryId, merchantId, tagId } = req.query;

  if (accountId) {
    const valid = await storage.accountBelongsToHousehold(
      accountId as string,
      household.id
    );
    if (!valid) {
      res.status(403).json({
        success: false,
        error: { code: "FORBIDDEN", message: "Account not found in household" },
      });
      return;
    }
  }

  // Similar checks for categoryId, merchantId, tagId...

  next();
}
```

### 15.2 Data Sanitization

```typescript
// Sanitize transaction names in responses (prevent XSS)
function sanitizeTransactionName(name: string): string {
  return name
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .slice(0, 255);
}

// Sanitize search input
function sanitizeSearchQuery(search: string): string {
  return search
    .replace(/[%_]/g, "\\$&") // Escape SQL LIKE wildcards
    .slice(0, 200);
}
```

---

## 16) Observability

### 16.1 Structured Logging

```typescript
// server/utils/analyticsLogger.ts

interface AnalyticsLogEntry {
  timestamp: string;
  level: "info" | "warn" | "error";
  endpoint: string;
  householdId: string;
  userId: string;
  durationMs: number;
  cacheHit: boolean;
  params: Record<string, unknown>;
  resultCount?: number;
  error?: string;
}

export function logAnalyticsRequest(entry: AnalyticsLogEntry): void {
  const logLine = JSON.stringify({
    ...entry,
    service: "analytics",
  });

  if (entry.level === "error") {
    console.error(logLine);
  } else {
    console.log(logLine);
  }
}
```

### 16.2 Health Check Endpoint

```typescript
// GET /api/reports/health
router.get("/health", async (req, res) => {
  const checks = {
    database: false,
    cache: false,
    snapshotWorker: false,
  };

  try {
    // Check database
    await db.execute(sql`SELECT 1`);
    checks.database = true;

    // Check cache
    analyticsCache.set("health-check", "ok", 1);
    checks.cache = analyticsCache.get("health-check") === "ok";

    // Check if snapshots are recent
    const latestSnapshot = await db
      .select({ date: netWorthSnapshots.date })
      .from(netWorthSnapshots)
      .orderBy(desc(netWorthSnapshots.date))
      .limit(1);

    if (latestSnapshot.length > 0) {
      const snapshotAge =
        Date.now() - new Date(latestSnapshot[0].date).getTime();
      checks.snapshotWorker = snapshotAge < 48 * 60 * 60 * 1000; // < 48 hours
    }

    const healthy = Object.values(checks).every(Boolean);

    res.status(healthy ? 200 : 503).json({
      success: healthy,
      checks,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    res.status(503).json({
      success: false,
      checks,
      error: "Health check failed",
    });
  }
});
```

---

## 17) Suggested Server Folder Structure

```text
server/
  routes/
    reports.ts
  repositories/
    ReportRepository.ts
  services/
    ReportService.ts
    AnalyticsCache.ts
    CacheInvalidation.ts
  validation/
    reports.ts
  middleware/
    rateLimit.ts
    analyticsAuth.ts
  jobs/
    snapshotWorker.ts
  config/
    cache.ts
  utils/
    reporting/
      dateRange.ts
      formatting.ts
      sankey.ts
    analyticsLogger.ts
```

`reports.ts` should:

- parse query with zod
- derive householdId via `storage.getHouseholdByUserId`
- call `ReportService`
- return `{ success: true, data: ... }`

Route registration:

- in `server/routes.ts` add:
  - `import reportsRoutes from "./routes/reports";`
  - `app.use("/api/reports", reportsRoutes);`

---

## 18) Client: React Query Hook Shapes

Create `client/src/hooks/use-reports.ts` (separate from `use-settings.ts`).

### 18.1 Base fetch helper

```ts
async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { credentials: "include" });
  const json = await res.json();
  if (!res.ok || !json.success)
    throw new Error(json.error?.message || "Request failed");
  return json.data as T;
}

function toQueryString(params: Record<string, unknown>): string {
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue;
    qs.set(key, String(value));
  }
  const str = qs.toString();
  return str ? `?${str}` : "";
}
```

### 18.2 Hook signatures

```ts
import { useQuery, useInfiniteQuery } from "@tanstack/react-query";

export function useReportsAnnual(params: ReportsAnnualParams) {
  return useQuery({
    queryKey: ["reports", "annual", params],
    queryFn: () =>
      fetchJson<ReportsAnnualResponse>(
        `/api/reports/annual${toQueryString(params)}`
      ),
    staleTime: 300_000,
  });
}

export function useReportsCashflow(params: ReportsCashflowParams) {
  return useQuery({
    queryKey: ["reports", "cashflow", params],
    queryFn: () =>
      fetchJson<ReportsCashflowResponse>(
        `/api/reports/cashflow${toQueryString(params)}`
      ),
    staleTime: 180_000,
  });
}

// ... similar hooks for sankey, spending/breakdown, spending/trend, income, net-worth, savings-rate

// Transaction drilldown with infinite scrolling
export function useReportsTransactionsInfinite(
  params: Omit<ReportsTransactionsParams, "cursor">
) {
  return useInfiniteQuery({
    queryKey: ["reports", "transactions", params],
    queryFn: async ({ pageParam }) => {
      const queryParams = {
        ...params,
        cursor: pageParam as string | undefined,
      };
      return fetchJson<ReportsTransactionsResponse>(
        `/api/reports/transactions${toQueryString(queryParams)}`
      );
    },
    enabled: Boolean(
      params.type ||
        params.search ||
        params.categoryId ||
        params.categoryGroupId ||
        params.merchantId ||
        params.accountId ||
        params.tagId
    ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.page.nextCursor ?? undefined,
    staleTime: 30_000,
  });
}
```

### 18.3 Utility Hooks

```ts
export function useCurrentMonthRange(): { from: string; to: string } {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  return {
    from: new Date(year, month, 1).toISOString().split("T")[0],
    to: new Date(year, month + 1, 0).toISOString().split("T")[0],
  };
}

export function useCurrentYearRange(): { from: string; to: string } {
  const year = new Date().getFullYear();
  return { from: `${year}-01-01`, to: `${year}-12-31` };
}
```

---

## 19) Implementation Order (Practical)

### Phase 0: Schema & Infrastructure

1. Add tables to `shared/schema.ts` (DONE - see Section 5)
2. Run `npm run db:push` to create tables
3. Run index creation SQL from Section 9

### Phase 1: Core CRUD

1. Implement CRUD endpoints: `/api/accounts`, `/api/transactions`
2. Implement cache service from Section 10
3. Add rate limiting middleware from Section 11

### Phase 2: Basic Analytics

1. `/api/reports/cashflow`
2. `/api/reports/spending/breakdown`
3. `/api/reports/spending/trend`

### Phase 3: Snapshots & Net Worth

1. Implement snapshot worker from Section 12
2. `/api/reports/net-worth`

### Phase 4: Advanced Analytics

1. `/api/reports/sankey`
2. `/api/reports/transactions` (drilldown)

### Phase 5: Annual Dashboard

1. `/api/reports/annual`
2. `/api/reports/income`
3. `/api/reports/savings-rate`

### Phase 6: Dashboard Aggregator

1. `/api/reports/dashboard` (optional composite endpoint)
2. Set up monitoring per Section 16

---

## 20) Monarch Alignment (Public Marketing Only)

Monarch's public messaging emphasizes:

- "visualize the flow of money"
- spending trends, income, net worth over time
- cash flow section and bill calendar

This architecture supports the same primitives by providing:

- a first-class reports API surface
- deterministic metric definitions
- snapshot-backed history charts
- drilldown workflows (click chart element -> list transactions)

---

## Appendix: Implementation Checklist

- [x] Add schema definitions to `shared/schema.ts`
- [ ] Run Drizzle migrations (`npm run db:push`)
- [ ] Create indexes from Section 9
- [ ] Implement cache service from Section 10
- [ ] Add rate limiting middleware from Section 11
- [ ] Implement snapshot worker from Section 12
- [ ] Update error responses to match Section 13
- [ ] Set up monitoring per Section 16
- [ ] Performance test against benchmarks in Section 14
- [ ] Wire up frontend hooks to replace hardcoded data
