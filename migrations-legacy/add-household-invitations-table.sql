-- Migration: Add/update household invitations table
-- Created: 2026-01-28
-- Description: Creates or updates household_invitations table for member invitation system

-- Drop the old table if it exists with the old schema
DROP TABLE IF EXISTS household_invitations CASCADE;

-- Create the household_invitations table with the new schema
CREATE TABLE IF NOT EXISTS household_invitations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id UUID NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  email VARCHAR(255) NOT NULL,
  role household_role NOT NULL DEFAULT 'member',
  invite_code VARCHAR(64) NOT NULL UNIQUE,
  invited_by UUID NOT NULL REFERENCES users(id),
  expires_at TIMESTAMP NOT NULL,
  accepted_at TIMESTAMP,
  accepted_by UUID REFERENCES users(id),
  created_at TIMESTAMP DEFAULT NOW()
);

-- Index for looking up invitations by code (most common lookup)
CREATE INDEX IF NOT EXISTS idx_household_invitations_code
  ON household_invitations(invite_code);

-- Index for fetching pending invitations by household
CREATE INDEX IF NOT EXISTS idx_household_invitations_household_pending
  ON household_invitations(household_id, accepted_at)
  WHERE accepted_at IS NULL;

-- Index for fetching invitations by email (for checking if already invited)
CREATE INDEX IF NOT EXISTS idx_household_invitations_email
  ON household_invitations(email, household_id)
  WHERE accepted_at IS NULL;

-- Comments
COMMENT ON TABLE household_invitations IS 'Stores pending household invitations. Invitations expire after 7 days.';
COMMENT ON COLUMN household_invitations.invite_code IS 'Secure random invite code (64 hex chars from crypto.randomBytes(32))';
COMMENT ON COLUMN household_invitations.role IS 'Role the invited user will have when they accept (admin, member, view_only)';
COMMENT ON COLUMN household_invitations.accepted_by IS 'User ID of the user who accepted the invitation (may differ from email if logged into different account)';
