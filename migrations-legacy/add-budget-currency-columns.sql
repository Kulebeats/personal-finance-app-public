-- Add currency column to budgets table (DB-002)
-- Enables multi-currency budget support
ALTER TABLE budgets
ADD COLUMN IF NOT EXISTS currency VARCHAR(3) NOT NULL DEFAULT 'ZMW';

-- Add currency column to budget_periods table (DB-003)
-- Ensures period-level currency tracking
ALTER TABLE budget_periods
ADD COLUMN IF NOT EXISTS currency VARCHAR(3) NOT NULL DEFAULT 'ZMW';

-- Backfill currency from household (DB-005)
-- Sets budget currency to match household currency
UPDATE budgets b
SET currency = h.currency
FROM households h
WHERE b.household_id = h.id
  AND b.currency = 'ZMW'
  AND h.currency != 'ZMW';

-- Backfill budget_periods currency from budget
UPDATE budget_periods bp
SET currency = b.currency
FROM budgets b
WHERE bp.budget_id = b.id
  AND bp.currency = 'ZMW'
  AND b.currency != 'ZMW';
