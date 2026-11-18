-- Add unique index to ensure only one flex budget per household
-- This prevents duplicate flex budgets which could cause calculation issues
CREATE UNIQUE INDEX IF NOT EXISTS idx_budgets_flex_unique
ON budgets(household_id) WHERE is_flex_bucket = true;
