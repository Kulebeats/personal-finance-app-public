import { householdFxRateOverrides } from "@shared/schema";
import { db } from "../../db";

/**
 * NEW-21: a foreign investment write needs the rate for its own date, so a
 * suite that posts foreign trades seeds the household's dated rate first. The
 * rate equals the conversion the suite already claims; it never invents one.
 * Rows belong to the household and cascade with it.
 */
export async function seedDatedFxRate(householdId: string, actorUserId: string, rate: string,
  window: { from?: string; effectiveDate?: string; validThrough?: string } = {}): Promise<void> {
  await db.insert(householdFxRateOverrides).values({
    householdId, actorUserId, fromCurrency: window.from ?? "USD", toCurrency: "ZMW",
    effectiveDate: window.effectiveDate ?? "2000-01-01", validThrough: window.validThrough ?? "2099-12-31", rate,
  });
}
