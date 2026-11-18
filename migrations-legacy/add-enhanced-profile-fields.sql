-- Add multiple phone number fields
ALTER TABLE users ADD COLUMN IF NOT EXISTS phone_number_mobile TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS phone_number_work TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS phone_number_home TEXT;

-- Migrate existing phone_number to phone_number_mobile
UPDATE users SET phone_number_mobile = phone_number WHERE phone_number IS NOT NULL AND phone_number_mobile IS NULL;

-- Add salary range (encrypted)
ALTER TABLE users ADD COLUMN IF NOT EXISTS salary_range_encrypted TEXT;

-- Add birthday privacy flag
ALTER TABLE users ADD COLUMN IF NOT EXISTS birthday_hide_year BOOLEAN DEFAULT FALSE;

-- Add custom occupation flag
ALTER TABLE users ADD COLUMN IF NOT EXISTS occupation_custom BOOLEAN DEFAULT FALSE;

-- Add profile completeness cache
ALTER TABLE users ADD COLUMN IF NOT EXISTS profile_completeness INTEGER DEFAULT 0;

-- Add company field for LinkedIn import
ALTER TABLE users ADD COLUMN IF NOT EXISTS company VARCHAR(255);
