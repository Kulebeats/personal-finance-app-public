# Personal Finance App - Architecture & Requirements Document

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [System Architecture](#system-architecture)
3. [Database Schema](#database-schema)
4. [User Stories](#user-stories)
5. [Feature Requirements](#feature-requirements)
6. [API Specifications](#api-specifications)
7. [AI Integration](#ai-integration)
8. [WhatsApp Integration](#whatsapp-integration)
9. [Implementation Tasks](#implementation-tasks)

---

## Executive Summary

### Vision

A modern personal finance management application for Zambian users featuring manual transaction entry, AI-powered receipt scanning, WhatsApp bot integration for quick transactions, and intelligent financial insights powered by Google Gemini.

### Key Differentiators

- **Manual-First Approach**: No bank sync - users have full control over their data
- **AI Receipt Scanning**: Snap a photo, AI extracts transaction details automatically
- **WhatsApp Integration**: Add transactions via chat, receive alerts and weekly summaries
- **Zambian Localization**: ZMW currency, local mobile money support (MTN, Airtel, Zamtel)
- **AI Financial Insights**: Personalized spending analysis and recommendations

### Tech Stack

| Layer        | Technology                                         |
| ------------ | -------------------------------------------------- |
| Frontend     | React 18, TypeScript, Vite, Tailwind CSS, Radix UI |
| Backend      | Express.js, TypeScript, Node.js                    |
| Database     | PostgreSQL with Drizzle ORM                        |
| AI           | Google Gemini 1.5 Pro API                          |
| Messaging    | WhatsApp Business API (Meta Cloud API)             |
| Queue        | BullMQ + Redis                                     |
| File Storage | Local filesystem (upgradeable to S3)               |

---

## System Architecture

### High-Level Architecture

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│                           CLIENT LAYER                                       │
├─────────────────────────────────────────────────────────────────────────────┤
│  React Web App        │    WhatsApp Bot           │    Receipt Scanner      │
│  (Manual entry +      │    (Quick transactions    │    (Camera/Upload)      │
│   Dashboard)          │     + Insights chat)      │                         │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                           API GATEWAY (Express)                              │
├─────────────────────────────────────────────────────────────────────────────┤
│  Authentication │ Rate Limiting │ File Upload (Multer) │ Webhooks           │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
        ┌───────────────────────────┼───────────────────────────┐
        ▼                           ▼                           ▼
┌───────────────┐         ┌───────────────┐         ┌───────────────┐
│   CORE API    │         │  AI SERVICE   │         │ NOTIFICATION  │
│   SERVICE     │         │               │         │   SERVICE     │
├───────────────┤         ├───────────────┤         ├───────────────┤
│ • Accounts    │         │ • Gemini API  │         │ • WhatsApp    │
│ • Transactions│ ──────► │ • Receipt OCR │ ◄────── │   - Alerts    │
│ • Budgets     │  Events │ • Categorize  │  Events │   - Add txn   │
│ • Goals       │         │ • Insights    │         │ • Email       │
│ • Rules       │         │ • Chat AI     │         │ • Push        │
└───────────────┘         └───────────────┘         └───────────────┘
        │                           │                           │
        └───────────────────────────┼───────────────────────────┘
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                        MESSAGE QUEUE (BullMQ + Redis)                        │
├─────────────────────────────────────────────────────────────────────────────┤
│  receipt.process │ transaction.created │ budget.exceeded │ whatsapp.incoming │
└─────────────────────────────────────────────────────────────────────────────┘
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                           DATA LAYER                                         │
├──────────────────────────┬──────────────────────────────────────────────────┤
│   PostgreSQL             │   File Storage                                    │
│   (All tables)           │   (Receipts, Profile pics, Banners)              │
└──────────────────────────┴──────────────────────────────────────────────────┘
```

### Data Flow Patterns

#### 1. Manual Transaction Entry

```text
User Input → React Form → Zod Validation → POST /api/transactions
→ Apply Rules → Save to DB → Invalidate Cache → Update UI
```

#### 2. Receipt Scanning Flow

```text
Camera/Upload → POST /api/receipts/scan → Queue Job → Gemini Vision API
→ Extract {merchant, amount, date, items} → Create Draft Transaction
→ User Confirms/Edits → Save Transaction
```

#### 3. WhatsApp Transaction Flow

```text
User: "spent 150 at shoprite"
→ WhatsApp Webhook → Parse Intent → Gemini NLP
→ Extract {amount: 150, merchant: "Shoprite", category: "Groceries"}
→ Create Transaction → Send Confirmation
```

---

## Database Schema

### Existing Tables (Already Implemented)

- `users` - User accounts and profiles
- `user_display_settings` - Theme, currency, locale preferences
- `user_notification_preferences` - Notification channels
- `households` - Multi-user household support
- `household_members` - Household membership
- `categories` / `category_groups` - Transaction categories
- `merchants` / `merchant_aliases` - Merchant management
- `tags` - Transaction tagging
- `rules` / `rule_execution_log` - Auto-categorization rules

### Architectural Best Practices

#### 1. PostgreSQL Enums (Type Safety)

Use PostgreSQL enums instead of VARCHAR for type columns to ensure data integrity:

```sql
-- Define enums first
CREATE TYPE account_type AS ENUM (
  'checking', 'savings', 'credit_card', 'cash', 'mobile_money',
  'investment', 'loan', 'mortgage', 'real_estate', 'vehicle', 'other'
);

CREATE TYPE transaction_type AS ENUM ('income', 'expense', 'transfer', 'balance_adjustment');

CREATE TYPE transaction_source AS ENUM (
  'manual', 'whatsapp', 'receipt_scan', 'csv_import', 'recurring'
);

CREATE TYPE transaction_status AS ENUM ('pending', 'cleared', 'reconciled');

CREATE TYPE recurring_frequency AS ENUM (
  'daily', 'weekly', 'biweekly', 'monthly', 'quarterly', 'yearly'
);
```

**Drizzle ORM Implementation:**

```typescript
// shared/schema.ts
export const accountTypeEnum = pgEnum("account_type", [
  "checking",
  "savings",
  "credit_card",
  "cash",
  "mobile_money",
  "investment",
  "loan",
  "mortgage",
  "real_estate",
  "vehicle",
  "other",
]);

export const transactionTypeEnum = pgEnum("transaction_type", [
  "income",
  "expense",
  "transfer",
  "balance_adjustment",
]);

export const transactionSourceEnum = pgEnum("transaction_source", [
  "manual",
  "whatsapp",
  "receipt_scan",
  "csv_import",
  "recurring",
]);

export const transactionStatusEnum = pgEnum("transaction_status", [
  "pending",
  "cleared",
  "reconciled",
]);

export const recurringFrequencyEnum = pgEnum("recurring_frequency", [
  "daily",
  "weekly",
  "biweekly",
  "monthly",
  "quarterly",
  "yearly",
]);
```

#### 2. Idempotency Keys (Duplicate Prevention)

Add idempotency keys to prevent duplicate transactions from WhatsApp/receipt ingestion:

```sql
-- On transactions table
idempotency_key VARCHAR(64) UNIQUE,

-- On receipts table
checksum VARCHAR(64),  -- SHA-256 of file content

-- On whatsapp_messages table
whatsapp_message_id VARCHAR(100) UNIQUE,
```

#### 3. Soft Deletion Pattern

Use `deleted_at` timestamp for reversible deletes on critical tables:

```sql
-- accounts, transactions, budgets, goals
deleted_at TIMESTAMP,
```

Query pattern: `WHERE deleted_at IS NULL` for active records.

#### 4. Explicit Indexes

Define indexes on frequently queried columns:

```sql
-- Example indexes (included in table definitions below)
CREATE INDEX accounts_household_idx ON accounts(household_id);
CREATE INDEX accounts_type_idx ON accounts(household_id, type);
CREATE INDEX transactions_household_date_idx ON transactions(household_id, date);
CREATE INDEX transactions_account_date_idx ON transactions(account_id, date);
CREATE INDEX transactions_category_idx ON transactions(category_id);
CREATE INDEX transactions_status_idx ON transactions(household_id, status);
```

#### 5. Feature Flags

Gate advanced features for incremental rollout:

```typescript
// server/config/features.ts
export const features = {
  aiReceiptScanning: process.env.FEATURE_AI_RECEIPTS === "true",
  whatsappBot: process.env.FEATURE_WHATSAPP === "true",
  aiInsights: process.env.FEATURE_AI_INSIGHTS === "true",
};

// Usage in routes
if (!features.aiReceiptScanning) {
  return res.status(404).json({ error: "Feature not available" });
}
```

#### 6. Consistent Error Envelope

All API responses follow this format:

```typescript
// Success
{
  success: true,
  data: T
}

// Error
{
  success: false,
  error: {
    code: "VALIDATION_ERROR" | "NOT_FOUND" | "UNAUTHORIZED" | "RATE_LIMITED" | "INTERNAL_ERROR",
    message: "Human readable message",
    details?: object  // Optional field-level errors
  }
}
```

#### 7. Pagination Pattern

All list endpoints return consistent pagination:

```typescript
{
  success: true,
  data: T[],
  pagination: {
    page: number,
    limit: number,
    total: number,
    hasMore: boolean
  }
}
```

#### 8. Rate Limiting

```typescript
// server/middleware/rateLimit.ts
- API: 100 requests/minute per user
- WhatsApp: 20 messages/day per connection
- Receipt uploads: 50/day per user
```

---

### New Tables Required

#### Core Financial Tables

```sql
-- ACCOUNTS: User's financial accounts (manual tracking)
CREATE TABLE accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id UUID REFERENCES households(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id),

  name VARCHAR(255) NOT NULL,
  type account_type NOT NULL,  -- PostgreSQL enum
  subtype VARCHAR(50),         -- mtn_money, airtel_money, zanaco, fnb, stanbic, etc.

  -- Balance tracking
  initial_balance DECIMAL(15,2) DEFAULT 0,  -- Starting balance when account created
  current_balance DECIMAL(15,2) DEFAULT 0,  -- Authoritative balance (source of truth)
  currency VARCHAR(3) DEFAULT 'ZMW',

  -- For credit accounts
  credit_limit DECIMAL(15,2),
  available_balance DECIMAL(15,2),

  -- Display
  is_hidden BOOLEAN DEFAULT FALSE,
  display_order INTEGER DEFAULT 0,
  color VARCHAR(7),
  icon VARCHAR(50),

  -- Classification for net worth
  is_asset BOOLEAN DEFAULT TRUE,  -- false for credit cards, loans (liabilities)
  include_in_net_worth BOOLEAN DEFAULT TRUE,
  notes TEXT,

  last_reconciled_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  deleted_at TIMESTAMP  -- Soft deletion
);

-- Indexes for accounts
CREATE INDEX accounts_household_idx ON accounts(household_id);
CREATE INDEX accounts_type_idx ON accounts(household_id, type);
CREATE INDEX accounts_household_asset_idx ON accounts(household_id, is_asset) WHERE deleted_at IS NULL AND is_hidden = FALSE;

-- TRANSACTIONS: All financial transactions
--
-- CANONICAL TRANSFER MODEL (Two-Row Representation):
-- Transfers create TWO linked transactions:
--   Row 1: type='transfer', is_transfer_in=false, account_id=source, transfer_pair_id=row2.id
--   Row 2: type='transfer', is_transfer_in=true, account_id=destination, transfer_pair_id=row1.id
-- Both rows have identical amount (always positive) and currency.
-- Analytics exclude transfers by default: WHERE type != 'transfer'
--
-- AMOUNT INVARIANT: amount is ALWAYS positive decimal(15,2)
-- Sign is determined by type: income adds, expense subtracts, transfer uses is_transfer_in
--
CREATE TABLE transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id UUID REFERENCES households(id) ON DELETE CASCADE,
  account_id UUID REFERENCES accounts(id) ON DELETE CASCADE,
  owner_user_id UUID REFERENCES users(id),  -- who created it (for "mine" vs "household" scope)
  merchant_id UUID REFERENCES merchants(id),
  category_id UUID REFERENCES categories(id),

  -- Idempotency (prevents duplicates from WhatsApp/receipts/CSV imports)
  idempotency_key UUID UNIQUE,  -- UUID v4 format

  -- Core data (amount is ALWAYS positive)
  date DATE NOT NULL,
  amount DECIMAL(15,2) NOT NULL CHECK (amount >= 0),
  currency VARCHAR(3) DEFAULT 'ZMW',
  type transaction_type NOT NULL,  -- PostgreSQL enum: income, expense, transfer, balance_adjustment

  -- Names
  name VARCHAR(255) NOT NULL,
  original_name VARCHAR(255),  -- Before rule renaming

  -- Status
  status transaction_status DEFAULT 'cleared',  -- PostgreSQL enum: pending, cleared, reconciled

  -- Transfer tracking (two-row model)
  is_transfer_in BOOLEAN DEFAULT FALSE,  -- For transfers: true = inflow, false = outflow
  transfer_pair_id UUID REFERENCES transactions(id),

  -- Review workflow
  is_reviewed BOOLEAN DEFAULT FALSE,
  reviewed_at TIMESTAMP,
  reviewed_by UUID REFERENCES users(id),

  -- Flags
  is_recurring BOOLEAN DEFAULT FALSE,
  is_excluded_from_budget BOOLEAN DEFAULT FALSE,
  is_excluded_from_reports BOOLEAN DEFAULT FALSE,

  -- For recurring transaction linking
  recurring_transaction_id UUID,  -- References recurring_transactions.id

  -- User notes
  notes TEXT,

  -- Receipt/attachment
  receipt_id UUID REFERENCES receipts(id),

  -- Source tracking
  source transaction_source DEFAULT 'manual',  -- PostgreSQL enum

  -- Import batch tracking (for CSV imports)
  import_batch_id UUID,

  -- AI categorization metadata
  ai_category_confidence DECIMAL(3,2),

  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  deleted_at TIMESTAMP  -- Soft deletion
);

-- Indexes for transactions (partial indexes for performance)
CREATE INDEX idx_transactions_household_date ON transactions(household_id, date DESC) WHERE deleted_at IS NULL;
CREATE INDEX idx_transactions_household_type_date ON transactions(household_id, type, date DESC) WHERE deleted_at IS NULL;
CREATE INDEX idx_transactions_account_date ON transactions(account_id, date DESC) WHERE deleted_at IS NULL;
CREATE INDEX idx_transactions_category_date ON transactions(category_id, date DESC) WHERE deleted_at IS NULL AND is_excluded_from_reports = FALSE;
CREATE INDEX idx_transactions_owner_date ON transactions(owner_user_id, date DESC) WHERE deleted_at IS NULL;
CREATE INDEX idx_transactions_cursor ON transactions(date DESC, id DESC) WHERE deleted_at IS NULL;  -- For cursor pagination

-- Transaction Tags (Many-to-Many)
CREATE TABLE transaction_tags (
  transaction_id UUID REFERENCES transactions(id) ON DELETE CASCADE,
  tag_id UUID REFERENCES tags(id) ON DELETE CASCADE,
  created_at TIMESTAMP DEFAULT NOW(),
  PRIMARY KEY (transaction_id, tag_id)
);

CREATE INDEX idx_transaction_tags_transaction ON transaction_tags(transaction_id);
CREATE INDEX idx_transaction_tags_tag ON transaction_tags(tag_id);

-- TRANSACTION SPLITS: For splitting a single transaction across multiple categories
--
-- SPLIT INVARIANT: SUM(splits.amount) = parent.amount (enforced at application layer)
-- Splits are ONLY allowed on income and expense transactions (NOT transfers or balance_adjustments)
-- Analytics aggregate splits, not parent, to prevent double-counting
-- Query pattern: LEFT JOIN transaction_splits, use COALESCE(split.amount, transaction.amount)
--
CREATE TABLE transaction_splits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id UUID NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,

  -- Split details (amount is positive, inherits sign from parent type)
  amount DECIMAL(15,2) NOT NULL CHECK (amount >= 0),
  category_id UUID REFERENCES categories(id),  -- Can override parent category
  merchant_id UUID REFERENCES merchants(id),   -- Can override parent merchant
  notes TEXT,

  -- Display order
  display_order INTEGER NOT NULL DEFAULT 0,

  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_transaction_splits_transaction ON transaction_splits(transaction_id, display_order);

-- BUDGETS: Category-based budgeting
CREATE TABLE budgets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id UUID REFERENCES households(id) ON DELETE CASCADE,
  category_id UUID REFERENCES categories(id),         -- NULL = flex/overall budget
  category_group_id UUID REFERENCES category_groups(id),  -- For group-level budgeting

  name VARCHAR(100),
  budget_type VARCHAR(20) DEFAULT 'category',  -- category, category_group, flex, savings
  amount DECIMAL(15,2) NOT NULL,
  period VARCHAR(20) DEFAULT 'monthly',  -- weekly, monthly, yearly

  -- Rollover
  rollover_enabled BOOLEAN DEFAULT FALSE,
  rollover_amount DECIMAL(15,2) DEFAULT 0,

  -- Alert thresholds
  warning_threshold INTEGER DEFAULT 80,  -- Percentage
  alert_threshold INTEGER DEFAULT 100,

  start_date DATE NOT NULL,
  end_date DATE,
  is_active BOOLEAN DEFAULT TRUE,

  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Indexes for budgets
CREATE INDEX budgets_household_idx ON budgets(household_id);
CREATE INDEX budgets_category_idx ON budgets(category_id);

-- Budget period tracking (actual vs budgeted per month)
CREATE TABLE budget_periods (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  budget_id UUID REFERENCES budgets(id) ON DELETE CASCADE,

  month INTEGER NOT NULL,  -- 1-12
  year INTEGER NOT NULL,

  budgeted_amount DECIMAL(15,2),
  actual_amount DECIMAL(15,2) DEFAULT 0,
  rollover_in DECIMAL(15,2) DEFAULT 0,
  rollover_out DECIMAL(15,2) DEFAULT 0,

  UNIQUE(budget_id, month, year)
);

-- RECURRING TRANSACTIONS: Bills and subscriptions
CREATE TABLE recurring_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id UUID REFERENCES households(id) ON DELETE CASCADE,
  account_id UUID REFERENCES accounts(id),
  merchant_id UUID REFERENCES merchants(id),
  category_id UUID REFERENCES categories(id),

  name VARCHAR(255) NOT NULL,
  amount DECIMAL(15,2) NOT NULL CHECK (amount >= 0),
  currency VARCHAR(3) DEFAULT 'ZMW',
  type transaction_type NOT NULL,  -- PostgreSQL enum: income, expense (NOT transfer or balance_adjustment)

  -- Schedule
  frequency recurring_frequency NOT NULL,  -- PostgreSQL enum: daily, weekly, biweekly, monthly, quarterly, yearly
  start_date DATE NOT NULL,
  end_date DATE,
  day_of_month INTEGER,  -- 1-31
  day_of_week INTEGER,   -- 0-6 (Sunday-Saturday)

  -- Tracking
  next_due_date DATE NOT NULL,
  last_occurrence DATE,
  last_generated_key UUID,  -- Idempotency for auto-generation

  -- Settings
  is_active BOOLEAN DEFAULT TRUE,
  is_paused BOOLEAN DEFAULT FALSE,
  is_subscription BOOLEAN DEFAULT FALSE,
  auto_create BOOLEAN DEFAULT FALSE,  -- Auto-create transaction on due date
  reminder_days INTEGER DEFAULT 3,     -- Days before to remind

  notes TEXT,

  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- GOALS: Financial goals tracking
CREATE TABLE goals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id UUID REFERENCES households(id) ON DELETE CASCADE,
  linked_account_id UUID REFERENCES accounts(id),

  name VARCHAR(255) NOT NULL,
  description TEXT,

  target_amount DECIMAL(15,2) NOT NULL,
  current_amount DECIMAL(15,2) DEFAULT 0,
  currency VARCHAR(3) DEFAULT 'ZMW',

  target_date DATE,
  priority INTEGER DEFAULT 1,  -- 1 = highest
  monthly_contribution DECIMAL(15,2),

  status VARCHAR(20) DEFAULT 'active',  -- active, completed, paused, cancelled

  icon VARCHAR(50),
  color VARCHAR(7),

  is_archived BOOLEAN DEFAULT FALSE,

  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  completed_at TIMESTAMP
);

-- GOAL CONTRIBUTIONS: Track contributions towards goals
CREATE TABLE goal_contributions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  goal_id UUID NOT NULL REFERENCES goals(id) ON DELETE CASCADE,

  amount DECIMAL(15,2) NOT NULL,
  date DATE NOT NULL,
  notes TEXT,

  -- Optional link to transaction
  transaction_id UUID REFERENCES transactions(id) ON DELETE SET NULL,

  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_goal_contributions_goal ON goal_contributions(goal_id, date DESC);

-- HOLDINGS: Investment tracking
CREATE TABLE holdings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID REFERENCES accounts(id) ON DELETE CASCADE,

  symbol VARCHAR(20),
  name VARCHAR(255) NOT NULL,
  security_type VARCHAR(50),  -- stock, etf, mutual_fund, bond, crypto

  quantity DECIMAL(18,8) NOT NULL,
  cost_basis DECIMAL(15,2),
  current_price DECIMAL(15,4),
  current_value DECIMAL(15,2),
  currency VARCHAR(3) DEFAULT 'USD',

  last_price_update TIMESTAMP,

  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- NET WORTH SNAPSHOTS: Historical tracking
CREATE TABLE net_worth_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id UUID REFERENCES households(id) ON DELETE CASCADE,

  date DATE NOT NULL,

  total_assets DECIMAL(15,2) NOT NULL,
  total_liabilities DECIMAL(15,2) NOT NULL,
  net_worth DECIMAL(15,2) NOT NULL,

  -- Breakdown by account type
  breakdown JSONB,  -- { cash: x, investments: y, real_estate: z, loans: -a }

  created_at TIMESTAMP DEFAULT NOW(),

  UNIQUE(household_id, date)
);

CREATE INDEX idx_net_worth_snapshots_household_date ON net_worth_snapshots(household_id, date DESC);

-- ACCOUNT BALANCE SNAPSHOTS: Historical balance for each account
CREATE TABLE account_balance_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,

  date DATE NOT NULL,
  balance DECIMAL(15,2) NOT NULL,
  available_balance DECIMAL(15,2),

  created_at TIMESTAMP DEFAULT NOW(),

  UNIQUE(account_id, date)
);

CREATE INDEX idx_account_balance_snapshots_account_date ON account_balance_snapshots(account_id, date DESC);

-- IMPORT BATCHES: Track CSV import jobs
CREATE TABLE import_batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id UUID NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id),

  -- File info
  file_name VARCHAR(255) NOT NULL,
  file_size INTEGER,

  -- Status
  status VARCHAR(20) DEFAULT 'pending',  -- pending, processing, completed, failed, cancelled

  -- Stats
  total_rows INTEGER DEFAULT 0,
  imported_rows INTEGER DEFAULT 0,
  skipped_rows INTEGER DEFAULT 0,
  error_rows INTEGER DEFAULT 0,

  -- Column mapping used
  column_mapping JSONB,  -- { date: "Date Column", amount: "Cost", description: "Details", ... }

  -- Error details
  errors JSONB,  -- [{ row: 5, field: "amount", message: "Invalid number" }, ...]

  started_at TIMESTAMP,
  completed_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_import_batches_household ON import_batches(household_id, created_at DESC);
```

#### AI & Receipt Scanning Tables

```sql
-- RECEIPTS: Uploaded receipt images and extracted data
CREATE TABLE receipts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id UUID REFERENCES households(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id),

  -- File info
  file_url TEXT NOT NULL,
  file_name VARCHAR(255),
  file_size INTEGER,
  mime_type VARCHAR(50),
  checksum VARCHAR(64),  -- SHA-256 for duplicate detection (idempotency)

  -- Processing status
  status VARCHAR(20) DEFAULT 'pending',  -- pending, processing, completed, failed

  -- AI-extracted data
  extracted_data JSONB,
  /*
    {
      merchant: "Shoprite",
      date: "2025-01-15",
      total: 245.50,
      currency: "ZMW",
      items: [
        { name: "Bread", quantity: 2, price: 25.00 },
        { name: "Milk", quantity: 1, price: 18.50 }
      ],
      payment_method: "cash",
      confidence: 0.95
    }
  */

  -- AI metadata
  model_used VARCHAR(50),
  processing_time_ms INTEGER,
  raw_response TEXT,

  -- Error handling
  error_message TEXT,
  retry_count INTEGER DEFAULT 0,

  -- Linked transaction (after user confirms)
  transaction_id UUID REFERENCES transactions(id),

  created_at TIMESTAMP DEFAULT NOW(),
  processed_at TIMESTAMP
);

-- Indexes for receipts
CREATE INDEX receipts_status_idx ON receipts(status);
CREATE INDEX receipts_checksum_idx ON receipts(checksum);

-- AI INSIGHTS: Generated financial insights
CREATE TABLE ai_insights (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id UUID REFERENCES households(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id),

  insight_type VARCHAR(50) NOT NULL,
  /*
    Types:
    - spending_anomaly: Unusual spending detected
    - budget_warning: Approaching/exceeded budget
    - savings_opportunity: Found potential savings
    - goal_progress: Goal milestone reached
    - recurring_detected: New recurring expense found
    - merchant_insight: Spending pattern at merchant
    - category_trend: Category spending trend
    - weekly_summary: Weekly spending summary
  */

  title VARCHAR(255) NOT NULL,
  description TEXT NOT NULL,

  -- Actionability
  actionable BOOLEAN DEFAULT TRUE,
  suggested_action TEXT,
  action_type VARCHAR(50),  -- create_budget, reduce_spending, review_subscription

  -- Related entities
  related_transaction_ids JSONB,  -- [uuid, uuid, ...]
  related_category_id UUID REFERENCES categories(id),
  related_account_id UUID REFERENCES accounts(id),
  related_merchant_id UUID REFERENCES merchants(id),

  -- AI metadata
  confidence DECIMAL(3,2),
  model_used VARCHAR(50),
  prompt_tokens INTEGER,
  completion_tokens INTEGER,

  -- User interaction
  is_read BOOLEAN DEFAULT FALSE,
  is_dismissed BOOLEAN DEFAULT FALSE,
  is_actioned BOOLEAN DEFAULT FALSE,
  user_feedback VARCHAR(20),  -- helpful, not_helpful, wrong

  -- Validity
  expires_at TIMESTAMP,

  created_at TIMESTAMP DEFAULT NOW()
);

-- Indexes for ai_insights
CREATE INDEX ai_insights_household_read_idx ON ai_insights(household_id, is_read);
CREATE INDEX ai_insights_expires_idx ON ai_insights(expires_at);

-- AI CONVERSATIONS: Chat history for contextual AI
CREATE TABLE ai_conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,

  channel VARCHAR(20) NOT NULL,  -- web, whatsapp
  session_id VARCHAR(100),  -- For grouping related messages

  messages JSONB NOT NULL,
  /*
    [
      { role: "user", content: "How much did I spend on food?", timestamp: "..." },
      { role: "assistant", content: "You spent K2,450 on food this month...", timestamp: "..." }
    ]
  */

  -- Context used
  context_data JSONB,  -- Financial data provided to AI

  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
```

#### WhatsApp & Notifications Tables

```sql
-- WHATSAPP CONNECTIONS: User's linked WhatsApp numbers
CREATE TABLE whatsapp_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,

  phone_number VARCHAR(20) NOT NULL UNIQUE,
  is_verified BOOLEAN DEFAULT FALSE,
  verification_code VARCHAR(6),
  verification_expires_at TIMESTAMP,

  -- Preferences
  notifications_enabled BOOLEAN DEFAULT TRUE,
  weekly_summary_enabled BOOLEAN DEFAULT TRUE,
  quick_add_enabled BOOLEAN DEFAULT TRUE,  -- Allow adding transactions via chat

  -- Rate limiting
  last_message_at TIMESTAMP,
  messages_today INTEGER DEFAULT 0,

  created_at TIMESTAMP DEFAULT NOW(),
  verified_at TIMESTAMP
);

