import { db } from "../server/db";
import { sql } from "drizzle-orm";

async function main() {
  try {
    console.log("Adding nrc column to users table...");
    await db.execute(
      sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS nrc VARCHAR(20)`
    );
    console.log("Successfully added nrc column");
  } catch (error) {
    console.error("Failed to add column:", error);
  }
  process.exit(0);
}

main();
