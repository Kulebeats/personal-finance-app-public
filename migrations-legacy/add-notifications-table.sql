-- Migration: Add notifications table
-- Created: 2026-01-02
-- Description: Adds the notifications table for in-app and email notification storage

CREATE TABLE IF NOT EXISTS notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  household_id UUID REFERENCES households(id) ON DELETE SET NULL,
  type VARCHAR(50) NOT NULL,
  title VARCHAR(255) NOT NULL,
  body TEXT NOT NULL,
  action_url VARCHAR(255),
  metadata JSONB,
  dedupe_key VARCHAR(150),
  is_read BOOLEAN NOT NULL DEFAULT FALSE,
  is_archived BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Index for fetching unread notifications for a user (most common query)
CREATE INDEX IF NOT EXISTS idx_notifications_user_unread 
  ON notifications(user_id, is_read, created_at DESC);

-- Index for fetching all notifications for a user
CREATE INDEX IF NOT EXISTS idx_notifications_user_created 
  ON notifications(user_id, created_at DESC);

-- Unique partial index for deduplication (only when dedupe_key is set)
CREATE UNIQUE INDEX IF NOT EXISTS idx_notifications_dedupe 
  ON notifications(user_id, dedupe_key) 
  WHERE dedupe_key IS NOT NULL;

-- Comment on table
COMMENT ON TABLE notifications IS 'Stores in-app notifications for users. Used for bell icon dropdown and notification history.';
COMMENT ON COLUMN notifications.dedupe_key IS 'Unique key to prevent duplicate notifications for the same event. Format varies by type (e.g., large_transaction:{txId}, budget:{budgetId}:{month}:{level})';
