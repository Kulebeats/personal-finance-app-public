-- Create merchant merge history table for undo support
-- Safe to run on existing databases

CREATE TABLE IF NOT EXISTS merchant_merge_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_merchant_id UUID NOT NULL,
  source_merchant_name VARCHAR(255) NOT NULL,
  target_merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  merged_transaction_ids JSONB,
  merged_by UUID REFERENCES users(id),
  merged_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  can_undo BOOLEAN DEFAULT true,
  undo_expires_at TIMESTAMP DEFAULT (CURRENT_TIMESTAMP + INTERVAL '30 days')
);

CREATE INDEX IF NOT EXISTS idx_merchant_merge_history_target
  ON merchant_merge_history(target_merchant_id);

CREATE INDEX IF NOT EXISTS idx_merchant_merge_history_can_undo
  ON merchant_merge_history(can_undo, undo_expires_at);

SELECT 'Migration complete. Merchant merge history table created.' AS status;
