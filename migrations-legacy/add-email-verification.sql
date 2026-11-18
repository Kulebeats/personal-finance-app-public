-- Add email verification columns to users table
-- Run this SQL in your database to add the necessary columns for the Security section

ALTER TABLE users 
ADD COLUMN IF NOT EXISTS email_verified BOOLEAN DEFAULT FALSE;

ALTER TABLE users 
ADD COLUMN IF NOT EXISTS email_verification_token TEXT;

ALTER TABLE users 
ADD COLUMN IF NOT EXISTS email_verification_expiry TIMESTAMP;

ALTER TABLE users 
ADD COLUMN IF NOT EXISTS pending_email VARCHAR(255);
