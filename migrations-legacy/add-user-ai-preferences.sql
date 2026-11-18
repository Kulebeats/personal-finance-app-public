-- Migration: Add user_ai_preferences table
-- Description: User AI feature preferences (placeholder for future AI functionality)

CREATE TABLE IF NOT EXISTS user_ai_preferences (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  
  -- AI feature toggles
  allow_data_training BOOLEAN DEFAULT TRUE,
  ai_insights_enabled BOOLEAN DEFAULT TRUE,
  ai_category_suggestions BOOLEAN DEFAULT TRUE,
  
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create trigger to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_user_ai_preferences_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_user_ai_preferences_updated_at
  BEFORE UPDATE ON user_ai_preferences
  FOR EACH ROW
  EXECUTE FUNCTION update_user_ai_preferences_updated_at();

COMMENT ON TABLE user_ai_preferences IS 'User preferences for AI-powered features (placeholder for future functionality)';
COMMENT ON COLUMN user_ai_preferences.allow_data_training IS 'Allow anonymized data to be used for AI model training';
COMMENT ON COLUMN user_ai_preferences.ai_insights_enabled IS 'Enable AI-powered spending insights and analysis';
COMMENT ON COLUMN user_ai_preferences.ai_category_suggestions IS 'Enable AI-powered category suggestions for transactions';
