/**
 * Run this script to add email verification columns to the users table
 *
 * Usage: npx tsx scripts/add-email-verification-columns.ts
 */

import { db } from "../server/db";
import { sql } from "drizzle-orm";

async function runMigration() {
  console.log("Adding email verification columns to users table...");

  try {
    // Add emailVerified column
    await db.execute(sql`
      ALTER TABLE users
      ADD COLUMN IF NOT EXISTS email_verified BOOLEAN DEFAULT FALSE
    `);
    console.log("Added email_verified column");

    // Add emailVerificationToken column
    await db.execute(sql`
      ALTER TABLE users
      ADD COLUMN IF NOT EXISTS email_verification_token TEXT
    `);
    console.log("Added email_verification_token column");

    // Add emailVerificationExpiry column
    await db.execute(sql`
      ALTER TABLE users
      ADD COLUMN IF NOT EXISTS email_verification_expiry TIMESTAMP
    `);
    console.log("Added email_verification_expiry column");

    // Add pendingEmail column
    await db.execute(sql`
      ALTER TABLE users
      ADD COLUMN IF NOT EXISTS pending_email VARCHAR(255)
    `);
    console.log("Added pending_email column");

    console.log("\nMigration completed successfully!");
  } catch (error) {
    console.error("Migration failed:", error);
    process.exit(1);
  }

  process.exit(0);
}

runMigration();
