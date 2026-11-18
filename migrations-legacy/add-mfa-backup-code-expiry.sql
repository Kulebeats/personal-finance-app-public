-- SEC-06: MFA Backup Code Expiry
-- Adds timestamp tracking for backup code generation to enable 90-day expiry

-- Add column to track when backup codes were generated
ALTER TABLE users ADD COLUMN IF NOT EXISTS mfa_backup_codes_generated_at TIMESTAMP;

-- For existing users with backup codes, set generated_at to now (codes will start expiring in 90 days)
UPDATE users 
SET mfa_backup_codes_generated_at = NOW() 
WHERE mfa_backup_codes IS NOT NULL 
  AND jsonb_array_length(mfa_backup_codes) > 0
  AND mfa_backup_codes_generated_at IS NULL;

-- Add index for efficient expiry queries
CREATE INDEX IF NOT EXISTS idx_users_backup_codes_expiry 
ON users (mfa_backup_codes_generated_at) 
WHERE mfa_enabled = true AND mfa_backup_codes IS NOT NULL;

-- Comment for documentation
COMMENT ON COLUMN users.mfa_backup_codes_generated_at IS 'Timestamp when backup codes were generated. Codes expire 90 days after this date.';
