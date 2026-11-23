import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq, inArray, or, sql } from "drizzle-orm";
import { accounts, auditLogs, holdings, householdMembers, investmentOpeningOperationReceipts, investmentTransactions,
  securities, taxLotDisposals, taxLots, transactions, userSessions, users } from "@shared/schema";
import { db, pool } from "../../db";
import { investmentService } from "../../modules/investments/investments.service";
import { revokeSessionByToken, revokeUserSessions } from "../../services/session-revocation";
import { a, b, actors, app, ids, reset, roles, start, stop, type Role } from "../../modules/tags/__tests__/completion-r04.tags.fixture";

const securityId = randomUUID(), holdingIds = new Set<string>(), detachedAuditIds = new Set<string>();
const actorsWithChangedSessions = new Set<Role | "outsider">();
const remove = (id: string, role: Role | "outsider" = "member") => request(app).delete(`/api/investments/holdings/${id}`)
  .set("Cookie", actors.get(role)!.cookie);
const opening = (quantity = "0", role: Role = "member") => request(app).post("/api/investments/holdings")
  .set("Cookie", actors.get(role)!.cookie).send({ operationId: randomUUID(), expectedCurrency: "ZMW", accountId: ids.sharedAccount,
    securityId, quantity, costBasis: quantity === "0" ? "0" : "20", acquiredDate: "2031-01-20" });
const buy = (id: string) => request(app).post("/api/investments/transactions").set("Cookie", actors.get("admin")!.cookie)
  .send({ accountId: ids.sharedAccount, holdingId: id, securityId, type: "buy", quantity: "1", price: "10", amount: "10",
    currency: "ZMW", transactionDate: "2031-01-26" });
async function shell(overrides: Partial<typeof holdings.$inferInsert> = {}) {
  const [row] = await db.insert(holdings).values({ householdId: a, accountId: ids.sharedAccount, securityId,
    quantity: "0", costBasis: "0", costBasisZmw: "0", acquiredDate: "2031-01-20", ...overrides }).returning();
  holdingIds.add(row.id); return row;
}
async function clean() {
  if (detachedAuditIds.size) await db.delete(auditLogs).where(inArray(auditLogs.id, Array.from(detachedAuditIds)));
  await db.delete(taxLotDisposals).where(inArray(taxLotDisposals.householdId, [a, b]));
  await db.delete(taxLots).where(inArray(taxLots.householdId, [a, b]));
  await db.delete(investmentTransactions).where(inArray(investmentTransactions.householdId, [a, b]));
  await db.delete(holdings).where(inArray(holdings.householdId, [a, b]));
  await db.delete(securities).where(eq(securities.id, securityId));
}
async function effects() {
  return {
    holdings: await db.select().from(holdings).where(inArray(holdings.householdId, [a, b])).orderBy(holdings.id),
    activity: await db.select().from(investmentTransactions).where(inArray(investmentTransactions.householdId, [a, b])).orderBy(investmentTransactions.id),
    lots: await db.select().from(taxLots).where(inArray(taxLots.householdId, [a, b])).orderBy(taxLots.id),
    disposals: await db.select().from(taxLotDisposals).where(inArray(taxLotDisposals.householdId, [a, b])).orderBy(taxLotDisposals.id),
    cash: await db.select().from(transactions).where(inArray(transactions.householdId, [a, b])).orderBy(transactions.id),
    accounts: await db.select().from(accounts).where(inArray(accounts.householdId, [a, b])).orderBy(accounts.id),
    openingReceipts: await db.select().from(investmentOpeningOperationReceipts)
      .where(inArray(investmentOpeningOperationReceipts.householdId, [a, b])).orderBy(investmentOpeningOperationReceipts.operationId),
    audit: await db.select().from(auditLogs).where(or(inArray(auditLogs.userId, Array.from(actors.values()).map(row => row.id)),
      inArray(auditLogs.entityId, Array.from(holdingIds)))).orderBy(auditLogs.id),
  };
}
async function refused(id: string, role: Role | "outsider" = "member", status = 409) {
  const before = await effects(), response = await remove(id, role).expect(status);
  expect(response.body).not.toHaveProperty("data"); expect(await effects()).toEqual(before); return response;
}
function opaque404(response: request.Response) {
  expect(response.body).toEqual({ success: false, error: { code: "NOT_FOUND", message: "Holding not found", timestamp: expect.any(String) } });
}
async function relogin(role: Role | "outsider") {
  actorsWithChangedSessions.add(role);
  const actor = actors.get(role)!, [user] = await db.select().from(users).where(eq(users.id, actor.id));
  const response = await request(app).post("/api/auth/login").send({ email: user.email, password: "SyntheticR04Tags123!" }).expect(200);
  actor.cookie = (response.headers["set-cookie"] as unknown as string[]).join("; ");
}
async function waitFor(check: () => Promise<boolean>) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) { if (await check()) return; await new Promise(resolve => setTimeout(resolve, 20)); }
  throw new Error("Synthetic holding-lock checkpoint was not reached");
}

