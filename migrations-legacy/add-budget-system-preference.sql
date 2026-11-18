ALTER TABLE household_preferences
ADD COLUMN IF NOT EXISTS budget_system varchar(20) NOT NULL DEFAULT 'flex';
