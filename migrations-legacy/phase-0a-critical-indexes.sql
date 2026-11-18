-- Phase 0A: Critical Indexes Migration
-- Run this after npm run db:push to add performance indexes
-- These indexes are essential for analytics queries per Plan V7

-- ============================================================================
-- TRANSACTIONS (Analytics Hot Path)
-- ============================================================================

-- Primary query index: household + date for all reports
CREATE INDEX IF NOT EXISTS idx_transactions_household_date
  ON transactions(household_id, date DESC)
  WHERE deleted_at IS NULL;

-- Type-filtered queries (income/expense reports)
CREATE INDEX IF NOT EXISTS idx_transactions_household_type_date
  ON transactions(household_id, type, date DESC)
  WHERE deleted_at IS NULL;

-- Category breakdown queries
CREATE INDEX IF NOT EXISTS idx_transactions_category_date
  ON transactions(category_id, date DESC)
  WHERE deleted_at IS NULL AND is_excluded_from_reports = FALSE;

-- Merchant breakdown queries
CREATE INDEX IF NOT EXISTS idx_transactions_merchant_date
  ON transactions(merchant_id, date DESC)
  WHERE deleted_at IS NULL;

-- Account-specific queries
CREATE INDEX IF NOT EXISTS idx_transactions_account_date
  ON transactions(account_id, date DESC)
  WHERE deleted_at IS NULL;

-- Owner filtering (scope=mine)
CREATE INDEX IF NOT EXISTS idx_transactions_owner_date
  ON transactions(owner_user_id, date DESC)
  WHERE deleted_at IS NULL;

-- Pending transactions quick lookup
CREATE INDEX IF NOT EXISTS idx_transactions_pending
  ON transactions(household_id, is_pending)
  WHERE deleted_at IS NULL AND is_pending = TRUE;

-- Cursor-based pagination support
CREATE INDEX IF NOT EXISTS idx_transactions_cursor
  ON transactions(date DESC, id DESC)
  WHERE deleted_at IS NULL;

-- Transfer pair uniqueness enforcement
-- Ensures exactly one inflow and one outflow per transfer_transaction_id
CREATE UNIQUE INDEX IF NOT EXISTS uniq_transactions_transfer_pair
  ON transactions(household_id, transfer_transaction_id, is_transfer_in)
  WHERE deleted_at IS NULL AND type = 'transfer';

-- Idempotency key uniqueness (for offline mutations)
CREATE UNIQUE INDEX IF NOT EXISTS uniq_transactions_idempotency_key
  ON transactions(idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- ============================================================================
-- SNAPSHOTS
-- ============================================================================

-- Net worth history queries
CREATE INDEX IF NOT EXISTS idx_net_worth_snapshots_household_date
  ON net_worth_snapshots(household_id, date DESC);

-- Account balance history
CREATE INDEX IF NOT EXISTS idx_account_balance_snapshots_account_date
  ON account_balance_snapshots(account_id, date DESC);

-- Unique constraints for snapshot idempotency
CREATE UNIQUE INDEX IF NOT EXISTS uniq_net_worth_snapshots_household_date
  ON net_worth_snapshots(household_id, date);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_account_balance_snapshots_account_date
  ON account_balance_snapshots(account_id, date);

-- ============================================================================
-- ACCOUNTS
-- ============================================================================

-- Active accounts listing
CREATE INDEX IF NOT EXISTS idx_accounts_household
  ON accounts(household_id, display_order)
  WHERE deleted_at IS NULL AND is_archived = FALSE;

-- Net worth calculation (assets vs liabilities)
CREATE INDEX IF NOT EXISTS idx_accounts_household_asset
  ON accounts(household_id, is_asset)
  WHERE deleted_at IS NULL AND is_hidden = FALSE;

-- ============================================================================
-- CATEGORIES
-- ============================================================================

-- Category group ordering
CREATE INDEX IF NOT EXISTS idx_categories_group
  ON categories(group_id, display_order)
  WHERE deleted_at IS NULL;

-- ============================================================================
-- BUDGETS
-- ============================================================================

-- Budget period queries
CREATE INDEX IF NOT EXISTS idx_budget_periods_budget_date
  ON budget_periods(budget_id, start_date, end_date);

-- Active budgets for household
CREATE INDEX IF NOT EXISTS idx_budgets_household_active
  ON budgets(household_id)
  WHERE is_active = TRUE;

-- ============================================================================
-- SPLITS + TAGS
-- ============================================================================

-- Transaction splits ordering
CREATE INDEX IF NOT EXISTS idx_transaction_splits_transaction
  ON transaction_splits(transaction_id, display_order);

-- Tag lookups
CREATE INDEX IF NOT EXISTS idx_transaction_tags_transaction
  ON transaction_tags(transaction_id);

CREATE INDEX IF NOT EXISTS idx_transaction_tags_tag
  ON transaction_tags(tag_id);

-- ============================================================================
-- HOUSEHOLD MEMBERS
-- ============================================================================

-- Quick membership lookup
CREATE INDEX IF NOT EXISTS idx_household_members_user
  ON household_members(user_id);

CREATE INDEX IF NOT EXISTS idx_household_members_household
  ON household_members(household_id);

-- ============================================================================
-- AUDIT LOGS
-- ============================================================================

-- Audit trail queries
CREATE INDEX IF NOT EXISTS idx_audit_logs_household_created
  ON audit_logs(household_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_logs_entity
  ON audit_logs(entity_type, entity_id);