describe("R13 holding DELETE retains posted history and acknowledges one authorized shell deletion", () => {
  beforeAll(start, 30_000);
  beforeEach(async () => {
    await clean(); await reset(); holdingIds.clear(); detachedAuditIds.clear();
    await db.insert(securities).values({ id: securityId, symbol: "SYN_DELETE", name: "Synthetic shell lifecycle", type: "stock", currency: "ZMW" });
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    const actorIds = Array.from(actors.values()).map(row => row.id);
    await db.update(users).set({ erasedAt: null, emailVerified: true }).where(inArray(users.id, actorIds));
    for (const role of roles) await db.insert(householdMembers).values({ householdId: a, userId: actors.get(role)!.id, role })
      .onConflictDoUpdate({ target: [householdMembers.householdId, householdMembers.userId], set: { role } });
    // Register actors before awaited session mutations so an interrupted RED
    // assertion still removes revoked cookies and extra devices. Grant/custody
    // changes leave sessions intact and need no replacement logins.
    if (actorsWithChangedSessions.size) {
      const changedActorIds = Array.from(actorsWithChangedSessions, role => actors.get(role)!.id);
      await pool.query('delete from "session" where sess->>\'userId\'=ANY($1::text[])', [changedActorIds]);
      await db.delete(userSessions).where(inArray(userSessions.userId, changedActorIds));
      for (const role of Array.from(actorsWithChangedSessions)) await relogin(role);
      actorsWithChangedSessions.clear();
    }
    await clean();
  });
  afterAll(async () => { await clean(); await stop(); });

  it.each([null, "0"])("deletes an authorized history-free zero shell with native cost %s and no money movement", async costBasis => {
    const row = await shell({ costBasis, costBasisZmw: costBasis }), before = await effects();
    const response = await remove(row.id).expect(204); expect(response.text).toBe("");
    const after = await effects(); expect(after.holdings).toEqual([]);
    for (const key of ["activity", "lots", "disposals", "cash", "accounts", "openingReceipts"] as const) expect(after[key]).toEqual(before[key]);
    const audit = after.audit.filter(item => item.entityId === row.id);
    expect(audit).toHaveLength(1); expect(audit[0]).toMatchObject({ householdId: null, userId: actors.get("member")!.id, action: "DELETE", entityType: "holding" });
    expect(audit[0].details).toMatchObject({ oldValue: { accountId: row.accountId, securityId, quantity: row.quantity, costBasis: row.costBasis } });
  });
  it("returns the same bodyless acknowledgement after a lost response without another audit or effect", async () => {
    const row = await shell(); await remove(row.id).expect(204); const committed = await effects();
    const retried = await remove(row.id).expect(204); expect(retried.text).toBe(""); expect(await effects()).toEqual(committed);
    await refused(row.id, "admin", 404); // Another actor cannot borrow this actor's acknowledgement.
  });
  it("serializes two exact DELETE requests to one effect and two acknowledgements", async () => {
    const row = await shell(), responses = await Promise.all([remove(row.id), remove(row.id)]);
    expect(responses.map(response => response.status)).toEqual([204, 204]);
    expect((await effects()).audit.filter(item => item.entityId === row.id && item.action === "DELETE")).toHaveLength(1);
  });
  it("acknowledges the same actor on another live device and rejects only the revoked original SID", async () => {
    const actor = actors.get("owner")!, oldCookie = actor.cookie, row = await shell();
    const sessions = await pool.query<{ sid: string }>('select sid from "session" where sess->>\'userId\'=$1', [actor.id]); expect(sessions.rows).toHaveLength(1);
    await remove(row.id, "owner").expect(204); const before = await effects();
    await relogin("owner"); await remove(row.id.toUpperCase(), "owner").expect(204);
    await db.transaction(tx => revokeSessionByToken(tx, actor.id, sessions.rows[0].sid));
    await request(app).delete(`/api/investments/holdings/${row.id}`).set("Cookie", oldCookie).expect(401);
    await remove(row.id, "owner").expect(204); expect(await effects()).toEqual(before);
  });
  it.each(["body", "query"] as const)("rejects unsupported DELETE %s intent both initially and on acknowledgement retry", async input => {
    const row = await shell(), before = await effects();
    const attempt = () => input === "body" ? remove(row.id).send({ quantity: "0", costBasis: "0" }) : remove(row.id).query({ force: "true" });
    await attempt().expect(400); expect(await effects()).toEqual(before);
    await remove(row.id).expect(204); const committed = await effects(); await attempt().expect(400); expect(await effects()).toEqual(committed);
  });
  it.each(["content length", "chunked"] as const)("rejects nonempty unsupported text/plain wire bodies with %s initially and on replay", async framing => {
    const row = await shell(), before = await effects();
    const attempt = async () => {
      const call = remove(row.id).set("Content-Type", "text/plain").expect(400);
      if (framing === "content length") return call.send("quantity=1&force=true");
      call.set("Transfer-Encoding", "chunked");
      return new Promise<request.Response>((resolve, reject) => {
        // Stream actual bytes without .send(), which would set Content-Length.
        call.write("quantity=1&force=true");
        call.end((error, response) => error ? reject(error) : resolve(response));
      });
    };
    await attempt(); expect(await effects()).toEqual(before);
    await remove(row.id).expect(204); const committed = await effects(); await attempt(); expect(await effects()).toEqual(committed);
  });
  it("allows a real zero-shell opening to be deleted but never recreates it on opening replay", async () => {
    const operationId = randomUUID(), payload = { operationId, expectedCurrency: "ZMW", accountId: ids.sharedAccount,
      securityId, quantity: "0", costBasis: "0", acquiredDate: "2031-01-20" };
    const created = await request(app).post("/api/investments/holdings").set("Cookie", actors.get("member")!.cookie).send(payload).expect(201);
    holdingIds.add(created.body.data.id); await remove(created.body.data.id).expect(204); const before = await effects();
    await request(app).post("/api/investments/holdings").set("Cookie", actors.get("member")!.cookie).send(payload).expect(409);
    expect(await effects()).toEqual(before); await remove(created.body.data.id).expect(204); expect(await effects()).toEqual(before);
  });
  it("lets private custody's owner delete while keeping its audit actor-only", async () => {
    const row = await shell({ accountId: ids.privateAccount }); await remove(row.id, "owner").expect(204);
    expect((await effects()).audit.filter(item => item.entityId === row.id)).toEqual([expect.objectContaining({ householdId: null, userId: actors.get("owner")!.id })]);
  });
  it.each(["history-free", "posted"])("keeps hidden %s custody and missing IDs exactly opaque before checking history", async history => {
    const row = await shell({ accountId: ids.privateAccount });
    if (history === "posted") await db.insert(investmentTransactions).values({ householdId: a, accountId: ids.privateAccount,
      holdingId: row.id, securityId, type: "buy", quantity: "1", amount: "10", currency: "ZMW", transactionDate: "2031-01-20" });
    opaque404(await refused(row.id, "member", 404)); opaque404(await refused(randomUUID(), "member", 404));
  });
  it.each([
    { source: "original", state: "positive" }, { source: "original", state: "fully sold" },
    { source: "later", state: "positive" }, { source: "later", state: "fully sold" },
  ])("protects shared custody's owner-private $source acquisition cash when $state", async ({ source, state }) => {
    const row = await shell();
    const purchase = (date: string) => request(app).post("/api/investments/transactions").set("Cookie", actors.get("owner")!.cookie)
      .send({ accountId: ids.sharedAccount, holdingId: row.id, securityId, type: "buy", quantity: "1", price: "10", amount: "10",
        currency: "ZMW", transactionDate: date });
    const original = await purchase("2031-01-21").expect(201);
    const selected = source === "later" ? await purchase("2031-01-26").expect(201) : original;
    // A coherent legacy cash link supplies independent privacy: custody stays
    // shared, and real signed BUY/SELL writers create the lots and disposals.
    const [cash] = await db.insert(transactions).values({ householdId: a, accountId: ids.sharedAccount,
      ownerUserId: actors.get("owner")!.id, isPrivate: true, type: "expense", amount: "10.00", currency: "ZMW",
      name: "Synthetic private DELETE acquisition source", date: source === "later" ? "2031-01-26" : "2031-01-21" }).returning();
    await db.update(investmentTransactions).set({ linkedTransactionId: cash.id }).where(eq(investmentTransactions.id, selected.body.data.id));
    if (state === "fully sold") await request(app).post("/api/investments/transactions").set("Cookie", actors.get("owner")!.cookie)
      .send({ accountId: ids.sharedAccount, holdingId: row.id, securityId, type: "sell", quantity: source === "later" ? "2" : "1",
        price: "20", amount: source === "later" ? "40" : "20", currency: "ZMW", transactionDate: "2031-02-01" }).expect(201);
    expect((await db.select().from(accounts).where(eq(accounts.id, ids.sharedAccount)))[0].isPrivate).toBe(false);
    const before = await effects(); expect(before.cash.find(item => item.id === cash.id)).toMatchObject({ isPrivate: true, ownerUserId: actors.get("owner")!.id });
    opaque404(await refused(row.id, "member", 404)); opaque404(await refused(randomUUID(), "member", 404));
    await refused(row.id, "owner", 409); expect(await effects()).toEqual(before);
  });
  it("checks current private cash before rejecting a valid-format legacy UPDATE audit without source IDs", async () => {
    const row = await shell(), purchase = await request(app).post("/api/investments/transactions")
      .set("Cookie", actors.get("owner")!.cookie).send({ accountId: ids.sharedAccount, holdingId: row.id, securityId,
        type: "buy", quantity: "1", price: "10", amount: "10", currency: "ZMW", transactionDate: "2031-01-21" }).expect(201);
    const [cash] = await db.insert(transactions).values({ householdId: a, accountId: ids.sharedAccount, ownerUserId: actors.get("owner")!.id,
      isPrivate: true, type: "expense", amount: "10.00", currency: "ZMW", date: "2031-01-21", name: "Synthetic legacy private acquisition cash" }).returning();
    await db.update(investmentTransactions).set({ linkedTransactionId: cash.id }).where(eq(investmentTransactions.id, purchase.body.data.id));
    // Explicit legacy fixture: the historic holding UPDATE emitter retained
    // quantity/cost oldValue and normalized persisted newValue, without an
    // accountId. Current PUT deliberately no longer emits this old contract.
    await db.insert(auditLogs).values({ householdId: a, userId: actors.get("owner")!.id, action: "UPDATE", entityType: "holding", entityId: row.id,
      details: { oldValue: { quantity: "1.00000000", costBasis: "10.00" }, newValue: { quantity: "1.00000000", costBasis: "10.00" } } });
    const before = await effects(); opaque404(await refused(row.id, "member", 404)); opaque404(await refused(randomUUID(), "member", 404));
    await refused(row.id, "owner", 409); expect(await effects()).toEqual(before);
  });
  it.each(["professional", "view_only"] as const)("denies %s financial deletion", async role => { const row = await shell(); await refused(row.id, role, 403); });
  it("denies cross-household custody without changing the holding", async () => { const row = await shell(); opaque404(await refused(row.id, "outsider", 404)); });

  it.each([
    { quantity: "1", costBasis: "20", costBasisZmw: "20" },
    { quantity: "1", costBasis: "0", costBasisZmw: "0" },
    { quantity: "0", costBasis: "20", costBasisZmw: "20" },
    { quantity: "0", costBasis: null, costBasisZmw: "20" },
  ])("refuses a nonempty or gifted aggregate even without legacy child evidence: %j", async declaration => {
    const row = await shell(declaration); await refused(row.id);
  });
  it("gives a source-free history/review next step when a position cannot be deleted", async () => {
    const row = await shell({ quantity: "1", costBasis: "0", costBasisZmw: "0" }), response = await refused(row.id);
    expect(response.body.error.message).toMatch(/history|disposal|correction|review/i);
    for (const secret of [row.id, ids.sharedAccount, securityId]) expect(response.body.error.message).not.toContain(secret);
  });
  it("preserves the complete BUY, FIFO disposal, cash and audits after a full sale", async () => {
    const created = await opening("2").expect(201), id = created.body.data.id; holdingIds.add(id);
    await request(app).post("/api/investments/transactions").set("Cookie", actors.get("member")!.cookie).send({
      accountId: ids.sharedAccount, holdingId: id, securityId, type: "sell", quantity: "2", price: "10", amount: "20",
      currency: "ZMW", transactionDate: "2031-02-01" }).expect(201);
    expect((await db.select().from(holdings).where(eq(holdings.id, id)))[0].quantity).toBe("0.00000000"); await refused(id);
  });
  it.each([
    { posting: "BUY then full SELL", damage: "removed", privateSource: false },
    { posting: "BUY then full SELL", damage: "detached", privateSource: false },
    { posting: "interest", damage: "removed", privateSource: false },
    { posting: "interest", damage: "detached", privateSource: false },
    { posting: "BUY then full SELL", damage: "removed", privateSource: true },
    { posting: "interest", damage: "detached", privateSource: true },
  ])("retains actual $posting audit-only history after children are $damage (private source $privateSource)", async ({ posting, damage, privateSource }) => {
    const accountId = privateSource ? ids.privateAccount : ids.sharedAccount, row = await shell({ accountId });
    const post = (type: "buy" | "sell" | "interest", date: string) => request(app).post("/api/investments/transactions")
      .set("Cookie", actors.get("owner")!.cookie).send({ accountId, holdingId: row.id, securityId, type,
        ...(type === "interest" ? {} : { quantity: "1", price: "10" }), amount: "10", currency: "ZMW", transactionDate: date });
    if (posting === "interest") await post("interest", "2031-01-21").expect(201);
    else { await post("buy", "2031-01-21").expect(201); await post("sell", "2031-02-01").expect(201); }
    const audit = (await effects()).audit.filter(item => item.entityType === "investment_transaction" &&
      (item.details as { newValue?: { holdingId?: string } }).newValue?.holdingId === row.id);
    expect(audit).toHaveLength(posting === "interest" ? 1 : 2);
    for (const evidence of audit) expect(evidence).toMatchObject({ userId: actors.get("owner")!.id, action: "CREATE",
      details: { newValue: { accountId, holdingId: row.id } } });
    await db.delete(taxLotDisposals).where(eq(taxLotDisposals.holdingId, row.id)); await db.delete(taxLots).where(eq(taxLots.holdingId, row.id));
    if (damage === "removed") await db.delete(investmentTransactions).where(eq(investmentTransactions.holdingId, row.id));
    else await db.update(investmentTransactions).set({ holdingId: null }).where(eq(investmentTransactions.holdingId, row.id));
    if (privateSource) await db.update(holdings).set({ accountId: ids.sharedAccount }).where(eq(holdings.id, row.id));
    expect((await db.select().from(holdings).where(eq(holdings.id, row.id)))[0].quantity).toBe("0.00000000");
    const before = await effects();
    if (privateSource) { opaque404(await refused(row.id, "member", 404)); opaque404(await refused(randomUUID(), "member", 404)); }
    else await refused(row.id, "member", 409);
    await refused(row.id, "owner", 409); expect(await effects()).toEqual(before);
  });
  it.each(["buy", "sell", "interest", "maturity"] as const)("refuses any linked %s activity even if an old aggregate is zero", async type => {
    const row = await shell(); await db.insert(investmentTransactions).values({ householdId: a, accountId: ids.sharedAccount,
      holdingId: row.id, securityId, type, quantity: "1", amount: "10", currency: "ZMW", transactionDate: "2031-01-20" }); await refused(row.id);
  });
  it("refuses a wrong-household linked child instead of nulling its historical holding identity", async () => {
    const row = await shell(); await db.insert(investmentTransactions).values({ householdId: b, accountId: ids.foreignAccount,
      holdingId: row.id, securityId, type: "buy", quantity: "1", amount: "10", currency: "ZMW", transactionDate: "2031-01-20" }); await refused(row.id);
  });
  it("preserves an exhausted orphan legacy lot rather than cascading it away", async () => {
    const row = await shell(); await db.insert(taxLots).values({ householdId: b, holdingId: row.id, quantity: "1", remainingQuantity: "0",
      costBasis: "10", acquiredDate: "2031-01-20" }); await refused(row.id);
  });
  it("preserves a direct disposal whose historical lot and trade were rebound to a different holding", async () => {
    const row = await shell(), other = await shell();
    const [trade] = await db.insert(investmentTransactions).values({ householdId: b, accountId: ids.foreignAccount,
      holdingId: other.id, securityId, type: "sell", quantity: "1", amount: "10", currency: "ZMW", transactionDate: "2031-01-20" }).returning();
    const [lot] = await db.insert(taxLots).values({ householdId: b, holdingId: other.id, quantity: "1", remainingQuantity: "0",
      costBasis: "10", acquiredDate: "2031-01-20" }).returning();
    await db.insert(taxLotDisposals).values({ householdId: b, holdingId: row.id, taxLotId: lot.id, transactionId: trade.id,
      quantity: "1", proceeds: "10", costBasis: "10", realizedGain: "0", disposedDate: "2031-01-20" }); await refused(row.id);
  });
  it.each(["positive CREATE", "unknown CREATE", "prior UPDATE"])("refuses %s audit evidence independently of actor and household scope", async evidence => {
    const row = await shell();
    await db.insert(auditLogs).values({ householdId: b, userId: actors.get("outsider")!.id, entityType: "holding", entityId: row.id,
      action: evidence === "prior UPDATE" ? "UPDATE" : "CREATE", details: { newValue: { accountId: ids.sharedAccount, securityId,
        quantity: evidence === "unknown CREATE" ? "unknown" : "1", costBasis: "0" } } }); await refused(row.id);
  });
  it.each(["other actor receipt", "detached creator audit"])("retains a damaged originally positive declaration supported by %s", async evidence => {
    const created = await opening("2", "admin").expect(201), id = created.body.data.id; holdingIds.add(id);
    await db.delete(taxLots).where(eq(taxLots.holdingId, id)); await db.delete(investmentTransactions).where(eq(investmentTransactions.holdingId, id));
    await db.update(holdings).set({ quantity: "0", costBasis: "0", costBasisZmw: "0" }).where(eq(holdings.id, id));
    // Keep each named provenance oracle independent now that ordinary
    // transaction audits also protect against child-row loss.
    await db.delete(auditLogs).where(and(eq(auditLogs.entityType, "investment_transaction"), sql`${auditLogs.details}->'newValue'->>'holdingId'=${id}`));
    if (evidence === "other actor receipt") await db.delete(auditLogs).where(eq(auditLogs.entityId, id));
    else {
      const creatorId = actors.get("admin")!.id;
      await db.update(users).set({ erasedAt: new Date() }).where(eq(users.id, creatorId));
      await db.delete(investmentOpeningOperationReceipts).where(eq(investmentOpeningOperationReceipts.actorUserId, creatorId));
      for (const audit of await db.select({ id: auditLogs.id }).from(auditLogs).where(eq(auditLogs.entityId, id))) detachedAuditIds.add(audit.id);
      await db.update(auditLogs).set({ userId: null }).where(eq(auditLogs.entityId, id));
    }
    await refused(id);
  });

  it.each(["grant", "custody", "verification", "erasure", "selected SID", "generation"] as const)("rechecks %s after signed admission before deleting", async change => {
    const role = "owner", actor = actors.get(role)!, row = await shell(), original = investmentService.deleteHolding.bind(investmentService);
    const gate = vi.spyOn(investmentService, "deleteHolding").mockImplementationOnce(async (...args) => {
      if (change === "grant") await db.update(householdMembers).set({ role: "view_only" }).where(and(eq(householdMembers.householdId, a), eq(householdMembers.userId, actor.id)));
      if (change === "custody") await db.update(accounts).set({ isPrivate: true, ownerUserId: actors.get("admin")!.id }).where(eq(accounts.id, ids.sharedAccount));
      if (change === "verification") await db.update(users).set({ emailVerified: false }).where(eq(users.id, actor.id));
      if (change === "erasure") await db.update(users).set({ erasedAt: new Date() }).where(eq(users.id, actor.id));
      if (change === "selected SID" || change === "generation") {
        const sessions = await pool.query<{ sid: string }>('select sid from "session" where sess->>\'userId\'=$1', [actor.id]); expect(sessions.rows).toHaveLength(1);
        actorsWithChangedSessions.add(role);
        await db.transaction(tx => change === "selected SID" ? revokeSessionByToken(tx, actor.id, sessions.rows[0].sid) : revokeUserSessions(tx, actor.id));
      }
      return original(...args);
    });
    const before = await effects(), response = await remove(row.id, role);
    expect(gate).toHaveBeenCalledOnce();
    expect(response.status).toBe(change === "custody" ? 404 : change === "grant" || change === "verification" ? 403 : 401);
    expect(response.body).not.toHaveProperty("data");
    const after = await effects(); expect(after.holdings).toEqual(before.holdings); expect(after.audit).toEqual(before.audit);
    for (const key of ["activity", "lots", "disposals", "cash", "openingReceipts"] as const) expect(after[key]).toEqual(before[key]);
  });
  it.each(["grant", "custody", "selected SID"] as const)("reauthorizes an already committed acknowledgement after late %s withdrawal", async change => {
    const row = await shell(); await remove(row.id, "owner").expect(204); const before = await effects();
    const actor = actors.get("owner")!, original = investmentService.deleteHolding.bind(investmentService);
    let withdrew = false;
    const gate = vi.spyOn(investmentService, "deleteHolding").mockImplementationOnce(async (...args) => {
      if (change === "grant") await db.update(householdMembers).set({ role: "view_only" }).where(and(eq(householdMembers.householdId, a), eq(householdMembers.userId, actor.id)));
      if (change === "custody") await db.update(accounts).set({ isPrivate: true, ownerUserId: actors.get("admin")!.id }).where(eq(accounts.id, ids.sharedAccount));
      if (change === "selected SID") {
        const sessions = await pool.query<{ sid: string }>('select sid from "session" where sess->>\'userId\'=$1', [actor.id]); expect(sessions.rows).toHaveLength(1);
        actorsWithChangedSessions.add("owner");
        await db.transaction(tx => revokeSessionByToken(tx, actor.id, sessions.rows[0].sid));
      }
      withdrew = true;
      return original(...args);
    });
    await remove(row.id, "owner").expect(change === "grant" ? 403 : change === "custody" ? 404 : 401);
    expect(gate).toHaveBeenCalledOnce(); expect(withdrew).toBe(true);
    const after = await effects(); expect(after.holdings).toEqual(before.holdings); expect(after.audit).toEqual(before.audit);
  });
  it("refuses a resurrected holding UUID instead of replaying an earlier deletion acknowledgement", async () => {
    const row = await shell(); await remove(row.id).expect(204);
    await shell({ id: row.id }); await refused(row.id);
  });
  it("rolls back the actual shell deletion when its actor-only audit INSERT fails, then permits an exact retry", async () => {
    const row = await shell({ accountId: ids.privateAccount }), before = await effects(), fault = `r13_delete_fault_${randomUUID().replace(/-/g, "")}`;
    try {
      await pool.query(`CREATE FUNCTION public."${fault}"() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $body$
        BEGIN RAISE EXCEPTION 'Synthetic delete audit failure' USING ERRCODE='23514'; END $body$`);
      await pool.query(`CREATE TRIGGER "${fault}" BEFORE INSERT ON public.audit_logs FOR EACH ROW
        WHEN (NEW.entity_id='${row.id}' AND NEW.action='DELETE') EXECUTE FUNCTION public."${fault}"()`);
      const response = await remove(row.id, "owner").expect(500);
      for (const secret of [row.id, ids.privateAccount, "Synthetic delete audit failure"]) expect(response.text).not.toContain(secret);
      expect(await effects()).toEqual(before);
    } finally {
      await pool.query(`DROP TRIGGER IF EXISTS "${fault}" ON public.audit_logs`); await pool.query(`DROP FUNCTION IF EXISTS public."${fault}"()`);
    }
    await remove(row.id, "owner").expect(204); const committed = await effects(); await remove(row.id, "owner").expect(204); expect(await effects()).toEqual(committed);
  });

  it.each(["BUY first", "DELETE first"] as const)("serializes different actors' %s on the actual holding row", async order => {
    const row = await shell(), barrier = await pool.connect(), key = Math.floor(Math.random() * 1_000_000_000),
      fault = `r13_delete_race_${randomUUID().replace(/-/g, "")}`;
    let first: Promise<request.Response> | undefined, second: Promise<request.Response> | undefined;
    try {
      await pool.query(`CREATE FUNCTION public."${fault}"() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $body$
        BEGIN PERFORM pg_advisory_xact_lock(730013, ${key}); IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW; END $body$`);
      await pool.query(`CREATE TRIGGER "${fault}" BEFORE UPDATE OR DELETE ON public.holdings FOR EACH ROW
        WHEN (OLD.id='${row.id}'::uuid) EXECUTE FUNCTION public."${fault}"()`);
      await barrier.query("select pg_advisory_lock(730013,$1)", [key]);
      first = (order === "BUY first" ? buy(row.id) : remove(row.id)).then(response => response);
      let firstPid = 0;
      await waitFor(async () => {
        const result = await pool.query<{ pid: number }>("select pid from pg_locks where locktype='advisory' and classid=730013 and objid=$1 and not granted", [key]);
        firstPid = result.rows[0]?.pid ?? 0; return firstPid !== 0;
      });
      second = (order === "BUY first" ? remove(row.id) : buy(row.id)).then(response => response);
      await waitFor(async () => (await pool.query<{ waiting: boolean }>("select exists(select 1 from pg_stat_activity where $1=any(pg_blocking_pids(pid))) as waiting", [firstPid])).rows[0].waiting);
      await barrier.query("select pg_advisory_unlock(730013,$1)", [key]);
      const results = await Promise.all([first, second]); expect(results.map(response => response.status)).toEqual(order === "BUY first" ? [201, 409] : [204, 404]);
      const state = await effects();
      if (order === "BUY first") { expect(state.holdings).toHaveLength(1); expect(state.holdings[0].quantity).toBe("1.00000000"); expect(state.activity).toHaveLength(1); expect(state.lots).toHaveLength(1); }
      else { expect(state.holdings).toEqual([]); expect(state.activity).toEqual([]); expect(state.lots).toEqual([]); }
    } finally {
      try { await barrier.query("select pg_advisory_unlock(730013,$1)", [key]); } finally { barrier.release(); }
      await Promise.allSettled([first, second].filter((attempt): attempt is Promise<request.Response> => !!attempt));
      await pool.query(`DROP TRIGGER IF EXISTS "${fault}" ON public.holdings`); await pool.query(`DROP FUNCTION IF EXISTS public."${fault}"()`);
    }
  });
});
