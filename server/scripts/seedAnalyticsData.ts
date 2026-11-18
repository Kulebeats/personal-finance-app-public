/**
 * Seed Analytics Data Script
 *
 * Generates test data for analytics verification:
 * - 10,000 transactions over 2 years
 * - 5 accounts (3 assets, 2 liabilities)
 * - 20 categories across 5 groups
 * - Mix of income/expense/transfers
 *
 * Usage: npx tsx server/scripts/seedAnalyticsData.ts
 */

import { db } from "../db";
import {
  accounts,
  transactions,
  categories,
  categoryGroups,
  households,
  users,
} from "@shared/schema";
import { eq } from "drizzle-orm";

const TRANSACTION_COUNT = 10000;
const DATE_RANGE_DAYS = 730; // 2 years

async function main() {
  console.log("Starting analytics data seeding...");

  // Get first household and user
  const [household] = await db.select().from(households).limit(1);
  const [user] = await db.select().from(users).limit(1);

  if (!household || !user) {
    console.error("No household or user found. Please create one first.");
    process.exit(1);
  }

  console.log(`Using household: ${household.id}`);
  console.log(`Using user: ${user.id}`);

  // Get existing accounts or create test accounts
  let testAccounts = await db
    .select()
    .from(accounts)
    .where(eq(accounts.householdId, household.id))
    .limit(5);

  if (testAccounts.length < 5) {
    console.log("Creating test accounts...");
    const accountTypes = [
      { name: "Main Checking", type: "checking", balance: "5000" },
      { name: "Savings", type: "savings", balance: "15000" },
      { name: "Investment", type: "investment", balance: "25000" },
      { name: "Credit Card", type: "credit", balance: "-2000" },
      { name: "Car Loan", type: "loan", balance: "-15000" },
    ];

    for (const acc of accountTypes) {
      await db.insert(accounts).values({
        householdId: household.id,
        ownerUserId: user.id,
        name: acc.name,
        type: acc.type as "checking" | "savings" | "investment" | "credit" | "loan",
        balance: acc.balance,
        currency: household.currency || "USD",
      });
    }

    testAccounts = await db
      .select()
      .from(accounts)
      .where(eq(accounts.householdId, household.id))
      .limit(5);
  }

  // Get existing categories
  const testCategories = await db
    .select()
    .from(categories)
    .where(eq(categories.householdId, household.id));

  if (testCategories.length === 0) {
    console.log("No categories found. Please create categories first.");
    process.exit(1);
  }

  // Get asset accounts for transactions
  const assetAccounts = testAccounts.filter(
    (a) => a.type !== "credit" && a.type !== "loan"
  );

  // Generate transactions
  console.log(`Generating ${TRANSACTION_COUNT} transactions...`);
  const now = new Date();
  let created = 0;

  for (let i = 0; i < TRANSACTION_COUNT; i++) {
    // Random date within range
    const daysAgo = Math.floor(Math.random() * DATE_RANGE_DAYS);
    const date = new Date(now);
    date.setDate(date.getDate() - daysAgo);
    const dateStr = date.toISOString().split("T")[0];

    // Random type (70% expense, 25% income, 5% transfer)
    const typeRoll = Math.random();
    let type: "income" | "expense" | "transfer";
    if (typeRoll < 0.7) {
      type = "expense";
    } else if (typeRoll < 0.95) {
      type = "income";
    } else {
      type = "transfer";
    }

    // Random amount
    let amount: number;
    if (type === "income") {
      amount = Math.floor(Math.random() * 5000) + 500; // 500-5500
    } else {
      amount = Math.floor(Math.random() * 500) + 10; // 10-510
    }

    // Random category
    const category =
      testCategories[Math.floor(Math.random() * testCategories.length)];

    // Random account
    const account =
      assetAccounts[Math.floor(Math.random() * assetAccounts.length)];

    try {
      await db.insert(transactions).values({
        householdId: household.id,
        accountId: account.id,
        ownerUserId: user.id,
        date: dateStr,
        name: `Test ${type} ${i + 1}`,
        amount: String(amount),
        type,
        categoryId: category?.id,
        source: "manual",
        isPending: Math.random() < 0.05, // 5% pending
        isExcludedFromReports: Math.random() < 0.02, // 2% excluded
      });
      created++;

      if (created % 1000 === 0) {
        console.log(`Created ${created}/${TRANSACTION_COUNT} transactions...`);
      }
    } catch (error) {
      // Skip on conflict
    }
  }

  console.log(`\nSeeding complete!`);
  console.log(`Created ${created} transactions`);
  console.log(`Date range: ${DATE_RANGE_DAYS} days`);
  console.log(`\nTest the analytics:`);
  console.log(`GET /api/reports/cashflow?from=2023-01-01&to=2024-12-31`);
  console.log(
    `GET /api/reports/spending/breakdown?from=2024-01-01&to=2024-12-31`
  );

  process.exit(0);
}

main().catch((error) => {
  console.error("Seed failed:", error);
  process.exit(1);
});
