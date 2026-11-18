-- Migration: Ensure budget_periods cascade on budget deletion (BUDGET-DATA-001)
-- Created: 2026-01-29
-- Description: Verify and fix cascade delete behavior for budget_periods when parent budget is deleted

-- Check existing constraint
DO $$
DECLARE
    constraint_exists boolean;
BEGIN
    -- Check if the foreign key constraint exists with ON DELETE CASCADE
    SELECT EXISTS (
        SELECT 1
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu
            ON tc.constraint_name = kcu.constraint_name
        JOIN information_schema.referential_constraints rc
            ON tc.constraint_name = rc.constraint_name
        WHERE tc.table_name = 'budget_periods'
            AND tc.constraint_type = 'FOREIGN KEY'
            AND kcu.column_name = 'budget_id'
            AND rc.delete_rule = 'CASCADE'
    ) INTO constraint_exists;

    IF NOT constraint_exists THEN
        -- Drop existing constraint if it exists without cascade
        EXECUTE 'ALTER TABLE budget_periods DROP CONSTRAINT IF EXISTS budget_periods_budget_id_budgets_id_fk';

        -- Add constraint with CASCADE
        EXECUTE 'ALTER TABLE budget_periods
                 ADD CONSTRAINT budget_periods_budget_id_budgets_id_fk
                 FOREIGN KEY (budget_id)
                 REFERENCES budgets(id)
                 ON DELETE CASCADE';

        RAISE NOTICE 'Budget cascade constraint added successfully';
    ELSE
        RAISE NOTICE 'Budget cascade constraint already exists';
    END IF;
END $$;

-- Add index on budget_id if it doesn't exist for performance
CREATE INDEX IF NOT EXISTS idx_budget_periods_budget_id
ON budget_periods(budget_id);

-- Verify constraint
DO $$
DECLARE
    constraint_check text;
BEGIN
    SELECT rc.delete_rule INTO constraint_check
    FROM information_schema.table_constraints tc
    JOIN information_schema.referential_constraints rc
        ON tc.constraint_name = rc.constraint_name
    WHERE tc.table_name = 'budget_periods'
        AND tc.constraint_type = 'FOREIGN KEY'
        AND tc.constraint_name = 'budget_periods_budget_id_budgets_id_fk';

    IF constraint_check = 'CASCADE' THEN
        RAISE NOTICE 'Verification passed: budget_periods will cascade on budget deletion';
    ELSE
        RAISE EXCEPTION 'Verification failed: cascade constraint not properly set';
    END IF;
END $$;
