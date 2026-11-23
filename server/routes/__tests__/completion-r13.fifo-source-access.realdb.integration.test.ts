import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { accounts, auditLogs, holdings, investmentTransactions, securities, taxLotDisposals, taxLots, transactions, householdFxRateOverrides } from "@shared/schema";
import { db, pool } from "../../db";
import { a, b, actors, app, ids, reset, start, stop, type Role } from "../../modules/tags/__tests__/completion-r04.tags.fixture";
import { seedDatedFxRate } from "../../testing/fixtures/dated-fx-rate";

const securityId = randomUUID(), holdingId = randomUUID(), otherHolding = randomUUID();
let purchaseId: string, lotId: string;
const deniedMessage = "Investment sale sources are unavailable";
function trade(type: "buy" | "sell", quantity = "1", price = "100.00", amount = "100.00", role: Role = "member", currency = "ZMW", date = "2031-02-01") {
  return request(app).post("/api/investments/transactions").set("Cookie", actors.get(role)!.cookie)
    .set("X-Capital-Subject", actors.get(role)!.id).set("X-Capital-Household", a)
    .send({ accountId: ids.sharedAccount, securityId, holdingId, type, quantity, price, amount, currency, transactionDate: date });
}
async function cash(privateSource = false, amount = "100.00", type: "expense" | "income" = "expense", currency = "ZMW") {
  // Controlled legacy link: actual normal trades create the economic lot and
  // disposal; this independently owned cash source tests current visibility.
  const [row] = await db.insert(transactions).values({ householdId: a, accountId: ids.sharedAccount, ownerUserId: actors.get("owner")!.id,
    isPrivate: privateSource, name: "Synthetic FIFO cash source", type, amount, currency, date: "2031-01-01" }).returning();
  return row.id;
}
async function clean() {
  await db.delete(taxLotDisposals).where(inArray(taxLotDisposals.householdId, [a, b]));
  await db.delete(taxLots).where(inArray(taxLots.householdId, [a, b]));
  await db.delete(investmentTransactions).where(inArray(investmentTransactions.householdId, [a, b]));
  await db.delete(holdings).where(inArray(holdings.householdId, [a, b]));
  await db.delete(securities).where(eq(securities.id, securityId));
  await db.delete(householdFxRateOverrides).where(inArray(householdFxRateOverrides.householdId, [a, b]));
}
async function effects(ignore: { lotId?: string; disposalId?: string } = {}) {
  const result = {
    holdings: await db.select().from(holdings).where(inArray(holdings.householdId, [a, b])).orderBy(holdings.id),
    lots: await db.select().from(taxLots).where(inArray(taxLots.householdId, [a, b])).orderBy(taxLots.id),
    disposals: await db.select().from(taxLotDisposals).where(inArray(taxLotDisposals.householdId, [a, b])).orderBy(taxLotDisposals.id),
    activity: await db.select({ id: investmentTransactions.id, type: investmentTransactions.type, amount: investmentTransactions.amount, quantity: investmentTransactions.quantity })
      .from(investmentTransactions).where(inArray(investmentTransactions.householdId, [a, b])).orderBy(investmentTransactions.id),
    audit: await db.select().from(auditLogs).where(eq(auditLogs.entityType, "investment_transaction")).orderBy(auditLogs.id),
  };
  return { ...result, lots: result.lots.filter(row => row.id !== ignore.lotId), disposals: result.disposals.filter(row => row.id !== ignore.disposalId) };
}
function expectDenied(response: request.Response) {
  expect.soft(response.status).toBe(409); expect.soft(response.body.error).toMatchObject({ code: "CONFLICT", message: deniedMessage });
  for (const secret of [purchaseId, holdingId, lotId, "100.00", "55P03", "could not obtain lock"]) expect.soft(response.text).not.toContain(secret);
}

