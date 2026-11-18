import { db } from "../../db";
import { grzAuctionResults } from "@shared/schema";
import { eq, and, desc } from "drizzle-orm";

/**
 * T-Bill auction yield lookup helpers, extracted from InvestmentAutomationService
 * (packet R6) so that file can stay under the server/services LOC limit.
 */

export function normalizeYieldPercent(rate: number): number | null {
  if (!Number.isFinite(rate)) return null;
  return rate <= 1 ? rate * 100 : rate;
}

export function parseYieldValue(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return parsed;
}

export async function getLatestTbillYield(
  tenorDays: number,
): Promise<number | null> {
  const results = await db
    .select()
    .from(grzAuctionResults)
    .where(
      and(
        eq(grzAuctionResults.securityType, "TBILL"),
        eq(grzAuctionResults.tenor, String(tenorDays)),
      ),
    )
    .orderBy(desc(grzAuctionResults.auctionDate))
    .limit(1);

  const latest = results[0];
  if (!latest) return null;

  const weighted = parseYieldValue(latest.weightedAvgYield);
  const highest = parseYieldValue(latest.highestYield);
  const lowest = parseYieldValue(latest.lowestYield);
  const resolved = weighted ?? highest ?? lowest;
  if (resolved === null) return null;

  return normalizeYieldPercent(resolved);
}
