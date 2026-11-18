-- Migration: Add householdId to grz_auction_results for tenant isolation
-- FIX DATA-GRZ-001: GRZ auction results need household scoping
-- Created: 2026-01-30

-- Add householdId column (nullable initially for backward compatibility)
ALTER TABLE grz_auction_results
ADD COLUMN household_id UUID;

-- Add foreign key constraint
ALTER TABLE grz_auction_results
ADD CONSTRAINT fk_grz_auction_results_household
FOREIGN KEY (household_id) REFERENCES households(id) ON DELETE CASCADE;

-- Create index for household queries
CREATE INDEX idx_grz_auction_results_household_id
ON grz_auction_results(household_id);

-- DECISION POINT: Choose one of the following strategies:

-- OPTION A: Make household-specific (recommended for tenant isolation)
-- Uncomment the following to enforce household scoping:
-- ALTER TABLE grz_auction_results ALTER COLUMN household_id SET NOT NULL;
-- UPDATE grz_auction_results SET household_id = (SELECT id FROM households LIMIT 1) WHERE household_id IS NULL;

-- OPTION B: Keep as shared global data (current behavior)
-- Leave household_id NULL for shared market data
-- Only set household_id when member posts custom auction results

-- Migration notes:
-- 1. Existing rows will have NULL household_id (shared global data)
-- 2. New rows posted by members will have household_id set
-- 3. Queries should filter: WHERE household_id IS NULL OR household_id = $householdId
-- 4. POST endpoint should set household_id from req.householdContext
