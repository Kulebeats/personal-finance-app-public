import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { accounts, auditLogs, holdings, investmentTransactions, securities, taxLotDisposals, taxLots, users, householdFxRateOverrides } from "@shared/schema";
import { db, pool } from "../../db";
import { investmentService } from "../../modules/investments/investments.service";
import { revokeSessionByToken, revokeUserSessions } from "../../services/session-revocation";
import { a, b, actors, app, ids, reset, start, stop, type Role } from "../../modules/tags/__tests__/completion-r04.tags.fixture";
import { seedDatedFxRate } from "../../testing/fixtures/dated-fx-rate";

const securityId = randomUUID();
const date = "2031-01-20";
function opening(role: Role | "outsider" = "member", overrides: Record<string, unknown> = {}) {
  return request(app).post("/api/investments/holdings").set("Cookie", actors.get(role)!.cookie)
    .send({ operationId: randomUUID(), expectedCurrency: "USD", accountId: ids.sharedAccount, securityId, quantity: "50", costBasis: "7500.00", acquiredDate: date, ...overrides });
}
function trade(holdingId: string, type: "buy" | "sell", quantity: string, price: string, amount: string,
  transactionDate: string, role: Role = "member", accountId = ids.sharedAccount) {
  return request(app).post("/api/investments/transactions").set("Cookie", actors.get(role)!.cookie)
    .send({ accountId, securityId, holdingId, type, quantity, price, amount, currency: "USD", transactionDate });
}
async function clean() {
  await db.delete(taxLotDisposals).where(inArray(taxLotDisposals.householdId, [a, b]));
  await db.delete(taxLots).where(inArray(taxLots.householdId, [a, b]));
  await db.delete(investmentTransactions).where(inArray(investmentTransactions.householdId, [a, b]));
  await db.delete(holdings).where(inArray(holdings.householdId, [a, b]));
  await db.delete(securities).where(eq(securities.id, securityId));
  await db.delete(householdFxRateOverrides).where(inArray(householdFxRateOverrides.householdId, [a, b]));
}
async function snapshot() {
  return {
    holdings: await db.select().from(holdings).where(eq(holdings.householdId, a)).orderBy(holdings.id),
    activity: await db.select().from(investmentTransactions).where(eq(investmentTransactions.householdId, a)).orderBy(investmentTransactions.id),
    lots: await db.select().from(taxLots).where(eq(taxLots.householdId, a)).orderBy(taxLots.id),
    disposals: await db.select().from(taxLotDisposals).where(eq(taxLotDisposals.householdId, a)).orderBy(taxLotDisposals.id),
    accounts: await db.select().from(accounts).where(eq(accounts.householdId, a)).orderBy(accounts.id),
    audit: await db.select().from(auditLogs).where(inArray(auditLogs.userId, Array.from(actors.values()).map(row => row.id))).orderBy(auditLogs.id),
  };
}