-- WHATSAPP MESSAGES: Message log
CREATE TABLE whatsapp_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id),
  connection_id UUID REFERENCES whatsapp_connections(id),

  direction VARCHAR(10) NOT NULL,  -- inbound, outbound
  phone_number VARCHAR(20) NOT NULL,

  message_type VARCHAR(20) NOT NULL,  -- text, template, interactive, image
  content JSONB NOT NULL,
  /*
    For text: { body: "..." }
    For template: { template_name: "...", parameters: [...] }
    For image: { url: "...", caption: "..." }
  */

  whatsapp_message_id VARCHAR(100) UNIQUE,  -- Idempotency key from WhatsApp

  -- Status tracking
  status VARCHAR(20) DEFAULT 'pending',  -- pending, sent, delivered, read, failed
  error_message TEXT,

  -- If this message created a transaction
  created_transaction_id UUID REFERENCES transactions(id),

  created_at TIMESTAMP DEFAULT NOW(),
  sent_at TIMESTAMP,
  delivered_at TIMESTAMP,
  read_at TIMESTAMP
);

-- Indexes for whatsapp_messages
CREATE INDEX whatsapp_messages_wa_id_idx ON whatsapp_messages(whatsapp_message_id);
CREATE INDEX whatsapp_messages_user_created_idx ON whatsapp_messages(user_id, created_at);

