import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import { accounts, auditLogs, holdings, householdMembers, investmentTransactions, securities, taxLotDisposals, taxLots, users, householdFxRateOverrides } from "@shared/schema";
import { db, pool } from "../../db";
import { investmentService } from "../../modules/investments/investments.service";
import { revokeSessionByToken } from "../../services/session-revocation";
import { a, b, actors, app, ids, reset, start, stop, type Role } from "../../modules/tags/__tests__/completion-r04.tags.fixture";
import { seedDatedFxRate } from "../../testing/fixtures/dated-fx-rate";

const securityId = randomUUID(), privateBasisSecurityId = randomUUID(), fineRateSecurityId = randomUUID(), date = "2031-01-20";
const detachedAuditIds = new Set<string>();
let holdingId: string;
const edit = (body: Record<string, unknown>, role: Role = "member", id = holdingId) => request(app)
  .put(`/api/investments/holdings/${id}`).set("Cookie", actors.get(role)!.cookie).send(body);
const assertUnavailable = (response: { body: unknown }) => expect(response.body).toEqual({ success: false,
  error: { code: "NOT_FOUND", message: "Holding not found", timestamp: expect.any(String) } });
async function clean() {
  if (detachedAuditIds.size) await db.delete(auditLogs).where(inArray(auditLogs.id, Array.from(detachedAuditIds)));
  detachedAuditIds.clear();
  await db.delete(taxLotDisposals).where(inArray(taxLotDisposals.householdId, [a, b]));
  await db.delete(taxLots).where(inArray(taxLots.householdId, [a, b]));
  await db.delete(investmentTransactions).where(inArray(investmentTransactions.householdId, [a, b]));
  await db.delete(holdings).where(inArray(holdings.householdId, [a, b]));
  await db.delete(securities).where(inArray(securities.id, [securityId, privateBasisSecurityId, fineRateSecurityId]));
  await db.delete(householdFxRateOverrides).where(inArray(householdFxRateOverrides.householdId, [a, b]));
}
async function snapshot() {
  return {
    holdings: await db.select().from(holdings).where(eq(holdings.householdId, a)).orderBy(holdings.id),
    activity: await db.select().from(investmentTransactions).where(eq(investmentTransactions.householdId, a)).orderBy(investmentTransactions.id),
    lots: await db.select().from(taxLots).where(eq(taxLots.householdId, a)).orderBy(taxLots.id),
    disposals: await db.select().from(taxLotDisposals).where(eq(taxLotDisposals.householdId, a)).orderBy(taxLotDisposals.id),
    accounts: await db.select().from(accounts).where(eq(accounts.householdId, a)).orderBy(accounts.id),
    audits: await db.select().from(auditLogs).where(inArray(auditLogs.userId, Array.from(actors.values()).map(row => row.id))).orderBy(auditLogs.id),
  };
}

