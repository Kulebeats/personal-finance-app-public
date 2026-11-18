-- Migration: Add report widget preferences for Annual Dashboard
-- Based on docs/ANNUAL_DASHBOARD_REQUIREMENTS.md Section 11

-- Add report widget preferences JSONB column to user_display_settings
ALTER TABLE user_display_settings
ADD COLUMN IF NOT EXISTS report_widget_preferences JSONB
DEFAULT '{"version":1,"aggregation":"monthly","widgets":[],"customCharts":[]}'::jsonb;

-- Add GIN index for JSONB queries
CREATE INDEX IF NOT EXISTS idx_user_display_settings_report_widgets
ON user_display_settings USING GIN (report_widget_preferences);

-- Performance indexes for financial ratios queries (Section 11.3)
CREATE INDEX IF NOT EXISTS idx_transactions_account_type_date
ON transactions(account_id, date)
WHERE deleted_at IS NULL;

-- For goals progress tracking
CREATE INDEX IF NOT EXISTS idx_goal_contributions_goal_date
ON goal_contributions(goal_id, date);

-- For debt analysis
CREATE INDEX IF NOT EXISTS idx_accounts_type_household
ON accounts(household_id, type)
WHERE deleted_at IS NULL;

-- For expense classification (stddev by category by month)
CREATE INDEX IF NOT EXISTS idx_transactions_category_month
ON transactions(category_id, date)
WHERE deleted_at IS NULL AND type = 'expense';
