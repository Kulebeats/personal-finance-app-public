-- Migration: Add recurring transaction enhancements
-- Created: 2026-01-02
-- Description: Adds recurring transaction fields plus link/history tables

-- Add custom frequency to enum
DO $$
BEGIN
  ALTER TYPE recurring_frequency ADD VALUE IF NOT EXISTS 'custom';
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- Add new columns to recurring_transactions
ALTER TABLE recurring_transactions
  ADD COLUMN IF NOT EXISTS amount_type VARCHAR(10) DEFAULT 'fixed',
  ADD COLUMN IF NOT EXISTS amount_tolerance INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS interval_value INTEGER DEFAULT 1,
  ADD COLUMN IF NOT EXISTS interval_unit VARCHAR(10),
  ADD COLUMN IF NOT EXISTS total_occurrences INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS missed_count INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_occurred_date DATE,
  ADD COLUMN IF NOT EXISTS detection_method VARCHAR(20) DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS detection_confidence INTEGER,
  ADD COLUMN IF NOT EXISTS reminder_email BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS reminder_push BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS reminder_in_app BOOLEAN DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS auto_link_enabled BOOLEAN DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS auto_mark_reviewed BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS is_subscription BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS trial_end_date DATE;

-- Create recurring_transaction_links table
CREATE TABLE IF NOT EXISTS recurring_transaction_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recurring_transaction_id UUID NOT NULL REFERENCES recurring_transactions(id) ON DELETE CASCADE,
  transaction_id UUID NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  match_confidence INTEGER,
  match_method VARCHAR(20) DEFAULT 'manual',
  expected_date DATE,
  actual_date DATE,
  expected_amount NUMERIC(15, 2),
  actual_amount NUMERIC(15, 2),
  status VARCHAR(20) DEFAULT 'linked',
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE (transaction_id, recurring_transaction_id)
);

CREATE INDEX IF NOT EXISTS idx_recurring_links_transaction
  ON recurring_transaction_links(transaction_id);

CREATE INDEX IF NOT EXISTS idx_recurring_links_recurring
  ON recurring_transaction_links(recurring_transaction_id);

-- Create recurring_transaction_history table
CREATE TABLE IF NOT EXISTS recurring_transaction_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recurring_transaction_id UUID NOT NULL REFERENCES recurring_transactions(id) ON DELETE CASCADE,
  action VARCHAR(30) NOT NULL,
  previous_state JSONB,
  new_state JSONB,
  change_reason TEXT,
  performed_by UUID REFERENCES users(id) ON DELETE SET NULL,
  linked_transaction_id UUID REFERENCES transactions(id) ON DELETE SET NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_recurring_history_recurring
  ON recurring_transaction_history(recurring_transaction_id);

CREATE INDEX IF NOT EXISTS idx_recurring_history_created
  ON recurring_transaction_history(recurring_transaction_id, created_at DESC);
