/**
 * Run SQL Verification Queries
 *
 * Alternative to psql for running verification queries
 */

import { db } from "../server/db";
import { sql } from "drizzle-orm";
import * as fs from "fs";
import * as path from "path";

async function runQuery(query: string, description: string) {
  console.log(`\n${'='.repeat(70)}`);
  console.log(`${description}`);
  console.log(`${'='.repeat(70)}\n`);

  try {
    const result = await db.execute(sql.raw(query));

    if (result.rows && result.rows.length > 0) {
      console.table(result.rows);
    } else {
      console.log('(No rows returned)');
    }
  } catch (error) {
    console.error('Query failed:', error);
  }
}

async function main() {
  console.log('╔═══════════════════════════════════════════════════════════════════╗');
  console.log('║           SQL Verification Queries for Audit Fixes                ║');
  console.log('╚═══════════════════════════════════════════════════════════════════╝');

  // 1. Check transactions with splits
  await runQuery(`
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
  `, 'Transactions with Splits (INT-RULES-001)');

  // 2. Check for duplicate goal assignments
  await runQuery(`
    SELECT
      goal_id,
      account_id,
      COUNT(*) as duplicate_count
    FROM goal_account_assignments
    GROUP BY goal_id, account_id
    HAVING COUNT(*) > 1;
  `, 'Duplicate Goal Assignments (DATA-GOAL-004) - Should be empty');

  // 3. Check unique constraint exists
  await runQuery(`
    SELECT
      indexname,
      indexdef
    FROM pg_indexes
    WHERE tablename = 'goal_account_assignments'
      AND indexname = 'unique_goal_account_idx';
  `, 'Unique Constraint on Goal Assignments (DATA-GOAL-004)');

  // 4. Check latest net worth snapshots
  await runQuery(`
    SELECT
      household_id,
      date,
      total_assets,
      total_liabilities,
      net_worth,
      currency,
      jsonb_typeof(assets_by_type) as assets_type,
      jsonb_typeof(assets_by_type->'checking') as checking_type
    FROM net_worth_snapshots
    ORDER BY date DESC, household_id
    LIMIT 5;
  `, 'Latest Net Worth Snapshots (DATA-SNAPSHOT-001)');

  // 5. Check account balance snapshots precision
  await runQuery(`
    SELECT
      account_id,
      date,
      balance,
      balance::numeric = ROUND(balance::numeric, 2) as is_precise
    FROM account_balance_snapshots
    ORDER BY date DESC
    LIMIT 10;
  `, 'Account Balance Snapshots Precision (DATA-SNAPSHOT-001)');

  // 6. Check private accounts in goal assignments
  await runQuery(`
    SELECT
      a.id as account_id,
      a.name as account_name,
      a.is_private,
      a.owner_user_id,
      g.id as goal_id,
      g.name as goal_name
    FROM accounts a
    INNER JOIN goal_account_assignments gaa ON gaa.account_id = a.id
    INNER JOIN goals g ON g.id = gaa.goal_id
    WHERE a.is_private = true
    ORDER BY a.name
    LIMIT 10;
  `, 'Private Accounts in Goal Assignments (AUTH-GOAL-ASSIGN-001)');

  // 7. Check GRZ bonds household matching
  await runQuery(`
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
  `, 'GRZ Bonds Household Validation (AUTH-GRZ-ACC-001)');

  // 8. Check GRZ T-bills household matching
  await runQuery(`
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
  `, 'GRZ T-Bills Household Validation (AUTH-GRZ-ACC-001)');

  // 9. Summary statistics
  await runQuery(`
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
  `, 'Summary Statistics');

  console.log('\n╔═══════════════════════════════════════════════════════════════════╗');
  console.log('║                     Verification Complete                         ║');
  console.log('╚═══════════════════════════════════════════════════════════════════╝\n');
}

main().catch(console.error);
