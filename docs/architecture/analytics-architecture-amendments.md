# Analytics & Reporting Architecture - Amendments

This document provides the missing sections identified during the architectural audit. These amendments should be merged into `docs/analytics-reporting-architecture.md` before implementation.

---

## Amendment A: Complete Schema Definitions (Phase 0)

These Drizzle ORM schema definitions must be added to `shared/schema.ts` before any analytics work begins.

### A.1 Accounts Table

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
  "other"
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
  balance: decimal("balance", { precision: 15, scale: 2 }).notNull().default("0"),
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

### A.2 Transactions Table

```typescript
// ============================================================================
// TRANSACTIONS
// ============================================================================

export const transactionTypes = pgEnum("transaction_type", [
  "income",
  "expense",
  "transfer"
]);

export const transactions = pgTable("transactions", {
  id: uuid("id").primaryKey().defaultRandom(),
  householdId: uuid("household_id")
    .notNull()
    .references(() => households.id, { onDelete: "cascade" }),
  accountId: uuid("account_id")
    .notNull()
    .references(() => accounts.id, { onDelete: "cascade" }),

  // Ownership for "mine" vs "household" scope
  ownerUserId: uuid("owner_user_id")
    .references(() => users.id, { onDelete: "set null" }),

  // Core transaction data
  date: date("date").notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  originalName: varchar("original_name", { length: 255 }), // Pre-rule/cleanup name
  amount: decimal("amount", { precision: 15, scale: 2 }).notNull(),
  type: transactionTypes("type").notNull(),

  // Categorization
  categoryId: uuid("category_id")
    .references(() => categories.id, { onDelete: "set null" }),
  merchantId: uuid("merchant_id")
    .references(() => merchants.id, { onDelete: "set null" }),

  // For transfers
  transferAccountId: uuid("transfer_account_id")
    .references(() => accounts.id, { onDelete: "set null" }),
  transferTransactionId: uuid("transfer_transaction_id"), // Links the pair

  // Status flags
  isPending: boolean("is_pending").notNull().default(false),
  isRecurring: boolean("is_recurring").notNull().default(false),
  recurringTransactionId: uuid("recurring_transaction_id"),

  // Exclusion flags for analytics
  isExcludedFromReports: boolean("is_excluded_from_reports").notNull().default(false),
  isExcludedFromBudget: boolean("is_excluded_from_budget").notNull().default(false),

  // Review workflow
  reviewedAt: timestamp("reviewed_at"),
  reviewedBy: uuid("reviewed_by").references(() => users.id),

  // User notes
  notes: text("notes"),


  // Metadata
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  deletedAt: timestamp("deleted_at"),
});
```

### A.3 Transaction Tags (Many-to-Many)

```typescript
// ============================================================================
// TRANSACTION TAGS
// ============================================================================

export const transactionTags = pgTable("transaction_tags", {
  id: uuid("id").primaryKey().defaultRandom(),
  transactionId: uuid("transaction_id")
    .notNull()
    .references(() => transactions.id, { onDelete: "cascade" }),
  tagId: uuid("tag_id")
    .notNull()
    .references(() => tags.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  uniqueTransactionTag: unique().on(table.transactionId, table.tagId),
}));
```

### A.4 Transaction Splits

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
  categoryId: uuid("category_id")
    .references(() => categories.id, { onDelete: "set null" }),
  merchantId: uuid("merchant_id")
    .references(() => merchants.id, { onDelete: "set null" }),
  notes: text("notes"),

  // Order for display
  displayOrder: integer("display_order").notNull().default(0),

  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// CONSTRAINT: Sum of splits must equal parent transaction amount
// Enforced at application layer, not DB
```

### A.5 Net Worth Snapshots

```typescript
// ============================================================================
// NET WORTH SNAPSHOTS
// ============================================================================

