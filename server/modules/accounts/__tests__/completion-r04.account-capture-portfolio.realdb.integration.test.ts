import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { accounts, accountWorthCaptures, grzBonds, holdings, households, netWorthSnapshots, pensionHoldings, securities } from "@shared/schema";
import { db } from "../../../db";
import { snapshotWorker } from "../../../jobs/snapshotWorker";

describe("daily portfolio capture preserves unavailable values", () => {
  let household: string, account: string, security: string;

  beforeEach(async () => {
    household = randomUUID();
    account = randomUUID();
    security = randomUUID();
    await db.insert(households).values({ id: household, name: "Daily portfolio", currency: "ZMW" });
    await db.insert(accounts).values({ id: account, householdId: household, type: "checking", name: "Cash", balance: "100", currency: "ZMW" });
  });

  afterEach(async () => {
    await db.delete(grzBonds).where(eq(grzBonds.householdId, household));
    await db.delete(households).where(eq(households.id, household));
    await db.delete(securities).where(eq(securities.id, security));
  });

  async function holding(quantity: string, currentPrice: string | null, currency = "ZMW") {
    await db.insert(securities).values({ id: security, symbol: "DAILY", name: "Daily quote", type: "stock", currency, currentPrice });
    await db.insert(holdings).values({ householdId: household, accountId: account, securityId: security, quantity });
  }

  it.each(["holding without price", "pension without balance", "active unvalued bond"] as const)(
    "withholds a new aggregate for a %s while persisting native account evidence", async kind => {
      if (kind === "holding without price") await holding("2", null);
      else if (kind === "pension without balance") {
        await db.insert(pensionHoldings).values({ householdId: household, accountId: account, providerName: "Local pension",
          pensionType: "private", currentBalance: null });
      } else {
        await db.insert(grzBonds).values({ householdId: household, accountId: account, bondName: "Active bond", tenorYears: 2,
          faceValue: "125", purchasePrice: "110", couponRate: "0.10", purchaseDate: "2025-01-01", maturityDate: "2027-01-01", status: "active" });
      }
      await expect(snapshotWorker.processHousehold(household)).rejects.toMatchObject({ code: "INSUFFICIENT_DATA" });
      expect(await db.select().from(netWorthSnapshots).where(eq(netWorthSnapshots.householdId, household))).toEqual([]);
      const rows = await db.select().from(accountWorthCaptures).where(eq(accountWorthCaptures.householdId, household));
      expect(rows).toHaveLength(1);
      expect(rows[0].evidence?.accounts).toEqual([expect.objectContaining({ accountId: account, sourceAmount: "100.00" })]);
    },
  );

  it.each([["0", "NaN", "ZMW"], ["0", "9.00", "QPX"], ["2", "0.00", "QPX"]])(
    "keeps known-zero positions balance-neutral for quantity %s price %s currency %s", async (quantity, price, currency) => {
      await holding(quantity, price, currency);
      expect(await snapshotWorker.processHousehold(household)).toBe(true);
      const [row] = await db.select().from(netWorthSnapshots).where(eq(netWorthSnapshots.householdId, household));
      expect(row.netWorth).toBe("100.00");
    },
  );

  it.each([["2", "3.00", "106.00"], ["0", null, "100.00"], ["2", "0.00", "100.00"]] as const)(
    "values quantity %s with observed price %s", async (quantity, price, expected) => {
      await holding(quantity, price);
      expect(await snapshotWorker.processHousehold(household)).toBe(true);
      const [row] = await db.select().from(netWorthSnapshots).where(eq(netWorthSnapshots.householdId, household));
      expect(row.netWorth).toBe(expected);
    },
  );
});
