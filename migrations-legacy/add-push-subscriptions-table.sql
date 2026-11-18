-- Add user_push_subscriptions table for Web Push notifications
-- This table stores push notification subscriptions for users

CREATE TABLE IF NOT EXISTS user_push_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL UNIQUE,
  keys JSONB NOT NULL, -- { p256dh: string, auth: string }
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Index for faster lookups by user_id
CREATE INDEX IF NOT EXISTS idx_user_push_subscriptions_user_id
  ON user_push_subscriptions(user_id);

-- Index for faster lookups by endpoint (already unique, but helpful for queries)
CREATE INDEX IF NOT EXISTS idx_user_push_subscriptions_endpoint
  ON user_push_subscriptions(endpoint);

-- Trigger to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_user_push_subscriptions_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_user_push_subscriptions_updated_at
  BEFORE UPDATE ON user_push_subscriptions
  FOR EACH ROW
  EXECUTE FUNCTION update_user_push_subscriptions_updated_at();
