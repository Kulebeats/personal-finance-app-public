-- Migration: Add Goals 3.0 schema
-- Created: 2026-01-03
-- Description: Adds Goals 3.0 columns, tables, and migrates existing goals

-- Enum types
DO $$
BEGIN
  CREATE TYPE goal_type_enum AS ENUM ('save_up', 'pay_down');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE goal_status_enum AS ENUM ('on_track', 'behind', 'at_risk', 'completed');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE payoff_method_enum AS ENUM ('avalanche', 'snowball', 'custom');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE assignment_type_enum AS ENUM ('full_balance', 'partial_balance');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE link_type_enum AS ENUM ('contribution', 'spending');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- Extend goals table
ALTER TABLE goals
  ADD COLUMN IF NOT EXISTS type goal_type_enum DEFAULT 'save_up' NOT NULL,
  ADD COLUMN IF NOT EXISTS goal_type VARCHAR(50),
  ADD COLUMN IF NOT EXISTS status goal_status_enum DEFAULT 'on_track',
  ADD COLUMN IF NOT EXISTS monthly_projection NUMERIC(15, 2),
  ADD COLUMN IF NOT EXISTS projected_completion_date DATE,
  ADD COLUMN IF NOT EXISTS spending_reduces_progress BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS debt_account_id UUID REFERENCES accounts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS original_balance NUMERIC(15, 2),
  ADD COLUMN IF NOT EXISTS interest_rate NUMERIC(5, 2),
  ADD COLUMN IF NOT EXISTS minimum_payment NUMERIC(15, 2),
  ADD COLUMN IF NOT EXISTS monthly_payment NUMERIC(15, 2),
  ADD COLUMN IF NOT EXISTS one_time_payment NUMERIC(15, 2),
  ADD COLUMN IF NOT EXISTS payoff_method payoff_method_enum,
  ADD COLUMN IF NOT EXISTS custom_image_url TEXT,
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS priority INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS notes TEXT;

ALTER TABLE goals
  ADD CONSTRAINT chk_goal_type CHECK (type IN ('save_up', 'pay_down'));

ALTER TABLE goals
  ADD CONSTRAINT chk_goal_status CHECK (status IN ('on_track', 'behind', 'at_risk', 'completed'));

ALTER TABLE goals
  ADD CONSTRAINT chk_payoff_method CHECK (payoff_method IN ('avalanche', 'snowball', 'custom'));

CREATE INDEX IF NOT EXISTS idx_goals_type ON goals(household_id, type);
CREATE INDEX IF NOT EXISTS idx_goals_status ON goals(household_id, status);
CREATE INDEX IF NOT EXISTS idx_goals_debt_account ON goals(debt_account_id) WHERE debt_account_id IS NOT NULL;

-- Goal account assignments
CREATE TABLE IF NOT EXISTS goal_account_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  goal_id UUID NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  assignment_type assignment_type_enum NOT NULL,
  partial_amount NUMERIC(15, 2),
  auto_update BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  CONSTRAINT uq_goal_account UNIQUE(goal_id, account_id),
  CONSTRAINT chk_partial_no_auto CHECK (
    assignment_type = 'full_balance' OR auto_update = FALSE
  )
);

CREATE INDEX IF NOT EXISTS idx_goal_account_assignments_goal
  ON goal_account_assignments(goal_id);
CREATE INDEX IF NOT EXISTS idx_goal_account_assignments_account
  ON goal_account_assignments(account_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_goal_account_full_balance
  ON goal_account_assignments(account_id)
  WHERE assignment_type = 'full_balance';

-- Goal transfers
CREATE TABLE IF NOT EXISTS goal_transfers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id UUID NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  from_goal_id UUID NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
  to_goal_id UUID NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
  amount NUMERIC(15, 2) NOT NULL,
  reason TEXT,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  CONSTRAINT chk_different_goals CHECK (from_goal_id != to_goal_id),
  CONSTRAINT chk_positive_amount CHECK (amount > 0)
);

CREATE INDEX IF NOT EXISTS idx_goal_transfers_household ON goal_transfers(household_id);
CREATE INDEX IF NOT EXISTS idx_goal_transfers_from ON goal_transfers(from_goal_id);
CREATE INDEX IF NOT EXISTS idx_goal_transfers_to ON goal_transfers(to_goal_id);
CREATE INDEX IF NOT EXISTS idx_goal_transfers_date ON goal_transfers(created_at);

-- Transaction goal links
CREATE TABLE IF NOT EXISTS transaction_goal_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id UUID NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  goal_id UUID NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
  amount NUMERIC(15, 2) NOT NULL,
  link_type link_type_enum DEFAULT 'contribution',
  linked_at TIMESTAMP DEFAULT NOW(),
  linked_by UUID REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT uq_transaction_goal UNIQUE(transaction_id, goal_id)
);

CREATE INDEX IF NOT EXISTS idx_transaction_goal_links_transaction
  ON transaction_goal_links(transaction_id);
CREATE INDEX IF NOT EXISTS idx_transaction_goal_links_goal
  ON transaction_goal_links(goal_id);

-- Goal activity log
CREATE TABLE IF NOT EXISTS goal_activity_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  goal_id UUID NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
  activity_type VARCHAR(50) NOT NULL,
  amount NUMERIC(15, 2),
  previous_balance NUMERIC(15, 2),
  new_balance NUMERIC(15, 2),
  metadata JSONB,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_goal_activity_goal ON goal_activity_log(goal_id);
CREATE INDEX IF NOT EXISTS idx_goal_activity_date ON goal_activity_log(created_at);

-- Data migration: set type for existing goals
UPDATE goals SET type = 'save_up' WHERE type IS NULL;

-- Migrate linkedAccountId to assignments with reconciliation logic
INSERT INTO goal_account_assignments (goal_id, account_id, assignment_type, partial_amount, auto_update)
SELECT
  g.id,
  g.linked_account_id,
  CASE
    WHEN ABS(CAST(g.current_amount AS NUMERIC) - CAST(a.balance AS NUMERIC)) > 1.00
    THEN 'partial_balance'
    ELSE 'full_balance'
  END,
  CASE
    WHEN ABS(CAST(g.current_amount AS NUMERIC) - CAST(a.balance AS NUMERIC)) > 1.00
    THEN g.current_amount
    ELSE NULL
  END,
  CASE
    WHEN ABS(CAST(g.current_amount AS NUMERIC) - CAST(a.balance AS NUMERIC)) > 1.00
    THEN FALSE
    ELSE TRUE
  END
FROM goals g
JOIN accounts a ON a.id = g.linked_account_id
WHERE g.linked_account_id IS NOT NULL
ON CONFLICT (goal_id, account_id) DO NOTHING;

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

-- Log migration activity
INSERT INTO goal_activity_log (goal_id, activity_type, metadata, created_at)
SELECT id, 'migrated_to_v3', jsonb_build_object(
  'previous_linked_account_id', linked_account_id,
  'migration_date', CURRENT_TIMESTAMP
), CURRENT_TIMESTAMP
FROM goals
WHERE linked_account_id IS NOT NULL;
