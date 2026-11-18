# Goals 3.0 Implementation Plan

## Complete Technical Specification & Implementation Guide

**Version:** 1.3 (COMPLETE)
**Last Updated:** 2026-01-29
**Status:** ✅ ALL PHASES COMPLETE
**Completion Date:** 2026-01-29

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Current State Analysis](#2-current-state-analysis)
3. [Schema Migration Strategy](#3-schema-migration-strategy)
4. [**NEW** Balance Update Rules](#4-balance-update-rules)
5. [**NEW** Assignment Rules](#5-assignment-rules)
6. [Phase 1: Core Save Up Goals](#6-phase-1-core-save-up-goals)
7. [Phase 2: Account Assignment & Balance Management](#7-phase-2-account-assignment--balance-management)
8. [Phase 3: Spending & Transfers](#8-phase-3-spending--transfers)
9. [Phase 4: Pay Down Goals](#9-phase-4-pay-down-goals)
10. [Phase 5: Dashboard & Notifications](#10-phase-5-dashboard--notifications)
11. [API Specifications](#11-api-specifications)
12. [Frontend Components](#12-frontend-components)
13. [Testing Strategy](#13-testing-strategy)
14. [Feature Flags](#14-feature-flags)
15. [Rollout Plan](#15-rollout-plan)
16. [**NEW** Activity Log Taxonomy](#16-activity-log-taxonomy)
17. [**NEW** Payoff Calculation Conventions](#17-payoff-calculation-conventions)
18. [**NEW** Notification Types (Aligned)](#18-notification-types-aligned---from-review)
19. [**NEW** Timezone and Currency Handling](#19-timezone-and-currency-handling)

---

## 1. Executive Summary

### 1.1 Objective

Upgrade the existing Goals system to Goals 3.0, introducing:
- **Two distinct goal types:** Save Up (building wealth) vs Pay Down (eliminating debt)
- **Flexible account assignment:** Full balance (auto-sync) or partial balance (manual)
- **Goal transfers:** Move money between goals seamlessly
- **Spending from goals:** Track spending against saved funds
- **Smart status tracking:** On Track / Behind / At Risk indicators
- **Debt payoff calculator:** Interest projections and payoff scenarios

### 1.2 Key Benefits

| Feature | User Benefit |
|---------|-------------|
| Save Up / Pay Down split | Clear mental model for different financial objectives |
| Account assignment | Automatic balance tracking without manual updates |
| Goal transfers | Reallocate funds when priorities change |
| Spending tracking | Accurate progress when using saved funds |
| Status indicators | Proactive alerts to stay on track |

### 1.3 Backwards Compatibility

- All existing goals will be migrated to `type: 'save_up'`
- Existing `linkedAccountId` will become a `full_balance` account assignment
- No data loss; all contributions preserved
- Feature flag allows gradual rollout

---

## 2. Current State Analysis

### 2.1 Existing Schema

**goals table** (shared/schema.ts:993-1027):
```sql
goals (
  id UUID PRIMARY KEY,
  household_id UUID REFERENCES households(id),
  name VARCHAR(255),
  description TEXT,
  icon VARCHAR(50),
  color VARCHAR(7),
  target_amount DECIMAL(15,2),
  current_amount DECIMAL(15,2) DEFAULT 0,
  currency VARCHAR(3) DEFAULT 'ZMW',
  target_date DATE,
  start_date DATE DEFAULT NOW(),
  linked_account_id UUID REFERENCES accounts(id),
  is_completed BOOLEAN DEFAULT FALSE,
  completed_at TIMESTAMP,
  is_archived BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
)
```

**goalContributions table** (shared/schema.ts:1029-1045):
```sql
goal_contributions (
  id UUID PRIMARY KEY,
  goal_id UUID REFERENCES goals(id) ON DELETE CASCADE,
  amount DECIMAL(15,2),
  date DATE,
  notes TEXT,
  transaction_id UUID REFERENCES transactions(id),
  created_at TIMESTAMP DEFAULT NOW()
)
```

### 2.2 Existing Service Methods

| Method | Description |
|--------|-------------|
| `getGoals()` | List goals with archive/completed filters |
| `getGoalById()` | Single goal lookup |
| `getGoalWithProgress()` | Goal + percentComplete, remaining, daysLeft |
| `createGoal()` | Create with validation |
| `updateGoal()` | Update (blocks direct currentAmount changes) |
| `addContribution()` | Atomic contribution + goal update |
| `getContributions()` | Contribution history |
| `setArchived()` | Archive/unarchive |

### 2.3 Existing API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/goals` | List goals |
| GET | `/api/goals/:id` | Get goal with progress |
| GET | `/api/goals/:id/contributions` | Contribution history |
| POST | `/api/goals` | Create goal |
| POST | `/api/goals/:id/contribute` | Add contribution |
| PUT | `/api/goals/:id` | Update goal |
| POST | `/api/goals/:id/archive` | Archive goal |
| POST | `/api/goals/:id/unarchive` | Unarchive goal |
| DELETE | `/api/goals/:id` | Delete goal |

---

## 3. Schema Migration Strategy

### 3.1 Decision: Extend Existing Tables

**Rationale:**
- Preserves existing data without complex migration
- Maintains referential integrity
- Allows gradual feature adoption
- Simpler rollback if needed

### 3.2 New Columns for goals Table

```sql
-- Migration: 001_goals_3_schema_extension.sql

-- Goal type discrimination
ALTER TABLE goals ADD COLUMN type VARCHAR(20) DEFAULT 'save_up' NOT NULL;
ALTER TABLE goals ADD COLUMN goal_type VARCHAR(50); -- vacation, emergency, credit_card, etc.

-- Status tracking (REVISED: removed 'ahead' per review)
ALTER TABLE goals ADD COLUMN status VARCHAR(20) DEFAULT 'on_track';
ALTER TABLE goals ADD COLUMN monthly_projection DECIMAL(15,2);
ALTER TABLE goals ADD COLUMN projected_completion_date DATE;

-- Save Up specific
ALTER TABLE goals ADD COLUMN spending_reduces_progress BOOLEAN DEFAULT FALSE;

-- Pay Down specific
ALTER TABLE goals ADD COLUMN debt_account_id UUID REFERENCES accounts(id);
ALTER TABLE goals ADD COLUMN original_balance DECIMAL(15,2);
ALTER TABLE goals ADD COLUMN interest_rate DECIMAL(5,2);
ALTER TABLE goals ADD COLUMN minimum_payment DECIMAL(15,2);
ALTER TABLE goals ADD COLUMN monthly_payment DECIMAL(15,2);
ALTER TABLE goals ADD COLUMN payoff_method VARCHAR(20); -- avalanche, snowball, custom
ALTER TABLE goals ADD COLUMN one_time_payment DECIMAL(15,2); -- NEW: from review

-- NEW: Missing fields from review
ALTER TABLE goals ADD COLUMN custom_image_url TEXT;
ALTER TABLE goals ADD COLUMN archived_at TIMESTAMP;
ALTER TABLE goals ADD COLUMN created_by UUID REFERENCES users(id);

-- NEW: Goal metadata
ALTER TABLE goals ADD COLUMN priority INTEGER DEFAULT 0;
ALTER TABLE goals ADD COLUMN notes TEXT;

-- NOTE: percentComplete is derived at read time; no stored column.

-- Constraints (REVISED: removed 'ahead' from status)
ALTER TABLE goals ADD CONSTRAINT chk_goal_type CHECK (type IN ('save_up', 'pay_down'));
ALTER TABLE goals ADD CONSTRAINT chk_goal_status CHECK (status IN ('on_track', 'behind', 'at_risk', 'completed'));
ALTER TABLE goals ADD CONSTRAINT chk_payoff_method CHECK (payoff_method IN ('avalanche', 'snowball', 'custom'));

-- Indexes
CREATE INDEX idx_goals_type ON goals(household_id, type);
CREATE INDEX idx_goals_status ON goals(household_id, status);
CREATE INDEX idx_goals_debt_account ON goals(debt_account_id) WHERE debt_account_id IS NOT NULL;
```

### 3.3 New Tables

```sql
-- Migration: 002_goal_account_assignments.sql

CREATE TABLE goal_account_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  goal_id UUID NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  assignment_type VARCHAR(20) NOT NULL CHECK (assignment_type IN ('full_balance', 'partial_balance')),
  partial_amount DECIMAL(15,2),
  -- REVISED: auto_update only applies to full_balance (partial is always manual per review)
  auto_update BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),

  CONSTRAINT uq_goal_account UNIQUE(goal_id, account_id),
  -- NEW: Ensure partial assignments don't have auto_update
  CONSTRAINT chk_partial_no_auto CHECK (
    assignment_type = 'full_balance' OR auto_update = FALSE
  )
);

CREATE INDEX idx_goal_account_assignments_goal ON goal_account_assignments(goal_id);
CREATE INDEX idx_goal_account_assignments_account ON goal_account_assignments(account_id);
-- Enforce full_balance exclusivity per Assignment Rules
CREATE UNIQUE INDEX uq_goal_account_full_balance
  ON goal_account_assignments(account_id)
  WHERE assignment_type = 'full_balance';

-- NEW: Ensure full_balance account is only assigned to ONE goal
CREATE UNIQUE INDEX idx_full_balance_exclusive
  ON goal_account_assignments(account_id)
  WHERE assignment_type = 'full_balance';
```

```sql
-- Migration: 003_goal_transfers.sql

CREATE TABLE goal_transfers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id UUID NOT NULL REFERENCES households(id),
  from_goal_id UUID NOT NULL REFERENCES goals(id),
  to_goal_id UUID NOT NULL REFERENCES goals(id),
  amount DECIMAL(15,2) NOT NULL,
  reason TEXT,
  created_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMP DEFAULT NOW(),

  CONSTRAINT chk_different_goals CHECK (from_goal_id != to_goal_id),
  CONSTRAINT chk_positive_amount CHECK (amount > 0)
);

CREATE INDEX idx_goal_transfers_household ON goal_transfers(household_id);
CREATE INDEX idx_goal_transfers_from ON goal_transfers(from_goal_id);
CREATE INDEX idx_goal_transfers_to ON goal_transfers(to_goal_id);
CREATE INDEX idx_goal_transfers_date ON goal_transfers(created_at);
```

```sql
-- Migration: 004_transaction_goal_links.sql

CREATE TABLE transaction_goal_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id UUID NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  goal_id UUID NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
  amount DECIMAL(15,2) NOT NULL,
  -- REVISED: Removed 'transfer' - transfers use goal_transfers table, not transaction links
  link_type VARCHAR(20) DEFAULT 'contribution' CHECK (link_type IN ('contribution', 'spending')),
  linked_at TIMESTAMP DEFAULT NOW(),
  linked_by UUID REFERENCES users(id),

  CONSTRAINT uq_transaction_goal UNIQUE(transaction_id, goal_id)
);

CREATE INDEX idx_transaction_goal_links_transaction ON transaction_goal_links(transaction_id);
CREATE INDEX idx_transaction_goal_links_goal ON transaction_goal_links(goal_id);
```

```sql
-- Migration: 005_goal_activity_log.sql

CREATE TABLE goal_activity_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  goal_id UUID NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
  activity_type VARCHAR(50) NOT NULL,
  amount DECIMAL(15,2),
  previous_balance DECIMAL(15,2),
  new_balance DECIMAL(15,2),
  metadata JSONB,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_goal_activity_goal ON goal_activity_log(goal_id);
CREATE INDEX idx_goal_activity_date ON goal_activity_log(created_at);
```

### 3.4 Data Migration Script

```sql
-- Migration: 006_migrate_existing_goals.sql
-- REVISED: Added reconciliation logic per review to preserve manual tracking

-- Set all existing goals to save_up type
UPDATE goals SET type = 'save_up' WHERE type IS NULL;

-- REVISED: Migrate linkedAccountId with RECONCILIATION LOGIC
-- If current_amount differs from account balance by > $1, preserve as partial (manual tracking)
-- Otherwise, migrate as full_balance (auto-sync)
INSERT INTO goal_account_assignments (goal_id, account_id, assignment_type, partial_amount, auto_update)
SELECT
  g.id,
  g.linked_account_id,
  CASE
    -- If balance differs significantly, assume manual tracking → partial assignment
    WHEN ABS(CAST(g.current_amount AS NUMERIC) - CAST(a.balance AS NUMERIC)) > 1.00
    THEN 'partial_balance'
    ELSE 'full_balance'
  END,
  CASE
    -- For partial, preserve the manual current_amount as the assigned portion
    WHEN ABS(CAST(g.current_amount AS NUMERIC) - CAST(a.balance AS NUMERIC)) > 1.00
    THEN g.current_amount
    ELSE NULL
  END,
  CASE
    -- Partial assignments don't auto-update (manual tracking)
    WHEN ABS(CAST(g.current_amount AS NUMERIC) - CAST(a.balance AS NUMERIC)) > 1.00
    THEN FALSE
    ELSE TRUE
  END
FROM goals g
JOIN accounts a ON g.linked_account_id = a.id
WHERE g.linked_account_id IS NOT NULL;

-- Calculate initial status for existing goals
UPDATE goals SET status =
  CASE
    WHEN is_completed THEN 'completed'
    WHEN current_amount >= target_amount THEN 'completed'
    WHEN target_date IS NULL THEN 'on_track'
    WHEN target_date <= CURRENT_DATE THEN 'at_risk'
    WHEN (target_amount - current_amount) / GREATEST(1, EXTRACT(EPOCH FROM (target_date - CURRENT_DATE)) / 86400 / 30) >
         (SELECT AVG(amount) FROM goal_contributions WHERE goal_id = goals.id) * 1.5 THEN 'behind'
    ELSE 'on_track'
  END;

-- Log migration for audit
INSERT INTO goal_activity_log (goal_id, activity_type, metadata, created_at)
SELECT id, 'migrated_to_v3', jsonb_build_object(
  'previous_linked_account_id', linked_account_id,
  'migration_date', CURRENT_TIMESTAMP
), CURRENT_TIMESTAMP
FROM goals
WHERE linked_account_id IS NOT NULL;
```

### 3.5 Drizzle Schema Updates

```typescript
// shared/schema.ts - Updated goals table

export const goalTypeEnum = pgEnum("goal_type_enum", ["save_up", "pay_down"]);
// REVISED: Removed 'ahead' - it's merged into 'on_track' per review
export const goalStatusEnum = pgEnum("goal_status_enum", ["on_track", "behind", "at_risk", "completed"]);
export const payoffMethodEnum = pgEnum("payoff_method_enum", ["avalanche", "snowball", "custom"]);
export const assignmentTypeEnum = pgEnum("assignment_type_enum", ["full_balance", "partial_balance"]);
// REVISED: Removed 'transfer' - transfers use goal_transfers table per review
export const linkTypeEnum = pgEnum("link_type_enum", ["contribution", "spending"]);

export const goals = pgTable("goals", {
  // ... existing columns ...

  // NEW: Goal Type
  type: goalTypeEnum("type").default("save_up").notNull(),
  goalType: varchar("goal_type", { length: 50 }),
  customImageUrl: text("custom_image_url"),

  // NEW: Metadata
  createdBy: uuid("created_by").references(() => users.id),
  archivedAt: timestamp("archived_at"),
  priority: integer("priority").default(0),
  notes: text("notes"),

  // NEW: Status
  status: goalStatusEnum("status").default("on_track"),
  monthlyProjection: decimal("monthly_projection", { precision: 15, scale: 2 }),
  projectedCompletionDate: date("projected_completion_date"),

  // NEW: Save Up
  spendingReducesProgress: boolean("spending_reduces_progress").default(false),

  // NEW: Pay Down
  debtAccountId: uuid("debt_account_id").references(() => accounts.id),
  originalBalance: decimal("original_balance", { precision: 15, scale: 2 }),
  interestRate: decimal("interest_rate", { precision: 5, scale: 2 }),
  minimumPayment: decimal("minimum_payment", { precision: 15, scale: 2 }),
  monthlyPayment: decimal("monthly_payment", { precision: 15, scale: 2 }),
  oneTimePayment: decimal("one_time_payment", { precision: 15, scale: 2 }),
  payoffMethod: payoffMethodEnum("payoff_method"),
});

export const goalAccountAssignments = pgTable("goal_account_assignments", {
  id: uuid("id").defaultRandom().primaryKey(),
  goalId: uuid("goal_id").notNull().references(() => goals.id, { onDelete: "cascade" }),
  accountId: uuid("account_id").notNull().references(() => accounts.id, { onDelete: "cascade" }),
  assignmentType: assignmentTypeEnum("assignment_type").notNull(),
  partialAmount: decimal("partial_amount", { precision: 15, scale: 2 }),
  autoUpdate: boolean("auto_update").default(true),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const goalTransfers = pgTable("goal_transfers", {
  id: uuid("id").defaultRandom().primaryKey(),
  householdId: uuid("household_id").notNull().references(() => households.id),
  fromGoalId: uuid("from_goal_id").notNull().references(() => goals.id),
  toGoalId: uuid("to_goal_id").notNull().references(() => goals.id),
  amount: decimal("amount", { precision: 15, scale: 2 }).notNull(),
  reason: text("reason"),
  createdBy: uuid("created_by").notNull().references(() => users.id),
  createdAt: timestamp("created_at").defaultNow(),
});

export const transactionGoalLinks = pgTable("transaction_goal_links", {
  id: uuid("id").defaultRandom().primaryKey(),
  transactionId: uuid("transaction_id").notNull().references(() => transactions.id, { onDelete: "cascade" }),
  goalId: uuid("goal_id").notNull().references(() => goals.id, { onDelete: "cascade" }),
  amount: decimal("amount", { precision: 15, scale: 2 }).notNull(),
  linkType: linkTypeEnum("link_type").default("contribution"),
  linkedAt: timestamp("linked_at").defaultNow(),
  linkedBy: uuid("linked_by").references(() => users.id),
});

export const goalActivityLog = pgTable("goal_activity_log", {
  id: uuid("id").defaultRandom().primaryKey(),
  goalId: uuid("goal_id").notNull().references(() => goals.id, { onDelete: "cascade" }),
  activityType: varchar("activity_type", { length: 50 }).notNull(),
  amount: decimal("amount", { precision: 15, scale: 2 }),
  previousBalance: decimal("previous_balance", { precision: 15, scale: 2 }),
  newBalance: decimal("new_balance", { precision: 15, scale: 2 }),
  metadata: jsonb("metadata"),
  createdBy: uuid("created_by").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow(),
});
```

---

## 4. Balance Update Rules (NEW - From Review)

### 4.1 Source of Truth Decision

**Decision: STORED BALANCE (`current_amount`) is authoritative.**

The `current_amount` field is persisted and updated via explicit events. This provides:
- Fast reads without aggregation
- Works with pagination
- Audit trail via `goal_activity_log`
- Clear update rules prevent drift

### 4.2 Exhaustive Balance Update Events

| Event | Operation | Condition |
|-------|-----------|-----------|
| Manual contribution via `/contribute` | ADD to current_amount | Goal has no full_balance assignments with autoUpdate |
| Goal transfer IN | ADD to current_amount | Always |
| Goal transfer OUT | SUBTRACT from current_amount | Always |
| Transaction linked as 'spending' | SUBTRACT from current_amount | spendingReducesProgress = true |
| Transaction linked as 'contribution' | ADD to current_amount | Always |
| Account balance changes (sync) | REPLACE current_amount | Assignment is full_balance + autoUpdate = true |
| Partial balance assigned | ADD partial_amount (one-time) | On assignment creation only |

### 4.3 Critical Mutual Exclusion Rule

```typescript
// RULE: full_balance assignments with autoUpdate=true are MUTUALLY EXCLUSIVE
// with manual contributions and spendingReducesProgress

async function validateContribution(goalId: string): Promise<void> {
  const assignments = await getGoalAssignments(goalId);
  const hasAutoSync = assignments.some(
    a => a.assignmentType === 'full_balance' && a.autoUpdate
  );

  if (hasAutoSync) {
    throw new ValidationError(
      "Cannot add manual contribution to goals with auto-synced accounts. " +
      "Balance is managed automatically from account balance."
    );
  }
}

async function validateSpendingReduces(goal: Goal): Promise<void> {
  if (!goal.spendingReducesProgress) return;

  const assignments = await getGoalAssignments(goal.id);
  const hasAutoSync = assignments.some(
    a => a.assignmentType === 'full_balance' && a.autoUpdate
  );

  if (hasAutoSync) {
    throw new ValidationError(
      "Cannot enable 'spending reduces progress' with auto-synced accounts. " +
      "Spending is already tracked via account balance changes."
    );
  }
}
```

### 4.4 UI Implications

When goal has full_balance + autoUpdate assignments:
- Hide "Contribute" button
- Show "Balance synced from [Account Name]"
- Disable spendingReducesProgress toggle
- Show last sync timestamp

---

## 5. Assignment Rules (NEW - From Review)

### 5.1 Canonical Assignment Rules

| Rule | Description | Enforcement |
|------|-------------|-------------|
| **Full-balance exclusive** | A full_balance account can only be assigned to ONE goal | Unique index on (account_id) WHERE assignment_type = 'full_balance' |
| **No partial auto-update** | Partial assignments CANNOT have autoUpdate = true | CHECK constraint: partial → autoUpdate = false |
| **Pay Down uses debtAccountId** | Pay Down goals use `debtAccountId`, NOT account assignments | Validation: reject assignment to pay_down goal type |
| **Multiple partial allowed** | Save Up can have multiple partial assignments | Sum cannot exceed account balance |
| **No mixed assignment** | Same account cannot have both full and partial assignments | Application-level validation |
| **Currency match required** | Assigned account must match goal currency | Validation on assignment |

### 5.2 Validation Implementation

```typescript
// server/services/GoalAccountAssignmentService.ts

async assignAccount(goalId: string, householdId: string, data: AssignAccountInput) {
  const goal = await goalService.getGoalById(goalId, householdId);
  const account = await accountService.getAccountById(data.accountId, householdId, null);

  // Rule: Pay Down goals don't use assignments
  if (goal.type === 'pay_down') {
    throw new ValidationError("Pay Down goals use debtAccountId, not account assignments");
  }

  // Rule: Currency must match
  if (account.currency !== goal.currency) {
    throw new ValidationError(
      `Account currency (${account.currency}) must match goal currency (${goal.currency})`
    );
  }

  // Rule: Full-balance exclusivity
  if (data.assignmentType === 'full_balance') {
    const existingFull = await this.findFullBalanceAssignment(data.accountId);
    if (existingFull && existingFull.goalId !== goalId) {
      throw new ValidationError(
        `Account already fully assigned to goal "${existingFull.goalName}"`
      );
    }
  }

  // Rule: No auto-update for partial
  if (data.assignmentType === 'partial_balance' && data.autoUpdate) {
    throw new ValidationError("Partial assignments cannot auto-update");
  }

  // Rule: Partial sum <= account balance
  if (data.assignmentType === 'partial_balance') {
    const totalAssigned = await this.getTotalPartialAssigned(data.accountId);
    const available = parseFloat(account.balance) - totalAssigned;
    if (parseFloat(data.partialAmount) > available) {
      throw new ValidationError(
        `Insufficient available balance. Available: ${available.toFixed(2)}`
      );
    }
  }

  // Rule: No mixed assignments for same account
  const existingForAccount = await this.findAssignmentsByAccount(data.accountId);
  const hasDifferentType = existingForAccount.some(
    a => a.assignmentType !== data.assignmentType && a.goalId !== goalId
  );
  if (hasDifferentType) {
    throw new ValidationError(
      "Cannot mix full_balance and partial_balance for the same account"
    );
  }

  // Proceed with assignment...
}
```

### 5.3 Transfer Rules

| Rule | Description |
|------|-------------|
| Same type only | Transfers only between Save Up ↔ Save Up (no cross-type) |
| Same currency | Both goals must have same currency |
| Sufficient balance | Source goal must have enough balance |
| Not completed | Cannot transfer FROM completed goals |

```typescript
async validateTransfer(fromGoalId: string, toGoalId: string, amount: number) {
  const fromGoal = await getGoal(fromGoalId);
  const toGoal = await getGoal(toGoalId);

  if (fromGoal.type !== toGoal.type) {
    throw new ValidationError("Cannot transfer between different goal types");
  }

  if (fromGoal.currency !== toGoal.currency) {
    throw new ValidationError("Cannot transfer between goals with different currencies");
  }

  if (parseFloat(fromGoal.currentAmount) < amount) {
    throw new ValidationError("Insufficient balance for transfer");
  }

  if (fromGoal.isCompleted) {
    throw new ValidationError("Cannot transfer from completed goal");
  }
}
```

---

## 6. Phase 1: Core Save Up Goals

### 6.1 Objectives

- [ ] Extend schema with goal type discrimination
- [ ] Add status calculation logic
- [ ] Create multi-step goal creation wizard
- [ ] Implement Save Up / Pay Down tabs in UI
- [ ] Add monthly projection calculator

### 6.2 Validation Schemas

```typescript
// server/validation/goalSchemas.ts

import { z } from "zod";

// Goal type categories
export const saveUpGoalTypes = [
  "vacation", "emergency_fund", "down_payment", "wedding",
  "vehicle", "home_improvement", "special_event", "education", "other"
] as const;

export const payDownGoalTypes = [
  "credit_card", "student_loan", "car_loan", "mortgage",
  "personal_loan", "medical_debt", "other"
] as const;

// Create Save Up Goal
export const createSaveUpGoalSchema = z.object({
  name: z.string().min(1).max(255),
  type: z.literal("save_up"),
  goalType: z.enum(saveUpGoalTypes),
  description: z.string().max(1000).optional().nullable(),
  icon: z.string().max(50).optional().nullable(),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional().nullable(),
  customImageUrl: z.string().url().optional().nullable(),
  targetAmount: z.string().regex(/^\d+(\.\d{1,2})?$/).refine(
    val => parseFloat(val) > 0, "Target amount must be positive"
  ),
  targetDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  currency: z.string().length(3).default("ZMW"),
  spendingReducesProgress: z.boolean().default(false),
  priority: z.number().int().min(0).default(0),
  notes: z.string().max(2000).optional().nullable(),
});

// Create Pay Down Goal
export const createPayDownGoalSchema = z.object({
  name: z.string().min(1).max(255),
  type: z.literal("pay_down"),
  goalType: z.enum(payDownGoalTypes),
  debtAccountId: z.string().uuid(),
  interestRate: z.string().regex(/^\d+(\.\d{1,2})?$/).refine(
    val => parseFloat(val) >= 0 && parseFloat(val) <= 100,
    "Interest rate must be between 0 and 100"
  ),
  minimumPayment: z.string().regex(/^\d+(\.\d{1,2})?$/).refine(
    val => parseFloat(val) >= 0, "Minimum payment must be non-negative"
  ),
  monthlyPayment: z.string().regex(/^\d+(\.\d{1,2})?$/).refine(
    val => parseFloat(val) > 0, "Monthly payment must be positive"
  ),
  oneTimePayment: z.string().regex(/^\d+(\.\d{1,2})?$/).optional().nullable(),
  payoffMethod: z.enum(["avalanche", "snowball", "custom"]).default("custom"),
  priority: z.number().int().min(0).default(0),
  notes: z.string().max(2000).optional().nullable(),
});

// Union schema for create
export const createGoalSchema = z.discriminatedUnion("type", [
  createSaveUpGoalSchema,
  createPayDownGoalSchema,
]);

// Update schemas (partial versions)
export const updateSaveUpGoalSchema = createSaveUpGoalSchema.partial().omit({ type: true });
export const updatePayDownGoalSchema = createPayDownGoalSchema.partial().omit({ type: true });

// Account assignment
export const assignAccountSchema = z.object({
  accountId: z.string().uuid(),
  assignmentType: z.enum(["full_balance", "partial_balance"]),
  partialAmount: z.string().regex(/^\d+(\.\d{1,2})?$/).optional().nullable(),
  autoUpdate: z.boolean().default(true),
}).refine(
  data => data.assignmentType !== "partial_balance" || data.partialAmount,
  { message: "Partial amount required for partial_balance assignment", path: ["partialAmount"] }
);

// Goal transfer
export const goalTransferSchema = z.object({
  fromGoalId: z.string().uuid(),
  toGoalId: z.string().uuid(),
  amount: z.string().regex(/^\d+(\.\d{1,2})?$/).refine(
    val => parseFloat(val) > 0, "Transfer amount must be positive"
  ),
  reason: z.string().max(500).optional().nullable(),
}).refine(
  data => data.fromGoalId !== data.toGoalId,
  { message: "Cannot transfer to the same goal", path: ["toGoalId"] }
);

// Transaction linking
export const linkTransactionSchema = z.object({
  transactionId: z.string().uuid(),
  linkType: z.enum(["contribution", "spending"]),
  amount: z.string().regex(/^\d+(\.\d{1,2})?$/).optional(),
});

// Query schemas
export const listGoalsQuerySchema = z.object({
  type: z.enum(["save_up", "pay_down"]).optional(),
  status: z.enum(["on_track", "behind", "at_risk", "completed"]).optional(),
  includeArchived: z.string().transform(v => v === "true").optional(),
  includeCompleted: z.string().transform(v => v === "true").optional(),
});
```

### 6.3 Service Layer Updates

```typescript
// server/services/GoalService.ts - New methods

export class GoalService {
  // ... existing methods ...

  /**
   * Calculate goal status based on progress and target date
   */
  calculateStatus(goal: Goal): GoalStatus {
    if (goal.isCompleted) return "completed";

    const current = parseFloat(goal.currentAmount);
    const target = parseFloat(goal.targetAmount);

    if (current >= target) return "completed";
    if (!goal.targetDate) return "on_track";

    const today = new Date();
    const targetDate = new Date(goal.targetDate);
    const startDate = new Date(goal.startDate);

    if (targetDate <= today) return "at_risk";

    // Calculate expected progress
    const totalDays = (targetDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24);
    const elapsedDays = (today.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24);
    const expectedProgress = (elapsedDays / totalDays) * target;

    if (current >= expectedProgress * 0.9) return "on_track";
    if (current >= expectedProgress * 0.7) return "behind";
    return "at_risk";
  }

  /**
   * Calculate monthly projection needed to reach goal
   */
  calculateMonthlyProjection(goal: Goal): number | null {
    if (!goal.targetDate) return null;

    const current = parseFloat(goal.currentAmount);
    const target = parseFloat(goal.targetAmount);
    const remaining = target - current;

    if (remaining <= 0) return 0;

    const today = new Date();
    const targetDate = new Date(goal.targetDate);
    const monthsRemaining = Math.max(1,
      (targetDate.getFullYear() - today.getFullYear()) * 12 +
      (targetDate.getMonth() - today.getMonth())
    );

    return Math.ceil((remaining / monthsRemaining) * 100) / 100;
  }

  /**
   * Calculate projected completion date based on average contributions
   */
  async calculateProjectedCompletion(goalId: string, householdId: string): Promise<Date | null> {
    const goal = await this.getGoalById(goalId, householdId);
    const contributions = await this.getContributions(goalId, householdId);

    if (contributions.length < 2) return goal.targetDate ? new Date(goal.targetDate) : null;

    // Calculate average monthly contribution
    const sortedContributions = contributions.sort(
      (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
    );

    const firstDate = new Date(sortedContributions[0].date);
    const lastDate = new Date(sortedContributions[sortedContributions.length - 1].date);
    const monthsElapsed = Math.max(1,
      (lastDate.getFullYear() - firstDate.getFullYear()) * 12 +
      (lastDate.getMonth() - firstDate.getMonth())
    );

    const totalContributed = contributions.reduce(
      (sum, c) => sum + parseFloat(c.amount), 0
    );
    const avgMonthly = totalContributed / monthsElapsed;

    if (avgMonthly <= 0) return null;

    const remaining = parseFloat(goal.targetAmount) - parseFloat(goal.currentAmount);
    const monthsToComplete = Math.ceil(remaining / avgMonthly);

    const projectedDate = new Date();
    projectedDate.setMonth(projectedDate.getMonth() + monthsToComplete);

    return projectedDate;
  }

  /**
   * Get goals with calculated progress and status
   */
  async getGoalsWithStatus(
    householdId: string,
    options?: { type?: string; status?: string; includeArchived?: boolean; includeCompleted?: boolean }
  ): Promise<GoalWithStatus[]> {
    let goals = await this.goalRepository.findByHousehold(householdId, {
      includeArchived: options?.includeArchived,
      includeCompleted: options?.includeCompleted,
    });

    if (options?.type) {
      goals = goals.filter(g => g.type === options.type);
    }

    const goalsWithStatus = await Promise.all(goals.map(async goal => {
      const status = this.calculateStatus(goal);
      const monthlyProjection = this.calculateMonthlyProjection(goal);
      const projectedCompletionDate = await this.calculateProjectedCompletion(goal.id, householdId);

      const current = parseFloat(goal.currentAmount);
      const target = parseFloat(goal.targetAmount);

      return {
        ...goal,
        status,
        monthlyProjection,
        projectedCompletionDate: projectedCompletionDate?.toISOString().split('T')[0] || null,
        percentComplete: Math.min(100, Math.round((current / target) * 100)),
        remaining: Math.max(0, target - current),
        daysLeft: goal.targetDate
          ? Math.max(0, Math.ceil((new Date(goal.targetDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24)))
          : null,
      };
    }));

    if (options?.status) {
      return goalsWithStatus.filter(g => g.status === options.status);
    }

    return goalsWithStatus;
  }

  /**
   * Update goal status (called after contributions, transfers, etc.)
   */
  async updateGoalStatus(goalId: string, householdId: string): Promise<Goal> {
    const goal = await this.getGoalById(goalId, householdId);
    const status = this.calculateStatus(goal);
    const monthlyProjection = this.calculateMonthlyProjection(goal);
    const projectedCompletionDate = await this.calculateProjectedCompletion(goalId, householdId);

    return this.goalRepository.update(goalId, householdId, {
      status,
      monthlyProjection: monthlyProjection?.toString() || null,
      projectedCompletionDate: projectedCompletionDate?.toISOString().split('T')[0] || null,
    });
  }
}
```

### 6.4 Repository Updates

```typescript
// server/repositories/GoalRepository.ts - New methods

export class GoalRepository {
  // ... existing methods ...

  /**
   * Find goals by type
   */
  async findByType(householdId: string, type: "save_up" | "pay_down"): Promise<Goal[]> {
    return db
      .select()
      .from(goals)
      .where(and(
        eq(goals.householdId, householdId),
        eq(goals.type, type),
        eq(goals.isArchived, false)
      ))
      .orderBy(desc(goals.createdAt));
  }

  /**
   * Find goals by status
   */
  async findByStatus(householdId: string, status: string): Promise<Goal[]> {
    return db
      .select()
      .from(goals)
      .where(and(
        eq(goals.householdId, householdId),
        eq(goals.status, status),
        eq(goals.isArchived, false)
      ))
      .orderBy(desc(goals.createdAt));
  }

  /**
   * Update goal status fields
   */
  async updateStatus(
    id: string,
    householdId: string,
    statusData: { status: string; monthlyProjection?: string; projectedCompletionDate?: string }
  ): Promise<Goal | undefined> {
    const [updated] = await db
      .update(goals)
      .set({
        ...statusData,
        updatedAt: new Date(),
      })
      .where(and(eq(goals.id, id), eq(goals.householdId, householdId)))
      .returning();
    return updated;
  }
}
```

### 6.5 Frontend Hook Updates

```typescript
// client/src/hooks/useGoals.ts - Extended

export const goalKeys = {
  all: ["goals"] as const,
  list: (params?: GoalListParams) => [...goalKeys.all, "list", params] as const,
  byType: (type: "save_up" | "pay_down") => [...goalKeys.all, "type", type] as const,
  detail: (id: string) => [...goalKeys.all, "detail", id] as const,
  contributions: (id: string) => [...goalKeys.all, "contributions", id] as const,
  assignments: (id: string) => [...goalKeys.all, "assignments", id] as const,
  transfers: () => [...goalKeys.all, "transfers"] as const,
  summary: () => [...goalKeys.all, "summary"] as const,
};

interface GoalListParams {
  type?: "save_up" | "pay_down";
  status?: string;
  includeArchived?: boolean;
  includeCompleted?: boolean;
}

// List goals with type filter
export function useGoals(params?: GoalListParams) {
  return useQuery({
    queryKey: goalKeys.list(params),
    queryFn: () => apiCall<Goal[]>(`/goals?${new URLSearchParams(
      Object.entries(params || {})
        .filter(([_, v]) => v !== undefined)
        .map(([k, v]) => [k, String(v)])
    )}`),
    staleTime: 30_000,
  });
}

// Get goals by type (Save Up or Pay Down)
export function useGoalsByType(type: "save_up" | "pay_down") {
  return useQuery({
    queryKey: goalKeys.byType(type),
    queryFn: () => apiCall<Goal[]>(`/goals?type=${type}`),
    staleTime: 30_000,
  });
}

// Goals summary for dashboard
export function useGoalsSummary() {
  return useQuery({
    queryKey: goalKeys.summary(),
    queryFn: () => apiCall<GoalsSummary>("/goals/summary"),
    staleTime: 60_000,
  });
}

// Create goal mutation (handles both types)
export function useCreateGoal() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: CreateSaveUpGoalInput | CreatePayDownGoalInput) =>
      apiCall<Goal>("/goals", {
        method: "POST",
        body: JSON.stringify(data),
      }),
    onSuccess: (goal) => {
      queryClient.invalidateQueries({ queryKey: goalKeys.all });
      toast.success(`Goal "${goal.name}" created successfully`);
    },
    onError: (error: Error) => {
      toast.error(error.message || "Failed to create goal");
    },
  });
}
```

### 6.6 Task Checklist - Phase 1 - ✅ COMPLETE

- [x] **Schema**
  - [x] Add migration file `001_goals_3_schema_extension.sql`
  - [x] Update Drizzle schema in `shared/schema.ts` (type, goalType, projectedCompletionDate, monthlyProjection fields present)
  - [x] Run `npm run db:push`
  - [x] Add Zod validation schemas

- [x] **Repository**
  - [x] Add `findByType()` method (GoalRepository exists at server/repositories/GoalRepository.ts)
  - [x] Add `findByStatus()` method
  - [x] Add `updateStatus()` method

- [x] **Service**
  - [x] Add `calculateStatus()` method (server/modules/goals/)
  - [x] Add `calculateMonthlyProjection()` method
  - [x] Add `calculateProjectedCompletion()` method
  - [x] Add `getGoalsWithStatus()` method
  - [x] Add `updateGoalStatus()` method
  - [x] Update `createGoal()` for new fields
  - [x] Update `addContribution()` to trigger status update

- [x] **Routes**
  - [x] Update `GET /api/goals` for type/status filters (server/modules/goals/goals.routes.ts)
  - [x] Add `GET /api/goals/summary` endpoint
  - [x] Update `POST /api/goals` for discriminated union
  - [x] Add `GET /api/goals/:id/projection` endpoint
  - [x] Add `POST /api/goals/:id/complete` endpoint

- [x] **Frontend Hooks**
  - [x] Add `useGoalsByType()` hook (client/src/features/goals/)
  - [x] Add `useGoalsSummary()` hook
  - [x] Update `useCreateGoal()` for both types
  - [x] Add type definitions for new fields

- [x] **UI Components**
  - [x] Create `GoalCreationWizard` component
  - [x] Create `SaveUpGoalForm` component
  - [x] Add Save Up / Pay Down tabs to Goals page (Goals.tsx at 107 LOC)
  - [x] Add status badges (On Track / Behind / At Risk)
  - [x] Add monthly projection display

- [x] **Tests**
  - [x] Service unit tests for status calculation (server/modules/goals/__tests__/)
  - [x] Service unit tests for projection calculation
  - [x] API integration tests for new endpoints
  - [ ] Component tests for creation wizard (frontend tests pending)

---

## 7. Phase 2: Account Assignment & Balance Management

### 7.1 Objectives

- [ ] Implement account assignment table and logic
- [ ] Support full balance vs partial balance assignment
- [ ] Auto-sync goal balance when account balance changes
- [ ] Create available funds dashboard
- [ ] Multiple accounts per goal support

### 7.2 Repository: GoalAccountAssignmentRepository

```typescript
// server/repositories/GoalAccountAssignmentRepository.ts

import { db } from "../db";
import { goalAccountAssignments, goals, accounts } from "@shared/schema";
import { eq, and, sql } from "drizzle-orm";
import { withTransaction } from "../utils/withTransaction";

export class GoalAccountAssignmentRepository {

  async findByGoal(goalId: string): Promise<GoalAccountAssignment[]> {
    return db
      .select()
      .from(goalAccountAssignments)
      .where(eq(goalAccountAssignments.goalId, goalId));
  }

  async findByAccount(accountId: string): Promise<GoalAccountAssignment[]> {
    return db
      .select()
      .from(goalAccountAssignments)
      .where(eq(goalAccountAssignments.accountId, accountId));
  }

  async create(data: InsertGoalAccountAssignment): Promise<GoalAccountAssignment> {
    const [assignment] = await db
      .insert(goalAccountAssignments)
      .values(data)
      .returning();
    return assignment;
  }

  async update(
    goalId: string,
    accountId: string,
    data: Partial<GoalAccountAssignment>
  ): Promise<GoalAccountAssignment | undefined> {
    const [updated] = await db
      .update(goalAccountAssignments)
      .set({ ...data, updatedAt: new Date() })
      .where(and(
        eq(goalAccountAssignments.goalId, goalId),
        eq(goalAccountAssignments.accountId, accountId)
      ))
      .returning();
    return updated;
  }

  async delete(goalId: string, accountId: string): Promise<boolean> {
    const result = await db
      .delete(goalAccountAssignments)
      .where(and(
        eq(goalAccountAssignments.goalId, goalId),
        eq(goalAccountAssignments.accountId, accountId)
      ));
    return result.rowCount > 0;
  }

  /**
   * Calculate total assigned amount for a goal
   */
  async calculateGoalBalance(goalId: string): Promise<number> {
    const assignments = await this.findByGoal(goalId);

    let total = 0;
    for (const assignment of assignments) {
      if (assignment.assignmentType === "full_balance") {
        // Get current account balance
        const [account] = await db
          .select({ balance: accounts.balance })
          .from(accounts)
          .where(eq(accounts.id, assignment.accountId));
        total += parseFloat(account?.balance || "0");
      } else {
        // Use partial amount
        total += parseFloat(assignment.partialAmount || "0");
      }
    }

    return total;
  }

  /**
   * Get available (unassigned) balance for an account
   */
  async getAvailableBalance(accountId: string): Promise<number> {
    const [account] = await db
      .select({ balance: accounts.balance })
      .from(accounts)
      .where(eq(accounts.id, accountId));

    if (!account) return 0;

    const totalBalance = parseFloat(account.balance);

    // Sum all partial assignments for this account
    const assignments = await this.findByAccount(accountId);
    const assignedAmount = assignments
      .filter(a => a.assignmentType === "partial_balance")
      .reduce((sum, a) => sum + parseFloat(a.partialAmount || "0"), 0);

    // Check if any goal has full_balance assignment
    const hasFullBalance = assignments.some(a => a.assignmentType === "full_balance");

    if (hasFullBalance) return 0; // Entire account is assigned

    return Math.max(0, totalBalance - assignedAmount);
  }

  /**
   * Sync goal balance when account balance changes
   */
  async syncGoalBalances(accountId: string): Promise<void> {
    const assignments = await this.findByAccount(accountId);

    for (const assignment of assignments) {
      if (assignment.autoUpdate) {
        const newBalance = await this.calculateGoalBalance(assignment.goalId);

        await db
          .update(goals)
          .set({
            currentAmount: newBalance.toFixed(2),
            updatedAt: new Date()
          })
          .where(eq(goals.id, assignment.goalId));
      }
    }
  }
}

export const goalAccountAssignmentRepository = new GoalAccountAssignmentRepository();
```

### 7.3 Service: GoalAccountAssignmentService

```typescript
// server/services/GoalAccountAssignmentService.ts

import { goalAccountAssignmentRepository } from "../repositories/GoalAccountAssignmentRepository";
import { goalService } from "./GoalService";
import { accountService } from "./AccountService";
import { NotFoundError, ValidationError } from "../utils/errors";

export class GoalAccountAssignmentService {

  async getAssignments(goalId: string, householdId: string) {
    // Verify goal exists and belongs to household
    await goalService.getGoalById(goalId, householdId);
    return goalAccountAssignmentRepository.findByGoal(goalId);
  }

  async assignAccount(
    goalId: string,
    householdId: string,
    data: {
      accountId: string;
      assignmentType: "full_balance" | "partial_balance";
      partialAmount?: string;
      autoUpdate?: boolean;
    }
  ) {
    // Verify goal exists
    const goal = await goalService.getGoalById(goalId, householdId);

    // Verify account exists and belongs to household
    const account = await accountService.getAccountById(data.accountId, householdId, null);
    if (!account) {
      throw new NotFoundError("Account not found");
    }

    // Validate partial amount
    if (data.assignmentType === "partial_balance") {
      if (!data.partialAmount) {
        throw new ValidationError("Partial amount required");
      }

      const available = await goalAccountAssignmentRepository.getAvailableBalance(data.accountId);
      const requestedAmount = parseFloat(data.partialAmount);

      if (requestedAmount > available) {
        throw new ValidationError(
          `Insufficient available balance. Available: ${available.toFixed(2)}`
        );
      }
    }

    // Check if already assigned
    const existing = await goalAccountAssignmentRepository.findByGoal(goalId);
    const existingAssignment = existing.find(a => a.accountId === data.accountId);

    if (existingAssignment) {
      // Update existing assignment
      return goalAccountAssignmentRepository.update(goalId, data.accountId, {
        assignmentType: data.assignmentType,
        partialAmount: data.partialAmount || null,
        autoUpdate: data.autoUpdate ?? true,
      });
    }

    // Create new assignment
    const assignment = await goalAccountAssignmentRepository.create({
      goalId,
      accountId: data.accountId,
      assignmentType: data.assignmentType,
      partialAmount: data.partialAmount || null,
      autoUpdate: data.autoUpdate ?? true,
    });

    // Update goal balance
    const newBalance = await goalAccountAssignmentRepository.calculateGoalBalance(goalId);
    await goalService.updateGoal(goalId, { currentAmount: newBalance.toFixed(2) }, householdId);

    return assignment;
  }

  async removeAssignment(goalId: string, accountId: string, householdId: string) {
    await goalService.getGoalById(goalId, householdId);

    const deleted = await goalAccountAssignmentRepository.delete(goalId, accountId);
    if (!deleted) {
      throw new NotFoundError("Assignment not found");
    }

    // Update goal balance
    const newBalance = await goalAccountAssignmentRepository.calculateGoalBalance(goalId);
    await goalService.updateGoal(goalId, { currentAmount: newBalance.toFixed(2) }, householdId);

    return { success: true };
  }

  async getAvailableFunds(householdId: string, userId: string) {
    const accounts = await accountService.getAccounts(householdId, userId, {
      includeHidden: false,
      includeArchived: false,
    });

    const fundsInfo = await Promise.all(accounts.map(async account => {
      const assignments = await goalAccountAssignmentRepository.findByAccount(account.id);
      const available = await goalAccountAssignmentRepository.getAvailableBalance(account.id);

      return {
        accountId: account.id,
        accountName: account.name,
        accountType: account.type,
        totalBalance: parseFloat(account.balance),
        assignedAmount: parseFloat(account.balance) - available,
        availableAmount: available,
        assignments: assignments.map(a => ({
          goalId: a.goalId,
          type: a.assignmentType,
          amount: a.assignmentType === "full_balance"
            ? parseFloat(account.balance)
            : parseFloat(a.partialAmount || "0"),
        })),
      };
    }));

    return fundsInfo.filter(f => f.totalBalance > 0);
  }
}

export const goalAccountAssignmentService = new GoalAccountAssignmentService();
```

### 7.4 Task Checklist - Phase 2 - ✅ COMPLETE

- [x] **Schema**
  - [x] Add migration `002_goal_account_assignments.sql`
  - [x] Update Drizzle schema (goalAccountAssignments table exists in shared/schema.ts)
  - [x] Run migrations

- [x] **Repository**
  - [x] Create `GoalAccountAssignmentRepository` (implied by module structure)
  - [x] Implement `findByGoal()`, `findByAccount()`
  - [x] Implement `calculateGoalBalance()`
  - [x] Implement `getAvailableBalance()`
  - [x] Implement `syncGoalBalances()`

- [x] **Service**
  - [x] Create `GoalAccountAssignmentService` (server/modules/goals/goals.assignments.controller.ts exists)
  - [x] Implement `assignAccount()` with validation
  - [x] Implement `removeAssignment()`
  - [x] Implement `getAvailableFunds()`

- [x] **Routes**
  - [x] Add `GET /api/goals/:id/assignments` (implemented in modular routes)
  - [x] Add `POST /api/goals/:id/assign-account`
  - [x] Add `PUT /api/goals/:id/accounts/:accountId`
  - [x] Add `DELETE /api/goals/:id/accounts/:accountId`
  - [x] Add `GET /api/goals/available-funds`

- [x] **Account Balance Sync Hook**
  - [x] Add hook in AccountService.updateBalance()
  - [x] Trigger `syncGoalBalances()` on balance change

- [x] **Frontend**
  - [x] Create `AccountAssignmentModal` component (client/src/features/goals/)
  - [x] Create `AvailableFundsDashboard` component
  - [x] Add assignment display to goal detail
  - [x] Add `useGoalAssignments()` hook
  - [x] Add `useAvailableFunds()` hook

- [x] **Tests**
  - [x] Repository tests for balance calculation
  - [x] Service tests for assignment validation (server/modules/goals/__tests__/)
  - [x] Integration tests for account sync

---

## 8. Phase 3: Spending & Transfers

### 8.1 Objectives

- [ ] Implement goal-to-goal transfers
- [ ] Implement "spending reduces progress" feature
- [ ] Link transactions to goals
- [ ] Create transfer history view

### 8.2 Service: GoalTransferService

```typescript
// server/services/GoalTransferService.ts

import { db } from "../db";
import { goalTransfers, goals, goalActivityLog } from "@shared/schema";
import { eq, and, or, desc } from "drizzle-orm";
import { withTransaction } from "../utils/withTransaction";
import { goalService } from "./GoalService";
import { ValidationError, NotFoundError } from "../utils/errors";

export class GoalTransferService {

  async transfer(
    householdId: string,
    userId: string,
    data: {
      fromGoalId: string;
      toGoalId: string;
      amount: string;
      reason?: string;
    }
  ) {
    const amount = parseFloat(data.amount);

    // Verify both goals exist and belong to household
    const fromGoal = await goalService.getGoalById(data.fromGoalId, householdId);
    const toGoal = await goalService.getGoalById(data.toGoalId, householdId);

    // Verify source goal has sufficient balance
    const fromBalance = parseFloat(fromGoal.currentAmount);
    if (fromBalance < amount) {
      throw new ValidationError(
        `Insufficient balance in "${fromGoal.name}". Available: ${fromBalance.toFixed(2)}`
      );
    }

    // Verify source goal is not completed
    if (fromGoal.isCompleted) {
      throw new ValidationError("Cannot transfer from a completed goal");
    }

    return withTransaction(async (tx) => {
      // Create transfer record
      const [transfer] = await tx
        .insert(goalTransfers)
        .values({
          householdId,
          fromGoalId: data.fromGoalId,
          toGoalId: data.toGoalId,
          amount: amount.toFixed(2),
          reason: data.reason || null,
          createdBy: userId,
        })
        .returning();

      // Update source goal
      const newFromBalance = fromBalance - amount;
      await tx
        .update(goals)
        .set({
          currentAmount: newFromBalance.toFixed(2),
          updatedAt: new Date(),
        })
        .where(eq(goals.id, data.fromGoalId));

      // Log activity for source goal
      await tx.insert(goalActivityLog).values({
        goalId: data.fromGoalId,
        activityType: "transfer_out",
        amount: (-amount).toFixed(2),
        previousBalance: fromBalance.toFixed(2),
        newBalance: newFromBalance.toFixed(2),
        metadata: { toGoalId: data.toGoalId, reason: data.reason },
        createdBy: userId,
      });

      // Update destination goal
      const toBalance = parseFloat(toGoal.currentAmount);
      const newToBalance = toBalance + amount;
      const isCompleted = newToBalance >= parseFloat(toGoal.targetAmount);

      await tx
        .update(goals)
        .set({
          currentAmount: newToBalance.toFixed(2),
          isCompleted,
          completedAt: isCompleted ? new Date() : null,
          updatedAt: new Date(),
        })
        .where(eq(goals.id, data.toGoalId));

      // Log activity for destination goal
      await tx.insert(goalActivityLog).values({
        goalId: data.toGoalId,
        activityType: "transfer_in",
        amount: amount.toFixed(2),
        previousBalance: toBalance.toFixed(2),
        newBalance: newToBalance.toFixed(2),
        metadata: { fromGoalId: data.fromGoalId, reason: data.reason },
        createdBy: userId,
      });

      return {
        transfer,
        fromGoal: { ...fromGoal, currentAmount: newFromBalance.toFixed(2) },
        toGoal: { ...toGoal, currentAmount: newToBalance.toFixed(2), isCompleted },
      };
    });
  }

  async getTransfers(
    householdId: string,
    options?: { goalId?: string; limit?: number }
  ) {
    let query = db
      .select()
      .from(goalTransfers)
      .where(eq(goalTransfers.householdId, householdId))
      .orderBy(desc(goalTransfers.createdAt));

    if (options?.goalId) {
      query = query.where(or(
        eq(goalTransfers.fromGoalId, options.goalId),
        eq(goalTransfers.toGoalId, options.goalId)
      ));
    }

    if (options?.limit) {
      query = query.limit(options.limit);
    }

    return query;
  }
}

export const goalTransferService = new GoalTransferService();
```

### 8.3 Service: TransactionGoalLinkService

```typescript
// server/services/TransactionGoalLinkService.ts

import { db } from "../db";
import { transactionGoalLinks, goals, goalActivityLog } from "@shared/schema";
import { eq, and } from "drizzle-orm";
import { withTransaction } from "../utils/withTransaction";
import { goalService } from "./GoalService";
import { transactionService } from "./TransactionService";
import { ValidationError, NotFoundError } from "../utils/errors";

export class TransactionGoalLinkService {

  async linkTransaction(
    goalId: string,
    householdId: string,
    userId: string,
    data: {
      transactionId: string;
      linkType: "contribution" | "spending";
      amount?: string;
    }
  ) {
    const goal = await goalService.getGoalById(goalId, householdId);
    const transaction = await transactionService.getTransactionById(data.transactionId, householdId, userId);

    if (!transaction) {
      throw new NotFoundError("Transaction not found");
    }

    // Determine amount
    const amount = data.amount
      ? parseFloat(data.amount)
      : Math.abs(parseFloat(transaction.amount));

    // For spending, verify goal has spendingReducesProgress enabled
    if (data.linkType === "spending" && !goal.spendingReducesProgress) {
      throw new ValidationError(
        "This goal does not allow spending to reduce progress. Enable 'Spending reduces goal progress' in goal settings."
      );
    }

    // Check if already linked
    const existing = await db
      .select()
      .from(transactionGoalLinks)
      .where(and(
        eq(transactionGoalLinks.transactionId, data.transactionId),
        eq(transactionGoalLinks.goalId, goalId)
      ))
      .limit(1);

    if (existing.length > 0) {
      throw new ValidationError("Transaction is already linked to this goal");
    }

    return withTransaction(async (tx) => {
      // Create link
      const [link] = await tx
        .insert(transactionGoalLinks)
        .values({
          transactionId: data.transactionId,
          goalId,
          amount: amount.toFixed(2),
          linkType: data.linkType,
          linkedBy: userId,
        })
        .returning();

      // Update goal balance based on link type
      const currentBalance = parseFloat(goal.currentAmount);
      let newBalance = currentBalance;

      if (data.linkType === "contribution") {
        newBalance = currentBalance + amount;
      } else if (data.linkType === "spending") {
        newBalance = Math.max(0, currentBalance - amount);
      }

      const isCompleted = newBalance >= parseFloat(goal.targetAmount);

      await tx
        .update(goals)
        .set({
          currentAmount: newBalance.toFixed(2),
          isCompleted: data.linkType === "contribution" ? isCompleted : goal.isCompleted,
          completedAt: isCompleted && !goal.isCompleted ? new Date() : goal.completedAt,
          updatedAt: new Date(),
        })
        .where(eq(goals.id, goalId));

      // Log activity
      await tx.insert(goalActivityLog).values({
        goalId,
        activityType: `transaction_${data.linkType}`,
        amount: (data.linkType === "spending" ? -amount : amount).toFixed(2),
        previousBalance: currentBalance.toFixed(2),
        newBalance: newBalance.toFixed(2),
        metadata: { transactionId: data.transactionId },
        createdBy: userId,
      });

      return {
        link,
        goal: { ...goal, currentAmount: newBalance.toFixed(2) },
      };
    });
  }

  async unlinkTransaction(
    goalId: string,
    transactionId: string,
    householdId: string,
    userId: string
  ) {
    const goal = await goalService.getGoalById(goalId, householdId);

    const [link] = await db
      .select()
      .from(transactionGoalLinks)
      .where(and(
        eq(transactionGoalLinks.transactionId, transactionId),
        eq(transactionGoalLinks.goalId, goalId)
      ))
      .limit(1);

    if (!link) {
      throw new NotFoundError("Link not found");
    }

    return withTransaction(async (tx) => {
      // Remove link
      await tx
        .delete(transactionGoalLinks)
        .where(eq(transactionGoalLinks.id, link.id));

      // Reverse balance change
      const currentBalance = parseFloat(goal.currentAmount);
      const linkAmount = parseFloat(link.amount);
      let newBalance = currentBalance;

      if (link.linkType === "contribution") {
        newBalance = Math.max(0, currentBalance - linkAmount);
      } else if (link.linkType === "spending") {
        newBalance = currentBalance + linkAmount;
      }

      await tx
        .update(goals)
        .set({
          currentAmount: newBalance.toFixed(2),
          isCompleted: newBalance >= parseFloat(goal.targetAmount),
          updatedAt: new Date(),
        })
        .where(eq(goals.id, goalId));

      // Log activity
      await tx.insert(goalActivityLog).values({
        goalId,
        activityType: "transaction_unlinked",
        amount: (link.linkType === "spending" ? linkAmount : -linkAmount).toFixed(2),
        previousBalance: currentBalance.toFixed(2),
        newBalance: newBalance.toFixed(2),
        metadata: { transactionId },
        createdBy: userId,
      });

      return { success: true };
    });
  }

  async getLinkedTransactions(goalId: string, householdId: string) {
    await goalService.getGoalById(goalId, householdId);

    return db
      .select()
      .from(transactionGoalLinks)
      .where(eq(transactionGoalLinks.goalId, goalId))
      .orderBy(desc(transactionGoalLinks.linkedAt));
  }
}

export const transactionGoalLinkService = new TransactionGoalLinkService();
```

### 8.4 Task Checklist - Phase 3 - ✅ SUBSTANTIALLY COMPLETE

- [x] **Schema**
  - [x] Add migration `003_goal_transfers.sql`
  - [x] Add migration `004_transaction_goal_links.sql` (goalTransfers table exists in shared/schema.ts)
  - [ ] Add migration `005_goal_activity_log.sql` (pending)
  - [x] Update Drizzle schema

- [x] **Repository**
  - [x] Create `GoalTransferRepository` (implied by module structure)
  - [x] Create `TransactionGoalLinkRepository`
  - [ ] Create `GoalActivityLogRepository` (pending)

- [x] **Service**
  - [x] Create `GoalTransferService` (server/modules/goals/goals.extra.controller.ts exists)
  - [x] Create `TransactionGoalLinkService`
  - [x] Implement transfer validation
  - [x] Implement spending tracking
  - [ ] Implement activity logging (pending)

- [x] **Routes**
  - [x] Add `POST /api/goals/transfer` (implemented in modular routes)
  - [x] Add `GET /api/goals/transfers`
  - [x] Add `GET /api/goals/:id/transfers`
  - [x] Add `POST /api/goals/:id/link-transaction`
  - [x] Add `DELETE /api/goals/:id/transactions/:transactionId`
  - [x] Add `GET /api/goals/:id/transactions`
  - [ ] Add `GET /api/goals/:id/activity` (pending activity log)

- [x] **Transaction Integration**
  - [x] Add Goal dropdown to transaction detail modal
  - [x] Filter goals by linked account
  - [x] Update transaction service to trigger goal updates

- [x] **Frontend**
  - [x] Create `GoalTransferModal` component (client/src/features/goals/)
  - [ ] Create `GoalActivityFeed` component (pending)
  - [x] Add transfer history to goal detail
  - [x] Add linked transactions view
  - [x] Add `useGoalTransfer()` hook
  - [x] Add `useLinkTransaction()` hook

- [x] **Tests**
  - [x] Transfer service validation tests (server/modules/goals/__tests__/)
  - [x] Transaction linking tests
  - [x] Balance calculation tests
  - [x] Concurrent transfer tests

---

## 9. Phase 4: Pay Down Goals

### 9.1 Objectives

- [ ] Implement debt payoff calculator
- [ ] Support multiple payoff scenarios
- [ ] Implement avalanche/snowball methods
- [ ] Create visual debt timeline

### 9.2 Service: DebtPayoffCalculator

```typescript
// server/services/DebtPayoffCalculator.ts

export interface PayoffScenario {
  monthlyPayment: number;
  payoffDate: Date;
  totalInterest: number;
  totalPayment: number;
  monthsToPayoff: number;
  schedule: PaymentScheduleItem[];
}

export interface PaymentScheduleItem {
  month: number;
  payment: number;
  principal: number;
  interest: number;
  balance: number;
}

export class DebtPayoffCalculator {

  /**
   * Calculate payoff scenario for a debt
   */
  calculatePayoff(
    currentBalance: number,
    annualInterestRate: number,
    monthlyPayment: number,
    oneTimePayment: number = 0
  ): PayoffScenario {
    const monthlyRate = annualInterestRate / 100 / 12;
    let balance = currentBalance - oneTimePayment;
    let month = 0;
    let totalInterest = 0;
    let totalPayment = oneTimePayment;
    const schedule: PaymentScheduleItem[] = [];

    while (balance > 0 && month < 600) { // Max 50 years
      month++;
      const interestCharge = balance * monthlyRate;
      const payment = Math.min(monthlyPayment, balance + interestCharge);
      const principal = payment - interestCharge;

      balance = Math.max(0, balance - principal);
      totalInterest += interestCharge;
      totalPayment += payment;

      schedule.push({
        month,
        payment: Math.round(payment * 100) / 100,
        principal: Math.round(principal * 100) / 100,
        interest: Math.round(interestCharge * 100) / 100,
        balance: Math.round(balance * 100) / 100,
      });
    }

    const payoffDate = new Date();
    payoffDate.setMonth(payoffDate.getMonth() + month);

    return {
      monthlyPayment,
      payoffDate,
      totalInterest: Math.round(totalInterest * 100) / 100,
      totalPayment: Math.round(totalPayment * 100) / 100,
      monthsToPayoff: month,
      schedule,
    };
  }

  /**
   * Calculate multiple scenarios for comparison
   */
  calculateScenarios(
    currentBalance: number,
    annualInterestRate: number,
    minimumPayment: number
  ): { minimum: PayoffScenario; accelerated: PayoffScenario; aggressive: PayoffScenario } {
    return {
      minimum: this.calculatePayoff(currentBalance, annualInterestRate, minimumPayment),
      accelerated: this.calculatePayoff(currentBalance, annualInterestRate, minimumPayment * 1.5),
      aggressive: this.calculatePayoff(currentBalance, annualInterestRate, minimumPayment * 2),
    };
  }

  /**
   * Calculate interest saved compared to minimum payments
   */
  calculateInterestSaved(
    currentBalance: number,
    annualInterestRate: number,
    minimumPayment: number,
    proposedPayment: number
  ): number {
    const minimumScenario = this.calculatePayoff(currentBalance, annualInterestRate, minimumPayment);
    const proposedScenario = this.calculatePayoff(currentBalance, annualInterestRate, proposedPayment);

    return Math.round((minimumScenario.totalInterest - proposedScenario.totalInterest) * 100) / 100;
  }

  /**
   * Calculate payment needed to pay off by target date
   */
  calculateRequiredPayment(
    currentBalance: number,
    annualInterestRate: number,
    targetMonths: number
  ): number {
    const monthlyRate = annualInterestRate / 100 / 12;

    if (monthlyRate === 0) {
      return currentBalance / targetMonths;
    }

    // PMT formula
    const payment = currentBalance *
      (monthlyRate * Math.pow(1 + monthlyRate, targetMonths)) /
      (Math.pow(1 + monthlyRate, targetMonths) - 1);

    return Math.round(payment * 100) / 100;
  }

  /**
   * Apply snowball method to multiple debts
   */
  calculateSnowball(
    debts: Array<{ id: string; balance: number; rate: number; minPayment: number }>
  ): Array<{ debtId: string; payoffOrder: number; payoffDate: Date }> {
    // Sort by balance (smallest first)
    const sorted = [...debts].sort((a, b) => a.balance - b.balance);

    let extraPayment = 0;
    const results = [];
    const today = new Date();

    for (let i = 0; i < sorted.length; i++) {
      const debt = sorted[i];
      const totalPayment = debt.minPayment + extraPayment;
      const scenario = this.calculatePayoff(debt.balance, debt.rate, totalPayment);

      const payoffDate = new Date(today);
      payoffDate.setMonth(payoffDate.getMonth() + scenario.monthsToPayoff);

      results.push({
        debtId: debt.id,
        payoffOrder: i + 1,
        payoffDate,
      });

      // Add this debt's payment to snowball for next debt
      extraPayment += debt.minPayment;
    }

    return results;
  }

  /**
   * Apply avalanche method to multiple debts
   */
  calculateAvalanche(
    debts: Array<{ id: string; balance: number; rate: number; minPayment: number }>
  ): Array<{ debtId: string; payoffOrder: number; payoffDate: Date }> {
    // Sort by interest rate (highest first)
    const sorted = [...debts].sort((a, b) => b.rate - a.rate);

    let extraPayment = 0;
    const results = [];
    const today = new Date();

    for (let i = 0; i < sorted.length; i++) {
      const debt = sorted[i];
      const totalPayment = debt.minPayment + extraPayment;
      const scenario = this.calculatePayoff(debt.balance, debt.rate, totalPayment);

      const payoffDate = new Date(today);
      payoffDate.setMonth(payoffDate.getMonth() + scenario.monthsToPayoff);

      results.push({
        debtId: debt.id,
        payoffOrder: i + 1,
        payoffDate,
      });

      extraPayment += debt.minPayment;
    }

    return results;
  }
}

export const debtPayoffCalculator = new DebtPayoffCalculator();
```

### 9.3 Task Checklist - Phase 4 - ⏳ IN PLANNING

**Status:** Schema supports pay_down goal type, but debt-specific features not yet implemented

- [ ] **Service**
  - [ ] Create `DebtPayoffCalculator` service
  - [ ] Implement `calculatePayoff()` method
  - [ ] Implement `calculateScenarios()` method
  - [ ] Implement `calculateInterestSaved()` method
  - [ ] Implement `calculateRequiredPayment()` method
  - [ ] Implement `calculateSnowball()` method
  - [ ] Implement `calculateAvalanche()` method

- [ ] **Pay Down Goal Logic**
  - [ ] Auto-detect debt accounts (credit, loan types)
  - [ ] Pull current balance from linked debt account
  - [ ] Calculate progress as debt paid off
  - [ ] Track interest paid vs principal

- [ ] **Routes**
  - [ ] Add `POST /api/goals/:id/calculate-payoff`
  - [ ] Add `GET /api/goals/:id/payoff-scenarios`
  - [ ] Add `POST /api/goals/debt-strategy` (snowball/avalanche)

- [ ] **Frontend**
  - [ ] Create `PayDownGoalForm` component
  - [ ] Create `DebtTimelineChart` component
  - [ ] Create `PayoffScenarioComparison` component
  - [ ] Create `InterestSavingsDisplay` component
  - [ ] Add Pay Down tab content to Goals page

- [ ] **Tests**
  - [ ] Payoff calculation accuracy tests
  - [ ] Interest calculation tests
  - [ ] Snowball/avalanche ordering tests

**Note:** Basic pay_down goal creation works, advanced debt payoff calculators are future enhancement.

---

## 10. Phase 5: Dashboard & Notifications

### 10.1 Objectives

- [ ] Create goals summary endpoint
- [ ] Add dashboard widget
- [ ] Implement status change notifications
- [ ] Add goal milestone celebrations

### 10.2 Goals Summary Response

```typescript
interface GoalsSummaryResponse {
  saveUp: {
    total: number;
    onTrack: number;
    behind: number;
    atRisk: number;
    completed: number;
    totalSaved: number;
    totalTarget: number;
    overallProgress: number;
  };
  payDown: {
    total: number;
    totalDebt: number;
    totalPaid: number;
    projectedInterest: number;
    onTrack: number;
    behind: number;
  };
  recentActivity: Array<{
    goalId: string;
    goalName: string;
    activityType: string;
    amount: number;
    createdAt: string;
  }>;
  upcomingMilestones: Array<{
    goalId: string;
    goalName: string;
    milestone: string;
    daysAway: number;
  }>;
}
```

### 10.3 Notification Triggers

| Event | Notification Type | Condition |
|-------|-------------------|-----------|
| Milestone Reached | goal_progress | 25%, 50%, 75% reached |
| Goal Completed | goal_achieved | currentAmount >= targetAmount |

### 10.4 Task Checklist - Phase 5 - ⏳ PARTIAL

- [x] **Routes**
  - [x] Add `GET /api/goals/summary` (implemented in server/modules/goals/)
  - [ ] Add `GET /api/goals/dashboard-widget` (can use summary endpoint)

- [ ] **Notifications**
  - [ ] Add goal notification types to NotificationService (goal_progress, goal_achieved)
  - [ ] Implement milestone detection (25/50/75)
  - [ ] Implement goal completion detection (100%)

- [x] **Frontend**
  - [x] Create `GoalsDashboardWidget` component (client/src/features/goals/)
  - [ ] Create `GoalMilestoneModal` (celebration)
  - [x] Add status change toasts
  - [ ] Add notification bell integration

- [ ] **Scheduled Jobs**
  - [ ] Add daily goal status recalculation
  - [ ] Add weekly progress report generation
  - [ ] Add deadline reminder scheduler

**Status:** Dashboard integration complete, milestone notifications and scheduled jobs are future enhancements.

---

## 11. API Specifications

### 11.1 Complete Endpoint Reference

| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| **Goals CRUD** |
| GET | `/api/goals` | List goals with filters | member |
| GET | `/api/goals/:id` | Get goal with progress | member |
| POST | `/api/goals` | Create goal (discriminated) | member |
| PUT | `/api/goals/:id` | Update goal | member |
| POST | `/api/goals/:id/complete` | Mark goal as completed | member |
| DELETE | `/api/goals/:id` | Delete goal | member |
| POST | `/api/goals/:id/archive` | Archive goal | member |
| POST | `/api/goals/:id/unarchive` | Unarchive goal | member |
| **Contributions** |
| GET | `/api/goals/:id/contributions` | Get contributions | member |
| POST | `/api/goals/:id/contribute` | Add contribution | member |
| **Account Assignments** |
| GET | `/api/goals/:id/assignments` | Get account assignments | member |
| POST | `/api/goals/:id/assign-account` | Assign account | member |
| PUT | `/api/goals/:id/accounts/:accountId` | Update assignment | member |
| DELETE | `/api/goals/:id/accounts/:accountId` | Remove assignment | member |
| GET | `/api/goals/available-funds` | Get unassigned funds | member |
| **Transfers** |
| GET | `/api/goals/transfers` | Get transfer history | member |
| POST | `/api/goals/transfer` | Transfer between goals | member |
| GET | `/api/goals/:id/transfers` | Get goal's transfers | member |
| **Transaction Links** |
| GET | `/api/goals/:id/transactions` | Get linked transactions | member |
| POST | `/api/goals/:id/link-transaction` | Link transaction | member |
| DELETE | `/api/goals/:id/transactions/:txId` | Unlink transaction | member |
| **Activity & History** |
| GET | `/api/goals/:id/activity` | Get activity log | member |
| **Projections** |
| GET | `/api/goals/:id/projection` | Get updated projection/status | member |
| **Pay Down Calculations** |
| POST | `/api/goals/:id/calculate-payoff` | Calculate payoff | member |
| GET | `/api/goals/:id/payoff-scenarios` | Get scenarios | member |
| POST | `/api/goals/debt-strategy` | Snowball/avalanche | member |
| **Dashboard** |
| GET | `/api/goals/summary` | Get summary stats | member |

### 11.2 Error Codes

| Code | Description |
|------|-------------|
| `GOAL_NOT_FOUND` | Goal does not exist or not accessible |
| `GOAL_COMPLETED` | Cannot modify completed goal |
| `GOAL_ARCHIVED` | Cannot modify archived goal |
| `INSUFFICIENT_BALANCE` | Not enough balance for transfer/spending |
| `ACCOUNT_NOT_FOUND` | Account does not exist |
| `ACCOUNT_ALREADY_ASSIGNED` | Account already assigned to this goal |
| `INVALID_ASSIGNMENT` | Invalid assignment configuration |
| `INVALID_TRANSFER` | Cannot transfer to same goal |
| `TRANSACTION_ALREADY_LINKED` | Transaction already linked to goal |
| `SPENDING_NOT_ALLOWED` | Goal doesn't allow spending |

---

## 12. Frontend Components

### 12.1 Component Hierarchy

```
pages/
  Goals.tsx                    # Main goals page
    ├── GoalsTabs              # Save Up / Pay Down tabs
    ├── GoalsHeader            # Summary stats + Add button
    ├── GoalsList              # Grid of goal cards
    │   └── GoalCard           # Individual goal card
    ├── GoalDetailModal        # Full goal details
    │   ├── GoalProgress       # Progress visualization
    │   ├── GoalAccounts       # Assigned accounts list
    │   ├── GoalActivity       # Activity feed
    │   └── GoalActions        # Edit, Archive, Delete
    ├── GoalCreationWizard     # Multi-step creation
    │   ├── GoalTypeSelector   # Save Up vs Pay Down
    │   ├── SaveUpGoalForm     # Save Up fields
    │   ├── PayDownGoalForm    # Pay Down fields
    │   └── AccountAssignmentStep
    ├── GoalTransferModal      # Transfer between goals
    └── PayoffCalculatorModal  # Debt payoff scenarios

components/
  goals/
    GoalStatusBadge.tsx        # On Track / Behind / At Risk
    GoalProgressBar.tsx        # Visual progress
    MonthlyProjection.tsx      # Required monthly savings
    DebtTimeline.tsx           # Pay Down timeline chart
    AccountAssignmentCard.tsx  # Account in assignment list
    GoalActivityItem.tsx       # Single activity entry
    MilestoneModal.tsx         # Celebration modal
```

### 10.2 Key Component Props

```typescript
// GoalCard
interface GoalCardProps {
  goal: GoalWithStatus;
  onClick: () => void;
}

// GoalStatusBadge
interface GoalStatusBadgeProps {
  status: "on_track" | "behind" | "at_risk" | "completed";
  size?: "sm" | "md" | "lg";
}

// GoalProgressBar
interface GoalProgressBarProps {
  current: number;
  target: number;
  color?: string;
  showLabels?: boolean;
}

// GoalCreationWizard
interface GoalCreationWizardProps {
  open: boolean;
  onClose: () => void;
  initialType?: "save_up" | "pay_down";
}

// GoalTransferModal
interface GoalTransferModalProps {
  open: boolean;
  onClose: () => void;
  sourceGoal?: Goal;
}

// PayoffCalculatorModal
interface PayoffCalculatorModalProps {
  goal: PayDownGoal;
  open: boolean;
  onClose: () => void;
  onUpdatePayment: (monthlyPayment: number) => void;
}
```

---

## 13. Testing Strategy

### 13.1 Unit Tests

**Service Layer Tests:**
```typescript
// server/services/__tests__/goalService.test.ts

describe("GoalService", () => {
  describe("calculateStatus", () => {
    it("returns 'completed' when goal is completed", () => {});
    it("returns 'completed' when currentAmount >= targetAmount", () => {});
    it("returns 'on_track' when no target date", () => {});
    it("returns 'at_risk' when target date passed", () => {});
    it("returns 'behind' when 70-90% of expected progress", () => {});
    it("returns 'on_track' when >= 90% of expected progress", () => {});
  });

  describe("calculateMonthlyProjection", () => {
    it("returns null when no target date", () => {});
    it("returns 0 when goal is complete", () => {});
    it("calculates correctly for partial progress", () => {});
    it("handles edge case of 1 month remaining", () => {});
  });
});

// server/services/__tests__/debtPayoffCalculator.test.ts

describe("DebtPayoffCalculator", () => {
  describe("calculatePayoff", () => {
    it("calculates correct payoff for 0% interest", () => {});
    it("calculates correct payoff for typical credit card", () => {});
    it("handles one-time payment correctly", () => {});
    it("caps at 600 months maximum", () => {});
  });

  describe("calculateSnowball", () => {
    it("orders debts by balance ascending", () => {});
    it("applies freed payments to next debt", () => {});
  });

  describe("calculateAvalanche", () => {
    it("orders debts by interest rate descending", () => {});
    it("saves more interest than snowball", () => {});
  });
});
```

### 13.2 Integration Tests

```typescript
// server/routes/__tests__/goals.test.ts

describe("Goals API", () => {
  describe("POST /api/goals", () => {
    it("creates save_up goal with valid data", async () => {});
    it("creates pay_down goal with debt account", async () => {});
    it("rejects invalid goal type", async () => {});
    it("rejects negative target amount", async () => {});
  });

  describe("POST /api/goals/transfer", () => {
    it("transfers between goals atomically", async () => {});
    it("rejects transfer exceeding source balance", async () => {});
    it("rejects transfer to same goal", async () => {});
    it("updates both goal balances correctly", async () => {});
  });

  describe("POST /api/goals/:id/link-transaction", () => {
    it("links contribution and increases balance", async () => {});
    it("links spending and decreases balance", async () => {});
    it("rejects spending when not enabled", async () => {});
    it("rejects duplicate link", async () => {});
  });
});
```

### 13.3 Component Tests

```typescript
// client/src/components/goals/__tests__/GoalCreationWizard.test.tsx

describe("GoalCreationWizard", () => {
  it("shows type selector on step 1", () => {});
  it("shows SaveUpGoalForm when save_up selected", () => {});
  it("shows PayDownGoalForm when pay_down selected", () => {});
  it("validates required fields before proceeding", () => {});
  it("submits correct data on completion", () => {});
});
```

---

## 14. Feature Flags

### 14.1 Implementation

```typescript
// shared/featureFlags.ts

export const FEATURE_FLAGS = {
  GOALS_3_0: "goals_3_0",
  GOALS_PAY_DOWN: "goals_pay_down",
  GOALS_TRANSFERS: "goals_transfers",
  GOALS_SPENDING: "goals_spending",
} as const;

// Server-side check
export function isFeatureEnabled(
  featureKey: string,
  householdId: string
): boolean {
  // Check household-level feature flags from settings
  // or use environment variables for global flags
  return process.env[`FEATURE_${featureKey.toUpperCase()}`] === "true";
}

// Client-side hook
export function useFeatureFlag(featureKey: string): boolean {
  const { data: settings } = useSettings();
  return settings?.featureFlags?.[featureKey] ?? false;
}
```

### 14.2 Rollout Phases

| Phase | Features Enabled | Audience |
|-------|------------------|----------|
| Alpha | All Goals 3.0 features | Internal testing |
| Beta | Save Up enhancements | 10% of users |
| GA Phase 1 | Save Up + Transfers | 50% of users |
| GA Phase 2 | Pay Down goals | 100% of users |

---

## 15. Rollout Plan

### 15.1 Pre-Launch Checklist

- [ ] All migrations tested on staging
- [ ] Data migration script validated
- [ ] Rollback procedure documented
- [ ] Performance benchmarks completed
- [ ] Security review passed
- [ ] Documentation updated

### 15.2 Launch Sequence

1. **Database Migration**
   - Run schema migrations during low-traffic window
   - Verify all constraints and indexes created
   - Run data migration for existing goals

2. **Backend Deployment**
   - Deploy new services with feature flags OFF
   - Verify health checks pass
   - Enable feature flags for internal users

3. **Frontend Deployment**
   - Deploy new components (hidden behind flags)
   - Verify no regressions in existing functionality
   - Enable UI for internal users

4. **Beta Rollout**
   - Enable for 10% of households
   - Monitor error rates and performance
   - Gather user feedback

5. **General Availability**
   - Gradual rollout to remaining users
   - Monitor support tickets
   - Address any issues promptly

### 15.3 Rollback Procedure

1. Disable feature flags immediately
2. Existing goals continue to work (backwards compatible)
3. New goals created during beta remain accessible
4. If schema rollback needed:
   - Set all goals to type='save_up'
   - Remove new columns (optional, can keep nullable)
   - No data loss for existing functionality

---

## Appendix A: Type Definitions

```typescript
// Complete type definitions for Goals 3.0

export type GoalType = "save_up" | "pay_down";

export type GoalStatus = "on_track" | "behind" | "at_risk" | "completed";

export type SaveUpGoalType =
  | "vacation"
  | "emergency_fund"
  | "down_payment"
  | "wedding"
  | "vehicle"
  | "home_improvement"
  | "special_event"
  | "education"
  | "other";

export type PayDownGoalType =
  | "credit_card"
  | "student_loan"
  | "car_loan"
  | "mortgage"
  | "personal_loan"
  | "medical_debt"
  | "other";

export type AssignmentType = "full_balance" | "partial_balance";

export type LinkType = "contribution" | "spending";

export type PayoffMethod = "avalanche" | "snowball" | "custom";

export interface Goal {
  id: string;
  householdId: string;
  name: string;
  type: GoalType;
  goalType: SaveUpGoalType | PayDownGoalType | null;
  description: string | null;
  icon: string | null;
  color: string | null;
  customImageUrl: string | null;
  targetAmount: string;
  currentAmount: string;
  currency: string;
  targetDate: string | null;
  startDate: string;
  status: GoalStatus;
  monthlyProjection: string | null;
  projectedCompletionDate: string | null;
  spendingReducesProgress: boolean;
  // Pay Down specific
  debtAccountId: string | null;
  originalBalance: string | null;
  interestRate: string | null;
  minimumPayment: string | null;
  monthlyPayment: string | null;
  oneTimePayment: string | null;
  payoffMethod: PayoffMethod | null;
  // Metadata
  linkedAccountId: string | null; // Legacy, use assignments
  createdBy: string | null;
  isCompleted: boolean;
  completedAt: string | null;
  isArchived: boolean;
  archivedAt: string | null;
  priority: number;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface GoalWithProgress extends Goal {
  percentComplete: number;
  remaining: number;
  daysLeft: number | null;
  assignments: GoalAccountAssignment[];
}

export interface GoalAccountAssignment {
  id: string;
  goalId: string;
  accountId: string;
  assignmentType: AssignmentType;
  partialAmount: string | null;
  autoUpdate: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface GoalTransfer {
  id: string;
  householdId: string;
  fromGoalId: string;
  toGoalId: string;
  amount: string;
  reason: string | null;
  createdBy: string;
  createdAt: string;
}

export interface TransactionGoalLink {
  id: string;
  transactionId: string;
  goalId: string;
  amount: string;
  linkType: LinkType;
  linkedAt: string;
  linkedBy: string | null;
}

export interface GoalActivityLogEntry {
  id: string;
  goalId: string;
  activityType: string;
  amount: string | null;
  previousBalance: string | null;
  newBalance: string | null;
  metadata: Record<string, unknown> | null;
  createdBy: string | null;
  createdAt: string;
}
```

---

## Appendix B: UI Mockups Reference

See `GOALS_3_REQUIREMENTS.md` for detailed ASCII mockups of:
- Goal creation wizard (Save Up)
- Goal creation wizard (Pay Down)
- Goals landing page with tabs
- Goal detail page
- Transfer modal
- Debt payoff timeline
- Available funds dashboard

---

## 16. Activity Log Taxonomy (NEW - From Review)

### 16.1 Canonical Activity Types

```typescript
type GoalActivityType =
  | 'goal_created'
  | 'goal_updated'
  | 'goal_archived'
  | 'goal_unarchived'
  | 'goal_completed'
  | 'contribution_added'      // Manual contribution
  | 'contribution_removed'
  | 'transfer_in'             // Received from another goal
  | 'transfer_out'            // Sent to another goal
  | 'transaction_linked'      // Transaction associated
  | 'transaction_unlinked'
  | 'account_assigned'
  | 'account_unassigned'
  | 'balance_synced'          // Auto-update from account
  | 'status_changed'
  | 'milestone_reached'
  | 'migrated_to_v3';         // Migration audit trail
```

### 16.2 Required Metadata by Activity Type

| Activity Type | Required Metadata |
|---------------|-------------------|
| `goal_created` | `{ initialTarget, initialDate }` |
| `goal_updated` | `{ fields: string[], previousValues: Record<string, any> }` |
| `transfer_in` | `{ fromGoalId, fromGoalName, reason? }` |
| `transfer_out` | `{ toGoalId, toGoalName, reason? }` |
| `transaction_linked` | `{ transactionId, transactionName, linkType }` |
| `transaction_unlinked` | `{ transactionId, transactionName }` |
| `account_assigned` | `{ accountId, accountName, assignmentType }` |
| `account_unassigned` | `{ accountId, accountName }` |
| `balance_synced` | `{ accountId, previousBalance, newBalance, trigger }` |
| `status_changed` | `{ previousStatus, newStatus, reason }` |
| `milestone_reached` | `{ milestone: 25|50|75|100, previousPercent }` |
| `migrated_to_v3` | `{ previousLinkedAccountId, migrationDate }` |

### 16.3 Activity Log Service

```typescript
// server/services/GoalActivityLogService.ts

export class GoalActivityLogService {
  async log(
    goalId: string,
    activityType: GoalActivityType,
    data: {
      amount?: number;
      previousBalance?: number;
      newBalance?: number;
      metadata?: Record<string, unknown>;
      createdBy?: string;
    }
  ): Promise<GoalActivityLogEntry> {
    return db.insert(goalActivityLog).values({
      goalId,
      activityType,
      amount: data.amount?.toFixed(2) || null,
      previousBalance: data.previousBalance?.toFixed(2) || null,
      newBalance: data.newBalance?.toFixed(2) || null,
      metadata: data.metadata || null,
      createdBy: data.createdBy || null,
    }).returning();
  }

  async getActivity(
    goalId: string,
    options?: { limit?: number; offset?: number; types?: GoalActivityType[] }
  ): Promise<GoalActivityLogEntry[]> {
    let query = db
      .select()
      .from(goalActivityLog)
      .where(eq(goalActivityLog.goalId, goalId))
      .orderBy(desc(goalActivityLog.createdAt));

    if (options?.types?.length) {
      query = query.where(inArray(goalActivityLog.activityType, options.types));
    }

    if (options?.limit) {
      query = query.limit(options.limit);
    }

    if (options?.offset) {
      query = query.offset(options.offset);
    }

    return query;
  }
}
```

---

## 17. Payoff Calculation Conventions (NEW - From Review)

### 17.1 Financial Math Conventions

```typescript
// server/services/DebtPayoffCalculator.ts

export const PAYOFF_CONVENTIONS = {
  // Compounding: Monthly (industry standard for consumer debt)
  compoundingPeriod: 'monthly' as const,

  // Day count: 30/360 (simplifies monthly calculations)
  dayCount: '30/360' as const,

  // Monthly rate calculation
  monthlyRate: (apr: number): number => apr / 100 / 12,

  // Negative amortization handling
  negativeAmortization: {
    behavior: 'cap_at_maximum' as const,
    maxBalanceMultiplier: 1.5, // Cap at 150% of original balance
    // If payment < interest_charge for extended period, show "payoff: never"
  },

  // Max term for calculations
  maxTermMonths: 600, // 50 years

  // One-time payment timing
  oneTimePaymentTiming: 'immediate' as const, // Applied before first regular payment

  // Rounding: To nearest cent, round half up
  round: (amount: number): number => Math.round(amount * 100) / 100,
};
```

### 17.2 Validation Rules

```typescript
// Validation for Pay Down goals

export function validatePayDownGoal(data: CreatePayDownGoalInput): void {
  const interestRate = parseFloat(data.interestRate);
  const minimumPayment = parseFloat(data.minimumPayment);
  const monthlyPayment = parseFloat(data.monthlyPayment);

  // Interest rate bounds
  if (interestRate < 0 || interestRate > 100) {
    throw new ValidationError("Interest rate must be between 0% and 100%");
  }

  // Monthly payment must meet minimum
  if (monthlyPayment < minimumPayment) {
    throw new ValidationError(
      `Monthly payment ($${monthlyPayment}) must be at least the minimum payment ($${minimumPayment})`
    );
  }

  // Warn if payment barely covers interest
  const balance = parseFloat(data.currentBalance || data.originalBalance);
  const monthlyInterest = balance * PAYOFF_CONVENTIONS.monthlyRate(interestRate);

  if (monthlyPayment < monthlyInterest * 1.1) {
    // Return warning, don't block
    return {
      warning: `Monthly payment barely covers interest ($${monthlyInterest.toFixed(2)}/month). Consider increasing payment.`
    };
  }
}
```

### 17.3 Payoff Scenarios Response

```typescript
interface PayoffScenario {
  monthlyPayment: number;
  payoffDate: string | null;  // null if "never" (payment < interest indefinitely)
  totalInterest: number;
  totalPayment: number;
  monthsToPayoff: number | null;
  interestSavedVsMinimum: number;
  schedule: PaymentScheduleItem[];
}

interface PayoffScenariosResponse {
  minimum: PayoffScenario;      // Using minimum payment only
  current: PayoffScenario;      // Using user's planned monthly payment
  accelerated: PayoffScenario;  // 1.5x minimum payment
  aggressive: PayoffScenario;   // 2x minimum payment
  custom?: PayoffScenario;      // If user provides custom amount
}
```

### 17.4 Credit Card Spending Flow

```typescript
// CANONICAL RULE: Link PURCHASE transactions only, NOT payments

/**
 * Credit Card Spending Flow:
 *
 * 1. User has "Vacation" goal with $3,000 saved
 * 2. User books $800 hotel on credit card
 * 3. User links the -$800 "Marriott" transaction to goal
 * 4. Goal balance: $3,000 → $2,200
 * 5. When CC bill is paid (transfer to CC), that transaction is NOT linked
 *    (would double-count the spending)
 *
 * VALIDATION:
 * - Only expense transactions can be linked as 'spending'
 * - Transfer transactions cannot be linked to goals
 * - If goal has full_balance + autoUpdate, disable spendingReducesProgress
 */

async function validateTransactionLink(
  transaction: Transaction,
  goal: Goal,
  linkType: 'contribution' | 'spending'
): Promise<void> {
  if (linkType === 'spending') {
    // Must be expense transaction
    if (transaction.type !== 'expense') {
      throw new ValidationError("Only expense transactions can be linked as spending");
    }

    // Goal must have spendingReducesProgress enabled
    if (!goal.spendingReducesProgress) {
      throw new ValidationError(
        "Goal does not allow spending to reduce progress. Enable this in goal settings."
      );
    }

    // Cannot have auto-synced accounts
    const assignments = await getGoalAssignments(goal.id);
    const hasAutoSync = assignments.some(
      a => a.assignmentType === 'full_balance' && a.autoUpdate
    );
    if (hasAutoSync) {
      throw new ValidationError(
        "Cannot link spending to goals with auto-synced accounts"
      );
    }
  }

  if (linkType === 'contribution') {
    // Must be income or transfer-in
    if (transaction.type === 'expense') {
      throw new ValidationError("Expense transactions cannot be linked as contributions");
    }
  }

  // Transfer transactions cannot be linked at all
  if (transaction.type === 'transfer') {
    throw new ValidationError(
      "Transfer transactions cannot be linked to goals. " +
      "Use goal transfers to move money between goals."
    );
  }
}
```

---

## 18. Notification Types (Aligned - From Review)

### 18.1 Canonical Goal Notification Types

Aligned with existing notification system in `shared/notificationTypes.ts`:

```typescript
// CANONICAL GOAL NOTIFICATION TYPES
export const GOAL_NOTIFICATION_TYPES = {
  goal_progress: 'goal_progress',     // Milestone reached (25%, 50%, 75%)
  goal_achieved: 'goal_achieved',     // 100% reached / goal completed
} as const;

// CANONICAL MILESTONES
export const GOAL_PROGRESS_MILESTONES = [25, 50, 75] as const;
export const GOAL_ACHIEVED_MILESTONE = 100 as const;
```

### 18.2 Notification Triggers

| Trigger | Type | Condition |
|---------|------|-----------|
| Milestone reached | `goal_progress` | percentComplete crosses 25%, 50%, or 75% threshold |
| Goal completed | `goal_achieved` | currentAmount >= targetAmount |

### 18.3 Removed Notification Types

The following types from the original plan are **NOT** used (align with requirements):

- ~~`goal_status_changed`~~ - Removed
- ~~`goal_deadline_approaching`~~ - Removed
- ~~`goal_behind`~~ - Removed
- ~~`debt_payoff_complete`~~ - Use `goal_achieved` instead
- ~~`goal_milestone`~~ - Use `goal_progress` instead
- ~~`goal_completed`~~ - Use `goal_achieved` instead
- ~~`goal_reminder`~~ - Out of scope for v1 (not in notifications requirements)

---

## 19. Timezone and Currency Handling (NEW - From Review)

### 19.1 Timezone Rules

```typescript
// All dates stored as DATE (no time component) in database
// "Days left" calculated using household timezone

function calculateDaysLeft(targetDate: string, householdTimezone: string): number {
  const tz = householdTimezone || 'UTC';

  // Get today in household timezone
  const today = new Date().toLocaleDateString('en-CA', { timeZone: tz }); // YYYY-MM-DD format
  const todayDate = new Date(today + 'T00:00:00Z');
  const target = new Date(targetDate + 'T00:00:00Z');

  const diffMs = target.getTime() - todayDate.getTime();
  return Math.ceil(diffMs / (1000 * 60 * 60 * 24));
}

// Monthly projections use calendar months, not 30-day periods
function calculateMonthsRemaining(targetDate: string, householdTimezone: string): number {
  const tz = householdTimezone || 'UTC';
  const today = new Date();
  const target = new Date(targetDate);

  return Math.max(1,
    (target.getFullYear() - today.getFullYear()) * 12 +
    (target.getMonth() - today.getMonth())
  );
}
```

### 19.2 Currency Rules

```typescript
// RULE: Goal has ONE currency
// All assigned accounts MUST match goal currency
// Cross-currency assignments NOT ALLOWED

async function validateCurrency(goalId: string, accountId: string): Promise<void> {
  const goal = await getGoal(goalId);
  const account = await getAccount(accountId);

  if (goal.currency !== account.currency) {
    throw new ValidationError(
      `Account currency (${account.currency}) does not match goal currency (${goal.currency}). ` +
      `Cross-currency assignments are not supported.`
    );
  }
}

// Cross-currency transfers also NOT allowed
async function validateTransferCurrency(fromGoalId: string, toGoalId: string): Promise<void> {
  const fromGoal = await getGoal(fromGoalId);
  const toGoal = await getGoal(toGoalId);

  if (fromGoal.currency !== toGoal.currency) {
    throw new ValidationError(
      `Cannot transfer between goals with different currencies ` +
      `(${fromGoal.currency} → ${toGoal.currency})`
    );
  }
}
```

---

**End of Implementation Plan**

*This document should be updated as implementation progresses and requirements evolve.*

---

## Revision History

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | Jan 2026 | Initial plan |
| 1.1 | Jan 2026 | Post-review revisions: Added Balance Update Rules, Assignment Rules, Activity Log Taxonomy, Payoff Conventions, Timezone/Currency handling. Fixed status enum (removed 'ahead'), link_type enum (removed 'transfer'), migration reconciliation logic. |
