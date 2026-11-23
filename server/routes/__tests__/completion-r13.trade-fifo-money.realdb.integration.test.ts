import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { holdings, investmentTransactions, securities, taxLotDisposals, taxLots, householdFxRateOverrides } from "@shared/schema";
import { db, pool } from "../../db";
import { a, actors, app, ids, reset, start, stop } from "../../modules/tags/__tests__/completion-r04.tags.fixture";
import { seedDatedFxRate } from "../../testing/fixtures/dated-fx-rate";

const securityId = randomUUID(), holdingId = randomUUID();
function trade(type: "buy" | "sell", quantity: string, price: string, amount: string, date: string, fees?: string,
  conversion: { amountZmw?: string; fxRate?: string; currency?: string } = {}) {
  const actor = actors.get("member")!;
  return request(app).post("/api/investments/transactions").set("Cookie", actor.cookie)
    .set("X-Capital-Subject", actor.id).set("X-Capital-Household", a)
    .send({ accountId: ids.sharedAccount, securityId, holdingId, type, quantity, price, amount,
      transactionDate: date, currency: "ZMW", fees, ...conversion });
}
async function clear() {
  await db.delete(taxLotDisposals).where(eq(taxLotDisposals.holdingId, holdingId));
  await db.delete(taxLots).where(eq(taxLots.holdingId, holdingId));
  await db.delete(investmentTransactions).where(eq(investmentTransactions.holdingId, holdingId));
  await db.delete(holdings).where(eq(holdings.id, holdingId));
  await db.delete(securities).where(eq(securities.id, securityId));
  await db.delete(householdFxRateOverrides).where(eq(householdFxRateOverrides.householdId, a));
}
async function totals() {
  return (await pool.query(`SELECT sum(proceeds)::text AS proceeds, sum(cost_basis)::text AS basis,
    sum(realized_gain)::text AS gain, bool_and(realized_gain=proceeds-cost_basis) AS reconciled
    FROM tax_lot_disposals WHERE holding_id=$1`, [holdingId])).rows[0];
}

