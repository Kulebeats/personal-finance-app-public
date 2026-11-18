-- Add visibility control fields to accounts table for Monarch Money parity
-- excludeFromNetWorth: Exclude account balance from net worth calculations
-- hideTransactions: Hide transactions from cash flow and budget calculations

ALTER TABLE accounts
ADD COLUMN IF NOT EXISTS exclude_from_net_worth BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE accounts
ADD COLUMN IF NOT EXISTS hide_transactions BOOLEAN NOT NULL DEFAULT FALSE;

-- Add comment for documentation
COMMENT ON COLUMN accounts.exclude_from_net_worth IS 'When true, excludes this account balance from net worth and account group totals';
COMMENT ON COLUMN accounts.hide_transactions IS 'When true, excludes transactions from cash flow and budget calculations';
