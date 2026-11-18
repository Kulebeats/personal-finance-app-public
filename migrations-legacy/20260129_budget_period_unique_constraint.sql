-- Migration: Add unique constraint for budget periods (BUDGET-RACE-001)
-- Created: 2026-01-29
-- Description: Prevent duplicate budget periods for the same budget and date range

-- Add unique constraint on (budget_id, start_date, end_date) if it doesn't exist
DO $$
BEGIN
    -- Check if constraint already exists
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'budget_periods_budget_id_start_date_end_date_unique'
    ) THEN
        -- Add the unique constraint
        ALTER TABLE budget_periods
        ADD CONSTRAINT budget_periods_budget_id_start_date_end_date_unique
        UNIQUE (budget_id, start_date, end_date);

        RAISE NOTICE 'Unique constraint added successfully';
    ELSE
        RAISE NOTICE 'Unique constraint already exists';
    END IF;
END $$;

-- Create index to support the constraint and improve query performance
CREATE INDEX IF NOT EXISTS idx_budget_periods_lookup
ON budget_periods(budget_id, start_date, end_date);

-- Verify constraint exists
DO $$
DECLARE
    constraint_count integer;
BEGIN
    SELECT COUNT(*) INTO constraint_count
    FROM pg_constraint
    WHERE conname = 'budget_periods_budget_id_start_date_end_date_unique'
        AND contype = 'u';

    IF constraint_count = 1 THEN
        RAISE NOTICE 'Verification passed: unique constraint exists';
    ELSE
        RAISE EXCEPTION 'Verification failed: unique constraint not found';
    END IF;
END $$;
