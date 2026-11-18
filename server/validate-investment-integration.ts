// Diagnostic script for Investment Integration Validation
import { db } from "./db";
import { sql } from "drizzle-orm";

async function runValidation() {
  console.log("🔍 Running Pre-Implementation Validation...\n");

  // Query 1: Orphaned Investment Income
  console.log("1️⃣  Checking for Orphaned Investment Income...");
  const orphanedIncome = await db.execute(sql`
    SELECT COUNT(*), type 
    FROM investment_transactions
    WHERE type IN ('dividend', 'interest', 'coupon', 'maturity')
    AND linked_transaction_id IS NULL
    GROUP BY type
  `);

  if (orphanedIncome.rowCount === 0) {
    console.log("✅ No orphaned investment income found.\n");
  } else {
    console.log("⚠️  Found orphaned investment income:");
    console.table(orphanedIncome.rows);
    console.log("\n");
  }

  // Query 2: Holdings Without Prices
  console.log("2️⃣  Checking for Holdings Without Prices...");
  const holdingsNoPrice = await db.execute(sql`
    SELECT h.id, s.symbol, s.current_price 
    FROM holdings h
    JOIN securities s ON s.id = h.security_id
    WHERE s.current_price IS NULL OR s.current_price = 0
  `);

  if (holdingsNoPrice.rowCount === 0) {
    console.log("✅ All holdings have valid prices.\n");
  } else {
    console.log("⚠️  Found holdings with invalid prices:");
    console.table(holdingsNoPrice.rows);
    console.log("\n");
  }

  // Query 3: Investment Account Balance vs Holdings
  console.log("3️⃣  Checking Investment Account Balance vs Holdings Value...");
  const accountBalances = await db.execute(sql`
    SELECT 
      a.id, 
      a.name, 
      a.balance::numeric as account_balance,
      (SELECT COALESCE(SUM(h.quantity * s.current_price), 0)
       FROM holdings h 
       JOIN securities s ON s.id = h.security_id
       WHERE h.account_id = a.id) as holdings_value
    FROM accounts a 
    WHERE a.type = 'investment'
  `);

  if (accountBalances.rowCount === 0) {
    console.log("ℹ️  No investment accounts found.\n");
  } else {
    console.log("📊 Investment Account Balances vs Holdings:");
    console.table(accountBalances.rows);
    console.log("\n");
  }
}

runValidation()
  .catch(console.error)
  .finally(() => process.exit());