export const netWorthSnapshots = pgTable("net_worth_snapshots", {
  id: uuid("id").primaryKey().defaultRandom(),
  householdId: uuid("household_id")
    .notNull()
    .references(() => households.id, { onDelete: "cascade" }),

  date: date("date").notNull(),

  // Aggregated values
  totalAssets: decimal("total_assets", { precision: 15, scale: 2 }).notNull(),
  totalLiabilities: decimal("total_liabilities", { precision: 15, scale: 2 }).notNull(),
  netWorth: decimal("net_worth", { precision: 15, scale: 2 }).notNull(),

  // Breakdown by account type (JSONB for flexibility)
  assetsByType: jsonb("assets_by_type"), // { checking: 5000, savings: 10000, ... }
  liabilitiesByType: jsonb("liabilities_by_type"), // { credit_card: 2000, loan: 5000, ... }

  // Individual account balances at snapshot time
  accountBalances: jsonb("account_balances"), // [{ accountId, balance }, ...]

  currency: varchar("currency", { length: 3 }).notNull().default("ZMW"),

  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  // One snapshot per household per day
  uniqueHouseholdDate: unique().on(table.householdId, table.date),
}));
```

### A.6 Account Balance Snapshots

```typescript
// ============================================================================
// ACCOUNT BALANCE SNAPSHOTS
// ============================================================================

export const accountBalanceSnapshots = pgTable("account_balance_snapshots", {
  id: uuid("id").primaryKey().defaultRandom(),
  accountId: uuid("account_id")
    .notNull()
    .references(() => accounts.id, { onDelete: "cascade" }),

  date: date("date").notNull(),
  balance: decimal("balance", { precision: 15, scale: 2 }).notNull(),
  availableBalance: decimal("available_balance", { precision: 15, scale: 2 }),

  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  uniqueAccountDate: unique().on(table.accountId, table.date),
}));
```

### A.7 Budgets and Budget Periods

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
  categoryId: uuid("category_id")
    .references(() => categories.id, { onDelete: "cascade" }),
  categoryGroupId: uuid("category_group_id")
    .references(() => categoryGroups.id, { onDelete: "cascade" }),

  // Budget configuration
  amount: decimal("amount", { precision: 15, scale: 2 }).notNull(),
  period: varchar("period", { length: 20 }).notNull().default("monthly"), // monthly, yearly, custom

  // Rollover settings
  rolloverEnabled: boolean("rollover_enabled").notNull().default(false),
  rolloverAmount: decimal("rollover_amount", { precision: 15, scale: 2 }).default("0"),

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
  spentAmount: decimal("spent_amount", { precision: 15, scale: 2 }).notNull().default("0"),
  rolloverIn: decimal("rollover_in", { precision: 15, scale: 2 }).default("0"),

  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
```

### A.8 Goals

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
  currentAmount: decimal("current_amount", { precision: 15, scale: 2 }).notNull().default("0"),
  currency: varchar("currency", { length: 3 }).notNull().default("ZMW"),

  // Timeline
  targetDate: date("target_date"),
  startDate: date("start_date").notNull().defaultNow(),

  // Linked account (optional - for tracking)
  linkedAccountId: uuid("linked_account_id")
    .references(() => accounts.id, { onDelete: "set null" }),

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
  transactionId: uuid("transaction_id")
    .references(() => transactions.id, { onDelete: "set null" }),

  createdAt: timestamp("created_at").notNull().defaultNow(),
});
```

### A.9 Recurring Transactions

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
  "yearly"
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
  categoryId: uuid("category_id")
    .references(() => categories.id, { onDelete: "set null" }),
  merchantId: uuid("merchant_id")
    .references(() => merchants.id, { onDelete: "set null" }),

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

## Amendment B: Database Index Strategy

### B.1 Critical Indexes for Analytics Performance

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

### B.2 Index Maintenance Notes

1. **Partial indexes** with `WHERE deleted_at IS NULL` reduce index size significantly
2. **Composite indexes** ordered by selectivity (household_id first, then date)
3. **Covering indexes** not used here to keep indexes small; rely on heap fetches
4. Run `ANALYZE` after bulk imports
5. Monitor with `pg_stat_user_indexes` for unused indexes

---

## Amendment C: Caching Architecture

### C.1 Cache Strategy Overview

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

### C.2 Server-Side Cache Configuration

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

### C.3 In-Memory Cache Implementation

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
    const toDelete = keys.filter(
      (k) => k.startsWith(`analytics:${endpoint}:${householdId}:`)
    );
    this.cache.del(toDelete);
  }
}

export const analyticsCache = new AnalyticsCache();
```

