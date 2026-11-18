ALTER TABLE budgets
ADD COLUMN IF NOT EXISTS is_flex_bucket boolean NOT NULL DEFAULT false;
