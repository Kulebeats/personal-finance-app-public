/**
 * NEW-13: the securities catalogue. Real HTTP, real Postgres.
 *
 * Owner ruling (23 Nov): one operator-curated global list that members pick
 * from and cannot add to, plus each household's own custom securities with
 * manual prices that no other household sees. No provider feed reaches a
 * household's custom security.
 *
 * "home" (H) and "other" (O) are two households; each case asserts both.
 * The provider is mocked: no test here makes a network call.
 */
import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { fxRates, holdings, securities, systemRoles, userSystemRoles, users } from "@shared/schema";
import { createFXRateRepository, createFXRateService, setGlobalFXService } from "../../core/calculations";
import { hashPassword } from "../../auth";
import { db, pool } from "../../db";
import { getTestApp } from "../../__tests__/fixtures";
import { marketDataService } from "../../services/MarketDataService";
import { eraseAccount } from "../../modules/settings/settings.account-deletion.service";
import {
  cleanPriceFixture, createPriceFixture, metadata, password, seedPriceFixture, setOtherRole, signed, type PriceFixture,
} from "./completion-c3-06.price-confirmation.fixture";

const provider = vi.hoisted(() => ({ quote: vi.fn() }));
vi.mock("yahoo-finance2", () => ({ default: class { quote = provider.quote; } }));

let app: Awaited<ReturnType<typeof getTestApp>>;
let passwordHash: string;
let fixture: PriceFixture;
const operator = { id: "", cookie: "" };

const custom = () => ({ ...metadata(fixture), name: "NEW-13 custom security" });
const listed = async (actor: "home" | "other") =>
  ((await signed(app, fixture, actor, "get", "/api/investments/securities").expect(200)).body.data as Array<{ id: string }>)
    .map(row => row.id);
const openHolding = (actor: "home" | "other", securityId: string, accountId: string) =>
  signed(app, fixture, actor, "post", "/api/investments/holdings").send({ operationId: randomUUID(), expectedCurrency: "ZMW",
    accountId, securityId, quantity: "10", costBasis: "50", acquiredDate: fixture.today });
/** Everything a household reads about its own wealth: holdings, portfolio summary and net worth. */
async function wealth(actor: "home" | "other") {
  const read = async (path: string) => (await signed(app, fixture, actor, "get", path).expect(200)).body.data;
  return {
    holdings: JSON.stringify(await read("/api/investments/holdings?currency=ZMW")),
    portfolio: JSON.stringify(await read("/api/investments/portfolio/summary")),
    summary: await read("/api/accounts/summary"),
  };
}

/** O's owner creates a custom security, prices it at 7.0000 for today and holds 10 of it. */
async function otherHoldsCustom() {
  await setOtherRole(fixture, "owner");
  const body = custom();
  const created = await signed(app, fixture, "other", "post", "/api/investments/securities").send(body).expect(201);
  const id: string = created.body.data.id;
  await signed(app, fixture, "other", "put", `/api/investments/securities/${id}/price`)
    .send({ price: "7.0000", date: fixture.today, validThrough: fixture.today }).expect(200);
  await openHolding("other", id, fixture.otherAccountId).expect(201);
  return { id, symbol: body.symbol };
}

