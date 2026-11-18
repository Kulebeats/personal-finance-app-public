import { db } from "../server/db";
import { sql } from "drizzle-orm";
import fs from "fs";
import path from "path";

async function runMigration() {
  try {
    console.log("Running migration: add-profile-fields.sql");

    const migrationPath = path.join(
      process.cwd(),
      "migrations",
      "add-profile-fields.sql"
    );
    const migrationSQL = fs.readFileSync(migrationPath, "utf-8");

    // Split by semicolon and run each statement
    const statements = migrationSQL
      .split(";")
      .map((s) => s.trim())
      .filter((s) => s.length > 0 && !s.startsWith("--"));

    for (const statement of statements) {
      console.log(`Executing: ${statement.substring(0, 60)}...`);
      await db.execute(sql.raw(statement));
    }

    console.log("✅ Migration completed successfully!");
    console.log("\nNew fields added:");
    console.log("  Users table:");
    console.log("    - first_name, last_name, display_name");
    console.log("    - birthday, gender, phone_number");
    console.log("    - address (JSON), occupation");
    console.log("    - annual_income, income_frequency");
    console.log("    - employment_status, investment_goal, risk_tolerance");
    console.log("\n  User Display Settings table:");
    console.log("    - locale, currency_position, dashboard_widgets");

    process.exit(0);
  } catch (error) {
    console.error("❌ Migration failed:", error);
    process.exit(1);
  }
}

runMigration();