describe("R13 FIFO refuses inaccessible or unsupported basis without skipping to a newer lot", () => {
  beforeAll(start, 30_000);
  beforeEach(async () => {
    await clean(); await reset(); await seedDatedFxRate(a, actors.get("owner")!.id, "20");
    await db.insert(securities).values({ id: securityId, symbol: "R13_FIFO_SOURCE", name: "Synthetic source-bound FIFO", type: "stock", currency: "ZMW" });
    await db.insert(holdings).values([
      { id: holdingId, householdId: a, accountId: ids.sharedAccount, securityId, quantity: "0", costBasis: "0" },
      { id: otherHolding, householdId: a, accountId: ids.privateAccount, securityId, quantity: "0", costBasis: "0" },
    ]);
    const created = await trade("buy", "1", "100.00", "100.00", "owner", "ZMW", "2031-01-01").expect(201);
    purchaseId = created.body.data.id;
    lotId = (await db.select().from(taxLots).where(eq(taxLots.transactionId, purchaseId)))[0].id;
  });
  afterEach(clean);
  afterAll(async () => { await clean(); await stop(); });

  it("keeps an ordinary visible acquisition and its exact native gain supported", async () => {
    await trade("sell", "1", "120.00", "120.00").expect(201);
    expect((await db.select().from(taxLotDisposals).where(eq(taxLotDisposals.taxLotId, lotId)))[0]).toMatchObject({ proceeds: "120.00", costBasis: "100.00", realizedGain: "20.00" });
  });
  it("allows the actual owner to use independently private acquisition cash", async () => {
    await db.update(investmentTransactions).set({ linkedTransactionId: await cash(true) }).where(eq(investmentTransactions.id, purchaseId));
    await trade("sell", "1", "120.00", "120.00", "owner").expect(201);
    expect((await db.select().from(taxLotDisposals).where(eq(taxLotDisposals.taxLotId, lotId)))[0].costBasis).toBe("100.00");
  });
  it.each(["private acquisition account", "private cash", "foreign cash", "cash denomination", "foreign acquisition", "wrong holding", "missing purchase", "foreign currency", "changed instrument currency", "changed native basis", "changed quantity", "changed acquisition date"])(
    "rolls back the whole sale for %s with the same source-free error", async source => {
      if (source === "private acquisition account") await db.update(investmentTransactions).set({ accountId: ids.privateAccount }).where(eq(investmentTransactions.id, purchaseId));
      if (source === "private cash") await db.update(investmentTransactions).set({ linkedTransactionId: await cash(true) }).where(eq(investmentTransactions.id, purchaseId));
      if (source === "foreign cash") await db.update(investmentTransactions).set({ linkedTransactionId: ids.foreignTx }).where(eq(investmentTransactions.id, purchaseId));
      if (source === "cash denomination") await db.update(investmentTransactions).set({ linkedTransactionId: await cash(false, "100.00", "expense", "USD") }).where(eq(investmentTransactions.id, purchaseId));
      if (source === "foreign acquisition") await db.update(investmentTransactions).set({ householdId: b }).where(eq(investmentTransactions.id, purchaseId));
      if (source === "wrong holding") await db.update(investmentTransactions).set({ holdingId: otherHolding }).where(eq(investmentTransactions.id, purchaseId));
      if (source === "missing purchase") await db.delete(investmentTransactions).where(eq(investmentTransactions.id, purchaseId));
      if (source === "foreign currency") await db.update(investmentTransactions).set({ currency: "USD" }).where(eq(investmentTransactions.id, purchaseId));
      if (source === "changed instrument currency") await db.update(securities).set({ currency: "USD" }).where(eq(securities.id, securityId));
      if (source === "changed native basis") await db.update(taxLots).set({ costBasis: "90.00" }).where(eq(taxLots.id, lotId));
      if (source === "changed quantity") await db.update(taxLots).set({ quantity: "2", remainingQuantity: "2" }).where(eq(taxLots.id, lotId));
      if (source === "changed acquisition date") await db.update(investmentTransactions).set({ transactionDate: "2030-12-31" }).where(eq(investmentTransactions.id, purchaseId));
      const before = await effects();
      expectDenied(await trade("sell", "1", "120.00", "120.00", "member", source === "changed instrument currency" ? "USD" : "ZMW"));
      expect(await effects()).toEqual(before);
    });
  it.each(["private cash", "foreign lot"])("cannot replace an earlier inaccessible %s lot with a newer public one", async source => {
    // Book the genuine newer purchase while both authoritative sources are
    // coherent; the later withdrawal must still block the attempted sale.
    await trade("buy", "1", "110.00", "110.00", "member", "ZMW", "2031-01-02").expect(201);
    if (source === "private cash") await db.update(investmentTransactions).set({ linkedTransactionId: await cash(true) }).where(eq(investmentTransactions.id, purchaseId));
    else await db.update(taxLots).set({ householdId: b }).where(eq(taxLots.id, lotId));
    const before = await effects(); expectDenied(await trade("sell", "1", "120.00", "120.00")); expect(await effects()).toEqual(before);
  });
  it.each(["same holding", "other holding"])("refuses multiple lots claiming the same actual BUY, including a duplicate in %s", async scope => {
    const [original] = await db.select().from(taxLots).where(eq(taxLots.id, lotId));
    await db.insert(taxLots).values({ ...original, id: randomUUID(), holdingId: scope === "same holding" ? holdingId : otherHolding });
    // One legitimate opening share has no additional purchase-basis evidence.
    if (scope === "same holding") await db.update(holdings).set({ quantity: "2" }).where(eq(holdings.id, holdingId));
    const before = await effects();
    expectDenied(await trade("sell", scope === "same holding" ? "2" : "1", "120.00", scope === "same holding" ? "240.00" : "120.00"));
    expect(await effects()).toEqual(before);
  });
  it.each(["same lot", "exhausted sibling"])("refuses duplicated quantity/proceeds backed by one actual prior SELL across %s allocations", async scope => {
    await db.delete(taxLots).where(eq(taxLots.holdingId, holdingId)); await db.delete(investmentTransactions).where(eq(investmentTransactions.holdingId, holdingId));
    await db.update(holdings).set({ quantity: "0", costBasis: "0", costBasisZmw: "0", acquisitionFxRate: null }).where(eq(holdings.id, holdingId));
    const bought = await trade("buy", scope === "same lot" ? "3" : "2", "10.00", scope === "same lot" ? "30.00" : "20.00", "owner", "ZMW", "2031-01-01").expect(201);
    purchaseId = bought.body.data.id; lotId = (await db.select().from(taxLots).where(eq(taxLots.transactionId, purchaseId)))[0].id;
    let duplicateLot = lotId;
    if (scope === "exhausted sibling") {
      const sibling = await trade("buy", "1", "10.00", "10.00", "owner", "ZMW", "2031-01-02").expect(201);
      duplicateLot = (await db.select().from(taxLots).where(eq(taxLots.transactionId, sibling.body.data.id)))[0].id;
    }
    const first = await trade("sell", "1", "20.00", "20.00", "owner", "ZMW", "2031-01-15").expect(201);
    const [original] = await db.select().from(taxLotDisposals).where(eq(taxLotDisposals.transactionId, first.body.data.id));
    await db.insert(taxLotDisposals).values({ ...original, id: randomUUID(), taxLotId: duplicateLot });
    await db.update(taxLots).set({ remainingQuantity: scope === "same lot" ? "1" : "0" }).where(eq(taxLots.id, duplicateLot));
    await db.update(holdings).set({ quantity: "1" }).where(eq(holdings.id, holdingId));
    const before = await effects(); expectDenied(await trade("sell", "1", "30.00", "30.00")); expect(await effects()).toEqual(before);
  });
  it.each(["private closing account", "private closing cash", "foreign closing", "closing currency", "disposal date", "disposal household", "missing closing"])(
    "rechecks the prior contributing %s before a later partial sale", async source => {
      // Use one two-share original lot for a genuine partial disposition.
      await db.update(holdings).set({ quantity: "0", costBasis: "0", costBasisZmw: "0", acquisitionFxRate: null }).where(eq(holdings.id, holdingId));
      await db.delete(taxLots).where(eq(taxLots.holdingId, holdingId));
      await db.delete(investmentTransactions).where(eq(investmentTransactions.holdingId, holdingId));
      const bought = await trade("buy", "2", "50.00", "100.00", "owner", "ZMW", "2031-01-01").expect(201);
      purchaseId = bought.body.data.id; lotId = (await db.select().from(taxLots).where(eq(taxLots.transactionId, purchaseId)))[0].id;
      const first = await trade("sell", "1", "60.00", "60.00", "owner", "ZMW", "2031-01-15").expect(201);
      if (source === "private closing account") await db.update(investmentTransactions).set({ accountId: ids.privateAccount }).where(eq(investmentTransactions.id, first.body.data.id));
      if (source === "private closing cash") await db.update(investmentTransactions).set({ linkedTransactionId: await cash(true, "60.00", "income") }).where(eq(investmentTransactions.id, first.body.data.id));
      if (source === "foreign closing") await db.update(investmentTransactions).set({ householdId: b }).where(eq(investmentTransactions.id, first.body.data.id));
      if (source === "closing currency") await db.update(investmentTransactions).set({ currency: "USD" }).where(eq(investmentTransactions.id, first.body.data.id));
      if (source === "disposal date") await db.update(taxLotDisposals).set({ disposedDate: "2031-01-16" }).where(eq(taxLotDisposals.transactionId, first.body.data.id));
      if (source === "disposal household") await db.update(taxLotDisposals).set({ householdId: b }).where(eq(taxLotDisposals.transactionId, first.body.data.id));
      if (source === "missing closing") await db.delete(investmentTransactions).where(eq(investmentTransactions.id, first.body.data.id));
      const before = await effects(); expectDenied(await trade("sell", "1", "70.00", "70.00")); expect(await effects()).toEqual(before);
    });
  it.each(["acquisition", "cash", "prior closing", "source account"])("returns a safe conflict during an earlier %s withdrawal, without raw SQL errors or partial effects", async source => {
    let target = purchaseId, cashId: string | undefined, sourceAccount: string | undefined;
    if (source === "cash") {
      cashId = await cash(false); await db.update(investmentTransactions).set({ linkedTransactionId: cashId }).where(eq(investmentTransactions.id, purchaseId));
    }
    if (source === "source account") {
      sourceAccount = randomUUID();
      await db.insert(accounts).values({ id: sourceAccount, householdId: a, ownerUserId: actors.get("owner")!.id, name: "Synthetic former custody", type: "investment", currency: "ZMW", balance: "0.00" });
      await db.update(investmentTransactions).set({ accountId: sourceAccount }).where(eq(investmentTransactions.id, purchaseId));
    }
    if (source === "prior closing") {
      await db.delete(taxLots).where(eq(taxLots.holdingId, holdingId)); await db.delete(investmentTransactions).where(eq(investmentTransactions.holdingId, holdingId));
      await db.update(holdings).set({ quantity: "0", costBasis: "0", costBasisZmw: "0", acquisitionFxRate: null }).where(eq(holdings.id, holdingId));
      const bought = await trade("buy", "2", "50.00", "100.00", "owner", "ZMW", "2031-01-01").expect(201);
      purchaseId = bought.body.data.id; lotId = (await db.select().from(taxLots).where(eq(taxLots.transactionId, purchaseId)))[0].id;
      target = (await trade("sell", "1", "60.00", "60.00", "owner", "ZMW", "2031-01-15").expect(201)).body.data.id;
    }
    const before = await effects(), editor = await pool.connect();
    let attempt: Promise<request.Response> | undefined;
    try {
      await editor.query("BEGIN");
      if (source === "cash") await editor.query("UPDATE transactions SET is_private=true WHERE id=$1", [cashId]);
      else if (source === "source account") await editor.query("UPDATE accounts SET is_private=true WHERE id=$1", [sourceAccount]);
      else await editor.query("UPDATE investment_transactions SET account_id=$2 WHERE id=$1", [target, ids.privateAccount]);
      let complete = false;
      attempt = trade("sell", "1", "120.00", "120.00").then(response => { complete = true; return response; });
      const deadline = Date.now() + 5_000;
      while (!complete && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 25));
      expect.soft(complete).toBe(true);
      await editor.query("COMMIT");
      expectDenied(await attempt); expect(await effects()).toEqual(before);
    } finally {
      try { await editor.query("ROLLBACK"); } finally { editor.release(); }
      if (attempt) await Promise.allSettled([attempt]);
    }
  });
  it.each(["purchase claimant", "closing allocation"])("fences a new %s inserted outside the prefix before final source admission", async source => {
    let parent = purchaseId;
    if (source === "closing allocation") {
      await db.delete(taxLots).where(eq(taxLots.holdingId, holdingId)); await db.delete(investmentTransactions).where(eq(investmentTransactions.holdingId, holdingId));
      await db.update(holdings).set({ quantity: "0", costBasis: "0", costBasisZmw: "0", acquisitionFxRate: null }).where(eq(holdings.id, holdingId));
      const bought = await trade("buy", "2", "50.00", "100.00", "owner", "ZMW", "2031-01-01").expect(201);
      purchaseId = bought.body.data.id; lotId = (await db.select().from(taxLots).where(eq(taxLots.transactionId, purchaseId)))[0].id;
      parent = (await trade("sell", "1", "60.00", "60.00", "owner", "ZMW", "2031-01-15").expect(201)).body.data.id;
    }
    const injectedId = randomUUID(), siblingLot = randomUUID();
    if (source === "closing allocation") await db.insert(taxLots).values({ id: siblingLot, householdId: a, holdingId: otherHolding,
      transactionId: null, quantity: "1", remainingQuantity: "0", costBasis: "20.00", acquiredDate: "2031-01-01" });
    const before = await effects(), editor = await pool.connect();
    let attempt: Promise<request.Response> | undefined;
    try {
      await editor.query("BEGIN");
      if (source === "purchase claimant") await editor.query(`INSERT INTO tax_lots(id,household_id,holding_id,transaction_id,quantity,remaining_quantity,cost_basis,acquired_date)
        VALUES($1,$2,$3,$4,1,1,100,'2031-01-01')`, [injectedId, a, otherHolding, parent]);
      else await editor.query(`INSERT INTO tax_lot_disposals(id,household_id,holding_id,tax_lot_id,transaction_id,quantity,proceeds,cost_basis,realized_gain,disposed_date)
        VALUES($1,$2,$3,$4,$5,1,60,20,40,'2031-01-15')`, [injectedId, a, otherHolding, siblingLot, parent]);
      let complete = false;
      attempt = trade("sell", "1", "120.00", "120.00").then(response => { complete = true; return response; });
      const deadline = Date.now() + 5_000;
      while (!complete && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 25));
      expect.soft(complete).toBe(true);
      await editor.query("COMMIT");
      expectDenied(await attempt);
      expect(await effects(source === "purchase claimant" ? { lotId: injectedId } : { disposalId: injectedId })).toEqual(before);
    } finally {
      try { await editor.query("ROLLBACK"); } finally { editor.release(); }
      if (attempt) await Promise.allSettled([attempt]);
    }
  });
});
