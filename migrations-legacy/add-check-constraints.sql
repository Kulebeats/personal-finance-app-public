-- Migration: Add database check constraints
-- These constraints enforce data integrity at the database level

-- Transaction amount must not be zero for most types
ALTER TABLE transactions 
ADD CONSTRAINT chk_transaction_amount_nonzero 
CHECK (
  type = 'balance_adjustment' 
  OR ABS(CAST(amount AS DECIMAL)) > 0
);

-- Budget amount must be positive
ALTER TABLE budgets 
ADD CONSTRAINT chk_budget_amount_positive 
CHECK (CAST(amount AS DECIMAL) >= 0);

-- Goal target amount must be positive
ALTER TABLE goals 
ADD CONSTRAINT chk_goal_target_positive 
CHECK (CAST(target_amount AS DECIMAL) > 0);

-- Goal current amount must be non-negative
ALTER TABLE goals 
ADD CONSTRAINT chk_goal_current_nonnegative 
CHECK (CAST(current_amount AS DECIMAL) >= 0);

-- Recurring amount must be positive
ALTER TABLE recurring_transactions 
ADD CONSTRAINT chk_recurring_amount_positive 
CHECK (CAST(amount AS DECIMAL) > 0);

-- Budget thresholds must be valid percentages
ALTER TABLE budgets 
ADD CONSTRAINT chk_budget_warning_threshold 
CHECK (warning_threshold IS NULL OR (warning_threshold >= 0 AND warning_threshold <= 100));

ALTER TABLE budgets 
ADD CONSTRAINT chk_budget_alert_threshold 
CHECK (alert_threshold IS NULL OR (alert_threshold >= 0 AND alert_threshold <= 200));

-- Currency must be 3 characters (ISO 4217)
ALTER TABLE transactions 
ADD CONSTRAINT chk_transaction_currency_length 
CHECK (currency IS NULL OR LENGTH(currency) = 3);

ALTER TABLE accounts 
ADD CONSTRAINT chk_account_currency_length 
CHECK (currency IS NULL OR LENGTH(currency) = 3);

ALTER TABLE households 
ADD CONSTRAINT chk_household_currency_length 
CHECK (currency IS NULL OR LENGTH(currency) = 3);
