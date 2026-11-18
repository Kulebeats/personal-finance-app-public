import { db } from "../db";
import { transactions, pendingReceipts } from "@shared/schema";

async function clearTransactions() {
  console.log("🗑️ Clearing transactions data...");
  try {
    // Clear dependent tables first
    console.log("   - Clearing pending receipts...");
    await db.delete(pendingReceipts);

    // Then clear transactions
    console.log("   - Clearing transactions...");
    await db.delete(transactions);

    console.log("✅ All transactions and pending receipts cleared.");
    process.exit(0);
  } catch (error) {
    console.error("❌ Failed to clear data:", error);
    process.exit(1);
  }
}

clearTransactions();