-- NOTIFICATIONS: In-app and multi-channel notifications
CREATE TABLE notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  household_id UUID REFERENCES households(id),

  type VARCHAR(50) NOT NULL,
  /*
    Types:
    - transaction_large: Large transaction detected
    - budget_exceeded: Budget limit exceeded
    - budget_warning: 80% of budget used
    - goal_achieved: Goal target reached
    - goal_contribution: Contribution reminder
    - bill_due: Upcoming bill
    - bill_overdue: Missed bill
    - insight_new: New AI insight available
    - weekly_summary: Weekly spending summary
    - account_low: Low balance warning
  */

  title VARCHAR(255) NOT NULL,
  body TEXT NOT NULL,

  -- Additional data
  data JSONB,  -- { transactionId, budgetId, amount, etc. }

  -- Action
  action_url VARCHAR(255),  -- Deep link to relevant page

  -- Channel delivery
  channels JSONB DEFAULT '{"inApp": true}',
  /*
    { inApp: true, email: false, whatsapp: true, push: false }
  */
  delivery_status JSONB,
  /*
    { inApp: "delivered", whatsapp: "sent", email: "failed" }
  */

  -- User interaction
  is_read BOOLEAN DEFAULT FALSE,
  read_at TIMESTAMP,

  created_at TIMESTAMP DEFAULT NOW()
);

