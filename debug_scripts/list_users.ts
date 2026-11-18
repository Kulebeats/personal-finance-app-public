import { db } from "../server/db";
import { users } from "../shared/schema";

async function main() {
  console.log("Listing all users...");
  try {
    const result = await db
      .select({
        id: users.id,
        username: users.username,
        email: users.email,
      })
      .from(users)
      .limit(20);
    console.log("Users:", JSON.stringify(result, null, 2));
  } catch (error) {
    console.error("Error querying database:", error);
  }
  process.exit(0);
}

main();
