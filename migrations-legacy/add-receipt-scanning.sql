-- Migration: Add Receipt Scanning Support
-- Created: 2024-12-22

-- Add OCR fields to transaction_attachments
ALTER TABLE transaction_attachments
ADD COLUMN IF NOT EXISTS thumbnail_path VARCHAR(500),
ADD COLUMN IF NOT EXISTS ocr_status VARCHAR(20) DEFAULT 'none',
ADD COLUMN IF NOT EXISTS ocr_data JSONB,
ADD COLUMN IF NOT EXISTS ocr_confidence DECIMAL(5, 2),
ADD COLUMN IF NOT EXISTS ocr_processed_at TIMESTAMP,
ADD COLUMN IF NOT EXISTS ocr_error_message TEXT;

-- Create pending_receipts table
CREATE TABLE IF NOT EXISTS pending_receipts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id UUID NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  uploaded_by UUID NOT NULL REFERENCES users(id),

  -- File info
  filename VARCHAR(255) NOT NULL,
  original_filename VARCHAR(255) NOT NULL,
  mime_type VARCHAR(100) NOT NULL,
  size INTEGER NOT NULL,
  storage_path VARCHAR(500) NOT NULL,
  thumbnail_path VARCHAR(500),

  -- OCR data
  ocr_status VARCHAR(20) NOT NULL DEFAULT 'pending',
  ocr_data JSONB,
  ocr_confidence DECIMAL(5, 2),
  ocr_processed_at TIMESTAMP,
  ocr_error_message TEXT,

  -- Matching
  match_status VARCHAR(20) NOT NULL DEFAULT 'pending',
  matched_transaction_id UUID REFERENCES transactions(id),
  match_attempts INTEGER NOT NULL DEFAULT 0,
  last_match_attempt TIMESTAMP,
  next_match_at TIMESTAMP,

  -- Idempotency & Deduplication
  idempotency_key VARCHAR(255) UNIQUE,
  image_hash VARCHAR(64),

  -- Timestamps
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Indexes for efficient queries
CREATE INDEX IF NOT EXISTS pending_receipts_household_idx 
  ON pending_receipts(household_id);

CREATE INDEX IF NOT EXISTS pending_receipts_match_status_idx 
  ON pending_receipts(match_status, next_match_at);

CREATE INDEX IF NOT EXISTS pending_receipts_idempotency_idx 
  ON pending_receipts(idempotency_key) 
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS pending_receipts_image_hash_idx 
  ON pending_receipts(household_id, image_hash) 
  WHERE image_hash IS NOT NULL;

-- Add index for OCR status on transaction_attachments
CREATE INDEX IF NOT EXISTS transaction_attachments_ocr_status_idx 
  ON transaction_attachments(ocr_status) 
  WHERE ocr_status != 'none';