-- NOTIFICATION QUEUE: For async delivery
CREATE TABLE notification_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  notification_id UUID REFERENCES notifications(id) ON DELETE CASCADE,

  channel VARCHAR(20) NOT NULL,  -- email, whatsapp, push

  status VARCHAR(20) DEFAULT 'pending',  -- pending, processing, sent, failed
  attempts INTEGER DEFAULT 0,
  max_attempts INTEGER DEFAULT 3,

  scheduled_for TIMESTAMP DEFAULT NOW(),
  last_attempt_at TIMESTAMP,

  error_message TEXT,

  created_at TIMESTAMP DEFAULT NOW()
);
  created_at TIMESTAMP DEFAULT NOW()
);

-- COLLABORATION & SECURITY

-- HOUSEHOLD INVITATIONS (Managed invitations)
CREATE TABLE household_invitations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id UUID REFERENCES households(id) ON DELETE CASCADE,
  invited_by UUID REFERENCES users(id),
  email VARCHAR(255) NOT NULL,
  role VARCHAR(20) DEFAULT 'member', -- admin, member, viewer
  token VARCHAR(100) NOT NULL UNIQUE,
  expires_at TIMESTAMP NOT NULL,
  status VARCHAR(20) DEFAULT 'pending', -- pending, accepted, expired
  created_at TIMESTAMP DEFAULT NOW()
);

-- AUDIT LOGS: Track critical changes (Security & Accountability)
CREATE TABLE audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id UUID REFERENCES households(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id),

  entity_type VARCHAR(50) NOT NULL, -- transaction, budget, rule
  entity_id UUID NOT NULL,
  action VARCHAR(20) NOT NULL, -- create, update, delete

  changes JSONB, -- { "amount": { "old": 100, "new": 200 } }
  ip_address INET,
  user_agent TEXT,

  created_at TIMESTAMP DEFAULT NOW()
);

-- TRANSACTION COMMENTS: Partner communication
CREATE TABLE transaction_comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id UUID REFERENCES transactions(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id),

  content TEXT NOT NULL,
  mention_user_ids JSONB, -- Array of UUIDs

  is_resolved BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- FINANCIAL PLAN: Forecasting configuration
CREATE TABLE financial_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id UUID REFERENCES households(id) ON DELETE CASCADE,

  name VARCHAR(100) NOT NULL,

  -- Assumptions
  inflation_rate DECIMAL(4,2) DEFAULT 5.0,
  income_growth_rate DECIMAL(4,2) DEFAULT 3.0,
  investment_return_rate DECIMAL(4,2) DEFAULT 7.0,

  -- Configuration
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,

  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
