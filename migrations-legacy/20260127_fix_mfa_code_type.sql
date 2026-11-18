-- Migration: Ensure mfa_code is TEXT
-- Created: 2026-01-27

ALTER TABLE users ALTER COLUMN mfa_code TYPE TEXT;
