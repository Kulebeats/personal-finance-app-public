import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { accounts, fxRates, goals, holdings, investmentTransactions, securities, users } from "@shared/schema";
import { hashPassword } from "../../auth";
import { createFXRateRepository, createFXRateService, setGlobalFXService } from "../../core/calculations";
import { db, pool } from "../../db";
import { getTestApp } from "../../__tests__/fixtures";
import { eraseAccount } from "../../modules/settings/settings.account-deletion.service";
import { calculateHoldingsValue } from "../../services/goal/assignment.calculations";
import { createSignedPlan, password, setOtherRole, signed } from "./completion-c3-06.price-confirmation.fixture";
import {
  cleanConfirmationFixture, configureConfirmationCalendar, confirmationPath, createConfirmationFixture,
  occurrencesPath, purchaseRows, seedConfirmationFixture, setPeerRole, tick, type ConfirmationFixture,
} from "./completion-c3-06.sip-confirmation.fixture";

// C3-06 proof: household A ("other") acts with full owner authority in its own
// household. Nothing it enters may change what household B's ("home") scheduled
// purchase records or how B's holdings are valued. Every entry by A and every
// read by B goes through the real HTTP routes against real Postgres.
let app: Awaited<ReturnType<typeof getTestApp>>;
let passwordHash: string;
let fixture: ConfirmationFixture;
let homeBrokerageId: string;
let createdSecurityIds: string[] = [];

const A_PRICE = "9.0000";
const A_GLOBAL_ATTEMPT = "9.5000";
const B_FILL_PRICE = "2.5000";

function pricePath() {
  return `/api/investments/securities/${fixture.referenceSecurityId}/price`;
}

async function readValuation(actor: "home" | "other") {
  const holdingsBody = (await signed(app, fixture, actor, "get", "/api/investments/holdings")
    .query({ currency: "ZMW" }).expect(200)).body;
  const summaryBody = (await signed(app, fixture, actor, "get", "/api/accounts/summary").expect(200)).body;
  const securityBody = (await signed(app, fixture, actor, "get",
    `/api/investments/securities/${fixture.referenceSecurityId}`).expect(200)).body;
  return { holdings: holdingsBody, summary: summaryBody, security: securityBody };
}

async function deleteHouseholdPriceRows(householdIds: string[]) {
  // Guarded so the suite can also run against the pre-C3-06 schema.
  const present = await pool.query<{ name: string | null }>(
    "select to_regclass('public.household_security_price_overrides')::text as name");
  if (!present.rows[0].name) return;
  await pool.query("delete from household_security_price_overrides where household_id=any($1::uuid[])", [householdIds]);
}