```

---

## User Stories

### Epic 1: Account Management

| ID    | Story                                                                                                                      | Priority |
| ----- | -------------------------------------------------------------------------------------------------------------------------- | -------- |
| ACC-1 | As a user, I want to create financial accounts (bank, cash, mobile money) so I can track my money across different sources | High     |
| ACC-2 | As a user, I want to see my total balance across all accounts so I know my financial position                              | High     |
| ACC-3 | As a user, I want to edit account names and types so I can organize them my way                                            | Medium   |
| ACC-4 | As a user, I want to hide accounts from my dashboard without deleting them                                                 | Low      |
| ACC-5 | As a user, I want to set account colors and icons for easy identification                                                  | Low      |

### Epic 2: Transaction Management

| ID    | Story                                                                            | Priority |
| ----- | -------------------------------------------------------------------------------- | -------- |
| TXN-1 | As a user, I want to manually add income and expense transactions                | High     |
| TXN-2 | As a user, I want to categorize transactions so I can track spending by category | High     |
| TXN-3 | As a user, I want to search and filter my transactions by date, amount, category | High     |
| TXN-4 | As a user, I want to add notes to transactions for context                       | Medium   |
| TXN-5 | As a user, I want to split a transaction across multiple categories              | Medium   |
| TXN-6 | As a user, I want to mark transactions as reviewed                               | Medium   |
| TXN-7 | As a user, I want to record transfers between my accounts                        | High     |
| TXN-8 | As a user, I want to tag transactions with custom tags                           | Medium   |
| TXN-9 | As a user, I want to exclude specific transactions from budgets/reports          | Low      |

### Epic 3: Receipt Scanning (AI)

| ID    | Story                                                                          | Priority |
| ----- | ------------------------------------------------------------------------------ | -------- |
| RCP-1 | As a user, I want to take a photo of a receipt and have AI extract the details | High     |
| RCP-2 | As a user, I want to upload receipt images from my gallery                     | High     |
| RCP-3 | As a user, I want to review and edit AI-extracted data before saving           | High     |
| RCP-4 | As a user, I want to see individual line items from my receipt                 | Medium   |
| RCP-5 | As a user, I want the AI to suggest the correct category based on the merchant | High     |
| RCP-6 | As a user, I want to attach the receipt image to the transaction               | Medium   |

### Epic 4: WhatsApp Integration

| ID   | Story                                                                                  | Priority |
| ---- | -------------------------------------------------------------------------------------- | -------- |
| WA-1 | As a user, I want to link my WhatsApp number to my account                             | High     |
| WA-2 | As a user, I want to add transactions via WhatsApp chat (e.g., "spent 50 at shoprite") | High     |
| WA-3 | As a user, I want to receive transaction confirmations on WhatsApp                     | High     |
| WA-4 | As a user, I want to receive budget warnings on WhatsApp                               | Medium   |
| WA-5 | As a user, I want to receive a weekly spending summary on WhatsApp                     | Medium   |
| WA-6 | As a user, I want to ask questions about my finances via WhatsApp (AI chat)            | Medium   |
| WA-7 | As a user, I want to send a receipt photo via WhatsApp to create a transaction         | High     |
| WA-8 | As a user, I want to check my balance via WhatsApp                                     | Low      |

### Epic 5: Budgeting

| ID    | Story                                                                    | Priority |
| ----- | ------------------------------------------------------------------------ | -------- |
| BUD-1 | As a user, I want to set monthly budgets for each category               | High     |
| BUD-2 | As a user, I want to see how much I've spent vs budgeted                 | High     |
| BUD-3 | As a user, I want to receive alerts when I'm approaching my budget limit | High     |
| BUD-4 | As a user, I want to rollover unused budget to the next month            | Medium   |
| BUD-5 | As a user, I want to see budget trends over time                         | Medium   |

### Epic 6: Goals

| ID    | Story                                                                   | Priority |
| ----- | ----------------------------------------------------------------------- | -------- |
| GOL-1 | As a user, I want to create savings goals with target amounts and dates | High     |
| GOL-2 | As a user, I want to track progress towards my goals                    | High     |
| GOL-3 | As a user, I want to link a goal to a specific savings account          | Medium   |
| GOL-4 | As a user, I want to receive notifications when I reach goal milestones | Medium   |

### Epic 7: Recurring Transactions

| ID    | Story                                                           | Priority |
| ----- | --------------------------------------------------------------- | -------- |
| REC-1 | As a user, I want to track my recurring bills and subscriptions | High     |
| REC-2 | As a user, I want to see upcoming bills on a calendar           | Medium   |
| REC-3 | As a user, I want to receive reminders before bills are due     | High     |
| REC-4 | As a user, I want the app to auto-detect recurring transactions | Medium   |

### Epic 8: AI Insights

| ID   | Story                                                                    | Priority |
| ---- | ------------------------------------------------------------------------ | -------- |
| AI-1 | As a user, I want AI to analyze my spending and provide insights         | High     |
| AI-2 | As a user, I want to see spending anomalies highlighted                  | Medium   |
| AI-3 | As a user, I want personalized savings recommendations                   | Medium   |
| AI-4 | As a user, I want to ask questions about my finances in natural language | Medium   |
| AI-5 | As a user, I want AI to automatically categorize my transactions         | High     |

### Epic 9: Reports & Analytics

| ID    | Story                                                      | Priority |
| ----- | ---------------------------------------------------------- | -------- |
| RPT-1 | As a user, I want to see my spending breakdown by category | High     |
| RPT-2 | As a user, I want to see income vs expenses over time      | High     |
| RPT-3 | As a user, I want to track my net worth over time          | Medium   |
| RPT-4 | As a user, I want to see a Sankey diagram of my money flow | Low      |
| RPT-5 | As a user, I want to export my data to CSV                 | Medium   |

### Epic 10: Household Management (Multi-User)

| ID    | Story                                                                              | Priority |
| ----- | ---------------------------------------------------------------------------------- | -------- |
| HSH-1 | As an admin, I want to invite my partner to my household via email                 | High     |
| HSH-2 | As a user, I want to join an existing household using an invite link               | High     |
| HSH-3 | As a user, I want to toggle "Private" mode for specific accounts/transactions      | High     |
| HSH-4 | As an admin, I want to manage member roles (Admin, Editor, Viewer)                 | Medium   |
| HSH-5 | As a user, I want to filter the dashboard by "My Spending" vs "Household Spending" | High     |
| HSH-6 | As a user, I want to comment on a transaction to ask my spouse about it            | Medium   |
| HSH-7 | As a user, I want to see an "Audit Log" of who changed a transaction               | Low      |

### Epic 11: Security & Privacy

| ID    | Story                                                                     | Priority |
| ----- | ------------------------------------------------------------------------- | -------- |
| SEC-1 | As a user, I want 2FA (Two-Factor Authentication) for login               | High     |
| SEC-2 | As a user, I want to see all my active sessions and revoke them           | Medium   |
| SEC-3 | As a user, I want to lock the app with a PIN/Biometrics (Mobile)          | High     |
| SEC-4 | As a user, I want my sensitive data (NRC, Salary) to be encrypted at rest | High     |
| SEC-5 | As a user, I want to download all my data (GDPR/Data Portability)         | Medium   |
| SEC-6 | As a system, I want to rate-limit API requests to prevent abuse           | High     |

### Epic 12: Financial Planning (Forecast)

| ID    | Story                                                                       | Priority |
| ----- | --------------------------------------------------------------------------- | -------- |
| PLN-1 | As a user, I want to see my projected bank balance for the next 12 months   | High     |
| PLN-2 | As a user, I want to simulate "What If" scenarios (e.g. buying a car)       | Medium   |
| PLN-3 | As a user, I want to see how my recurring bills affect my future cash flow  | High     |
| PLN-4 | As a user, I want to know my "Safe to Spend" amount based on upcoming bills | High     |

### Epic 13: Offline Capability (PWA)

| ID    | Story                                                                                          | Priority |
| ----- | ---------------------------------------------------------------------------------------------- | -------- |
| PWA-1 | As a user, I want to install the app on my phone home screen (Add to Home Screen)              | High     |
| PWA-2 | As a user, I want to add a transaction while offline (e.g. inside Shoprite) and sync it later  | High     |
| PWA-3 | As a user, I want to view my current balance and recent transactions without internet          | Medium   |
| PWA-4 | As a user, I want the app to automatically sync my offline data when I reconnect to Zamtel/MTN | High     |
| PWA-5 | As a user, I want to be notified if a sync fails so I don't lose my data                       | Medium   |

---

## Feature Requirements

### F1: Receipt Scanning

#### Functional Requirements (Receipts)

- FR1.1: Support camera capture and file upload (JPG, PNG, PDF)
- FR1.2: Process images using Google Gemini Vision API
- FR1.3: Extract: merchant name, date, total amount, line items, payment method
- FR1.4: Auto-suggest category based on merchant
- FR1.5: Allow user to edit extracted data before saving
- FR1.6: Store original receipt image linked to transaction
- FR1.7: Handle multi-page receipts (PDF)
- FR1.8: Support both English and local language receipts

#### Non-Functional Requirements

- NFR1.1: Process receipt within 5 seconds
- NFR1.2: Achieve >90% accuracy on clear receipts
- NFR1.3: Gracefully handle blurry/damaged receipts
- NFR1.4: Maximum file size: 10MB

#### AI Prompt Template

```text
Analyze this receipt image and extract:
1. Merchant/Store name
2. Date of transaction
3. Total amount
4. Currency (default ZMW if not shown)
5. Individual line items with quantities and prices
6. Payment method if visible

