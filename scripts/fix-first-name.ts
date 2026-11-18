import { db } from "../server/db";
import { sql } from "drizzle-orm";

async function fixFirstName() {
  try {
    console.log("Adding first_name column...");

    await db.execute(
      sql.raw(
        `ALTER TABLE users ADD COLUMN IF NOT EXISTS first_name VARCHAR(50)`
      )
    );

    console.log("✅ first_name column added successfully!");
    process.exit(0);
  } catch (error) {
    console.error("❌ Failed:", error);
    process.exit(1);
  }
}

fixFirstName();
