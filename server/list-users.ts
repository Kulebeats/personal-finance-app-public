import "dotenv/config";
import { db } from "./db.js";
import { users } from "@shared/schema.js";

async function listUsers() {
  const all = await db
    .select({ id: users.id, email: users.email, username: users.username })
    .from(users)
    .limit(10);
  console.log("Users in database:");
  all.forEach((u) => console.log(`  - ${u.email} (${u.username})`));
  process.exit(0);
}

listUsers().catch((e) => {
  console.error(e);
  process.exit(1);
});