Return JSON format:
{
  "merchant": string,
  "date": "YYYY-MM-DD",
  "total": number,
  "currency": "ZMW",
  "items": [{ "name": string, "quantity": number, "price": number }],
  "payment_method": "cash" | "card" | "mobile_money" | "unknown",
  "confidence": 0-1
}

If any field cannot be determined, use null.
```

### F2: WhatsApp Bot

#### Functional Requirements (WhatsApp)

- FR2.1: Verify phone number via OTP
- FR2.2: Parse natural language transaction input
- FR2.3: Support formats: "spent X at Y", "received X from Y", "paid X for Y"
- FR2.4: Confirm transaction details before saving
- FR2.5: Process receipt images sent via WhatsApp
- FR2.6: Answer financial questions using AI
- FR2.7: Send scheduled notifications (weekly summary, bill reminders)
- FR2.8: Support quick commands: "balance", "budget", "help"

#### Non-Functional Requirements (WhatsApp)

- NFR2.1: Rate Limit: Max 10 AI chat messages per user/day (Cost Control)
- NFR2.2: Response time < 2 seconds for text commands

#### Message Templates (Meta-approved)

1. `transaction_confirmation` - Confirm added transaction
2. `budget_warning` - Budget limit approaching
3. `weekly_summary` - Weekly spending summary
4. `bill_reminder` - Upcoming bill reminder

#### NLP Intent Recognition

```yaml
Intents:
- add_expense: "spent", "paid", "bought"
- add_income: "received", "got", "earned"
- check_balance: "balance", "how much"
- check_budget: "budget", "left to spend"
- ask_question: "how much did I", "what's my"
- help: "help", "commands"
```

### F3: AI Financial Insights

#### Insight Types

| Type                | Trigger                                 | Example                                                        |
| ------------------- | --------------------------------------- | -------------------------------------------------------------- |
| spending_anomaly    | Spending 50% above average for category | "Your restaurant spending is K500 higher than usual this week" |
| budget_warning      | 80% or 100% of budget used              | "You've used 85% of your Groceries budget"                     |
| savings_opportunity | Detected high spending area             | "You could save K200/month by reducing takeout orders"         |
| recurring_detected  | New recurring pattern found             | "Looks like you have a new K99/month subscription"             |
| goal_progress       | Milestone reached                       | "You're 50% towards your Emergency Fund goal!"                 |
| merchant_insight    | Frequent merchant spending              | "You've spent K1,200 at Shoprite this month"                   |

#### AI Analysis Frequency

- Real-time: Budget warnings, large transactions
- Daily: Spending anomalies, recurring detection
- Weekly: Savings opportunities, trends

---

## API Specifications

### Accounts API

```text
GET    /api/accounts              - List all accounts
POST   /api/accounts              - Create account
GET    /api/accounts/:id          - Get account details
PUT    /api/accounts/:id          - Update account
DELETE /api/accounts/:id          - Delete account
GET    /api/accounts/:id/balance-history - Get balance over time
POST   /api/accounts/:id/adjust-balance  - Manual balance adjustment
```

### Transactions API

```text
GET    /api/transactions          - List transactions (with filters)
POST   /api/transactions          - Create transaction
GET    /api/transactions/:id      - Get transaction details
PUT    /api/transactions/:id      - Update transaction
DELETE /api/transactions/:id      - Delete transaction
POST   /api/transactions/:id/split - Split transaction
POST   /api/transactions/bulk     - Bulk update/delete
GET    /api/transactions/summary  - Get spending summary
```

### Receipts API

```text
POST   /api/receipts/scan         - Upload and scan receipt
GET    /api/receipts/:id          - Get receipt details
GET    /api/receipts/:id/status   - Check processing status
POST   /api/receipts/:id/confirm  - Confirm and create transaction
DELETE /api/receipts/:id          - Delete receipt
```

### Budgets API

```text
GET    /api/budgets               - List all budgets
POST   /api/budgets               - Create budget
GET    /api/budgets/:id           - Get budget details
PUT    /api/budgets/:id           - Update budget
DELETE /api/budgets/:id           - Delete budget
GET    /api/budgets/summary       - Get budget vs actual summary
```

### Goals API

```text
GET    /api/goals                 - List all goals
POST   /api/goals                 - Create goal
GET    /api/goals/:id             - Get goal details
PUT    /api/goals/:id             - Update goal
DELETE /api/goals/:id             - Delete goal
POST   /api/goals/:id/contribute  - Add contribution
```

### Recurring API

```text
GET    /api/recurring             - List recurring transactions
POST   /api/recurring             - Create recurring
PUT    /api/recurring/:id         - Update recurring
DELETE /api/recurring/:id         - Delete recurring
POST   /api/recurring/:id/skip    - Skip next occurrence
GET    /api/recurring/upcoming    - Get upcoming bills
```

### AI API

```text
POST   /api/ai/categorize         - Categorize transaction
POST   /api/ai/insights           - Generate insights for user
GET    /api/ai/insights           - Get user's insights
PUT    /api/ai/insights/:id       - Mark insight read/dismissed
POST   /api/ai/chat               - Chat with AI assistant
GET    /api/ai/conversations      - Get chat history
```

### WhatsApp API

```text
POST   /api/whatsapp/webhook      - WhatsApp webhook (Meta)
GET    /api/whatsapp/webhook      - Webhook verification
POST   /api/whatsapp/connect      - Start phone verification
POST   /api/whatsapp/verify       - Verify OTP
DELETE /api/whatsapp/disconnect   - Unlink WhatsApp
PUT    /api/whatsapp/preferences  - Update notification preferences
```

### Imports API

```text
POST   /api/imports/upload        - Upload CSV file for preview
POST   /api/imports/preview       - Generate import preview with mapping
POST   /api/imports/execute       - Execute import batch
GET    /api/imports               - List import batches (paginated)
GET    /api/imports/:id           - Get import batch details
DELETE /api/imports/:id           - Delete import batch (and transactions)
GET    /api/imports/:id/errors    - Get import error details
POST   /api/imports/templates     - Save column mapping template
GET    /api/imports/templates     - List saved templates
```

**CSV Import Request/Response:**

```typescript
// POST /api/imports/upload
interface UploadCSVRequest {
  file: File; // multipart/form-data
  account_id: string;
}

interface UploadCSVResponse {
  upload_id: string;
  headers: string[];
  sample_rows: string[][]; // First 5 rows
  detected_mappings: ColumnMapping | null; // Auto-detected
}

// POST /api/imports/execute
interface ExecuteImportRequest {
  upload_id: string;
  column_mapping: {
    date: string;
    description: string;
    amount: string;
    category?: string;
    notes?: string;
  };
  date_format: string; // e.g., "MM/DD/YYYY", "YYYY-MM-DD"
  amount_format: 'signed' | 'separate_columns';
  debit_column?: string; // If separate_columns
  credit_column?: string;
  skip_duplicates: boolean;
  default_category_id?: string;
}

