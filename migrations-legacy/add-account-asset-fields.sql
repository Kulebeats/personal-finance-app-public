-- Add property/vehicle detail fields to accounts

ALTER TABLE accounts
ADD COLUMN IF NOT EXISTS estimated_value DECIMAL(15, 2);

ALTER TABLE accounts
ADD COLUMN IF NOT EXISTS purchase_date DATE;

ALTER TABLE accounts
ADD COLUMN IF NOT EXISTS address TEXT;

COMMENT ON COLUMN accounts.estimated_value IS 'Estimated value for property/vehicle accounts';
COMMENT ON COLUMN accounts.purchase_date IS 'Purchase date for property/vehicle accounts';
COMMENT ON COLUMN accounts.address IS 'Property address for real estate accounts';
