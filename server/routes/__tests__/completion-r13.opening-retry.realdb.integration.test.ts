import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import { accounts, auditLogs, holdings, householdMembers, investmentTransactions, securities, taxLotDisposals, taxLots, transactions, users, householdFxRateOverrides } from "@shared/schema";
import { db, pool } from "../../db";
import { investmentService } from "../../modules/investments/investments.service";
import { openingRequestDigest } from "../../modules/investments/investmentHoldingOpeningReceipt";
import { revokeSessionByToken } from "../../services/session-revocation";
import { a, b, actors, app, ids, reset, start, stop, type Role } from "../../modules/tags/__tests__/completion-r04.tags.fixture";
import { seedDatedFxRate } from "../../testing/fixtures/dated-fx-rate";

const securityId = randomUUID(), otherSecurityId = randomUUID();
const body = (operationId: string) => ({ operationId, expectedCurrency: "USD", accountId: ids.sharedAccount, securityId, quantity: "50", costBasis: "7500", acquiredDate: "2031-01-20" });
const create = (payload: Record<string, unknown>, role: Role = "member") => request(app).post("/api/investments/holdings")
  .set("Cookie", actors.get(role)!.cookie).send(payload);
async function clean() {
  await db.delete(taxLotDisposals).where(inArray(taxLotDisposals.householdId, [a, b]));
  await db.delete(taxLots).where(inArray(taxLots.householdId, [a, b]));
  await db.delete(investmentTransactions).where(inArray(investmentTransactions.householdId, [a, b]));
  await db.delete(holdings).where(inArray(holdings.householdId, [a, b]));
  await db.delete(securities).where(inArray(securities.id, [securityId, otherSecurityId]));
  await db.delete(householdFxRateOverrides).where(inArray(householdFxRateOverrides.householdId, [a, b]));
}
async function receipt(operationId: string, role: Role = "member") {
  return (await pool.query("select * from investment_opening_operation_receipts where household_id=$1 and actor_user_id=$2 and operation_id=$3", [a, actors.get(role)!.id, operationId])).rows;
}
async function effects() {
  return {
    holdings: await db.select().from(holdings).where(eq(holdings.householdId, a)).orderBy(holdings.id),
    activity: await db.select().from(investmentTransactions).where(eq(investmentTransactions.householdId, a)).orderBy(investmentTransactions.id),
    lots: await db.select().from(taxLots).where(eq(taxLots.householdId, a)).orderBy(taxLots.id),
    disposals: await db.select().from(taxLotDisposals).where(eq(taxLotDisposals.householdId, a)).orderBy(taxLotDisposals.id),
    accounts: await db.select().from(accounts).where(eq(accounts.householdId, a)).orderBy(accounts.id),
    audit: await db.select().from(auditLogs).where(inArray(auditLogs.userId, Array.from(actors.values()).map(row => row.id))).orderBy(auditLogs.id),
  };
}