### C.4 Cache Invalidation Triggers

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
  account: [
    "netWorth",
    "dashboard",
  ],

  // When a category is modified
  category: [
    "spendingBreakdown",
    "annual",
    "sankey",
  ],

  // When budget is modified
  budget: [
    "dashboard",
  ],
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

### C.5 React Query Client Configuration

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

## Amendment D: Rate Limiting

### D.1 Rate Limit Configuration

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
      message: "Analytics rate limit exceeded. Please wait before requesting more reports.",
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

### D.2 Apply Rate Limits to Routes

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

## Amendment E: Snapshot Worker Specification

### E.1 Daily Snapshot Job

```typescript
// server/jobs/snapshotWorker.ts

import cron from "node-cron";
import { db } from "../db";
import { accounts, netWorthSnapshots, accountBalanceSnapshots } from "@shared/schema";
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
    .where(and(
      isNull(accounts.deletedAt),
      eq(accounts.isHidden, false)
    ));

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
    .where(and(
      eq(accounts.householdId, householdId),
      isNull(accounts.deletedAt),
      eq(accounts.isHidden, false)
    ));

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
      liabilitiesByType[account.type] = (liabilitiesByType[account.type] || 0) + Math.abs(balance);
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
        target: [accountBalanceSnapshots.accountId, accountBalanceSnapshots.date],
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
```

---

## Amendment F: Error Response Contracts

### F.1 Standard Error Format

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

### F.2 Analytics-Specific Error Codes

```typescript
// Additional error codes for analytics
export type AnalyticsErrorCode =
  | "INVALID_DATE_RANGE"      // from > to
  | "DATE_RANGE_TOO_LARGE"    // > 5 years
  | "MISSING_REQUIRED_FILTER" // Transaction drilldown without filter
  | "INVALID_INTERVAL"        // Unsupported interval for endpoint
  | "NO_DATA_AVAILABLE"       // No transactions in range
  | "SNAPSHOT_NOT_FOUND";     // Net worth snapshot missing
```

### F.3 Error Response Examples

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

## Amendment G: Performance Benchmarks

### G.1 Target Response Times

| Endpoint | Target P50 | Target P95 | Max Acceptable |
|----------|-----------|-----------|----------------|
| `/reports/dashboard` | 200ms | 500ms | 1000ms |
| `/reports/cashflow` | 150ms | 400ms | 800ms |
| `/reports/spending/breakdown` | 100ms | 300ms | 600ms |
| `/reports/spending/trend` | 150ms | 400ms | 800ms |
| `/reports/annual` | 300ms | 800ms | 2000ms |
| `/reports/net-worth` | 100ms | 250ms | 500ms |
| `/reports/sankey` | 400ms | 1000ms | 2500ms |
| `/reports/savings-rate` | 100ms | 300ms | 600ms |
| `/reports/transactions` | 50ms | 150ms | 300ms |

### G.2 Query Complexity Limits

- Maximum date range: 5 years
- Maximum transactions in single query: 10,000 (use pagination beyond)
- Maximum Sankey nodes: 200
- Maximum breakdown items: 200

### G.3 Monitoring Metrics

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

---

## Amendment H: Security Model

### H.1 Authorization Checks

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
    const valid = await storage.accountBelongsToHousehold(accountId as string, household.id);
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

### H.2 Data Sanitization

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

## Amendment I: Observability

### I.1 Structured Logging

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

### I.2 Health Check Endpoint

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
      const snapshotAge = Date.now() - new Date(latestSnapshot[0].date).getTime();
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

## Appendix: Migration Checklist

Before merging into main architecture document:

- [ ] Add Amendment A schemas to `shared/schema.ts`
- [ ] Run Drizzle migrations
- [ ] Create indexes from Amendment B
- [ ] Implement cache service from Amendment C
- [ ] Add rate limiting middleware from Amendment D
- [ ] Implement snapshot worker from Amendment E
- [ ] Update error responses to match Amendment F
- [ ] Set up monitoring per Amendment I
- [ ] Performance test against benchmarks in Amendment G

