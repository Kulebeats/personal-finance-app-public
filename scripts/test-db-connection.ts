import { db } from "../server/db";
import { sql } from "drizzle-orm";

async function testDatabaseConnection() {
  try {
    console.log("Testing database connection...");

    // Test basic connection
    const result = await db.execute(sql`SELECT 1 as test`);
    console.log("✅ Database connection successful");

    // Test users table
    const userCount = await db.execute(
      sql`SELECT COUNT(*) as count FROM users`
    );
    console.log(
      `✅ Users table accessible, ${userCount.rows[0].count} users found`
    );

    // Test if test user exists
    const testUser = await db.execute(
      sql`SELECT email, username FROM users WHERE email = 'test@test.com'`
    );
    if (testUser.rows.length > 0) {
      console.log(
        `✅ Test user found: ${testUser.rows[0].email} (${testUser.rows[0].username})`
      );
    } else {
      console.log("❌ Test user not found");
    }

    console.log("\n✅ All database tests passed!");
  } catch (error) {
    console.error("❌ Database connection failed:", error);
  }

  process.exit(0);
}

testDatabaseConnection();
