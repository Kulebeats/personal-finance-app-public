import { db } from "../server/db";
import { users } from "@shared/schema";

async function main() {
  try {
    console.log("Connecting to database...");
    const allUsers = await db.select().from(users);
    console.log(`Found ${allUsers.length} users:`);
    allUsers.forEach((u) => {
      console.log(`- ID: ${u.id}, Username: ${u.username}, Email: ${u.email}`);
    });
  } catch (error) {
    console.error("Error fetching users:", error);
  }
  process.exit(0);
}

main();
