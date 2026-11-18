-- Weekly Recap Feedback Table
-- Stores user feedback (thumbs up/down) for weekly recap steps

CREATE TABLE IF NOT EXISTS weekly_recap_feedback (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  household_id UUID REFERENCES households(id) ON DELETE CASCADE,
  week_start DATE NOT NULL,
  week_end DATE NOT NULL,
  step VARCHAR(20) NOT NULL CHECK (step IN ('net-worth', 'spending', 'recurring', 'overall')),
  feedback VARCHAR(10) NOT NULL CHECK (feedback IN ('positive', 'negative')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, week_start, step)
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_weekly_recap_user_week ON weekly_recap_feedback(user_id, week_start);
CREATE INDEX IF NOT EXISTS idx_weekly_recap_household ON weekly_recap_feedback(household_id);
