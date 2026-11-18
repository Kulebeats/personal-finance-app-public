-- Migration: Add transaction_attachments table
-- Date: 2025-12-19

CREATE TABLE IF NOT EXISTS transaction_attachments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id UUID NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  filename VARCHAR(255) NOT NULL,
  original_filename VARCHAR(255) NOT NULL,
  mime_type VARCHAR(100) NOT NULL,
  size INTEGER NOT NULL,
  storage_path VARCHAR(500) NOT NULL,
  uploaded_by UUID REFERENCES users(id),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
);

-- Index for efficient lookup by transaction
CREATE INDEX IF NOT EXISTS idx_transaction_attachments_transaction_id 
  ON transaction_attachments(transaction_id);

-- Index for cleanup queries by upload date
CREATE INDEX IF NOT EXISTS idx_transaction_attachments_created_at 
  ON transaction_attachments(created_at);