describe("R13 evidenced holding edits cannot silently replace acquisition declarations", () => {
  beforeAll(start, 30_000);
  beforeEach(async () => {
    await clean(); await reset(); await seedDatedFxRate(a, actors.get("owner")!.id, "20");
    await db.insert(securities).values({ id: securityId, symbol: "SYN_EDIT_OPENING", name: "Synthetic evidenced holding edit", type: "stock", currency: "USD" });
    const created = await request(app).post("/api/investments/holdings").set("Cookie", actors.get("member")!.cookie)
      .send({ operationId: randomUUID(), expectedCurrency: "USD", accountId: ids.sharedAccount, securityId, quantity: "50", costBasis: "7500", acquiredDate: date }).expect(201);
    holdingId = created.body.data.id;
  });
  afterEach(async () => { vi.restoreAllMocks(); await db.update(users).set({ erasedAt: null }).where(inArray(users.id, Array.from(actors.values()).map(row => row.id))); await clean(); });
  afterAll(async () => { await clean(); await stop(); });

  it.each([{ quantity: "51" }, { costBasis: "8000" }, { acquiredDate: "2031-02-01" }, { costBasisZmw: "150000" }, { acquisitionFxRate: "20" }])(
    "refuses an incompatible financial edit %j before any holding, source or audit change", async body => {
      const before = await snapshot();
      const response = await edit(body).expect(409);
      for (const secret of [holdingId, securityId, "7500"]) expect(response.text).not.toContain(secret);
      expect(await snapshot()).toEqual(before);
      await request(app).post("/api/investments/transactions").set("Cookie", actors.get("member")!.cookie).send({
        accountId: ids.sharedAccount, securityId, holdingId, type: "buy", quantity: "10", price: "150", amount: "1500", currency: "USD", transactionDate: "2031-03-01",
      }).expect(201);
      expect((await snapshot()).holdings[0]).toMatchObject({ quantity: "60.00000000", costBasis: "9000.00" });
    },
  );
  it("accepts a numerically exact no-op without changing timestamps, sources or audit", async () => {
    const before = await snapshot();
    await edit({ quantity: "50", costBasis: "7500.0", acquiredDate: date, costBasisZmw: null, acquisitionFxRate: null }).expect(200);
    expect(await snapshot()).toEqual(before);
  });
  it("denies a peer private-custody no-op while retaining the owner's current no-op", async () => {
    const created = await request(app).post("/api/investments/holdings").set("Cookie", actors.get("owner")!.cookie)
      .send({ operationId: randomUUID(), expectedCurrency: "USD", accountId: ids.privateAccount, securityId, quantity: "1", costBasis: "150", acquiredDate: date }).expect(201);
    const before = await snapshot();
    const hidden = await edit({ quantity: "1" }, "member", created.body.data.id).expect(404);
    const missing = await edit({ quantity: "1" }, "member", randomUUID()).expect(404);
    assertUnavailable(hidden); assertUnavailable(missing);
    await edit({ quantity: "1" }, "owner", created.body.data.id).expect(200);
    expect(await snapshot()).toEqual(before);
  });
  it("denies all peer no-op and guessed-cost inputs against private prior acquisition cash while keeping owner read-back", async () => {
    await db.insert(securities).values({ id: privateBasisSecurityId, symbol: "SYN_PRIVATE_BASIS", name: "Synthetic private acquisition basis", type: "stock", currency: "ZMW" });
    const created = await request(app).post("/api/investments/holdings").set("Cookie", actors.get("owner")!.cookie)
      .send({ operationId: randomUUID(), expectedCurrency: "ZMW", accountId: ids.sharedAccount, securityId: privateBasisSecurityId, quantity: "2", costBasis: "100", acquiredDate: date }).expect(201);
    const receipt = await request(app).post("/api/transactions").set("Cookie", actors.get("owner")!.cookie).send({ accountId: ids.sharedAccount,
      name: "Private original acquisition", type: "expense", date, amount: { amount: "100", currency: "ZMW" }, isPrivate: true, idempotencyKey: randomUUID() }).expect(201);
    await db.update(investmentTransactions).set({ linkedTransactionId: receipt.body.data.id }).where(eq(investmentTransactions.holdingId, created.body.data.id));
    const before = await snapshot(), missing = await edit({}, "member", randomUUID()).expect(404);
    for (const input of [{}, { costBasis: "100" }, { costBasis: "101" }]) {
      const response = await edit(input, "member", created.body.data.id).expect(404);
      assertUnavailable(response); assertUnavailable(missing); expect(response.body).not.toHaveProperty("data");
    }
    await edit({ costBasis: "100" }, "owner", created.body.data.id).expect(200);
    expect(await snapshot()).toEqual(before);
  });
  it("refuses shell financial initialization before acknowledging an unsourced positive position", async () => {
    const created = await request(app).post("/api/investments/holdings").set("Cookie", actors.get("member")!.cookie)
      .send({ operationId: randomUUID(), expectedCurrency: "USD", accountId: ids.sharedAccount, securityId, quantity: "0", costBasis: "0", acquiredDate: date }).expect(201);
    const before = await snapshot();
    await edit({ quantity: "1", costBasis: "150" }, "member", created.body.data.id).expect(409);
    expect(await snapshot()).toEqual(before);
  });
  it.each(["native", "base", "missing base"])("fails closed on a stale stored %s aggregate before no-op or guessed-cost comparisons", async problem => {
    const created = await request(app).post("/api/investments/holdings").set("Cookie", actors.get("member")!.cookie)
      .send({ operationId: randomUUID(), expectedCurrency: "USD", accountId: ids.sharedAccount, securityId, quantity: "50", costBasis: "7500", costBasisZmw: "150000", acquisitionFxRate: "20", acquiredDate: date }).expect(201);
    await db.update(holdings).set(problem === "native" ? { costBasis: "0" } : { costBasisZmw: problem === "base" ? "9999" : null }).where(eq(holdings.id, created.body.data.id));
    const before = await snapshot(), absent = await edit({}, "member", randomUUID()).expect(404);
    for (const input of [{}, { costBasis: "0" }, { costBasis: "7500" }]) {
      const response = await edit(input, "member", created.body.data.id).expect(404);
      assertUnavailable(response); assertUnavailable(absent);
    }
    expect(await snapshot()).toEqual(before);
  });
  it("preserves a supported declared original FX rate on current no-op read-back", async () => {
    const created = await request(app).post("/api/investments/holdings").set("Cookie", actors.get("member")!.cookie)
      .send({ operationId: randomUUID(), expectedCurrency: "USD", accountId: ids.sharedAccount, securityId, quantity: "50", costBasis: "7500", costBasisZmw: "150000", acquisitionFxRate: "20", acquiredDate: date }).expect(201);
    const before = await snapshot();
    await edit({ acquisitionFxRate: "20", acquiredDate: date }, "member", created.body.data.id).expect(200);
    expect(await snapshot()).toEqual(before);
  });
  it("accepts a no-op edit of an 8-place declared FX rate, as the opening does (#254 r4)", async () => {
    await db.delete(householdFxRateOverrides).where(eq(householdFxRateOverrides.householdId, a));
    await seedDatedFxRate(a, actors.get("owner")!.id, "20.12345678");
    await db.insert(securities).values({ id: fineRateSecurityId, symbol: "SYN_FINE_RATE", name: "Synthetic 8-place declared rate", type: "stock", currency: "USD" });
    const created = await request(app).post("/api/investments/holdings").set("Cookie", actors.get("member")!.cookie)
      .send({ operationId: randomUUID(), expectedCurrency: "USD", accountId: ids.sharedAccount, securityId: fineRateSecurityId, quantity: "1",
        costBasis: "100", costBasisZmw: "2012.35", acquisitionFxRate: "20.12345678", acquiredDate: date });
    expect(created.status).toBe(201);
    const before = await snapshot();
    await edit({ acquisitionFxRate: "20.12345678", acquiredDate: date }, "member", created.body.data.id).expect(200);
    expect(await snapshot()).toEqual(before);
    await edit({ acquisitionFxRate: "20.123456789" }, "member", created.body.data.id).expect(400);
  });
  it("keeps the original zero-shell declaration through its ordinary later first BUY and no-op", async () => {
    const created = await request(app).post("/api/investments/holdings").set("Cookie", actors.get("member")!.cookie)
      .send({ operationId: randomUUID(), expectedCurrency: "USD", accountId: ids.sharedAccount, securityId, quantity: "0", costBasis: "0", acquiredDate: date }).expect(201);
    await request(app).post("/api/investments/transactions").set("Cookie", actors.get("member")!.cookie).send({ accountId: ids.sharedAccount,
      securityId, holdingId: created.body.data.id, type: "buy", quantity: "10", price: "10", amount: "100", currency: "USD", transactionDate: "2031-01-26" }).expect(201);
    const before = await snapshot(); await edit({}, "member", created.body.data.id).expect(200); expect(await snapshot()).toEqual(before);
  });
  it("retains an explicitly declared zero-shell FX rate without inventing an acquisition lot", async () => {
    const created = await request(app).post("/api/investments/holdings").set("Cookie", actors.get("member")!.cookie)
      .send({ operationId: randomUUID(), expectedCurrency: "USD", accountId: ids.sharedAccount, securityId, quantity: "0", costBasis: "0", costBasisZmw: "0", acquisitionFxRate: "20", acquiredDate: date }).expect(201);
    const before = await snapshot(); await edit({}, "member", created.body.data.id).expect(200); expect(await snapshot()).toEqual(before);
  });
  it("does not legitimize a changed original date just because it matches a later valid purchase", async () => {
    await request(app).post("/api/investments/transactions").set("Cookie", actors.get("member")!.cookie).send({ accountId: ids.sharedAccount,
      securityId, holdingId, type: "buy", quantity: "1", price: "10", amount: "10", currency: "USD", transactionDate: "2031-01-26" }).expect(201);
    await db.update(holdings).set({ acquiredDate: "2031-01-26" }).where(eq(holdings.id, holdingId));
    const before = await snapshot(); assertUnavailable(await edit({}).expect(404)); expect(await snapshot()).toEqual(before);
  });
  it.each(["household audience", "system actor"])("refuses an original declaration with invalid %s provenance", async provenance => {
    const changedAudits = await db.update(auditLogs).set(provenance === "household audience" ? { householdId: a } : { userId: null })
      .where(and(eq(auditLogs.entityId, holdingId), eq(auditLogs.entityType, "holding"), eq(auditLogs.action, "CREATE")))
      .returning({ id: auditLogs.id });
    changedAudits.forEach(row => detachedAuditIds.add(row.id));
    const before = await snapshot(); assertUnavailable(await edit({}).expect(404)); expect(await snapshot()).toEqual(before);
  });
  it("keeps a visible peer's declaration after its original actor is explicitly erased", async () => {
    const created = await request(app).post("/api/investments/holdings").set("Cookie", actors.get("owner")!.cookie)
      .send({ operationId: randomUUID(), expectedCurrency: "USD", accountId: ids.sharedAccount, securityId, quantity: "1", costBasis: "150", acquiredDate: date }).expect(201);
    await db.update(users).set({ erasedAt: new Date() }).where(eq(users.id, actors.get("owner")!.id));
    const before = await snapshot(); await edit({}, "member", created.body.data.id).expect(200); expect(await snapshot()).toEqual(before);
  });
  it("maps a held original audit row to the same opaque unavailable envelope without financial effects", async () => {
    const editor = await pool.connect(), before = await snapshot();
    try {
      await editor.query("BEGIN");
      await editor.query("select id from audit_logs where entity_id=$1 and entity_type='holding' and action='CREATE' for update", [holdingId]);
      assertUnavailable(await edit({}).expect(404)); expect(await snapshot()).toEqual(before);
    } finally { await editor.query("ROLLBACK"); editor.release(); }
  });
  it("rechecks the current capability after signed admission even for a no-op", async () => {
    const before = await snapshot(), original = investmentService.updateHolding.bind(investmentService);
    const gate = vi.spyOn(investmentService, "updateHolding").mockImplementationOnce(async (...args) => {
      await db.update(householdMembers).set({ role: "view_only" }).where(and(eq(householdMembers.householdId, a), eq(householdMembers.userId, actors.get("member")!.id)));
      return original(...args);
    });
    await edit({ quantity: "50" }).expect(403); expect(gate).toHaveBeenCalledOnce();
    expect(await snapshot()).toEqual(before);
  });
  it("rejects actual selected-session revocation before an admitted no-op can return financial data", async () => {
    const actor = actors.get("owner")!, before = await snapshot();
    const sessions = await pool.query<{ sid: string }>('select sid from "session" where sess->>\'userId\'=$1', [actor.id]);
    expect(sessions.rows).toHaveLength(1);
    const original = investmentService.updateHolding.bind(investmentService);
    const gate = vi.spyOn(investmentService, "updateHolding").mockImplementationOnce(async (...args) => {
      await db.transaction(tx => revokeSessionByToken(tx, actor.id, sessions.rows[0].sid));
      return original(...args);
    });
    const response = await edit({ quantity: "50" }, "owner").expect(401);
    expect(gate).toHaveBeenCalledOnce(); expect(response.body).not.toHaveProperty("data"); expect(await snapshot()).toEqual(before);
  });
});
