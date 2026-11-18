-- Add index for split transaction queries in budget calculations
-- This improves performance when calculating budget spend with splits
CREATE INDEX IF NOT EXISTS idx_transaction_splits_category
ON transaction_splits(category_id, transaction_id);
