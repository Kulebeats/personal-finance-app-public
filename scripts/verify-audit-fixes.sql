-- Verification SQL Scripts for Audit Fixes
-- Run these queries to verify all fixes are working correctly

-- ============================================================================
-- 1. VERIFY INT-RULES-001: Transaction Splits Persistence
-- ============================================================================

-- Check if any transactions have splits
SELECT
  t.id as transaction_id,
  t.name as transaction_name,
  t.amount as total_amount,
  t.is_excluded_from_budget,
  COUNT(ts.id) as split_count,
  COALESCE(SUM(ts.amount::numeric), 0) as splits_sum
FROM transactions t
LEFT JOIN transaction_splits ts ON ts.transaction_id = t.id
WHERE t.deleted_at IS NULL
GROUP BY t.id, t.name, t.amount, t.is_excluded_from_budget
HAVING COUNT(ts.id) > 0
ORDER BY t.created_at DESC
LIMIT 10;

-- Check split details for a specific transaction
-- Replace 'TRANSACTION_ID' with actual transaction ID
/*
SELECT
  ts.id,
  ts.amount,
  ts.display_order,
  c.name as category_name,
  m.name as merchant_name,
  ts.notes
FROM transaction_splits ts
LEFT JOIN categories c ON c.id = ts.category_id
LEFT JOIN merchants m ON m.id = ts.merchant_id
WHERE ts.transaction_id = 'TRANSACTION_ID'
ORDER BY ts.display_order;
*/

-- Verify parent transactions are excluded from budget
SELECT
  t.id,
  t.name,
  t.amount,
  t.is_excluded_from_budget,
  t.is_excluded_from_reports,
  COUNT(ts.id) as split_count
FROM transactions t
INNER JOIN transaction_splits ts ON ts.transaction_id = t.id
WHERE t.deleted_at IS NULL
  AND t.is_excluded_from_budget = false
GROUP BY t.id, t.name, t.amount, t.is_excluded_from_budget, t.is_excluded_from_reports;
-- Should return 0 rows (all split parents should be excluded)

-- ============================================================================
-- 2. VERIFY DATA-GOAL-004: Duplicate Assignment Prevention
-- ============================================================================

-- Check if unique constraint exists
SELECT
  indexname,
  indexdef
FROM pg_indexes
WHERE tablename = 'goal_account_assignments'
  AND indexname = 'unique_goal_account_idx';
-- Should return 1 row with unique index definition

-- Check for any duplicate assignments (should be 0)
SELECT
  goal_id,
  account_id,
  COUNT(*) as duplicate_count
FROM goal_account_assignments
GROUP BY goal_id, account_id
HAVING COUNT(*) > 1;
-- Should return 0 rows

-- ============================================================================
-- 3. VERIFY DATA-SNAPSHOT-001: Snapshot Precision
-- ============================================================================

-- Check latest net worth snapshots
SELECT
  household_id,
  date,
  total_assets,
  total_liabilities,
  net_worth,
  currency,
  -- Check if assets_by_type contains string values (not numbers)
  jsonb_typeof(assets_by_type) as assets_type,
  -- Sample an assets_by_type value
  jsonb_typeof(assets_by_type->'checking') as checking_type,
  -- Check if accountBalances contains string balances
  jsonb_typeof((account_balances->0->>'balance')::jsonb) as balance_type
