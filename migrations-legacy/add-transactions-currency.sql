-- Migration: Add currency column to transactions
-- This migration adds an optional currency column for multi-currency support
-- The column defaults to NULL but can be populated with ISO 4217 codes

-- Add the currency column
ALTER TABLE transactions 
ADD COLUMN IF NOT EXISTS currency VARCHAR(3);

-- Optionally backfill with household currency (run manually if needed)
-- UPDATE transactions t
-- SET currency = h.currency
-- FROM accounts a
-- JOIN households h ON a.household_id = h.id
-- WHERE t.account_id = a.id AND t.currency IS NULL;

-- Create index for currency-based queries
CREATE INDEX IF NOT EXISTS idx_transactions_currency ON transactions(currency);
