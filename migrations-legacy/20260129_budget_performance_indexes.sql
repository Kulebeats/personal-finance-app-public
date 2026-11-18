-- Migration: Budget Performance Indexes (BUDGET-PERF-001)
-- Created: 2026-01-29
-- Description: Optimize budget-related queries with targeted indexes

-- BUDGET-PERF-001: Composite index for budget period lookups
-- This supports queries that filter by budget_id and date range
CREATE INDEX IF NOT EXISTS idx_budget_periods_budget_date_range
ON budget_periods(budget_id, start_date, end_date)
WHERE budget_id IS NOT NULL;

-- BUDGET-PERF-001: Index for budget active status queries
-- Supports queries that filter by household and active status
CREATE INDEX IF NOT EXISTS idx_budgets_household_active_status
ON budgets(household_id, is_active)
WHERE is_active = true;

-- BUDGET-PERF-001: Index for category-based budget lookups
CREATE INDEX IF NOT EXISTS idx_budgets_category_id
ON budgets(category_id)
WHERE category_id IS NOT NULL;

-- BUDGET-PERF-001: Index for category group-based budget lookups
CREATE INDEX IF NOT EXISTS idx_budgets_category_group_id
ON budgets(category_group_id)
WHERE category_group_id IS NOT NULL;

-- BUDGET-PERF-001: Index for flex bucket queries
CREATE INDEX IF NOT EXISTS idx_budgets_flex_bucket
ON budgets(household_id, is_flex_bucket)
WHERE is_flex_bucket = true;

-- BUDGET-PERF-001: Covering index for budget period date range queries
-- This index can satisfy queries without going back to the table
CREATE INDEX IF NOT EXISTS idx_budget_periods_covering
ON budget_periods(budget_id, start_date, end_date, budget_amount, spent_amount, rollover_in, version);

-- BUDGET-PERF-001: Index for budget period date range scans
-- Supports queries that need to find all periods within a date range
CREATE INDEX IF NOT EXISTS idx_budget_periods_date_range
ON budget_periods(start_date, end_date)
INCLUDE (budget_id, budget_amount, spent_amount);

-- BUDGET-PERF-001: Add statistics for query planner
-- This helps PostgreSQL choose better query plans
ANALYZE budgets;
ANALYZE budget_periods;

-- Verify indexes were created
DO $$
DECLARE
    index_count integer;
BEGIN
    SELECT COUNT(*) INTO index_count
    FROM pg_indexes
    WHERE schemaname = 'public'
        AND tablename IN ('budgets', 'budget_periods')
        AND indexname LIKE 'idx_budget%';

    IF index_count >= 7 THEN
        RAISE NOTICE 'Budget performance indexes created successfully (% indexes)', index_count;
    ELSE
        RAISE WARNING 'Expected at least 7 budget indexes, found %', index_count;
    END IF;
END $$;

-- Performance recommendations logged
DO $$
BEGIN
    RAISE NOTICE 'BUDGET-PERF-001: Performance optimizations applied';
    RAISE NOTICE '1. Composite indexes for common query patterns';
    RAISE NOTICE '2. Partial indexes to reduce index size';
    RAISE NOTICE '3. Covering indexes to avoid table lookups';
    RAISE NOTICE '4. Statistics updated for better query plans';
END $$;
