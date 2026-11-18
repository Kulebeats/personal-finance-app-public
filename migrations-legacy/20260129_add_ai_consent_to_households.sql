-- Migration: Add AI consent fields to households table
-- Date: 2026-01-29
-- Issue: AI-DATA-001 (P0), AI-AUDIT-001 (P1), AI-RATE-001 (P1), AI-ARCH-001 (P2)
-- Description: Add fields for tracking household AI assistant consent per Zambia DPA

-- Add AI consent fields to households table
ALTER TABLE households
ADD COLUMN IF NOT EXISTS ai_consent_given BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS ai_consent_date TIMESTAMP,
ADD COLUMN IF NOT EXISTS ai_consent_version VARCHAR(10) DEFAULT 'v1.0';

-- Update existing households to require explicit consent
UPDATE households SET ai_consent_given = FALSE WHERE ai_consent_given IS NULL;

-- Add comment for documentation
COMMENT ON COLUMN households.ai_consent_given IS 'Whether household has given consent for AI assistant data processing (Zambia DPA compliance)';
COMMENT ON COLUMN households.ai_consent_date IS 'Timestamp when AI consent was given or revoked';
COMMENT ON COLUMN households.ai_consent_version IS 'Version of AI consent terms accepted (for re-consent on version upgrade)';
