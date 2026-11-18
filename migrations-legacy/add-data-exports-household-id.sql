-- Add household_id to data_exports for report export scoping
-- Safe to run on existing databases

ALTER TABLE data_exports
  ADD COLUMN IF NOT EXISTS household_id UUID REFERENCES households(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_data_exports_household_id
  ON data_exports(household_id);

CREATE INDEX IF NOT EXISTS idx_data_exports_user_household
  ON data_exports(user_id, household_id);

SELECT 'Migration complete. data_exports household_id added.' AS status;
