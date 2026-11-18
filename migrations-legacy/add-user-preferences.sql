-- Migration: Add user_preferences table
-- Description: User-level preferences for transaction entry defaults, import behavior, and receipt handling

CREATE TABLE IF NOT EXISTS user_preferences (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  
  -- Transaction entry defaults
  remember_last_account BOOLEAN DEFAULT TRUE,
  remember_last_category_per_merchant BOOLEAN DEFAULT TRUE,
  default_transaction_type VARCHAR(20) DEFAULT 'expense',
  auto_fill_today_date BOOLEAN DEFAULT TRUE,
  
  -- Import behavior  
  skip_duplicate_imports BOOLEAN DEFAULT TRUE,
  auto_assign_categories_from_rules BOOLEAN DEFAULT TRUE,
  
  -- Receipt handling
  auto_create_from_receipt BOOLEAN DEFAULT FALSE,
  require_ocr_review BOOLEAN DEFAULT TRUE,
  ocr_confidence_threshold INTEGER DEFAULT 70,
  
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create index on user_id for faster lookups (though it's a primary key, explicit for clarity)
-- No additional indexes needed as this is a 1:1 relationship with users

COMMENT ON TABLE user_preferences IS 'User-level preferences for transaction workflow and data entry';
COMMENT ON COLUMN user_preferences.remember_last_account IS 'Auto-select the last used account when adding transactions';
COMMENT ON COLUMN user_preferences.remember_last_category_per_merchant IS 'Remember and suggest categories based on merchant history';
COMMENT ON COLUMN user_preferences.default_transaction_type IS 'Default type (expense/income/transfer) for new transactions';
COMMENT ON COLUMN user_preferences.auto_fill_today_date IS 'Automatically set transaction date to today';
COMMENT ON COLUMN user_preferences.skip_duplicate_imports IS 'Skip transactions with matching date+amount during imports';
COMMENT ON COLUMN user_preferences.auto_assign_categories_from_rules IS 'Apply category rules during CSV/receipt imports';
COMMENT ON COLUMN user_preferences.auto_create_from_receipt IS 'Automatically create transaction when receipt is scanned';
COMMENT ON COLUMN user_preferences.require_ocr_review IS 'Require manual confirmation of OCR data before saving';
COMMENT ON COLUMN user_preferences.ocr_confidence_threshold IS 'Minimum OCR confidence percentage (50-95) to accept scanned data';
