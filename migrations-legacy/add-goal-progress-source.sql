DO $$
BEGIN
  CREATE TYPE goal_progress_source AS ENUM ('contributions', 'holdings');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

ALTER TABLE goals
  ADD COLUMN IF NOT EXISTS progress_source goal_progress_source NOT NULL DEFAULT 'contributions';
