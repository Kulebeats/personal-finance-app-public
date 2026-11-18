import { db } from "./db";
import { securities } from "@shared/schema";
import { eq, or } from "drizzle-orm";

async function main() {
  console.log("🌱 Seeding Generic T-Bill Securities...");

  const tbills = [
    { name: "91-Day GRZ T-Bill", symbol: "GRZ-91D", type: "tbill" },
    { name: "182-Day GRZ T-Bill", symbol: "GRZ-182D", type: "tbill" },
    { name: "273-Day GRZ T-Bill", symbol: "GRZ-273D", type: "tbill" },
    { name: "364-Day GRZ T-Bill", symbol: "GRZ-364D", type: "tbill" },
  ];

  for (const bill of tbills) {
    // Check if exists
    const existing = await db.query.securities.findFirst({
      where: eq(securities.symbol, bill.symbol),
    });

    if (!existing) {
      await db.insert(securities).values({
        symbol: bill.symbol,
        name: bill.name,
        type: "tbill",
        currency: "ZMW",
        currentPrice: "1.00", // Placeholder
        exchange: "luse",
        sector: "Government",
      });
      console.log(`✅ Created: ${bill.name}`);
    } else {
      // Update type just in case
      if (existing.type !== "tbill") {
        await db
          .update(securities)
          .set({ type: "tbill" })
          .where(eq(securities.id, existing.id));
        console.log(`🔄 Updated type for: ${bill.name}`);
      } else {
        console.log(`⏭️  Skipped (Exists): ${bill.name}`);
      }
    }
  }

  console.log("✨ Seeding Complete");
  process.exit(0);
}

main().catch((err) => {
  console.error("Fatal Error:", err);
  process.exit(1);
});