interface ExecuteImportResponse {
  batch_id: string;
  total_rows: number;
  imported: number;
  skipped: number; // Duplicates
  errors: ImportError[];
}
```

### Reports API

```text
GET    /api/reports/dashboard          - Dashboard summary data
GET    /api/reports/spending           - Spending breakdown by category
GET    /api/reports/income-expense     - Income vs expense over time
GET    /api/reports/net-worth          - Net worth calculation
GET    /api/reports/net-worth/history  - Net worth over time
GET    /api/reports/cash-flow          - Cash flow analysis
GET    /api/reports/trends             - Spending trends analysis
GET    /api/reports/annual             - Annual summary dashboard
GET    /api/reports/annual/comparison  - Year-over-year comparison
GET    /api/reports/category/:id       - Category drill-down
GET    /api/reports/merchant/:id       - Merchant spending analysis
POST   /api/reports/export             - Export report to CSV/PDF
```

**Common Report Query Parameters:**

```typescript
interface ReportFilters {
  start_date: string; // ISO date
  end_date: string;
  account_ids?: string[]; // Filter by accounts
  category_ids?: string[]; // Filter by categories
  include_transfers?: boolean; // Default: false
  household_id?: string;
}

// GET /api/reports/annual?year=2024
interface AnnualReportResponse {
  year: number;
  total_income: number;
  total_expenses: number;
  net_savings: number;
  savings_rate: number;
  by_month: MonthlyBreakdown[];
  by_category: CategoryBreakdown[];
  top_merchants: MerchantBreakdown[];
  net_worth_start: number;
  net_worth_end: number;
  net_worth_change: number;
}
```

---

## AI Integration

### Google Gemini Setup

```typescript
// server/services/GeminiService.ts
import { GoogleGenerativeAI } from "@google/generative-ai";

export class GeminiService {
  private genAI: GoogleGenerativeAI;
  private textModel: GenerativeModel;
  private visionModel: GenerativeModel;

  constructor() {
    this.genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
    this.textModel = this.genAI.getGenerativeModel({
      model: "gemini-1.5-flash", // Good balance of speed/cost/free-tier
    });
    this.visionModel = this.genAI.getGenerativeModel({
      model: "gemini-1.5-pro", // Best for vision/reasoning (also has free tier)
    });
  }

  // Receipt scanning
  async scanReceipt(imageBase64: string): Promise<ReceiptData> {}

  // Transaction categorization
  async categorizeTransaction(
    name: string,
    amount: number
  ): Promise<CategorySuggestion> {}

  // Financial insights
  async generateInsights(
    financialData: UserFinancialData
  ): Promise<Insight[]> {}

  // Natural language parsing (WhatsApp)
  async parseTransactionIntent(message: string): Promise<ParsedTransaction> {}

  // Chat assistant
  async chat(message: string, context: FinancialContext): Promise<string> {}
}
```

### AI Environment Variables

```bash
GEMINI_API_KEY=your_gemini_api_key
```

---

## WhatsApp Integration

### Meta Business Setup Requirements

1. Meta Business Account
2. WhatsApp Business API access
3. Verified business phone number
4. Approved message templates

### Webhook Configuration

```yaml
Webhook URL: https://yourapp.com/api/whatsapp/webhook
Verify Token: YOUR_VERIFY_TOKEN
Subscribed Fields: messages, message_status
```

### WhatsApp Environment Variables

```bash
WHATSAPP_ACCESS_TOKEN=your_access_token
WHATSAPP_PHONE_NUMBER_ID=your_phone_number_id
WHATSAPP_VERIFY_TOKEN=your_verify_token
WHATSAPP_BUSINESS_ID=your_business_id
```

---

## CSV Import Service

### ImportService Implementation

```typescript
// server/services/ImportService.ts
import Papa from 'papaparse';
import { createHash } from 'crypto';

interface ParsedRow {
  date: Date;
  description: string;
  amount: number;
  type: 'income' | 'expense';
  category?: string;
  notes?: string;
}

interface ImportResult {
  total: number;
  imported: number;
  skipped: number;
  errors: ImportError[];
}

export class ImportService {
  // Parse CSV and return preview data
  async parseCSV(
    fileBuffer: Buffer,
    options: { delimiter?: string; encoding?: string }
  ): Promise<{ headers: string[]; rows: string[][] }> {}

  // Auto-detect column mappings based on header names
  detectColumnMappings(headers: string[]): ColumnMapping | null {
    const datePatterns = ['date', 'transaction date', 'posted'];
    const amountPatterns = ['amount', 'value', 'sum'];
    const descPatterns = ['description', 'memo', 'payee', 'name'];
    // ... matching logic
  }

  // Parse amount from string (handles negative, parentheses, currency symbols)
  parseAmount(value: string, format: 'signed' | 'separate'): number {
    // Remove currency symbols: K, $, ZMW
    // Handle (1,234.56) as negative
    // Handle -1,234.56 as negative
  }

  // Parse date with multiple format support
  parseDate(value: string, format: string): Date {
    // Supported formats: MM/DD/YYYY, DD/MM/YYYY, YYYY-MM-DD, etc.
  }

  // Generate duplicate detection hash
  generateTransactionHash(
    date: Date,
    amount: number,
    description: string
  ): string {
    const normalized = `${date.toISOString().split('T')[0]}|${amount}|${description.toLowerCase().trim()}`;
    return createHash('sha256').update(normalized).digest('hex').substring(0, 16);
  }

  // Execute import batch
  async executeImport(
    uploadId: string,
    mapping: ColumnMapping,
    options: ImportOptions
  ): Promise<ImportResult> {
    // 1. Parse all rows with mapping
    // 2. Generate hashes for duplicate detection
    // 3. Check existing transactions for duplicates
    // 4. Create import_batch record
    // 5. Insert transactions with import_batch_id
    // 6. Return results
  }

  // Rollback an import batch
  async rollbackImport(batchId: string): Promise<void> {
    // Delete all transactions with import_batch_id = batchId
    // Update import_batch status to 'rolled_back'
  }
}
```

### Column Mapping Templates

```typescript
// Predefined templates for common bank exports
const BANK_TEMPLATES: Record<string, ColumnMapping> = {
  'zanaco_csv': {
    date: 'Transaction Date',
    description: 'Description',
    amount: 'Amount',
    date_format: 'DD/MM/YYYY',
    amount_format: 'signed'
  },
  'stanbic_csv': {
    date: 'Date',
    description: 'Narrative',
    debit: 'Debit',
    credit: 'Credit',
    date_format: 'YYYY-MM-DD',
    amount_format: 'separate_columns'
  },
  'mtn_momo': {
    date: 'Date',
    description: 'Transaction Type',
    amount: 'Amount',
    date_format: 'DD-MMM-YYYY',
    amount_format: 'signed'
  }
};
```

---

## Report Service

### ReportService Implementation

```typescript
// server/services/ReportService.ts
import { Redis } from 'ioredis';

interface DateRange {
  start: Date;
  end: Date;
}

interface ReportFilters {
  accountIds?: string[];
  categoryIds?: string[];
  includeTransfers?: boolean;
}

export class ReportService {
  private redis: Redis;
  private cacheVersion: number = 1; // Increment to invalidate all caches

  // Cache key generation with versioning
  private getCacheKey(
    type: string,
    householdId: string,
    params: object
  ): string {
    const hash = createHash('md5')
      .update(JSON.stringify(params))
      .digest('hex')
      .substring(0, 8);
    return `report:v${this.cacheVersion}:${type}:${householdId}:${hash}`;
  }

  // Dashboard summary (cached 5 minutes)
  async getDashboardSummary(
    householdId: string,
    range: DateRange
  ): Promise<DashboardSummary> {
    // Total income, expenses, net
    // Spending by top categories
    // Recent transactions
    // Budget status overview
  }

  // Spending breakdown by category
  async getSpendingByCategory(
    householdId: string,
    range: DateRange,
    filters: ReportFilters
  ): Promise<CategoryBreakdown[]> {
    // Group by category with totals
    // Include category group rollups
    // Calculate percentages
  }

  // Income vs Expense time series
  async getIncomeExpenseTimeSeries(
    householdId: string,
    range: DateRange,
    granularity: 'day' | 'week' | 'month'
  ): Promise<TimeSeriesData[]> {}

  // Net worth calculation
  async getNetWorth(householdId: string): Promise<NetWorthData> {
    // Sum assets (is_asset = true)
    // Sum liabilities (is_asset = false)
    // Return breakdown by account type
  }

  // Net worth history (uses account_balance_snapshots)
  async getNetWorthHistory(
    householdId: string,
    range: DateRange
  ): Promise<NetWorthSnapshot[]> {}

