import "dotenv/config";
import { pool } from "./db.js";

async function migrate() {
  console.log("Running migration: Add budget_system column");

  try {
    await pool.query(`
      ALTER TABLE household_preferences 
      ADD COLUMN IF NOT EXISTS budget_system VARCHAR(20) DEFAULT 'flex';
    `);

    console.log("✓ Successfully added budget_system column");

    // Also check for any other missing columns that might cause issues
    await pool.query(`
      ALTER TABLE household_preferences 
      ADD COLUMN IF NOT EXISTS show_pending_transactions BOOLEAN DEFAULT true;
    `);

    await pool.query(`
      ALTER TABLE household_preferences 
      ADD COLUMN IF NOT EXISTS allow_edit_pending BOOLEAN DEFAULT true;
    `);

    await pool.query(`
      ALTER TABLE household_preferences 
      ADD COLUMN IF NOT EXISTS display_merchant_logos BOOLEAN DEFAULT true;
    `);

    await pool.query(`
      ALTER TABLE household_preferences 
      ADD COLUMN IF NOT EXISTS default_budget_scope VARCHAR(20) DEFAULT 'current_month';
    `);

    console.log("✓ Migration complete!");
    process.exit(0);
  } catch (error) {
    console.error("Migration failed:", error);
    process.exit(1);
  }
}

migrate();
