-- Add merchant fields for categorization and metadata
-- Safe to run on existing databases

ALTER TABLE merchants
  ADD COLUMN IF NOT EXISTS category VARCHAR(100);

ALTER TABLE merchants
  ADD COLUMN IF NOT EXISTS default_category_id UUID REFERENCES categories(id);

ALTER TABLE merchants
  ADD COLUMN IF NOT EXISTS notes TEXT;

ALTER TABLE merchants
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true;

ALTER TABLE merchants
  ADD COLUMN IF NOT EXISTS icon_type VARCHAR(20) DEFAULT 'logo';

ALTER TABLE merchants
  ADD COLUMN IF NOT EXISTS custom_icon TEXT;

CREATE INDEX IF NOT EXISTS idx_merchants_category ON merchants(category);
CREATE INDEX IF NOT EXISTS idx_merchants_default_category ON merchants(default_category_id);
CREATE INDEX IF NOT EXISTS idx_merchants_household_active ON merchants(household_id, is_active);

SELECT 'Migration complete. Merchant fields added.' AS status;