FROM net_worth_snapshots
ORDER BY date DESC, household_id
LIMIT 5;
-- assets_type and checking_type should be 'object' and 'string' respectively
-- balance_type might be null (it's already a string in JSON)

-- Verify account balance snapshots precision
SELECT
  account_id,
  date,
  balance,
  -- Check if balance is stored as string with 2 decimal places
  balance::numeric = ROUND(balance::numeric, 2) as is_precise
FROM account_balance_snapshots
ORDER BY date DESC
LIMIT 10;
-- All is_precise should be true

-- ============================================================================
-- 4. VERIFY AUTH-GOAL-ASSIGN-001: Private Account Filtering
-- ============================================================================

-- Check private accounts that are assigned to goals
SELECT
  a.id as account_id,
  a.name as account_name,
  a.is_private,
  a.owner_user_id,
  g.id as goal_id,
  g.name as goal_name,
  gaa.id as assignment_id
FROM accounts a
INNER JOIN goal_account_assignments gaa ON gaa.account_id = a.id
INNER JOIN goals g ON g.id = gaa.goal_id
WHERE a.is_private = true
ORDER BY a.name;
-- These should only be visible to the owner_user_id

-- ============================================================================
-- 5. VERIFY AUTH-GRZ-ACC-001: GRZ Account Validation
-- ============================================================================

-- Check GRZ bonds with account assignments
SELECT
  gb.id as bond_id,
  gb.bond_name,
  gb.account_id,
  a.household_id as account_household_id,
  gb.household_id as bond_household_id,
  CASE
    WHEN a.household_id = gb.household_id THEN 'MATCH'
    ELSE 'MISMATCH'
  END as household_check
FROM grz_bonds gb
LEFT JOIN accounts a ON a.id = gb.account_id
WHERE gb.account_id IS NOT NULL
ORDER BY gb.created_at DESC
LIMIT 10;
-- All household_check should be 'MATCH'

-- Check GRZ T-bills with account assignments
SELECT
  gt.id as tbill_id,
  gt.account_id,
  a.household_id as account_household_id,
  gt.household_id as tbill_household_id,
  CASE
    WHEN a.household_id = gt.household_id THEN 'MATCH'
    ELSE 'MISMATCH'
  END as household_check
FROM grz_t_bills gt
LEFT JOIN accounts a ON a.id = gt.account_id
WHERE gt.account_id IS NOT NULL
ORDER BY gt.created_at DESC
LIMIT 10;
-- All household_check should be 'MATCH'

-- ============================================================================
-- 6. VERIFY DATA-BUDGET-001: Budget Recalculation with Splits
-- ============================================================================

-- Compare budget amounts with actual transaction totals (including splits)
WITH transaction_totals AS (
  -- Regular transactions (not split parents)
  SELECT
    t.category_id,
    DATE_TRUNC('month', t.date::date) as month,
    SUM(t.amount::numeric) as total
  FROM transactions t
  WHERE t.deleted_at IS NULL
    AND t.is_excluded_from_budget = false
    AND t.type IN ('expense', 'income')
  GROUP BY t.category_id, DATE_TRUNC('month', t.date::date)

  UNION ALL

  -- Split transactions
  SELECT
    ts.category_id,
    DATE_TRUNC('month', t.date::date) as month,
    SUM(ts.amount::numeric) as total
  FROM transaction_splits ts
  INNER JOIN transactions t ON t.id = ts.transaction_id
  WHERE t.deleted_at IS NULL
    AND t.type IN ('expense', 'income')
  GROUP BY ts.category_id, DATE_TRUNC('month', t.date::date)
)
SELECT
  c.name as category_name,
  tt.month,
  COALESCE(SUM(tt.total), 0) as calculated_total,
  b.amount as budget_amount,
  CASE
    WHEN b.amount IS NULL THEN 'NO_BUDGET'
    WHEN ABS(b.amount::numeric - COALESCE(SUM(tt.total), 0)) < 0.01 THEN 'MATCH'
    ELSE 'MISMATCH'
  END as status
FROM transaction_totals tt
INNER JOIN categories c ON c.id = tt.category_id
LEFT JOIN budgets b ON b.category_id = c.id
  AND DATE_TRUNC('month', b.month::date) = tt.month
WHERE c.include_in_budget = true
GROUP BY c.name, tt.month, b.amount
ORDER BY tt.month DESC, c.name
LIMIT 20;
-- Status should be 'MATCH' or 'NO_BUDGET' (not 'MISMATCH')

-- ============================================================================
-- SUMMARY STATISTICS
-- ============================================================================

SELECT
  'Transactions with Splits' as metric,
  COUNT(DISTINCT t.id) as count
FROM transactions t
INNER JOIN transaction_splits ts ON ts.transaction_id = t.id
WHERE t.deleted_at IS NULL

UNION ALL

SELECT
  'Total Transaction Splits' as metric,
  COUNT(*) as count
FROM transaction_splits ts
INNER JOIN transactions t ON t.id = ts.transaction_id
WHERE t.deleted_at IS NULL

UNION ALL

SELECT
  'Goal Account Assignments' as metric,
  COUNT(*) as count
FROM goal_account_assignments

UNION ALL

SELECT
  'Private Accounts' as metric,
  COUNT(*) as count
FROM accounts
WHERE is_private = true

UNION ALL

SELECT
  'GRZ Bonds with Accounts' as metric,
  COUNT(*) as count
FROM grz_bonds
WHERE account_id IS NOT NULL

UNION ALL

SELECT
  'Latest Net Worth Snapshots' as metric,
  COUNT(*) as count
FROM net_worth_snapshots
WHERE date = (SELECT MAX(date) FROM net_worth_snapshots);
