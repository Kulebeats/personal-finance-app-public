import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq, inArray } from "drizzle-orm";
import {
  fxRates,
  holdings,
  householdSecurityPriceOverrides,
  netWorthSnapshots,
  securities,
} from "@shared/schema";
import { hashPassword } from "../../auth";
import { createFXRateRepository, createFXRateService, setGlobalFXService } from "../../core/calculations";
import { db } from "../../db";
import { getTestApp } from "../../__tests__/fixtures";
import { snapshotWorker } from "../../jobs/snapshotWorker";
import { portfolioValuationService } from "../../services/PortfolioValuationService";
import {
  cleanPriceFixture,
  createPriceFixture,
  password,
  seedPriceFixture,
  setOtherRole,
  signed,
  type Actor,
  type PriceFixture,
} from "./completion-c3-06.price-confirmation.fixture";

let app: Awaited<ReturnType<typeof getTestApp>>;
let passwordHash: string;
let fixture: PriceFixture;

function recordPrice(actor: Actor, price: string, date = fixture.today, validThrough = date) {
  return signed(app, fixture, actor, "put", `/api/investments/securities/${fixture.referenceSecurityId}/price`)
    .send({ price, date, validThrough });
}

async function expectSummary(actor: Actor, netWorth: number) {
  const result = await signed(app, fixture, actor, "get", "/api/accounts/summary").expect(200);
  expect(result.body).toMatchObject({
    success: true,
    data: { netWorth, totalAssets: netWorth, totalLiabilities: 0, currency: "ZMW" },
  });
}

describe("C3-06 household prices remain consistent through account publication", () => {
  beforeAll(async () => {
    app = await getTestApp();
    passwordHash = await hashPassword(password);
    setGlobalFXService(createFXRateService(createFXRateRepository(db, fxRates)));
  });

  beforeEach(async () => {
    fixture = createPriceFixture();
    await seedPriceFixture(fixture, app, passwordHash);
    await db.insert(holdings).values([
      { householdId: fixture.homeHouseholdId, accountId: fixture.homeAccountId,
        securityId: fixture.referenceSecurityId, quantity: "100", costBasis: "100.00" },
      { householdId: fixture.otherHouseholdId, accountId: fixture.otherAccountId,
        securityId: fixture.referenceSecurityId, quantity: "100", costBasis: "100.00" },
    ]);
  });

  afterEach(async () => {
    if (!fixture) return;
    await db.delete(householdSecurityPriceOverrides).where(inArray(
      householdSecurityPriceOverrides.householdId,
      [fixture.homeHouseholdId, fixture.otherHouseholdId],
    ));
    await cleanPriceFixture(fixture);
  });

  it("uses each household's own price in the signed account summary", async () => {
    await setOtherRole(fixture, "admin");
    await expectSummary("home", 300);
    await expectSummary("other", 400);

    await recordPrice("home", "3.1415").expect(200);
    await recordPrice("other", "7.2718").expect(200);

    await expectSummary("home", 414.15);
    await expectSummary("other", 927.18);
  });

  it("reports the selected household price window without exposing its author evidence", async () => {
    await db.update(securities).set({ lastPriceUpdate: new Date("2000-01-01T00:00:00Z") })
      .where(eq(securities.id, fixture.referenceSecurityId));
    await recordPrice("home", "3.1415").expect(200);

    const result = await signed(app, fixture, "home", "get", "/api/investments/holdings")
      .query({ currency: "ZMW" })
      .expect(200);
    expect(result.body.data).toHaveLength(1);
    const row = result.body.data[0];
    expect(row).toMatchObject({ currentValue: { amount: "314.15", currency: "ZMW" } });
    expect(row.priceEvidence).toBeUndefined();
    expect(row.security.valuationPrice).toEqual({
      source: "manual",
      effectiveDate: fixture.today,
      validThrough: fixture.today,
      recordedAt: expect.any(String),
    });
  });

  it("rebuilds the summary after a signed price write during its valuation await", async () => {
    const calculate = portfolioValuationService.getHouseholdInvestmentValue.bind(portfolioValuationService);
    const valuation = vi.spyOn(portfolioValuationService, "getHouseholdInvestmentValue")
      .mockImplementationOnce(async (...args) => {
        const result = await calculate(...args);
        await recordPrice("home", "3.1415").expect(200);
        return result;
      });
    try {
      await expectSummary("home", 414.15);
      expect(valuation.mock.calls.length).toBeGreaterThanOrEqual(2);
    } finally {
      valuation.mockRestore();
    }
    await expectSummary("other", 400);
  });

  it("uses the same household price in the normal daily snapshot worker", async () => {
    await setOtherRole(fixture, "admin");
    await recordPrice("home", "3.1415").expect(200);
    await recordPrice("other", "7.2718").expect(200);

    expect(await snapshotWorker.processHousehold(fixture.homeHouseholdId)).toBe(true);
    expect(await snapshotWorker.processHousehold(fixture.otherHouseholdId)).toBe(true);
    const snapshots = await db.select({
      householdId: netWorthSnapshots.householdId,
      netWorth: netWorthSnapshots.netWorth,
    }).from(netWorthSnapshots).where(inArray(
      netWorthSnapshots.householdId,
      [fixture.homeHouseholdId, fixture.otherHouseholdId],
    ));
    expect(snapshots).toHaveLength(2);
    expect(snapshots).toEqual(expect.arrayContaining([
      { householdId: fixture.homeHouseholdId, netWorth: "414.15" },
      { householdId: fixture.otherHouseholdId, netWorth: "927.18" },
    ]));
    // The ordinary snapshot path owns its immutable capture-generation rows.
    // Household teardown preserves those historical generation records.
  });

  it("returns unavailable after expiry when the visible holding has no reference price", async () => {
    const past = new Date(`${fixture.today}T00:00:00Z`);
    past.setUTCDate(past.getUTCDate() - 1);
    const yesterday = past.toISOString().slice(0, 10);
    await recordPrice("home", "3.1415", yesterday, yesterday).expect(200);
    await db.update(securities).set({ currentPrice: null }).where(eq(securities.id, fixture.referenceSecurityId));

    const response = await signed(app, fixture, "home", "get", "/api/accounts/summary").expect(422);
    expect(response.body).toMatchObject({ success: false, error: { code: "FINANCIAL_DATA_UNAVAILABLE" } });
  });
});
