import "dotenv/config";
import { db } from "../server/db";
import { households } from "@shared/schema";
import { fxAttributionService } from "../server/services/FXAttributionService";

async function main() {
  try {
    const household = await db.query.households.findFirst();
    if (!household) {
      console.error("No household found");
      return;
    }
    console.log("Using household:", household.id);
    const results = await fxAttributionService.calculateAttribution(
      household.id
    );
    console.log("Success:", results);
  } catch (error) {
    console.error("Error:", error);
  } finally {
    process.exit(0);
  }
}

main();
