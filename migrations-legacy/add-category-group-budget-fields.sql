-- Add category group and category budget fields
-- Safe to run on existing databases

ALTER TABLE category_groups
  ADD COLUMN IF NOT EXISTS budget_mode VARCHAR(20) DEFAULT 'by_category' NOT NULL;

ALTER TABLE category_groups
  ADD COLUMN IF NOT EXISTS rollover_enabled BOOLEAN DEFAULT false NOT NULL;

ALTER TABLE category_groups
  ADD COLUMN IF NOT EXISTS is_archived BOOLEAN DEFAULT false NOT NULL;

ALTER TABLE categories
  ADD COLUMN IF NOT EXISTS rollover_enabled BOOLEAN DEFAULT false;

ALTER TABLE categories
  ADD COLUMN IF NOT EXISTS rollover_start_balance NUMERIC(15, 2);

SELECT 'Migration complete. Category group and category fields added.' AS status;
