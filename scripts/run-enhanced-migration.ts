import { db } from "../server/db";
import { sql } from "drizzle-orm";
import fs from "fs";
import path from "path";

async function runEnhancedMigration() {
  try {
    console.log("Running enhanced profile migration...\n");

    const migrationPath = path.join(
      process.cwd(),
      "migrations",
      "add-enhanced-profile-fields.sql"
    );
    const migrationSQL = fs.readFileSync(migrationPath, "utf-8");

    const statements = migrationSQL
      .split(";")
      .map((s) => s.trim())
      .filter((s) => s.length > 0 && !s.startsWith("--"));

    for (const statement of statements) {
      const preview = statement.substring(0, 70).replace(/\n/g, " ");
      console.log(`Executing: ${preview}...`);
      await db.execute(sql.raw(statement));
    }

    console.log("\n✅ Enhanced profile migration completed successfully!");
    console.log("\nNew fields added:");
    console.log(
      "  📱 Multiple phone numbers: phone_number_mobile, phone_number_work, phone_number_home"
    );
    console.log("  💰 Salary range: salary_range_encrypted");
    console.log("  🎂 Birthday privacy: birthday_hide_year");
    console.log("  🏢 Occupation: occupation_custom, company");
    console.log("  📊 Profile completeness: profile_completeness");

    process.exit(0);
  } catch (error) {
    console.error("❌ Migration failed:", error);
    process.exit(1);
  }
}

runEnhancedMigration();