describe("C3-06 two-household isolation of manual prices and scheduled purchases", () => {
  beforeAll(async () => {
    app = await getTestApp();
    passwordHash = await hashPassword(password);
    setGlobalFXService(createFXRateService(createFXRateRepository(db, fxRates)));
  });

  beforeEach(async () => {
    fixture = createConfirmationFixture();
    await seedConfirmationFixture(fixture, app, passwordHash);
    homeBrokerageId = randomUUID();
    // B's existing position sits in a separate account so the scheduled plan's
    // custody account starts empty; A holds the same shared instrument.
    await db.insert(accounts).values({
      id: homeBrokerageId, householdId: fixture.homeHouseholdId, name: "C3-06 home brokerage",
      type: "investment", currency: "ZMW", initialBalance: "0.00", balance: "0.00",
      isPrivate: false, ownerUserId: fixture.home.id,
    });
    await db.insert(holdings).values([
      { householdId: fixture.homeHouseholdId, accountId: homeBrokerageId,
        securityId: fixture.referenceSecurityId, quantity: "100", costBasis: "100.00" },
      { householdId: fixture.otherHouseholdId, accountId: fixture.otherAccountId,
        securityId: fixture.referenceSecurityId, quantity: "100", costBasis: "100.00" },
    ]);
  });

  afterEach(async () => {
    if (!fixture) return;
    await deleteHouseholdPriceRows([fixture.homeHouseholdId, fixture.otherHouseholdId]);
    await db.delete(goals).where(inArray(goals.householdId, [fixture.homeHouseholdId, fixture.otherHouseholdId]));
    if (createdSecurityIds.length) await db.delete(securities).where(inArray(securities.id, createdSecurityIds));
    createdSecurityIds = [];
    await cleanConfirmationFixture(fixture);
  });

  it("keeps everything household A enters out of household B's scheduled purchase and valuation", async () => {
    await setOtherRole(fixture, "owner");
    const plan = await createSignedPlan(app, fixture);
    const before = await readValuation("home");
    // 100.00 custody cash + 0.00 brokerage cash + 100 units at the 2.00 reference.
    expect(before.summary.data).toMatchObject({ netWorth: 300, currency: "ZMW" });

    // A, as owner of its own household, enters a dated manual price and also
    // tries the old open-ended form that used to rewrite the shared catalogue.
    await signed(app, fixture, "other", "put", pricePath())
      .send({ price: A_PRICE, date: fixture.today, validThrough: fixture.today });
    await signed(app, fixture, "other", "put", pricePath())
      .send({ price: A_GLOBAL_ATTEMPT, date: fixture.today });

    // B's holdings, summary and instrument read are exactly as before.
    expect(await readValuation("home")).toEqual(before);

    // A's own price did take effect, in A only: 200.00 cash + 100 x 9.0000.
    const otherView = await readValuation("other");
    expect(otherView.summary.data).toMatchObject({ netWorth: 1100 });
    expect(otherView.security.data.valuationPrice).toMatchObject({
      source: "manual", effectiveDate: fixture.today, validThrough: fixture.today,
    });

    // A cannot confirm B's occurrence either, whatever it claims was filled.
    // B's due plan is not executed by the scheduler at any price: it waits.
    await tick(app);
    expect(await purchaseRows(fixture)).toEqual([]);
    const pending = await signed(app, fixture, "home", "get", occurrencesPath(plan.id)).expect(200);
    expect(pending.body.data).toEqual([expect.objectContaining({
      planId: plan.id, scheduledDate: fixture.today, state: "pending", occurrenceRevision: 0,
    })]);
    const foreignFill = { executionDate: fixture.today, quantity: "1.00000000", price: A_PRICE, fees: "0.00" };
    await signed(app, fixture, "other", "post", confirmationPath(plan.id, fixture.today))
      .send({ operationId: randomUUID(), expectedRevision: 0, finalStatement: true,
        outcome: "filled", fills: [foreignFill] })
      .expect(404);
    expect(await purchaseRows(fixture)).toEqual([]);

    // B confirms from its own final statement; only B's evidence is recorded.
    await configureConfirmationCalendar(app, fixture);
    const fill = { executionDate: fixture.today, quantity: "4.00000000", price: B_FILL_PRICE, fees: "0.00" };
    await signed(app, fixture, "home", "post", confirmationPath(plan.id, fixture.today))
      .send({ operationId: randomUUID(), expectedRevision: 0, finalStatement: true,
        outcome: "filled", fills: [fill] })
      .expect(200);
    const purchases = await purchaseRows(fixture);
    expect(purchases).toHaveLength(1);
    expect(purchases[0]).toMatchObject({
      householdId: fixture.homeHouseholdId, accountId: fixture.homeAccountId, type: "buy",
      transactionDate: fill.executionDate, quantity: fill.quantity, price: B_FILL_PRICE,
      fees: "0.00", amount: "10.00", currency: "ZMW",
    });
    const otherPurchases = await db.select().from(investmentTransactions)
      .where(inArray(investmentTransactions.householdId, [fixture.otherHouseholdId]));
    expect(otherPurchases).toEqual([]);

    // B's new position is still valued at the shared reference, never A's mark:
    // 100.00 + 0.00 cash + 104 units at 2.00.
    const after = await readValuation("home");
    expect(after.summary.data).toMatchObject({ netWorth: 308 });
    expect(after.security.data).toMatchObject({ valuationPrice: null });
    // Holdings values are MoneyDto in the base currency (NEW-35 class).
    const rows = after.holdings.data as Array<{ currentValue: { amount: string; currency: string };
      security: { valuationPrice: unknown } }>;
    expect(rows.map(row => row.currentValue)).toHaveLength(2);
    expect(rows.map(row => row.currentValue)).toEqual(expect.arrayContaining([
      { amount: "8.00", currency: "ZMW" }, { amount: "200.00", currency: "ZMW" },
    ]));
    for (const row of rows) expect(row.security.valuationPrice).toBeNull();
  });

  it("never lets a security household A creates or prices carry A's price into household B", async () => {
    await setOtherRole(fixture, "owner");
    const symbol = `C306X${randomUUID().slice(0, 8)}`;
    const metadata = { symbol, name: "C3-06 household-created security", type: "stock", currency: "ZMW" };

    // A cannot put a price on the shared catalogue when it creates a security.
    await signed(app, fixture, "other", "post", "/api/investments/securities")
      .send({ ...metadata, currentPrice: "7.0000" }).expect(400);
    expect(await db.select().from(securities).where(eq(securities.symbol, symbol))).toEqual([]);

    const created = await signed(app, fixture, "other", "post", "/api/investments/securities")
      .send(metadata).expect(201);
    const securityId: string = created.body.data.id;
    createdSecurityIds.push(securityId);
    expect(created.body.data).toMatchObject({ currentPrice: null, lastPriceUpdate: null });

    // A's owner then edits the price; that is A's own dated household price.
    await signed(app, fixture, "other", "put", `/api/investments/securities/${securityId}/price`)
      .send({ price: "7.0000", date: fixture.today, validThrough: fixture.today }).expect(200);
    const otherRead = await signed(app, fixture, "other", "get", `/api/investments/securities/${securityId}`).expect(200);
    expect(otherRead.body.data).toMatchObject({ currentPrice: "7.0000",
      valuationPrice: expect.objectContaining({ source: "manual" }) });

    // The stored row is untouched. NEW-13: A's security is A's custom row, so B
    // cannot read it at all, let alone a price from A.
    const [stored] = await db.select().from(securities).where(eq(securities.id, securityId));
    expect(stored).toMatchObject({ currentPrice: null, lastPriceUpdate: null, ownerHouseholdId: fixture.otherHouseholdId });
    await signed(app, fixture, "home", "get", `/api/investments/securities/${securityId}`).expect(404);
    const catalogue = await signed(app, fixture, "home", "get", "/api/investments/securities").expect(200);
    const listed = (catalogue.body.data as Array<{ id: string }>).find(row => row.id === securityId);
    expect(listed).toBeUndefined();
  });

  it("values each household's holdings-backed goal at its own price, never the other household's", async () => {
    await setOtherRole(fixture, "owner");
    const goalFor = (householdId: string, linkedAccountId: string) => ({
      householdId, linkedAccountId, name: "C3-06 holdings goal", targetAmount: "10000.00",
      currency: "ZMW", type: "investment" as const, progressSource: "holdings" as const,
    });
    const [homeGoal, otherGoal] = await db.insert(goals).values([
      goalFor(fixture.homeHouseholdId, homeBrokerageId),
      goalFor(fixture.otherHouseholdId, fixture.otherAccountId),
    ]).returning({ id: goals.id });
    const progress = async (actor: "home" | "other", goalId: string) =>
      (await signed(app, fixture, actor, "get", `/api/goals/${goalId}`).expect(200)).body.data.currentAmount;

    // 100 units each at the 2.00 shared reference.
    expect(await progress("home", homeGoal.id)).toMatchObject({ amount: expect.stringMatching(/^200(\.00)?$/) });
    expect(await progress("other", otherGoal.id)).toMatchObject({ amount: expect.stringMatching(/^200(\.00)?$/) });

    await signed(app, fixture, "other", "put", pricePath())
      .send({ price: A_PRICE, date: fixture.today, validThrough: fixture.today }).expect(200);

    // A's goal follows A's dated price (100 x 9.0000); B's stays on the reference.
    expect(await progress("other", otherGoal.id)).toMatchObject({ amount: expect.stringMatching(/^900(\.00)?$/) });
    expect(await progress("home", homeGoal.id)).toMatchObject({ amount: expect.stringMatching(/^200(\.00)?$/) });
    expect((await calculateHoldingsValue([fixture.otherAccountId], "ZMW", fixture.otherHouseholdId, db)).toString())
      .toBe("900.00");
    expect((await calculateHoldingsValue([homeBrokerageId], "ZMW", fixture.homeHouseholdId, db)).toString())
      .toBe("200.00");
  });

  it("keeps an erased author's manual price as household evidence under the anonymised identity", async () => {
    // Same convention as completed purchase proofs and financial audits: the
    // shared record survives with the author UUID of the anonymised users row,
    // and the surviving household's valuation does not move.
    await setPeerRole(fixture, "admin");
    const peer = fixture.peer;
    await request(app).put(pricePath()).set("Cookie", peer.cookie)
      .set("X-Capital-Subject", peer.id).set("X-Capital-Household", peer.householdId)
      .send({ price: A_PRICE, date: fixture.today, validThrough: fixture.today }).expect(200);
    const before = await readValuation("home");
    expect(before.security.data.valuationPrice).toMatchObject({ source: "manual" });
    const priceRows = async () => (await pool.query(
      "select * from household_security_price_overrides where household_id=$1 order by id", [fixture.homeHouseholdId])).rows;
    const recorded = await priceRows();
    expect(recorded).toEqual([expect.objectContaining({ actor_user_id: peer.id, price: A_PRICE })]);

    await eraseAccount({ userId: peer.id, householdId: fixture.homeHouseholdId, userEmail: peer.email });

    const [identity] = await db.select().from(users).where(eq(users.id, peer.id));
    expect(identity.erasedAt).not.toBeNull();
    expect(identity.email).not.toBe(peer.email);
    expect(await priceRows()).toEqual(recorded);
    expect(await readValuation("home")).toEqual(before);
  });

  it.each(["0", "0.0000", "-1.0000"])("refuses the non-positive manual price %s over HTTP and in storage", async price => {
    await setOtherRole(fixture, "owner");
    const refused = await signed(app, fixture, "other", "put", pricePath())
      .send({ price, date: fixture.today, validThrough: fixture.today }).expect(400);
    expect(refused.body.error.code).toBe("VALIDATION_ERROR");
    await expect(pool.query(`insert into household_security_price_overrides
      (household_id,security_id,actor_user_id,effective_date,valid_through,price,currency)
      values ($1,$2,$3,$4,$4,$5,'ZMW')`,
    [fixture.otherHouseholdId, fixture.referenceSecurityId, fixture.other.id, fixture.today, price]))
      .rejects.toMatchObject({ code: "23514", constraint: "household_security_price_override_price_ck" });
    const stored = await pool.query("select 1 from household_security_price_overrides where household_id=$1",
      [fixture.otherHouseholdId]);
    expect(stored.rows).toEqual([]);
  });
});