describe("R13 opening operation identity survives lost acknowledgments and concurrent retries", () => {
  beforeAll(start, 30_000);
  beforeEach(async () => {
    await clean(); await reset(); await seedDatedFxRate(a, actors.get("owner")!.id, "20");
    await db.insert(securities).values({ id: securityId, symbol: "SYN_OPEN_RETRY", name: "Synthetic replayed opening", type: "stock", currency: "USD" });
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await db.update(users).set({ erasedAt: null, emailVerified: true }).where(inArray(users.id, Array.from(actors.values()).map(row => row.id)));
    await clean();
  });
  afterAll(async () => { await clean(); await stop(); });

  it("requires an explicit client operation UUID without creating any effects", async () => {
    const { operationId: _omitted, ...payload } = body(randomUUID()), before = await effects();
    await create(payload).expect(400); await create({ ...payload, operationId: "invalid" }).expect(400);
    expect(await effects()).toEqual(before);
  });
  it("requires the user-confirmed native currency and rejects initial denomination drift without effects", async () => {
    const { expectedCurrency: _omitted, ...payload } = body(randomUUID()), before = await effects();
    await create(payload).expect(400);
    await db.update(securities).set({ currency: "ZMW" }).where(eq(securities.id, securityId));
    await create(body(randomUUID())).expect(409); expect(await effects()).toEqual(before);
  });
  it("returns the original creation receipt on retry without replaying changes to the live holding", async () => {
    const payload = body(randomUUID()), first = await create(payload).expect(201);
    await request(app).post("/api/investments/transactions").set("Cookie", actors.get("member")!.cookie).send({
      accountId: ids.sharedAccount, securityId, holdingId: first.body.data.id, type: "buy", quantity: "10", price: "150", amount: "1500", currency: "USD", transactionDate: "2031-01-26",
    }).expect(201);
    await request(app).post("/api/investments/transactions").set("Cookie", actors.get("member")!.cookie).send({
      accountId: ids.sharedAccount, securityId, holdingId: first.body.data.id, type: "sell", quantity: "5", price: "200", amount: "1000", currency: "USD", transactionDate: "2031-02-01",
    }).expect(201);
    const before = await effects(), replay = await create(payload).expect(201);
    expect(replay.body.data).toEqual(first.body.data); expect(await effects()).toEqual(before);
    expect(before.holdings[0]).toMatchObject({ quantity: "55.00000000", costBasis: "8250.00" });
    expect(before.disposals).toHaveLength(1);
    const rows = await receipt(payload.operationId); expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ household_id: a, actor_user_id: actors.get("member")!.id, operation_id: payload.operationId,
      request_version: 1, request_digest: expect.stringMatching(/^[0-9a-f]{64}$/), currency: "USD", holding_id: first.body.data.id });
    expect(rows[0].creation_snapshot.holding).toEqual(first.body.data);
    expect(rows[0].creation_snapshot).toMatchObject({ version: 1, purchaseId: before.activity.find(row => row.transactionDate === payload.acquiredDate)!.id,
      lotId: before.lots.find(row => row.acquiredDate === payload.acquiredDate)!.id });
    await expect(pool.query("update investment_opening_operation_receipts set request_digest=repeat('0',64) where operation_id=$1", [payload.operationId])).rejects.toMatchObject({ code: "23514" });
    await expect(pool.query("update investment_opening_operation_receipts set creation_snapshot=jsonb_set(creation_snapshot,'{holding,costBasis}',to_jsonb($2::text)) where operation_id=$1", [payload.operationId, "0.00"])).rejects.toMatchObject({ code: "23514" });
    expect(await receipt(payload.operationId)).toEqual(rows);
  });
  it("normalizes equivalent declaration formatting while preserving the same operation receipt", async () => {
    const payload = body(randomUUID()), first = await create(payload).expect(201), before = await effects();
    const replay = await create({ ...payload, expectedCurrency: "usd", accountId: ids.sharedAccount.toUpperCase(), securityId: securityId.toUpperCase(), quantity: "50.00000000", costBasis: "7500.00", costBasisZmw: null, acquisitionFxRate: null }).expect(201);
    expect(replay.body.data).toEqual(first.body.data); expect(await effects()).toEqual(before);
  });
  it("normalizes explicitly declared historical base and rate without conflating unknown base with zero", async () => {
    const payload = { ...body(randomUUID()), costBasisZmw: "150000", acquisitionFxRate: "20" }, first = await create(payload).expect(201), before = await effects();
    const replay = await create({ ...payload, costBasisZmw: "150000.00", acquisitionFxRate: "20.0000" }).expect(201);
    expect(replay.body.data).toEqual(first.body.data); expect(await effects()).toEqual(before);
    const unknown = body(randomUUID()); await create(unknown).expect(201); const afterUnknown = await effects();
    await create({ ...unknown, costBasisZmw: "0" }).expect(409); expect(await effects()).toEqual(afterUnknown);
  });
  it("replays the normal ZMW form declaration with implicit or equivalent base cost while rejecting a changed explicit base", async () => {
    await db.update(securities).set({ currency: "ZMW" }).where(eq(securities.id, securityId));
    const payload = { ...body(randomUUID()), expectedCurrency: "ZMW", quantity: "3", costBasis: "0.30" };
    const first = await create(payload).expect(201), before = await effects();
    expect(first.body.data.costBasisZmw).toBe("0.30");
    for (const declared of [payload, { ...payload, costBasisZmw: "0.30" }]) expect((await create(declared).expect(201)).body.data).toEqual(first.body.data);
    await create({ ...payload, costBasisZmw: "0.31" }).expect(409); expect(await effects()).toEqual(before);
  });
  it.each([{ costBasisZmw: "0.31", acquisitionFxRate: "1" }, { costBasis: "0", costBasisZmw: "1" }])(
    "conflicts changed semantic intent on an existing key but rejects the same new declaration400: %j", async changed => {
      await db.update(securities).set({ currency: "ZMW" }).where(eq(securities.id, securityId));
      const payload = { ...body(randomUUID()), expectedCurrency: "ZMW", quantity: "3", costBasis: "0.30" };
      await create(payload).expect(201); const before = await effects();
      await create({ ...payload, ...changed }).expect(409);
      await create({ ...payload, operationId: randomUUID(), ...changed }).expect(400); expect(await effects()).toEqual(before);
    },
  );
  it("reauthorizes the hidden original source before deciding a changed cross-field replay intent", async () => {
    await db.update(securities).set({ currency: "ZMW" }).where(eq(securities.id, securityId));
    const payload = { ...body(randomUUID()), expectedCurrency: "ZMW", quantity: "3", costBasis: "0.30" };
    await create(payload).expect(201);
    await db.update(accounts).set({ isPrivate: true, ownerUserId: actors.get("owner")!.id }).where(eq(accounts.id, ids.sharedAccount));
    const before = await effects(), response = await create({ ...payload, costBasisZmw: "0.31", acquisitionFxRate: "1" }).expect(404);
    expect(response.body).not.toHaveProperty("data"); expect(await effects()).toEqual(before);
  });
  it.each([
    { quantity: "0", costBasis: "0", costBasisZmw: undefined, expectedBase: "0.00" },
    { quantity: "0", costBasis: null, costBasisZmw: undefined, expectedBase: null },
    { quantity: "0", costBasis: null, costBasisZmw: "0", expectedBase: "0.00" },
    { quantity: "1", costBasis: "0", costBasisZmw: undefined, expectedBase: "0.00" },
  ])("preserves ZMW zero/gift declaration and replay without inventing unknown cost: %j", async declaration => {
    await db.update(securities).set({ currency: "ZMW" }).where(eq(securities.id, securityId));
    const { expectedBase, ...values } = declaration, payload = { ...body(randomUUID()), expectedCurrency: "ZMW", ...values };
    const first = await create(payload).expect(201), before = await effects();
    expect(first.body.data).toMatchObject({ costBasis: declaration.costBasis === null ? null : "0.00", costBasisZmw: expectedBase });
    expect((await create(payload).expect(201)).body.data).toEqual(first.body.data);
    if (declaration.costBasis === null) await create({ ...payload, costBasisZmw: declaration.costBasisZmw === undefined ? "0" : undefined }).expect(409);
    else expect((await create({ ...payload, costBasisZmw: "0" }).expect(201)).body.data).toEqual(first.body.data);
    expect(before.activity).toHaveLength(declaration.quantity === "0" ? 0 : 1);
    expect(before.lots).toHaveLength(declaration.quantity === "0" ? 0 : 1); expect(await effects()).toEqual(before);
  });
  it("serializes concurrent identical requests to one holding, opening BUY, lot and audit pair", async () => {
    const payload = body(randomUUID()), responses = await Promise.all([create(payload), create(payload)]);
    expect(responses.map(row => row.status)).toEqual([201, 201]); expect(responses[1].body.data).toEqual(responses[0].body.data);
    const after = await effects(); expect(after.holdings).toHaveLength(1); expect(after.activity).toHaveLength(1); expect(after.lots).toHaveLength(1);
    expect(after.audit.filter(row => row.entityType === "holding" || row.entityType === "investment_transaction")).toHaveLength(2);
  });
  it("rejects changed payload reuse before any new financial or audit effects", async () => {
    const payload = body(randomUUID()); await create(payload).expect(201); const before = await effects();
    const response = await create({ ...payload, costBasis: "8000" }).expect(409);
    expect(response.text).not.toContain(before.holdings[0].id); expect(await effects()).toEqual(before);
  });
  it.each([{ quantity: "51" }, { acquiredDate: "2031-01-21" }, { costBasisZmw: "0" }, { acquisitionFxRate: "20" }])("binds each original economic field on replay: %j", async changed => {
    const payload = body(randomUUID()); await create(payload).expect(201); const before = await effects();
    await create({ ...payload, ...changed }).expect(409); expect(await effects()).toEqual(before);
  });
  it("serializes concurrent changed-payload reuse to exactly one admitted operation", async () => {
    const payload = body(randomUUID()), results = await Promise.all([create(payload), create({ ...payload, costBasis: "8000" })]);
    expect(results.map(row => row.status).sort()).toEqual([201, 409]);
    const after = await effects(); expect(after.holdings).toHaveLength(1); expect(after.activity).toHaveLength(1); expect(after.lots).toHaveLength(1);
    expect(await receipt(payload.operationId)).toHaveLength(1);
  });
  it("replays a zero shell once without manufacturing BUY or lot rows", async () => {
    const payload = { ...body(randomUUID()), quantity: "0", costBasis: "0" }, first = await create(payload).expect(201), before = await effects();
    const replay = await create(payload).expect(201); expect(replay.body.data).toEqual(first.body.data); expect(await effects()).toEqual(before);
    expect(before.activity).toEqual([]); expect(before.lots).toEqual([]); expect(await receipt(payload.operationId)).toHaveLength(1);
  });
  it("allows intentional identical positions with distinct operation identities", async () => {
    const first = await create(body(randomUUID())).expect(201), second = await create(body(randomUUID())).expect(201);
    expect(second.body.data.id).not.toBe(first.body.data.id); const after = await effects();
    expect(after.holdings).toHaveLength(2); expect(after.activity).toHaveLength(2); expect(after.lots).toHaveLength(2);
  });
  it("scopes an operation UUID to its actor rather than returning another member's receipt", async () => {
    const payload = body(randomUUID()), first = await create(payload).expect(201), second = await create(payload, "admin").expect(201);
    expect(second.body.data.id).not.toBe(first.body.data.id); expect((await effects()).holdings).toHaveLength(2);
  });
  it("retains the operation identity after explicit synthetic holding damage instead of recreating a missing position", async () => {
    const payload = body(randomUUID()), first = await create(payload).expect(201);
    // Deliberate DB damage is not a supported positive-position DELETE. Keep
    // the original missing-source replay oracle after HTTP history protection.
    await db.delete(holdings).where(eq(holdings.id, first.body.data.id));
    const before = await effects(); await create(payload).expect(409); expect(await effects()).toEqual(before);
  });
  it.each(["moved custody", "rebound security", "currency drift"])("rejects changed original %s without publishing or recreating the receipt", async changed => {
    const payload = body(randomUUID()), first = await create(payload).expect(201);
    if (changed === "moved custody") await db.update(holdings).set({ accountId: ids.foreignAccount }).where(eq(holdings.id, first.body.data.id));
    if (changed === "rebound security") {
      await db.insert(securities).values({ id: otherSecurityId, symbol: "SYN_REBOUND", name: "Synthetic other security", type: "stock", currency: "USD" });
      await db.update(holdings).set({ securityId: otherSecurityId }).where(eq(holdings.id, first.body.data.id));
    }
    if (changed === "currency drift") await db.update(securities).set({ currency: "ZMW" }).where(eq(securities.id, securityId));
    const before = await effects(), response = await create(payload).expect(409);
    expect(response.body).not.toHaveProperty("data"); expect(await effects()).toEqual(before);
  });
  it("reauthorizes current custody on replay without disclosing its old creation snapshot", async () => {
    const payload = body(randomUUID()), first = await create(payload).expect(201);
    await db.update(accounts).set({ isPrivate: true, ownerUserId: actors.get("owner")!.id }).where(eq(accounts.id, ids.sharedAccount));
    const before = await effects(), response = await create(payload).expect(404);
    expect(response.body).not.toHaveProperty("data"); expect(response.text).not.toContain(first.body.data.id); expect(await effects()).toEqual(before);
  });
  it("authorizes the hidden original custody before comparing a changed visible-account payload", async () => {
    const payload = body(randomUUID()); await create(payload).expect(201);
    const visibleAccount = randomUUID();
    await db.insert(accounts).values({ id: visibleAccount, householdId: a, name: "Synthetic changed visible custody", type: "investment", currency: "ZMW", balance: "0", isPrivate: false });
    await db.update(accounts).set({ isPrivate: true, ownerUserId: actors.get("owner")!.id }).where(eq(accounts.id, ids.sharedAccount));
    const before = await effects(); await create({ ...payload, accountId: visibleAccount }).expect(404); expect(await effects()).toEqual(before);
  });
  it("does not expose a different household's receipt for the same operation UUID", async () => {
    const payload = body(randomUUID()), first = await create(payload).expect(201), before = await effects();
    const response = await request(app).post("/api/investments/holdings").set("Cookie", actors.get("outsider")!.cookie).send(payload).expect(404);
    expect(response.text).not.toContain(first.body.data.id); expect(await effects()).toEqual(before);
  });
  it("withdraws replay only when its original purchase cash source becomes private to another actor", async () => {
    const payload = body(randomUUID()), first = await create(payload, "owner").expect(201), cashAccount = randomUUID();
    await db.insert(accounts).values({ id: cashAccount, householdId: a, name: "Original cash source", type: "checking", currency: "USD", initialBalance: "10000", balance: "10000", isPrivate: false });
    const cash = await request(app).post("/api/transactions").set("Cookie", actors.get("owner")!.cookie).send({ accountId: cashAccount,
      name: "Original opening source", type: "expense", date: payload.acquiredDate, amount: { amount: "7500", currency: "USD" }, isPrivate: false, idempotencyKey: randomUUID() }).expect(201);
    await db.update(investmentTransactions).set({ linkedTransactionId: cash.body.data.id }).where(eq(investmentTransactions.holdingId, first.body.data.id));
    expect((await create(payload, "owner").expect(201)).body.data).toEqual(first.body.data);
    await db.update(transactions).set({ isPrivate: true, ownerUserId: actors.get("admin")!.id }).where(eq(transactions.id, cash.body.data.id));
    const before = await effects(); const response = await create(payload, "owner").expect(409);
    expect(response.body).not.toHaveProperty("data"); expect(await effects()).toEqual(before);
  });
  it.each(["withdrawn", "held"])("keeps the original acknowledgment independent of a later peer's %s private cash source", async state => {
    const payload = body(randomUUID()), first = await create(payload).expect(201), cashAccount = randomUUID();
    const bought = await request(app).post("/api/investments/transactions").set("Cookie", actors.get("admin")!.cookie).send({ accountId: ids.sharedAccount,
      securityId, holdingId: first.body.data.id, type: "buy", quantity: "1", price: "150", amount: "150", currency: "USD", transactionDate: "2031-02-01" }).expect(201);
    await db.insert(accounts).values({ id: cashAccount, householdId: a, name: "Later peer private source", type: "checking", currency: "USD", initialBalance: "10000", balance: "10000", isPrivate: true, ownerUserId: actors.get("admin")!.id });
    const cash = await request(app).post("/api/transactions").set("Cookie", actors.get("admin")!.cookie).send({ accountId: cashAccount,
      name: "Later private acquisition", type: "expense", date: "2031-02-01", amount: { amount: "150", currency: "USD" }, isPrivate: true, idempotencyKey: randomUUID() }).expect(201);
    await db.update(investmentTransactions).set({ linkedTransactionId: cash.body.data.id }).where(eq(investmentTransactions.id, bought.body.data.id));
    if (state === "withdrawn") await db.update(transactions).set({ deletedAt: new Date() }).where(eq(transactions.id, cash.body.data.id));
    const before = await effects(), editor = state === "held" ? await pool.connect() : null;
    try {
      if (editor) { await editor.query("BEGIN"); await editor.query("select id from transactions where id=$1 for update", [cash.body.data.id]); }
      const replay = await create(payload).expect(201); expect(replay.body.data).toEqual(first.body.data); expect(await effects()).toEqual(before);
    } finally { if (editor) { await editor.query("ROLLBACK"); editor.release(); } }
  });
  it.each(["extra field", "zero shell cost", "invalid date", "invalid timestamp", "forged valid shell"])("rejects deliberately inserted malformed creation evidence: %s", async corruption => {
    const payload = body(randomUUID()); await create(payload).expect(201);
    const [original] = await receipt(payload.operationId), operationId = randomUUID();
    const snapshot = structuredClone(original.creation_snapshot), replayPayload = { ...payload, operationId };
    if (corruption === "extra field") snapshot.holding.privateUndeclaredField = "Hidden extra data";
    if (corruption === "zero shell cost" || corruption === "invalid date" || corruption === "forged valid shell") {
      snapshot.purchaseId = null; snapshot.lotId = null; snapshot.holding.quantity = "0.00000000";
    }
    if (corruption === "invalid date") { snapshot.holding.costBasis = "0.00"; snapshot.holding.acquiredDate = "2031-02-30"; }
    if (corruption === "invalid timestamp") snapshot.holding.createdAt = "not-a-timestamp";
    if (corruption === "forged valid shell") { snapshot.holding.costBasis = "0.00"; replayPayload.quantity = "0"; replayPayload.costBasis = "0"; }
    // Fixture construction intentionally supplies the real versioned digest;
    // rejection must validate persisted evidence, not rely on a bogus hash.
    const digest = openingRequestDigest(replayPayload);
    await pool.query("insert into investment_opening_operation_receipts(household_id,actor_user_id,operation_id,request_version,request_digest,currency,holding_id,creation_snapshot) values($1,$2,$3,1,$4,'USD',$5,$6::jsonb)",
      [a, actors.get("member")!.id, operationId, digest, original.holding_id, JSON.stringify(snapshot)]);
    const before = await effects(), persisted = await receipt(operationId), response = await create(replayPayload).expect(409);
    expect(response.body).not.toHaveProperty("data"); expect(response.text).not.toContain("Hidden extra data");
    expect(await effects()).toEqual(before); expect(await receipt(operationId)).toEqual(persisted);
  });
  it("rolls back every effect when the actual operation receipt INSERT fails", async () => {
    const before = await effects(), payload = body(randomUUID()), fault = `r13_open_receipt_fault_${randomUUID().replace(/-/g, "")}`;
    expect((await pool.query("select to_regclass('public.investment_opening_operation_receipts') as name")).rows[0].name).toBe("investment_opening_operation_receipts");
    try {
      await pool.query(`CREATE FUNCTION public."${fault}"() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $body$
        BEGIN RAISE EXCEPTION 'Synthetic opening receipt failure' USING ERRCODE='23514'; END $body$`);
      await pool.query(`CREATE TRIGGER "${fault}" BEFORE INSERT ON public.investment_opening_operation_receipts FOR EACH ROW
        WHEN (NEW.actor_user_id='${actors.get("member")!.id}'::uuid) EXECUTE FUNCTION public."${fault}"()`);
      await create(payload).expect(500); expect(await effects()).toEqual(before);
      expect((await pool.query("select operation_id from investment_opening_operation_receipts where operation_id=$1", [payload.operationId])).rows).toEqual([]);
    } finally {
      await pool.query(`DROP TRIGGER IF EXISTS "${fault}" ON public.investment_opening_operation_receipts`);
      await pool.query(`DROP FUNCTION IF EXISTS public."${fault}"()`);
    }
    await create(payload).expect(201); const after = await effects();
    expect(after.holdings).toHaveLength(1); expect(after.activity).toHaveLength(1); expect(after.lots).toHaveLength(1); expect(await receipt(payload.operationId)).toHaveLength(1);
  });
  it.each(["role", "membership", "unverified", "erased"])("reauthorizes original replay after %s withdrawal between admission and posting", async changed => {
    const payload = body(randomUUID()); await create(payload).expect(201); const before = await effects(), actor = actors.get("member")!;
    const original = investmentService.createHolding.bind(investmentService);
    const gate = vi.spyOn(investmentService, "createHolding").mockImplementationOnce(async (...args) => {
      if (changed === "role") await db.update(householdMembers).set({ role: "view_only" }).where(and(eq(householdMembers.householdId, a), eq(householdMembers.userId, actor.id)));
      if (changed === "membership") await db.delete(householdMembers).where(and(eq(householdMembers.householdId, a), eq(householdMembers.userId, actor.id)));
      if (changed === "unverified") await db.update(users).set({ emailVerified: false }).where(eq(users.id, actor.id));
      if (changed === "erased") await db.update(users).set({ erasedAt: new Date() }).where(eq(users.id, actor.id));
      return original(...args);
    });
    const response = await create(payload).expect(changed === "erased" ? 401 : 403);
    expect(gate).toHaveBeenCalledOnce(); expect(response.body).not.toHaveProperty("data"); expect(await effects()).toEqual(before);
  });
  it("uses the original request credential before publishing an existing receipt", async () => {
    const payload = body(randomUUID()); await create(payload, "owner").expect(201); const before = await effects();
    const actor = actors.get("owner")!, sessions = await pool.query<{ sid: string }>('select sid from "session" where sess->>\'userId\'=$1', [actor.id]);
    expect(sessions.rows).toHaveLength(1);
    const original = investmentService.createHolding.bind(investmentService);
    const gate = vi.spyOn(investmentService, "createHolding").mockImplementationOnce(async (...args) => {
      await db.transaction(tx => revokeSessionByToken(tx, actor.id, sessions.rows[0].sid)); return original(...args);
    });
    const response = await create(payload, "owner").expect(401);
    expect(gate).toHaveBeenCalledOnce(); expect(response.body).not.toHaveProperty("data"); expect(await effects()).toEqual(before);
  });
});