  // Annual summary
  async getAnnualSummary(
    householdId: string,
    year: number
  ): Promise<AnnualSummary> {
    // Total income/expenses for year
    // Monthly breakdown
    // Category breakdown
    // Top merchants
    // Year-over-year comparison
    // Savings rate
  }

  // Invalidate cache when data changes
  async invalidateHouseholdCache(householdId: string): Promise<void> {
    const pattern = `report:v${this.cacheVersion}:*:${householdId}:*`;
    const keys = await this.redis.keys(pattern);
    if (keys.length > 0) {
      await this.redis.del(...keys);
    }
  }
}
```

### Report Cache Strategy

```typescript
// Cache TTLs by report type
const CACHE_TTLS: Record<string, number> = {
  'dashboard': 5 * 60,        // 5 minutes
  'spending': 15 * 60,        // 15 minutes
  'trends': 60 * 60,          // 1 hour
  'annual': 24 * 60 * 60,     // 24 hours (historical data)
  'net_worth': 30 * 60,       // 30 minutes
};

// Cache invalidation triggers
// 1. Transaction created/updated/deleted → invalidate affected date ranges
// 2. Account created/updated/deleted → invalidate net worth caches
// 3. Category updated → invalidate spending caches
// 4. Budget updated → invalidate dashboard cache
```

---

## Implementation Tasks

### Phase 1: Core Financial Data (Week 1-2)

#### Database Setup

- [ ] Add `accounts` table to schema.ts
- [ ] Add `transactions` table to schema.ts
- [ ] Add `transaction_tags` junction table
- [ ] Run database migrations
- [ ] Add indexes for common queries

#### API Routes

- [ ] Create `server/routes/accounts.ts`
- [ ] Create `server/routes/transactions.ts`
- [ ] Create `server/utils/encryption.ts` (Implement AES-256-GCM for sensitive data)
- [ ] Add storage methods to `server/storage.ts`
- [ ] Add Zod validation schemas
- [ ] Write API tests (Vitest/Jest) - **CRITICAL: Write alongside implementation**

#### Frontend Hooks

- [ ] Create `client/src/hooks/use-accounts.ts`
- [ ] Create `client/src/hooks/use-transactions.ts`
- [ ] Connect existing pages to real API

### Phase 2: Budgets & Planning (Week 2-3)

#### Database

- [ ] Add `budgets` table
- [ ] Add `budget_periods` table
- [ ] Add `recurring_transactions` table
- [ ] Add `goals` table
- [ ] Add `holdings` table
- [ ] Add `net_worth_snapshots` table

#### Budget API Routes

- [ ] Create `server/routes/budgets.ts`
- [ ] Create `server/routes/recurring.ts`
- [ ] Create `server/routes/goals.ts`
- [ ] Add budget calculation logic
- [ ] Add recurring transaction scheduler

#### Budget Frontend

- [ ] Connect Budget page to API
- [ ] Connect Goals page to API
- [ ] Connect Recurring page to API
- [ ] Add budget progress indicators

### Phase 3: AI Integration (Week 3-4)

#### AI Setup

- [ ] Install `@google/generative-ai` package
- [ ] Create `server/services/GeminiService.ts`
- [ ] Add AI-related tables to schema

#### Receipt Scanning

- [ ] Add `receipts` table
- [ ] Create `server/routes/receipts.ts`
- [ ] Implement receipt image upload (Multer)
- [ ] Implement Gemini Vision receipt extraction
- [ ] Build receipt review/confirm flow
- [ ] Create ReceiptScanner component (camera + upload)

#### AI Insights

- [ ] Add `ai_insights` table
- [ ] Create insights generation job (BullMQ)
- [ ] Implement spending anomaly detection
- [ ] Implement savings opportunity detection
- [ ] Create InsightsWidget component

#### Auto-categorization

- [ ] Implement transaction categorization API
- [ ] Add category suggestions to transaction form
- [ ] Track categorization confidence

### Phase 4: WhatsApp Integration (Week 4-5)

#### WhatsApp Setup

- [ ] Set up Meta Business account
- [ ] Configure WhatsApp Business API
- [ ] Add WhatsApp tables to schema

#### Core Bot

- [ ] Create `server/routes/whatsapp.ts`
- [ ] Implement webhook handler
- [ ] Implement phone number verification
- [ ] Create `server/services/WhatsAppService.ts`

#### Transaction via Chat

- [ ] Implement NLP intent parsing with Gemini
- [ ] Build transaction confirmation flow
- [ ] Handle receipt images via WhatsApp

#### Notifications

- [ ] Create notification queue system (BullMQ)
- [ ] Implement budget warning notifications
- [ ] Implement weekly summary notifications
- [ ] Implement bill reminder notifications

#### WhatsApp Frontend

- [ ] Add WhatsApp connection UI to Settings
- [ ] Add notification preference toggles

### Phase 5: Polish & Testing (Week 5-6)

#### Testing

- [ ] Write integration tests for all APIs
- [ ] Write component tests for new features
- [ ] End-to-end testing with Playwright
- [ ] Performance testing

#### Documentation

- [ ] API documentation (Swagger/OpenAPI)
- [ ] Budget Settings and Forecast requirements (`docs/budget-modal-requirements.md`)
- [ ] User guide
- [ ] Developer setup guide

#### Deployment

- [ ] Set up Redis for BullMQ
- [ ] Configure environment variables
- [ ] Set up file storage
- [ ] Deploy to production

### Phase 6: PWA & Offline Support (Week 6-7)

#### Configuration

- [ ] Configure `vite-plugin-pwa`
- [ ] Create `manifest.json` (icons, theme_color)
- [ ] Register Service Worker

#### Offline Logic

- [ ] Implement `TanStack Query` persistence with `idb` (IndexedDB)
- [ ] Create "Sync Queue" for offline mutations
- [ ] Implement conflict resolution strategy (Strict Last-Write-Wins based on `updated_at`)
- [ ] Add "Offline/Online" status indicator to UI

### Phase 7: CSV Import & Reports (Week 7-8)

#### CSV Import Backend

- [ ] Add `import_batches` table to schema.ts
- [ ] Create `server/routes/imports.ts`
- [ ] Create `server/services/ImportService.ts`
- [ ] Implement CSV parsing with papaparse
- [ ] Implement column mapping auto-detection
- [ ] Implement duplicate detection (date + amount + description hash)
- [ ] Implement batch rollback functionality
- [ ] Add validation for date formats and amount parsing

#### CSV Import Frontend

- [ ] Create `client/src/components/ImportWizard/` component
- [ ] Step 1: File upload with drag-and-drop
- [ ] Step 2: Column mapping UI with preview
- [ ] Step 3: Validation and conflict resolution
- [ ] Step 4: Import progress and results
- [ ] Create import history view
- [ ] Add "Undo Import" functionality

#### Reports Backend

- [ ] Create `server/routes/reports.ts`
- [ ] Create `server/services/ReportService.ts`
- [ ] Implement dashboard summary endpoint
- [ ] Implement spending breakdown by category
- [ ] Implement income vs expense time series
- [ ] Implement net worth calculation
- [ ] Implement cash flow analysis
- [ ] Implement annual summary endpoint
- [ ] Add Redis caching for expensive reports

#### Reports Frontend

- [ ] Create `client/src/hooks/use-reports.ts`
- [ ] Create AnnualDashboard component
- [ ] Create SpendingChart component (pie/bar)
- [ ] Create TrendChart component (line)
- [ ] Create NetWorthChart component
- [ ] Create CashFlowChart component
- [ ] Implement date range selector
- [ ] Implement report export (CSV/PDF)

---

## Appendix

### Zambian Mobile Money Codes

- MTN Mobile Money: 096XXXXXXX, 076XXXXXXX
- Airtel Money: 097XXXXXXX, 077XXXXXXX
- Zamtel Kwacha: 095XXXXXXX, 075XXXXXXX

### Currency Formatting

- Primary: ZMW (Zambian Kwacha)
- Format: K1,234.56
- Thousands separator: comma
- Decimal separator: period

### Default Categories (Zambian Context)

- Groceries (Shoprite, Pick n Pay, Spar)
- Transport (Fuel, Taxi, Bus)
- Utilities (ZESCO, Water, Internet)
- Mobile Money (Transfers, Airtime)
- Healthcare
- Education
- Entertainment
- Dining Out
- Shopping
- Personal Care