describe("FIN-10/FIN-11 declared opening holdings remain buyable and FIFO sellable", () => {
  beforeAll(start, 30_000);
  beforeEach(async () => {
    await clean(); await reset(); await seedDatedFxRate(a, actors.get("owner")!.id, "25");
    // The instrument supplies native units even when custody is denominated in ZMW.
    await db.insert(securities).values({ id: securityId, symbol: "SYN_OPENING", name: "Synthetic declared opening", type: "stock", currency: "USD" });
  });
  afterEach(async () => { vi.restoreAllMocks(); await clean(); });
  afterAll(async () => { await clean(); await stop(); });

  it("records the declared original purchase exactly once, then accepts the existing buy and a FIFO sale", async () => {
    const balances = (await snapshot()).accounts;
    const created = await opening().expect(201), holdingId = created.body.data.id;
    const beforeTrade = await snapshot();
    expect(beforeTrade.holdings).toEqual([expect.objectContaining({ id: holdingId, quantity: "50.00000000", costBasis: "7500.00", acquiredDate: date })]);
    expect(beforeTrade.activity).toHaveLength(1); expect(beforeTrade.lots).toHaveLength(1);
    const purchase = beforeTrade.activity[0], lot = beforeTrade.lots[0];
    expect(purchase).toMatchObject({ householdId: a, accountId: ids.sharedAccount, holdingId, securityId, type: "buy", quantity: "50.00000000",
      amount: "7500.00", currency: "USD", transactionDate: date, price: null, amountZmw: null, fxRate: null, linkedTransactionId: null });
    expect(lot).toMatchObject({ householdId: a, holdingId, transactionId: purchase.id, quantity: "50.00000000", remainingQuantity: "50.00000000",
      costBasis: "7500.00", costBasisZmw: null, acquiredDate: date, acquisitionFxRate: null });
    const audits = beforeTrade.audit.filter(row => row.entityId === holdingId || row.entityId === purchase.id);
    expect(audits).toHaveLength(2);
    for (const audit of audits) expect(audit).toMatchObject({ householdId: null, userId: actors.get("member")!.id, action: "CREATE" });
    expect(audits.find(row => row.entityId === holdingId)?.details).toMatchObject({ newValue: { accountId: ids.sharedAccount, securityId,
      quantity: "50.00000000", costBasis: "7500.00", acquiredDate: date, currency: "USD", costBasisZmw: null, acquisitionFxRate: null } });
    await trade(holdingId, "buy", "10", "150", "1500", "2031-01-26").expect(201);
    expect((await snapshot()).holdings[0]).toMatchObject({ quantity: "60.00000000", costBasis: "9000.00", costBasisZmw: null });
    const sold = await trade(holdingId, "sell", "55", "200", "11000", "2031-02-01").expect(201);
    const after = await snapshot();
    // NEW-21: the buy now carries its dated base (25), and FIFO leaves only those
    // 5 units, so the remaining ZMW basis is known: 5 x 150 x 25 (was null).
    expect(after.holdings[0]).toMatchObject({ quantity: "5.00000000", costBasis: "750.00", costBasisZmw: "18750.00" });
    expect(after.disposals.filter(row => row.transactionId === sold.body.data.id)).toHaveLength(2);
    expect(after.disposals.filter(row => row.transactionId === sold.body.data.id).map(row => ({ quantity: row.quantity, basis: row.costBasis }))).toEqual(expect.arrayContaining([
      { quantity: "5.00000000", basis: "750.00" }, { quantity: "50.00000000", basis: "7500.00" },
    ]));
    expect(after.accounts).toEqual(balances);
  });

  it("keeps the user's historical base cost through a later purchase and FIFO disposal", async () => {
    // #236 F2: a declared base must match the dated rate on its own date, so the
    // claimed 20 is the rate on the opening date and 25 applies from the later buy.
    await db.delete(householdFxRateOverrides).where(eq(householdFxRateOverrides.householdId, a));
    await seedDatedFxRate(a, actors.get("owner")!.id, "20", { validThrough: "2031-01-25" });
    await seedDatedFxRate(a, actors.get("owner")!.id, "25", { effectiveDate: "2031-01-26" });
    const created = await opening("member", { costBasisZmw: "150000", acquisitionFxRate: "20" }).expect(201);
    const holdingId = created.body.data.id;
    expect((await snapshot()).lots[0]).toMatchObject({ costBasisZmw: "150000.00", acquisitionFxRate: "20.00000000" });
    await request(app).post("/api/investments/transactions").set("Cookie", actors.get("member")!.cookie).send({
      accountId: ids.sharedAccount, securityId, holdingId, type: "buy", quantity: "10", price: "150", amount: "1500", currency: "USD",
      amountZmw: "37500", fxRate: "25", transactionDate: "2031-01-26",
    }).expect(201);
    expect((await snapshot()).holdings[0]).toMatchObject({ costBasis: "9000.00", costBasisZmw: "187500.00" });
    await trade(holdingId, "sell", "25", "200", "5000", "2031-02-01").expect(201);
    expect((await snapshot()).holdings[0]).toMatchObject({ quantity: "35.00000000", costBasis: "5250.00", costBasisZmw: "112500.00" });
  });

  it("lets the private custody owner open and sell with actor-only audit while denying a peer", async () => {
    const created = await opening("owner", { accountId: ids.privateAccount }).expect(201), holdingId = created.body.data.id;
    const before = await snapshot();
    await trade(holdingId, "sell", "1", "200", "200", "2031-02-01", "member", ids.privateAccount).expect(404);
    expect(await snapshot()).toEqual(before);
    await trade(holdingId, "sell", "1", "200", "200", "2031-02-01", "owner", ids.privateAccount).expect(201);
    const after = await snapshot();
    expect(after.holdings[0]).toMatchObject({ quantity: "49.00000000", costBasis: "7350.00" });
    for (const audit of after.audit.filter(row => row.entityType === "holding" || row.entityType === "investment_transaction")) {
      expect(audit).toMatchObject({ userId: actors.get("owner")!.id, householdId: null });
    }
  });

  it.each(["member", "admin", "professional", "view_only", "outsider"] as const)("denies %s opening against another actor's private custody", async role => {
    const before = await snapshot();
    const response = await opening(role, { accountId: ids.privateAccount });
    expect(response.status).toBe(role === "view_only" || role === "professional" ? 403 : 404);
    expect(response.text).not.toContain(ids.privateAccount); expect(await snapshot()).toEqual(before);
  });

  it.each([
    { quantity: "-1" }, { quantity: "0", costBasis: "1" }, { costBasis: "-1" }, { costBasis: "1.001" },
    { acquiredDate: "2031-02-30" }, { costBasisZmw: "1", acquisitionFxRate: "20" },
    { quantity: "1", costBasis: "0", costBasisZmw: "100" },
  ])("rejects invalid declared opening without persisting any effects: %j", async overrides => {
    const before = await snapshot();
    await opening("member", overrides).expect(400);
    expect(await snapshot()).toEqual(before);
  });

  it("allows a zero shell without manufacturing a purchase or lot", async () => {
    const created = await opening("member", { quantity: "0", costBasis: "0" }).expect(201);
    const after = await snapshot();
    expect(after.holdings).toEqual([expect.objectContaining({ id: created.body.data.id, quantity: "0.00000000", costBasis: "0.00" })]);
    expect(after.activity).toEqual([]); expect(after.lots).toEqual([]);
    await trade(created.body.data.id, "buy", "1", "150", "150", "2031-01-26").expect(201);
    expect((await snapshot()).holdings[0]).toMatchObject({ quantity: "1.00000000", costBasis: "150.00" });
  });

  it.each([undefined, "0"])("preserves a declared zero-cost gift with base cost %s", async costBasisZmw => {
    const created = await opening("member", { quantity: "1", costBasis: "0", costBasisZmw }).expect(201);
    const after = await snapshot();
    expect(after.lots).toEqual([expect.objectContaining({ quantity: "1.00000000", costBasis: "0.00", costBasisZmw: costBasisZmw === undefined ? null : "0.00" })]);
    await trade(created.body.data.id, "sell", "1", "1", "1", "2031-02-01").expect(201);
    expect((await snapshot()).holdings[0]).toMatchObject({ quantity: "0.00000000", costBasis: "0.00" });
  });

  it.each(["holding", "investment_transaction"])("rolls back holding, opening BUY and lot if the actual %s audit INSERT fails", async entityType => {
    const before = await snapshot(), fault = `r13_opening_fault_${randomUUID().replace(/-/g, "")}`;
    try {
      await pool.query(`CREATE FUNCTION public."${fault}"() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $body$
        BEGIN RAISE EXCEPTION 'Synthetic opening audit failure' USING ERRCODE='23514'; END $body$`);
      await pool.query(`CREATE TRIGGER "${fault}" BEFORE INSERT ON public.audit_logs FOR EACH ROW
        WHEN (NEW.user_id='${actors.get("member")!.id}'::uuid AND NEW.entity_type='${entityType}') EXECUTE FUNCTION public."${fault}"()`);
      const response = await opening().expect(500);
      expect(response.text).not.toContain(securityId); expect(response.text).not.toContain("Synthetic opening audit failure");
      expect(await snapshot()).toEqual(before);
    } finally {
      await pool.query(`DROP TRIGGER IF EXISTS "${fault}" ON public.audit_logs`);
      await pool.query(`DROP FUNCTION IF EXISTS public."${fault}"()`);
    }
  });

  it.each([
    { role: "admin", source: "selected SID" },
    { role: "member", source: "user generation" },
  ] as const)("rejects actual $source revocation after signed admission and before the opening write", async ({ role, source }) => {
    const actor = actors.get(role)!;
    const [identity] = await db.select().from(users).where(eq(users.id, actor.id));
    const sessions = await pool.query<{ sid: string }>('select sid from "session" where sess->>\'userId\'=$1', [actor.id]);
    expect(sessions.rows).toHaveLength(1);
    const sid = sessions.rows[0].sid, before = await snapshot();
    const original = investmentService.createHolding.bind(investmentService);
    const gate = vi.spyOn(investmentService, "createHolding").mockImplementationOnce(async (...args) => {
      // The real HTTP guards have admitted this request. Revoke its actual
      // credential before the transactional service can write any finance row.
      await db.transaction(tx => source === "selected SID" ? revokeSessionByToken(tx, actor.id, sid) : revokeUserSessions(tx, actor.id));
      return original(...args);
    });
    const response = await opening(role).expect(401);
    expect(gate).toHaveBeenCalledOnce(); expect(response.body).not.toHaveProperty("data");
    for (const secret of [sid, securityId, ids.sharedAccount, identity.passwordHash, "7500"]) expect(response.text).not.toContain(secret);
    expect(await snapshot()).toEqual(before);
    const [after] = await db.select().from(users).where(eq(users.id, actor.id));
    expect(after.securityGeneration).toBe(identity.securityGeneration + (source === "user generation" ? 1 : 0));
    expect((await pool.query('select sid from "session" where sid=$1', [sid])).rows).toEqual([]);
  });
});
