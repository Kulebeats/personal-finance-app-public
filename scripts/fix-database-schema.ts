import { db } from "../server/db";
import { sql } from "drizzle-orm";

async function fixDatabaseSchema() {
  try {
    console.log("Fixing database schema...\n");

    // Add all missing columns one by one
    const columns = [
      "ALTER TABLE users ADD COLUMN IF NOT EXISTS phone_number_mobile TEXT",
      "ALTER TABLE users ADD COLUMN IF NOT EXISTS phone_number_work TEXT",
      "ALTER TABLE users ADD COLUMN IF NOT EXISTS phone_number_home TEXT",
      "ALTER TABLE users ADD COLUMN IF NOT EXISTS salary_range_encrypted TEXT",
      "ALTER TABLE users ADD COLUMN IF NOT EXISTS birthday_hide_year BOOLEAN DEFAULT FALSE",
      "ALTER TABLE users ADD COLUMN IF NOT EXISTS occupation_custom BOOLEAN DEFAULT FALSE",
      "ALTER TABLE users ADD COLUMN IF NOT EXISTS profile_completeness INTEGER DEFAULT 0",
      "ALTER TABLE users ADD COLUMN IF NOT EXISTS company VARCHAR(255)",
    ];

    for (const column of columns) {
      try {
        console.log(`Executing: ${column}`);
        await db.execute(sql.raw(column));
        console.log("✅ Success");
      } catch (error) {
        console.log(`⚠️  ${error.message}`);
      }
    }

    // Migrate existing phone_number to phone_number_mobile
    try {
      console.log("\nMigrating existing phone numbers...");
      await db.execute(
        sql.raw(
          "UPDATE users SET phone_number_mobile = phone_number WHERE phone_number IS NOT NULL AND phone_number_mobile IS NULL"
        )
      );
      console.log("✅ Phone number migration complete");
    } catch (error) {
      console.log(`⚠️  ${error.message}`);
    }

    console.log("\n✅ Database schema fix completed!");
    process.exit(0);
  } catch (error) {
    console.error("❌ Schema fix failed:", error);
    process.exit(1);
  }
}

fixDatabaseSchema();
