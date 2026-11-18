-- Create merchant logo uploads table
-- Safe to run on existing databases

CREATE TABLE IF NOT EXISTS merchant_logo_uploads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  original_filename VARCHAR(255) NOT NULL,
  stored_filename VARCHAR(255) NOT NULL,
  file_path TEXT NOT NULL,
  file_size INTEGER NOT NULL,
  mime_type VARCHAR(100) NOT NULL,
  uploaded_by UUID REFERENCES users(id) ON DELETE SET NULL,
  uploaded_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_merchant_logo_uploads_merchant
  ON merchant_logo_uploads(merchant_id);

SELECT 'Migration complete. Merchant logo uploads table created.' AS status;
