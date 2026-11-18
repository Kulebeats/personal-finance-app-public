-- Add indexes for security_prices table for improved query performance
-- This table is queried frequently for historical price lookups

-- Primary query pattern: get prices for a security ordered by date
CREATE INDEX IF NOT EXISTS idx_security_prices_security_date
  ON security_prices(security_id, date DESC);

-- Unique constraint: one price per security per date
CREATE UNIQUE INDEX IF NOT EXISTS uniq_security_prices_security_date
  ON security_prices(security_id, date);

-- Investment transactions by household and date
CREATE INDEX IF NOT EXISTS idx_investment_transactions_household_date
  ON investment_transactions(household_id, transaction_date DESC);

-- Investment transactions by holding
CREATE INDEX IF NOT EXISTS idx_investment_transactions_holding
  ON investment_transactions(holding_id, transaction_date DESC)
  WHERE holding_id IS NOT NULL;

-- Holdings by household
CREATE INDEX IF NOT EXISTS idx_holdings_household
  ON holdings(household_id);

-- Holdings by account
CREATE INDEX IF NOT EXISTS idx_holdings_account
  ON holdings(account_id)
  WHERE account_id IS NOT NULL;

-- Tax lots by holding
CREATE INDEX IF NOT EXISTS idx_tax_lots_holding
  ON tax_lots(holding_id);

-- GRZ Bonds by household
CREATE INDEX IF NOT EXISTS idx_grz_bonds_household
  ON grz_bonds(household_id);

-- GRZ T-Bills by household
CREATE INDEX IF NOT EXISTS idx_grz_tbills_household
  ON grz_tbills(household_id);
