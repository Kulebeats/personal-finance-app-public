import { db } from "../db";
import { accounts } from "@shared/schema";

async function listAccounts() {
  console.log("Listing all accounts...");
  const allAccounts = await db.select().from(accounts);
  console.table(
    allAccounts.map((a) => ({ id: a.id, name: a.name, type: a.type }))
  );
  process.exit(0);
}

listAccounts();
