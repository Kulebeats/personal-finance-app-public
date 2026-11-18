import { db } from "../db";
import { sql } from "drizzle-orm";

async function runMigration() {
  console.log("Adding currency column to transactions table...");

  try {
    // Add the currency column if it doesn't exist
    await db.execute(
      sql`ALTER TABLE transactions ADD COLUMN IF NOT EXISTS currency VARCHAR(3)`
    );
    console.log("✅ Currency column added successfully");

    // Create index
    await db.execute(
      sql`CREATE INDEX IF NOT EXISTS idx_transactions_currency ON transactions(currency)`
    );
    console.log("✅ Index created successfully");
  } catch (error) {
    console.error("Migration failed:", error);
    process.exit(1);
  }

  process.exit(0);
}

runMigration();
