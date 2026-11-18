import "dotenv/config";
import { pool } from "./db.js";

async function migrate() {
  console.log("Running comprehensive migration: Category Schema Sync v2");

  try {
    // category_groups table
    console.log("\n=== Checking category_groups table ===");
    const groupColumns = [
      {
        name: "budget_mode",
        type: "VARCHAR(20) DEFAULT 'by_category' NOT NULL",
      },
      { name: "rollover_enabled", type: "BOOLEAN DEFAULT false NOT NULL" },
      { name: "is_archived", type: "BOOLEAN DEFAULT false NOT NULL" },
      { name: "display_order", type: "INTEGER DEFAULT 0 NOT NULL" },
    ];

    for (const col of groupColumns) {
      await pool.query(`
        ALTER TABLE category_groups 
        ADD COLUMN IF NOT EXISTS ${col.name} ${col.type};
      `);
      console.log(`✓ Column ${col.name} checked/added`);
    }

    // categories table
    console.log("\n=== Checking categories table ===");
    const catColumns = [
      { name: "include_in_budget", type: "BOOLEAN DEFAULT true" },
      { name: "rollover_enabled", type: "BOOLEAN DEFAULT false" },
      { name: "rollover_start_balance", type: "DECIMAL(15,2)" },
      { name: "is_archived", type: "BOOLEAN DEFAULT false" },
      { name: "display_order", type: "INTEGER DEFAULT 0 NOT NULL" },
      { name: "deleted_at", type: "TIMESTAMP" },
    ];

    for (const col of catColumns) {
      await pool.query(`
        ALTER TABLE categories 
        ADD COLUMN IF NOT EXISTS ${col.name} ${col.type};
      `);
      console.log(`✓ Column ${col.name} checked/added`);
    }

    console.log("\n✓ All category migrations complete!");
    process.exit(0);
  } catch (error) {
    console.error("Migration failed:", error);
    process.exit(1);
  }
}

migrate();