describe("NEW-13 securities catalogue: curated list plus household-private custom securities", () => {
  beforeAll(async () => {
    app = await getTestApp();
    passwordHash = await hashPassword(password);
    setGlobalFXService(createFXRateService(createFXRateRepository(db, fxRates)));
  }, 30_000);

  beforeEach(async () => {
    provider.quote.mockReset();
    fixture = createPriceFixture();
    await seedPriceFixture(fixture, app, passwordHash);
    await db.insert(systemRoles).values({ name: "super_admin" }).onConflictDoNothing();
    const [{ id: roleId }] = await db.select({ id: systemRoles.id }).from(systemRoles).where(eq(systemRoles.name, "super_admin"));
    operator.id = randomUUID();
    const email = `new13-operator-${operator.id}@example.invalid`;
    await db.insert(users).values({ id: operator.id, email, username: `new13-op-${operator.id.slice(0, 8)}`, passwordHash, emailVerified: true });
    await db.insert(userSystemRoles).values({ userId: operator.id, roleId });
    const login = await request(app).post("/api/auth/login").send({ email, password }).expect(200);
    operator.cookie = (login.headers["set-cookie"] as unknown as string[]).join("; ");
  }, 30_000);

  afterEach(async () => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    await pool.query("delete from household_security_price_overrides where household_id = any($1::uuid[])",
      [[fixture.homeHouseholdId, fixture.otherHouseholdId]]);
    await db.delete(holdings).where(inArray(holdings.householdId, [fixture.homeHouseholdId, fixture.otherHouseholdId]));
    await pool.query("delete from audit_logs where user_id = $1", [operator.id]);
    await cleanPriceFixture(fixture);
    await db.delete(userSystemRoles).where(eq(userSystemRoles.userId, operator.id));
    await pool.query('delete from "session" where sess->>\'userId\' = $1', [operator.id]);
    await db.delete(users).where(eq(users.id, operator.id));
  });

  it("a member's new security is custom to the member's household, never added to the curated list", async () => {
    const body = custom();
    // The body cannot choose another household as owner.
    const created = await signed(app, fixture, "other", "post", "/api/investments/securities")
      .send({ ...body, ownerHouseholdId: fixture.homeHouseholdId }).expect(201);
    const id: string = created.body.data.id;
    expect.soft(created.body.data.ownerHouseholdId, "owner").toBe(fixture.otherHouseholdId);
    expect.soft(await listed("other"), "O lists its own custom security").toContain(id);
    expect.soft(await listed("home"), "H does not list O's custom security").not.toContain(id);
    expect.soft((await signed(app, fixture, "home", "get", `/api/investments/securities/${id}`)).status, "H get").toBe(404);
    // A second custom security with the same symbol in the same household is refused.
    expect.soft((await signed(app, fixture, "other", "post", "/api/investments/securities").send(body)).status, "duplicate").toBe(409);
  });

  it("only the operator adds to the curated list, and every household sees a curated row", async () => {
    const body = custom();
    expect.soft((await signed(app, fixture, "home", "post", "/api/admin/securities").send(body)).status, "household owner").toBe(403);
    const created = await request(app).post("/api/admin/securities").set("Cookie", operator.cookie).send(body);
    expect(created.status, "operator").toBe(201);
    const id: string = created.body.data.id;
    expect.soft(created.body.data.ownerHouseholdId, "curated owner").toBeNull();
    expect.soft(await listed("home"), "H lists the curated row").toContain(id);
    expect.soft(await listed("other"), "O lists the curated row").toContain(id);
  });

  it("keeps O's custom security and its manual price out of everything H reads or writes", async () => {
    const before = await wealth("home");
    const { id, symbol } = await otherHoldsCustom();

    expect.soft(await listed("home"), "H list").not.toContain(id);
    expect.soft((await signed(app, fixture, "home", "get", `/api/investments/securities/${id}`)).status, "H get").toBe(404);
    expect.soft((await signed(app, fixture, "home", "get", `/api/investments/securities/${id}/prices`)).status, "H history").toBe(404);
    expect.soft((await signed(app, fixture, "home", "put", `/api/investments/securities/${id}/price`)
      .send({ price: "1.0000", date: fixture.today, validThrough: fixture.today })).status, "H price write").toBe(404);
    expect.soft((await openHolding("home", id, fixture.homeAccountId)).status, "H opens a holding").toBe(404);
    expect.soft(await db.select().from(holdings).where(eq(holdings.householdId, fixture.homeHouseholdId)), "H holdings").toEqual([]);

    const after = await wealth("home");
    expect.soft(after, "H wealth unchanged").toEqual(before);
    expect.soft(JSON.stringify(after), "H wealth never names the custom security").not.toContain(symbol);
  });

  it("O's manual price on its custom security changes only O's valuation", async () => {
    const homeBefore = await wealth("home");
    await otherHoldsCustom();
    // O: 200.00 cash + 10 x 7.0000.
    expect((await wealth("other")).summary).toMatchObject({ netWorth: 270, currency: "ZMW" });
    expect(await wealth("home")).toEqual(homeBefore);
  });

  it("the database refuses a holding, price or alert that ties a household to another household's custom security", async () => {
    const { id } = await otherHoldsCustom();
    const refused = { code: "23514", constraint: "security_owner_household_scope" };
    await expect(pool.query(`insert into holdings (household_id, account_id, security_id, quantity)
      values ($1, $2, $3, '1')`, [fixture.homeHouseholdId, fixture.homeAccountId, id])).rejects.toMatchObject(refused);
    await expect(pool.query(`insert into household_security_price_overrides
      (household_id, security_id, actor_user_id, effective_date, valid_through, price, currency)
      values ($1, $2, $3, $4, $4, '1', 'ZMW')`, [fixture.homeHouseholdId, id, fixture.home.id, fixture.today])).rejects.toMatchObject(refused);
    await expect(pool.query(`insert into price_alerts (household_id, security_id, alert_type, threshold)
      values ($1, $2, 'above', '1')`, [fixture.homeHouseholdId, id])).rejects.toMatchObject(refused);
    // Moving O's own holding onto H is refused too.
    await expect(pool.query("update holdings set household_id = $1, account_id = $2 where household_id = $3",
      [fixture.homeHouseholdId, fixture.homeAccountId, fixture.otherHouseholdId])).rejects.toMatchObject(refused);
    await expect(pool.query(`insert into recurring_investments (household_id, account_id, security_id, type, frequency, amount, next_execution_date)
      values ($1, $2, $3, 'sip', 'monthly', '10.00', $4)`, [fixture.homeHouseholdId, fixture.homeAccountId, id, fixture.today]))
      .rejects.toMatchObject(refused);
    await expect(pool.query(`insert into investment_transactions (household_id, account_id, security_id, type, amount, transaction_date)
      values ($1, $2, $3, 'buy', '10.00', $4)`, [fixture.homeHouseholdId, fixture.homeAccountId, id, fixture.today]))
      .rejects.toMatchObject(refused);
    // Re-pointing H's own holding of a curated row at O's custom security is refused.
    await pool.query("insert into holdings (household_id, account_id, security_id, quantity) values ($1, $2, $3, '1')",
      [fixture.homeHouseholdId, fixture.homeAccountId, fixture.referenceSecurityId]);
    await expect(pool.query("update holdings set security_id = $1 where household_id = $2", [id, fixture.homeHouseholdId]))
      .rejects.toMatchObject(refused);
    // And a custom security cannot be handed to another household.
    await expect(pool.query("update securities set owner_household_id = $1 where id = $2", [fixture.homeHouseholdId, id]))
      .rejects.toMatchObject(refused);
  });

  it("another household's custom security answers exactly like an unknown id", async () => {
    const { id } = await otherHoldsCustom();
    const unknown = randomUUID();
    const pairs: Array<[string, (target: string) => request.Test]> = [
      ["get", target => signed(app, fixture, "home", "get", `/api/investments/securities/${target}`)],
      ["history", target => signed(app, fixture, "home", "get", `/api/investments/securities/${target}/prices`)],
      ["price write", target => signed(app, fixture, "home", "put", `/api/investments/securities/${target}/price`)
        .send({ price: "1.0000", date: fixture.today, validThrough: fixture.today })],
      ["holding", target => openHolding("home", target, fixture.homeAccountId)],
    ];
    // Only the response time may differ.
    const untimed = (body: { error?: Record<string, unknown> }) =>
      ({ ...body, error: body.error ? { ...body.error, timestamp: undefined } : undefined });
    await setOtherRole(fixture, "owner");
    for (const [label, call] of pairs) {
      const foreign = await call(id);
      const missing = await call(unknown);
      expect.soft(foreign.status, `${label} status`).toBe(missing.status);
      expect.soft(untimed(foreign.body), `${label} body`).toEqual(untimed(missing.body));
    }
  });

  it("reads a visible security's reference history even when the household's own prices overlap", async () => {
    // Overlapping household marks are a valuation conflict, not a reason to hide global history.
    for (const [from, through] of [[fixture.today, fixture.today], ["2000-01-01", fixture.today]]) {
      await pool.query(`insert into household_security_price_overrides
        (household_id, security_id, actor_user_id, effective_date, valid_through, price, currency)
        values ($1, $2, $3, $4, $5, '1', 'ZMW')`, [fixture.homeHouseholdId, fixture.referenceSecurityId, fixture.home.id, from, through]);
    }
    const history = await signed(app, fixture, "home", "get", `/api/investments/securities/${fixture.referenceSecurityId}/prices`);
    expect(history.status).toBe(200);
    expect(history.body.data).toEqual([]);
  });

  it("audits an operator's curated row with the operator and no household", async () => {
    const created = await request(app).post("/api/admin/securities").set("Cookie", operator.cookie).send(custom()).expect(201);
    const { rows } = await pool.query("select * from audit_logs where entity_type = 'security' and entity_id = $1", [created.body.data.id]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ action: "CREATE", user_id: operator.id, household_id: null });
    expect(rows[0].details.newValue).toMatchObject({ symbol: created.body.data.symbol, scope: "curated" });
  });

  it("erasing O's sole member removes O's priced, held custom security and leaves H and the curated list alone", async () => {
    const homeBefore = await wealth("home");
    const { id } = await otherHoldsCustom();
    expect(await eraseAccount({ userId: fixture.other.id, householdId: fixture.otherHouseholdId,
      userEmail: fixture.other.email, ipAddress: "127.0.0.1" })).toEqual({ householdDeleted: true });
    expect.soft(await db.select().from(securities).where(eq(securities.id, id)), "custom row").toEqual([]);
    expect.soft((await pool.query("select id from household_security_price_overrides where security_id = $1", [id])).rows, "its price").toEqual([]);
    expect.soft(await db.select().from(holdings).where(eq(holdings.securityId, id)), "its holding").toEqual([]);
    expect.soft(await db.select({ id: securities.id }).from(securities).where(eq(securities.id, fixture.referenceSecurityId)), "curated row")
      .toEqual([{ id: fixture.referenceSecurityId }]);
    expect.soft(await wealth("home"), "H unchanged").toEqual(homeBefore);
  });

  it("an operator with no household refreshes prices, and the global rows name no household", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Synthetic network boundary")));
    const curatedSymbol = [...fixture.symbols][0];
    provider.quote.mockImplementation(async (asked: string) => asked === curatedSymbol ? { regularMarketPrice: 6 } : {});
    await request(app).post("/api/investments/market/refresh").set("Cookie", operator.cookie).expect(200);
    const { rows } = await pool.query("select user_id, household_id from audit_logs where entity_type = 'security_price' and entity_id = $1",
      [fixture.referenceSecurityId]);
    expect(rows).toEqual([{ user_id: operator.id, household_id: null }]);

    vi.spyOn(marketDataService, "updateFXRates").mockRejectedValue(new Error("Synthetic internal detail"));
    const failed = await request(app).post("/api/investments/market/refresh").set("Cookie", operator.cookie).expect(500);
    expect(JSON.stringify(failed.body), "no internal error text").not.toContain("Synthetic internal detail");
    vi.unstubAllGlobals();
  });

  it("only the operator can start a manual market refresh", async () => {
    const fx = vi.spyOn(marketDataService, "updateFXRates").mockResolvedValue({ updated: 0, failed: 0 } as never);
    const prices = vi.spyOn(marketDataService, "updateSecurityPrices").mockResolvedValue({ updated: 0, failed: 0 });
    await setOtherRole(fixture, "owner");
    expect.soft((await signed(app, fixture, "home", "post", "/api/investments/market/refresh")).status, "H owner").toBe(403);
    expect.soft((await signed(app, fixture, "other", "post", "/api/investments/market/refresh")).status, "O owner").toBe(403);
    expect.soft(fx, "no FX refresh").not.toHaveBeenCalled();
    expect.soft(prices, "no price refresh").not.toHaveBeenCalled();
  });

  it("the provider refresh never quotes or prices a household's custom security", async () => {
    const { id, symbol } = await otherHoldsCustom();
    const curatedSymbol = [...fixture.symbols].find(value => value !== symbol)!;
    provider.quote.mockImplementation(async (asked: string) =>
      asked === symbol || asked === curatedSymbol ? { regularMarketPrice: 5 } : {});
    await marketDataService.updateSecurityPrices();
    expect.soft(provider.quote, "custom symbol sent to the provider").not.toHaveBeenCalledWith(symbol);
    const [customRow] = await db.select().from(securities).where(eq(securities.id, id));
    expect.soft(customRow.currentPrice, "custom global price").toBeNull();
    const [curated] = await db.select().from(securities).where(eq(securities.id, fixture.referenceSecurityId));
    expect.soft(curated.currentPrice, "curated still refreshed").toBe("5.0000");
  });
});