describe("Manual investment trades reconcile their signed amounts to persisted FIFO rows", () => {
  beforeAll(start, 30_000);
  beforeEach(async () => {
    await reset();
    await db.insert(securities).values({ id: securityId, symbol: "SYN_FIFO", name: "Synthetic FIFO security", type: "stock", currency: "ZMW" });
    await db.insert(holdings).values({ id: holdingId, householdId: a, accountId: ids.sharedAccount, securityId, quantity: "0" });
  });
  afterEach(clear);
  afterAll(stop);

  it("allocates one sale's full proceeds across three FIFO lots", async () => {
    for (const date of ["2031-01-01", "2031-01-02", "2031-01-03"]) await trade("buy", "1", "0.20", "0.20", date).expect(201);
    await trade("sell", "3", "0.3333", "1.00", "2031-02-01").expect(201);
    expect(await totals()).toEqual({ proceeds: "1.00", basis: "0.60", gain: "0.40", reconciled: true });
  });

  it("fully recovers one lot's basis across separate partial sales", async () => {
    await trade("buy", "3", "0.3333", "1.00", "2031-01-01").expect(201);
    for (const date of ["2031-02-01", "2031-02-02", "2031-02-03"]) await trade("sell", "1", "1.00", "1.00", date).expect(201);
    expect(await totals()).toEqual({ proceeds: "3.00", basis: "1.00", gain: "2.00", reconciled: true });
  });

  it("retains an explicitly recorded acquisition fee and its fee-inclusive lot basis", async () => {
    const created = await trade("buy", "10", "5", "51.00", "2031-01-01", "1.00").expect(201);
    const [activity] = await db.select().from(investmentTransactions).where(eq(investmentTransactions.id, created.body.data.id));
    const [lot] = await db.select().from(taxLots).where(eq(taxLots.transactionId, activity.id));
    expect.soft(activity).toMatchObject({ fees: "1.00", amount: "51.00" });
    expect(lot).toMatchObject({ householdId: a, holdingId, quantity: "10.00000000", remainingQuantity: "10.00000000",
      costBasis: "51.00", acquiredDate: "2031-01-01", acquisitionFxRate: null, costBasisZmw: null });
  });

  it("sells eight shares against the first two lots in purchase order", async () => {
    const first = await trade("buy", "5", "10", "50.00", "2031-01-01").expect(201);
    const second = await trade("buy", "5", "12", "60.00", "2031-01-02").expect(201);
    const sale = await trade("sell", "8", "20", "160.00", "2031-02-01").expect(201);
    const { rows } = await pool.query(`SELECT l.transaction_id AS purchase, l.remaining_quantity AS remaining, d.quantity,
      d.disposed_date::text AS date, d.proceeds, d.cost_basis AS basis, d.realized_gain AS gain FROM tax_lot_disposals d JOIN tax_lots l ON l.id=d.tax_lot_id
      WHERE d.transaction_id=$1 ORDER BY l.acquired_date`, [sale.body.data.id]);
    expect(rows).toEqual([
      { purchase: first.body.data.id, date: "2031-02-01", remaining: "0.00000000", quantity: "5.00000000", proceeds: "100.00", basis: "50.00", gain: "50.00" },
      { purchase: second.body.data.id, date: "2031-02-01", remaining: "2.00000000", quantity: "3.00000000", proceeds: "60.00", basis: "36.00", gain: "24.00" },
    ]);
  });

  it("records sale fees and allocates net proceeds without subtracting fees twice", async () => {
    await trade("buy", "5", "10", "50.00", "2031-01-01").expect(201);
    const sale = await trade("sell", "5", "11", "53.75", "2031-02-01", "1.25").expect(201);
    const [stored] = await db.select().from(investmentTransactions).where(eq(investmentTransactions.id, sale.body.data.id));
    expect(stored).toMatchObject({ amount: "53.75", fees: "1.25" });
    expect(await totals()).toEqual({ proceeds: "53.75", basis: "50.00", gain: "3.75", reconciled: true });
  });

  it("rejects unrepresentable or contradictory trades before recording any financial effect", async () => {
    for (const [quantity, price, amount, fees] of [
      ["-1", "1", "1.00", "0"], ["0", "1", "0.00", "0"], ["0.000000001", "1", "0.00", "0"],
      ["1", "1.00001", "1.00", "0"], ["1", "1", "1.009", "0"], ["1", "1", "1.00", "-1"], ["1", "1", "1.00", "0.10"],
    ]) {
      await trade("buy", quantity, price, amount, "2031-01-01", fees).expect(400);
    }
    expect(await db.select().from(investmentTransactions).where(eq(investmentTransactions.holdingId, holdingId))).toEqual([]);
    expect(await db.select().from(taxLots).where(eq(taxLots.holdingId, holdingId))).toEqual([]);
  });

  it("preserves a booked sale's FIFO order while permitting a harmless historical purchase", async () => {
    await trade("buy", "1", "10", "10", "2031-01-01").expect(201);
    await trade("buy", "1", "20", "20", "2031-01-02").expect(201);
    await trade("sell", "1", "30", "30", "2031-03-01").expect(201);
    await trade("sell", "1", "25", "25", "2031-02-01").expect(409);
    await trade("buy", "1", "3", "3", "2030-12-01").expect(409);
    expect(await totals()).toEqual({ proceeds: "30.00", basis: "10.00", gain: "20.00", reconciled: true });
    expect(await db.select().from(investmentTransactions).where(eq(investmentTransactions.holdingId, holdingId))).toHaveLength(3);
    const [holding] = await db.select().from(holdings).where(eq(holdings.id, holdingId));
    expect(holding.quantity).toBe("1.00000000");
    await trade("buy", "1", "4", "4", "2031-02-01").expect(201);
    await trade("buy", "1", "4", "4", "2031-01-01").expect(201);
  });

  it("detects missing sale evidence even on exhausted lots", async () => {
    await trade("buy", "1", "10", "10", "2031-01-01").expect(201);
    await trade("buy", "1", "20", "20", "2031-01-02").expect(201);
    const sale = await trade("sell", "1", "30", "30", "2031-03-01").expect(201);
    await db.delete(investmentTransactions).where(eq(investmentTransactions.id, sale.body.data.id));
    await trade("buy", "1", "3", "3", "2030-12-01").expect(409);
    await trade("sell", "1", "25", "25", "2031-02-01").expect(409);
    expect(await db.select().from(taxLots).where(eq(taxLots.holdingId, holdingId))).toHaveLength(2);
    expect((await db.select().from(holdings).where(eq(holdings.id, holdingId)))[0].quantity).toBe("1.00000000");
  });

  it("uses the actual same-day FIFO tie key for an already booked sale", async () => {
    const buy = await trade("buy", "1", "10", "10", "2031-01-01").expect(201);
    await trade("sell", "1", "15", "15", "2031-01-01").expect(201);
    await trade("buy", "1", "14", "14", "2031-01-01").expect(201);
    // Model a competing writer whose database transaction began before the booked lot's.
    await db.update(taxLots).set({ createdAt: new Date("2099-01-01T00:00:00Z") }).where(eq(taxLots.transactionId, buy.body.data.id));
    await trade("buy", "1", "13", "13", "2031-01-01").expect(409);
    expect(await totals()).toEqual({ proceeds: "15.00", basis: "10.00", gain: "5.00", reconciled: true });
  });

  it("rejects contradictory or unrepresentable ZMW equivalents and accepts a fully fee-offset sale", async () => {
    await trade("buy", "1", "10", "10", "2031-01-01").expect(201);
    for (const conversion of [
      { amountZmw: "-50", fxRate: "-2" }, { amountZmw: "9.99" }, { fxRate: "0" }, { fxRate: "2" },
      { fxRate: "1.00001" }, { amountZmw: "10.001" }, { amountZmw: "NaN" },
    ]) await trade("sell", "1", "10", "10", "2031-02-01", undefined, conversion).expect(400);
    await trade("sell", "1", "10", "0", "2031-02-01", "10", { amountZmw: "0", fxRate: "1" }).expect(201);
    expect(await totals()).toEqual({ proceeds: "0.00", basis: "10.00", gain: "-10.00", reconciled: true });
  });

  it("rejects inconsistent foreign settlement evidence", async () => {
    await db.update(securities).set({ currency: "USD" }).where(eq(securities.id, securityId));
    await seedDatedFxRate(a, actors.get("owner")!.id, "20");
    await trade("buy", "1", "10", "10", "2031-01-01", undefined,
      { currency: "USD", amountZmw: "99", fxRate: "20" }).expect(400);
    expect(await db.select().from(taxLots).where(eq(taxLots.holdingId, holdingId))).toEqual([]);
    await trade("buy", "1", "10", "10", "2031-01-01", undefined, { currency: "USD" }).expect(201);
    await trade("sell", "1", "10", "0", "2031-02-01", "10", { currency: "USD", amountZmw: "100" }).expect(400);
    await trade("sell", "1", "10", "0", "2031-02-01", "10", { currency: "USD", amountZmw: "0" }).expect(201);
    expect(await totals()).toEqual({ proceeds: "0.00", basis: "10.00", gain: "-10.00", reconciled: true });
  });

  it("cannot dispose of a purchase dated after the sale", async () => {
    await trade("buy", "1", "10", "10.00", "2031-02-01").expect(201);
    await trade("sell", "1", "11", "11.00", "2031-01-01").expect(409);
    expect((await db.select().from(investmentTransactions).where(eq(investmentTransactions.holdingId, holdingId)))).toHaveLength(1);
    expect(await db.select().from(taxLotDisposals).where(eq(taxLotDisposals.holdingId, holdingId))).toEqual([]);
  });
});
