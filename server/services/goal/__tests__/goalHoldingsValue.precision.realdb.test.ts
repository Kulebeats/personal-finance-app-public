import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { accounts, fxRates, holdings, households, securities, type Goal } from "@shared/schema";
import { db } from "../../../db";
import { createFXRateRepository, createFXRateService, setGlobalFXService } from "../../../core/calculations";
import { roundMoney } from "../../../core/money";
import { calculateHoldingsValue } from "../assignment.calculations";
import { GoalBaseService } from "../GoalBaseService";

// P2: a holding's share count is a decimal(18,8), not money, but it multiplies
// a price into money. Parsed as a float it keeps only ~17 significant digits,
// so a large, finely divided holding loses cents. Both goal readers must carry
// the stored decimal string into the multiplication unchanged.
const householdId = randomUUID();
const accountId = randomUUID();
const securityId = randomUUID();
const QUANTITY = "1234567890.12345678";
const PRICE = "1000000.0000";
// 1234567890.12345678 x 1000000 exactly; a float share count gives ...456.70.
const EXACT = "1234567890123456.78";

class GoalHoldingsProbe extends GoalBaseService {
  value(goal: Goal) {
    return this.calculateHoldingsValue(goal);
  }
}

describe("goal holdings value keeps the stored share count exact", () => {
  beforeAll(async () => {
    setGlobalFXService(createFXRateService(createFXRateRepository(db, fxRates)));
    await db.insert(households).values({ id: householdId, name: "Synthetic P2 goal holdings", currency: "ZMW" });
    await db.insert(accounts).values({
      id: accountId, householdId, name: "P2 brokerage", type: "investment", currency: "ZMW",
      initialBalance: "0.00", balance: "0.00", isPrivate: false,
    });
    await db.insert(securities).values({
      id: securityId, symbol: `P2${securityId.slice(0, 8)}`, name: "P2 instrument",
      type: "stock", currency: "ZMW", currentPrice: PRICE,
    });
    await db.insert(holdings).values({ householdId, accountId, securityId, quantity: QUANTITY, costBasis: "0" });
  });

  afterAll(async () => {
    await db.delete(holdings).where(eq(holdings.householdId, householdId));
    await db.delete(accounts).where(eq(accounts.householdId, householdId));
    await db.delete(households).where(eq(households.id, householdId));
    await db.delete(securities).where(eq(securities.id, securityId));
  });

  it("values the assignment reader's holdings to the exact cent", async () => {
    const value = await calculateHoldingsValue([accountId], "ZMW", householdId, db);
    expect(roundMoney(value.amount)).toBe(EXACT);
  });

  it("values the goal service's holdings to the exact cent", async () => {
    const goal = { id: randomUUID(), householdId, linkedAccountId: accountId, currency: "ZMW" } as unknown as Goal;
    const value = await new GoalHoldingsProbe().value(goal);
    expect(roundMoney(value.amount)).toBe(EXACT);
  });
});
