/**
 * Run SQL migrations using the project's database connection
 * Usage: npx tsx migrations/run-migration.ts <migration-file.sql>
 */

import "dotenv/config";
import { readFileSync } from "fs";
import { Pool } from "pg";
import { resolve } from "path";

async function runMigration() {
  const migrationFile = process.argv[2];

  if (!migrationFile) {
    console.error(
      "Usage: npx tsx migrations/run-migration.ts <migration-file.sql>"
    );
    process.exit(1);
  }

  const filePath = resolve(process.cwd(), migrationFile);
  console.log(`Reading migration file: ${filePath}`);

  let sql: string;
  try {
    sql = readFileSync(filePath, "utf-8");
  } catch (err) {
    console.error(`Could not read file: ${filePath}`);
    process.exit(1);
  }

  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL environment variable is not set");
    process.exit(1);
  }

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
  });

  console.log("Connecting to database...");

  try {
    const client = await pool.connect();
    console.log("Connected. Running migration...\n");

    const result = await client.query(sql);

    console.log("✅ Migration completed successfully!");
    if (Array.isArray(result)) {
      console.log(`Executed ${result.length} statements.`);
    }

    client.release();
  } catch (err: any) {
    console.error("❌ Migration failed:");
    console.error(err.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

runMigration();
