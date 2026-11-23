import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq, inArray, or, sql } from "drizzle-orm";
import {
  accountBalanceSnapshots, accounts, auditLogs, fxRates, grzTBills, holdings, householdMembers, households,
  investmentHoldingDeletionReceipts, investmentOpeningOperationReceipts, investmentTransactions,
  outboxEvents, pensionHoldings, securities, securityAuditLogs, sessionRevocations, taxLotDisposals, taxLots,
  transactions, userSessions, users,
} from "@shared/schema";
import { db, pool } from "../../db";
import { roundMoney } from "../../core/money";
import { hashPassword } from "../../auth";
import { getTestApp } from "../../__tests__/fixtures";
import * as calculations from "../../core/calculations";
import { revokeSessionByToken, revokeUserSessions } from "../../services/session-revocation";
import { sessionIdentityHash } from "../../services/session-identity";
import { portfolioValuationService } from "../../services/PortfolioValuationService";

// TEST-ONLY / UNVERIFIED. Master 117-118/132-136: household roles never grant
// another actor's private custody. Native-ZMW declared openings avoid choosing
// any policy for a shared holding funded by private underlying cash activity.
const roles = ["owner", "admin", "member", "view_only", "professional"] as const;
type Role = (typeof roles)[number];
type Actor = { id: string; email: string; cookie: string };
const householdId = randomUUID(), password = "SyntheticR12Custody123!";
const actors = new Map<Role, Actor>();
for (const role of roles) {
  const id = randomUUID();
  actors.set(role, { id, email: `r12-custody-${id}@example.invalid`, cookie: "" });
}
const actor = (role: Role) => actors.get(role)!;
const actorIds = Array.from(actors.values(), row => row.id);
const ownedOutbox = or(eq(outboxEvents.householdId, householdId),
  inArray(sql<string>`${outboxEvents.payload}->>'userId'`, actorIds));
const accountIds = { shared: randomUUID(), viewer: randomUUID(), peer: randomUUID() };
const positions = [
  { key: "shared", role: "member", securityId: randomUUID(), accountId: accountIds.shared,
    type: "stock", marker: "R12_CUSTODY_SHARED_STOCK", quantity: "10", cost: "80", value: 100, gain: 20 },
  { key: "viewer", role: "member", securityId: randomUUID(), accountId: accountIds.viewer,
    type: "etf", marker: "R12_CUSTODY_MEMBER_PRIVATE_ETF", quantity: "6", cost: "45", value: 60, gain: 15 },
  { key: "peer", role: "owner", securityId: randomUUID(), accountId: accountIds.peer,
    type: "bond", marker: "R12_CUSTODY_OWNER_PRIVATE_BOND", quantity: "4", cost: "30", value: 40, gain: 10 },
] as const;
const holdingIds = new Map<string, string>();
const summaryPaths = ["/portfolio", "/portfolio/summary"] as const;
const summaryCases = roles.flatMap(role => summaryPaths.map(path => ({ role, path })));
const changes = ["custody", "membership", "selected SID", "generation"] as const;
const lateCases = summaryPaths.flatMap(path => changes.map(change => ({ path, change })));
const sourceCases = summaryPaths.flatMap(path => (["holding", "T-bill", "pension"] as const).map(source => ({ path, source })));
const alternatives = [
  { key: "shared", accountId: accountIds.shared, billId: randomUUID(), pensionId: randomUUID(), bill: "11", pension: "13" },
  { key: "viewer", accountId: accountIds.viewer, billId: randomUUID(), pensionId: randomUUID(), bill: "5", pension: "17" },
  { key: "peer", accountId: accountIds.peer, billId: randomUUID(), pensionId: randomUUID(), bill: "7", pension: "7" },
] as const;
let app: Awaited<ReturnType<typeof getTestApp>>;
let replaceMemberSession = false;

function get(path: string, role: Role = "member") {
  return request(app).get(`/api/investments${path}?currency=ZMW`).set("Cookie", actor(role).cookie);
}
async function login(role: Role) {
  const response = await request(app).post("/api/auth/login").send({ email: actor(role).email, password }).expect(200);
  actor(role).cookie = (response.headers["set-cookie"] as unknown as string[]).join("; ");
}
async function restoreMemberships() {
  for (const role of roles) {
    await db.insert(householdMembers).values({ householdId, userId: actor(role).id, role })
      .onConflictDoUpdate({ target: [householdMembers.householdId, householdMembers.userId], set: { role } });
  }
}
async function cleanPositions() {
  // Both receipt families are immutable while their actor/household is live.
  // Use their accepted whole-household ON DELETE CASCADE lifecycle, never a
  // direct receipt DELETE. Preserve actor ownership until scoped audit cleanup.
  await db.delete(auditLogs).where(or(eq(auditLogs.householdId, householdId), inArray(auditLogs.userId, actorIds)));
  await db.delete(outboxEvents).where(ownedOutbox);
  // These unposted synthetic bills have a NO ACTION household FK. They have
  // no principal/cash history and are owned by UUID, independently of receipts.
  await db.delete(grzTBills).where(inArray(grzTBills.id, alternatives.map(row => row.billId)));
  await db.delete(households).where(eq(households.id, householdId));
  await db.delete(securities).where(inArray(securities.id, positions.map(row => row.securityId)));
  holdingIds.clear();
}
async function financialState() {
  return {
    holdings: await db.select().from(holdings).where(eq(holdings.householdId, householdId)).orderBy(holdings.id),
    activity: await db.select().from(investmentTransactions).where(eq(investmentTransactions.householdId, householdId)).orderBy(investmentTransactions.id),
    lots: await db.select().from(taxLots).where(eq(taxLots.householdId, householdId)).orderBy(taxLots.id),
    disposals: await db.select().from(taxLotDisposals).where(eq(taxLotDisposals.householdId, householdId)).orderBy(taxLotDisposals.id),
    cash: await db.select().from(transactions).where(eq(transactions.householdId, householdId)).orderBy(transactions.id),
    accounts: await db.select().from(accounts).where(eq(accounts.householdId, householdId)).orderBy(accounts.id),
    balanceSnapshots: await db.select().from(accountBalanceSnapshots)
      .where(inArray(accountBalanceSnapshots.accountId, Object.values(accountIds))).orderBy(accountBalanceSnapshots.id),
    securities: await db.select().from(securities).where(inArray(securities.id, positions.map(row => row.securityId))).orderBy(securities.id),
    bills: await db.select().from(grzTBills).where(eq(grzTBills.householdId, householdId)).orderBy(grzTBills.id),
    pensions: await db.select().from(pensionHoldings).where(eq(pensionHoldings.householdId, householdId)).orderBy(pensionHoldings.id),
    openingReceipts: await db.select().from(investmentOpeningOperationReceipts)
      .where(eq(investmentOpeningOperationReceipts.householdId, householdId)).orderBy(investmentOpeningOperationReceipts.operationId),
    deletionReceipts: await db.select().from(investmentHoldingDeletionReceipts)
      .where(eq(investmentHoldingDeletionReceipts.householdId, householdId)).orderBy(investmentHoldingDeletionReceipts.holdingId),
    audit: await db.select().from(auditLogs).where(or(eq(auditLogs.householdId, householdId), inArray(auditLogs.userId, actorIds))).orderBy(auditLogs.id),
    securityAudit: await db.select().from(securityAuditLogs)
      .where(or(inArray(securityAuditLogs.userId, actorIds), inArray(securityAuditLogs.targetUserId, actorIds))).orderBy(securityAuditLogs.id),
    outbox: await db.select().from(outboxEvents).where(ownedOutbox).orderBy(outboxEvents.id),
  };
}
async function seedAlternatives() {
  // Read-source fixtures only; these rows do not attest the GRZ or pension writer.
  await db.insert(grzTBills).values(alternatives.map(row => ({ id: row.billId, householdId, accountId: row.accountId,
    tbillName: `R12_${row.key}_PRIVATE_BILL`, tenorDays: 91, faceValue: row.bill, purchasePrice: row.bill,
    purchaseDate: "2026-10-01", maturityDate: "2026-12-31", status: "active" as const })));
  await db.insert(pensionHoldings).values(alternatives.map(row => ({ id: row.pensionId, householdId, accountId: row.accountId,
    providerName: `R12_${row.key}_PRIVATE_PENSION`, pensionType: "private", currentBalance: row.pension })));
}
function visiblePositions(role: Role) {
  return positions.filter(row => row.key === "shared" || row.role === role);
}
function assertHidden(response: request.Response, role: Role) {
  for (const position of positions.filter(row => !visiblePositions(role).includes(row))) {
    for (const hidden of [holdingIds.get(position.key)!, position.securityId, position.accountId, position.marker]) {
      expect(response.text).not.toContain(hidden);
    }
  }
}
const zmw = (value: number | string) => ({ amount: roundMoney(value), currency: "ZMW" });
function assertHoldings(response: request.Response, role: Role) {
  const visible = visiblePositions(role);
  expect(response.body).toMatchObject({ success: true, meta: { baseCurrency: "ZMW" } });
  expect(response.body.data).toHaveLength(visible.length);
  expect(response.body.data).toEqual(expect.arrayContaining(visible.map(position => expect.objectContaining({
    id: holdingIds.get(position.key), accountId: position.accountId, currentValue: zmw(position.value),
    costBasis: roundMoney(position.cost), costBasisBase: zmw(position.cost), gainLoss: zmw(position.gain), fxRateUsed: 1,
    security: expect.objectContaining({ id: position.securityId, name: position.marker, type: position.type, currency: "ZMW" }),
  }))));
  assertHidden(response, role);
}
function assertSummary(response: request.Response, role: Role) {
  const expected = role === "member"
    ? { totalValue: zmw(160), totalCostBasis: zmw(125), totalGainLoss: zmw(35), holdingsCount: 2, byType: { stock: zmw(100), etf: zmw(60) } }
    : role === "owner"
      ? { totalValue: zmw(140), totalCostBasis: zmw(110), totalGainLoss: zmw(30), holdingsCount: 2, byType: { stock: zmw(100), bond: zmw(40) } }
      : { totalValue: zmw(100), totalCostBasis: zmw(80), totalGainLoss: zmw(20), holdingsCount: 1, byType: { stock: zmw(100) } };
  expect(response.body).toMatchObject({ success: true, meta: { baseCurrency: "ZMW" } });
  expect(response.body.data).toMatchObject({ ...expected, tbillsValue: zmw(0), pensionValue: zmw(0),
    totalIncludingAlternatives: expected.totalValue });
  // Exact keys matter: hidden type/existence must not survive in an aggregate.
  expect(response.body.data.byType).toEqual(expected.byType);
  if (role === "owner") expect(response.body.data.totalGainLossPercent).toBeCloseTo(27.27272727, 6);
  else expect(response.body.data.totalGainLossPercent).toBe(role === "member" ? 28 : 25);
  assertHidden(response, role);
}

describe("R12 signed portfolio custody privacy agrees with the existing holdings list", () => {
  beforeAll(async () => {
    app = await getTestApp();
    await db.insert(households).values({ id: householdId, name: "Synthetic R12 custody", currency: "ZMW" });
    const passwordHash = await hashPassword(password);
    for (const role of roles) {
      const current = actor(role);
      await db.insert(users).values({ id: current.id, username: `r12-custody-${current.id}`, email: current.email,
        passwordHash, emailVerified: true, timezone: "Africa/Lusaka" });
      await db.insert(householdMembers).values({ householdId, userId: current.id, role });
      await login(role);
    }
    // getTestApp mounts the genuine routes without the ordinary startup hook.
    // Use the real DB-backed FX service; native ZMW needs no synthetic quote.
    calculations.setGlobalFXService(calculations.createFXRateService(calculations.createFXRateRepository(db, fxRates),
      { cacheTtlSeconds: 300, baseCurrency: "USD", fallbackDays: 30 }));
  }, 30_000);
  beforeEach(async () => {
    await cleanPositions();
    await db.insert(households).values({ id: householdId, name: "Synthetic R12 custody", currency: "ZMW" });
    await restoreMemberships();
    await db.insert(accounts).values([
      { id: accountIds.shared, householdId, name: "R12 shared investment custody", type: "investment", currency: "ZMW",
        balance: "0", initialBalance: "0", isPrivate: false, ownerUserId: actor("owner").id },
      { id: accountIds.viewer, householdId, name: "R12 member private investment custody", type: "investment", currency: "ZMW",
        balance: "0", initialBalance: "0", isPrivate: true, ownerUserId: actor("member").id },
      { id: accountIds.peer, householdId, name: "R12 owner private investment custody", type: "investment", currency: "ZMW",
        balance: "0", initialBalance: "0", isPrivate: true, ownerUserId: actor("owner").id },
    ]);
    await db.insert(securities).values(positions.map(position => ({ id: position.securityId,
      symbol: `R12_${position.key}_${position.securityId.slice(0, 8)}`, name: position.marker,
      type: position.type, currency: "ZMW", currentPrice: "10" })));
    for (const position of positions) {
      const created = await request(app).post("/api/investments/holdings").set("Cookie", actor(position.role).cookie)
        .send({ operationId: randomUUID(), expectedCurrency: "ZMW", accountId: position.accountId,
          securityId: position.securityId, quantity: position.quantity, costBasis: position.cost, acquiredDate: "2026-10-01" }).expect(201);
      holdingIds.set(position.key, created.body.data.id);
    }
    const setup = await financialState();
    expect(setup.holdings).toHaveLength(3); expect(setup.activity).toHaveLength(3);
    expect(setup.lots).toHaveLength(3); expect(setup.openingReceipts).toHaveLength(3);
    expect(setup.audit.filter(row => row.entityType === "holding" || row.entityType === "investment_transaction")).toHaveLength(6);
    expect(setup.cash).toEqual([]); // Declared originals do not invent cash purchases.
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await restoreMemberships();
    if (replaceMemberSession) {
      await pool.query('delete from "session" where sess->>\'userId\'=$1', [actor("member").id]);
      await db.delete(userSessions).where(eq(userSessions.userId, actor("member").id));
      await db.delete(sessionRevocations).where(eq(sessionRevocations.userId, actor("member").id));
      await login("member");
      replaceMemberSession = false;
    }
    await cleanPositions();
  });
  afterAll(async () => {
    await cleanPositions();
    await db.delete(securityAuditLogs).where(or(inArray(securityAuditLogs.userId, actorIds), inArray(securityAuditLogs.targetUserId, actorIds)));
    await pool.query('delete from "session" where sess->>\'userId\'=ANY($1::text[])', [actorIds]);
    await db.delete(userSessions).where(inArray(userSessions.userId, actorIds));
    await db.delete(sessionRevocations).where(inArray(sessionRevocations.userId, actorIds));
    await db.delete(users).where(inArray(users.id, actorIds));
  });

  // Five positive list controls are independent of the ten summary RED cases.
  it.each(roles)("keeps the real holdings list at shared plus %s-owned private custody without GET effects", async role => {
    const before = await financialState();
    const response = await get("/holdings", role).expect(200);
    expect(await financialState()).toEqual(before); // Session expiry touches are outside this financial snapshot.
    assertHoldings(response, role);
  });

  it.each(summaryCases)("keeps $path at shared plus $role-owned private custody without GET effects", async ({ path, role }) => {
    const before = await financialState();
    const response = await get(path, role).expect(200);
    expect(await financialState()).toEqual(before);
    assertSummary(response, role);
  });

  it.each(lateCases)("retires $path after actual late $change withdrawal during real valuation", async ({ path, change }) => {
    // Admission is real signed HTTP. Only the existing FX await is wrapped;
    // rates and valuation results are never fabricated or replaced.
    const memberId = actor("member").id;
    const [identity] = await db.select().from(users).where(eq(users.id, memberId));
    const sessions = await pool.query<{ sid: string }>('select sid from "session" where sess->>\'userId\'=$1', [memberId]);
    expect(sessions.rows).toHaveLength(1);
    const sid = sessions.rows[0].sid, before = await financialState(), original = calculations.getLatestFxRates;
    let withdrew = false;
    const gate = vi.spyOn(calculations, "getLatestFxRates").mockImplementationOnce(async (...args) => {
      const realRates = await original(...args);
      expect(realRates).toBeInstanceOf(Map); expect(args[1]).toBe("ZMW");
      if (change === "custody") await db.update(accounts).set({ isPrivate: true, ownerUserId: actor("owner").id }).where(eq(accounts.id, accountIds.shared));
      if (change === "membership") await db.delete(householdMembers).where(and(eq(householdMembers.householdId, householdId), eq(householdMembers.userId, memberId)));
      if (change === "selected SID" || change === "generation") {
        replaceMemberSession = true; // Register before await so failing RED still restores only this actor.
        await db.transaction(tx => change === "selected SID" ? revokeSessionByToken(tx, memberId, sid) : revokeUserSessions(tx, memberId));
      }
      withdrew = true;
      return realRates;
    });
    const response = await get(path);
    expect(gate).toHaveBeenCalledOnce(); expect(withdrew).toBe(true);
    const after = await financialState();
    for (const key of Object.keys(before) as (keyof typeof before)[]) {
      if (change !== "custody" || key !== "accounts") expect(after[key]).toEqual(before[key]);
    }
    if (change === "custody") {
      expect(after.accounts).toEqual(before.accounts.map(row => row.id === accountIds.shared
        ? { ...row, isPrivate: true, ownerUserId: actor("owner").id } : row));
    }
    if (change === "membership") expect(await db.select().from(householdMembers)
      .where(and(eq(householdMembers.householdId, householdId), eq(householdMembers.userId, memberId)))).toEqual([]);
    if (change === "selected SID" || change === "generation") {
      expect((await pool.query('select sid from "session" where sid=$1', [sid])).rows).toEqual([]);
      const [current] = await db.select().from(users).where(eq(users.id, memberId));
      expect(current.securityGeneration).toBe(identity.securityGeneration + (change === "generation" ? 1 : 0));
      if (change === "selected SID") expect(await db.select().from(sessionRevocations)
        .where(eq(sessionRevocations.sessionIdHash, sessionIdentityHash(sid)))).toEqual([
        expect.objectContaining({ userId: memberId, sessionIdHash: sessionIdentityHash(sid) }),
      ]);
    }
    expect(response.status).toBe(change === "custody" ? 409 : change === "membership" ? 403 : 401);
    expect(response.body).not.toHaveProperty("data");
    for (const retired of [sid, identity.passwordHash, ...positions.map(row => row.marker), ...Array.from(holdingIds.values())]) {
      expect(response.text).not.toContain(retired);
    }
  });

  it.each(summaryCases)("scopes both alternative legs through $path to $role without GET effects", async ({ path, role }) => {
    await seedAlternatives();
    const before = await financialState(), response = await get(path, role).expect(200);
    expect(await financialState()).toEqual(before);
    const expected = role === "member" ? { totalValue: zmw(160), tbillsValue: zmw(16), pensionValue: zmw(30), totalIncludingAlternatives: zmw(206) }
      : role === "owner" ? { totalValue: zmw(140), tbillsValue: zmw(18), pensionValue: zmw(20), totalIncludingAlternatives: zmw(178) }
        : { totalValue: zmw(100), tbillsValue: zmw(11), pensionValue: zmw(13), totalIncludingAlternatives: zmw(124) };
    expect(response.body.data).toMatchObject(expected);
    assertHidden(response, role);
    for (const row of alternatives) {
      for (const hidden of [row.billId, row.pensionId, `R12_${row.key}_PRIVATE_BILL`, `R12_${row.key}_PRIVATE_PENSION`]) {
        expect(response.text).not.toContain(hidden);
      }
    }
  });

  it.each(sourceCases)("retires $path when the actual $source amount changes during the real FX await", async ({ path, source }) => {
    await seedAlternatives();
    const before = await financialState(), original = calculations.getLatestFxRates;
    const gate = vi.spyOn(calculations, "getLatestFxRates").mockImplementationOnce(async (...args) => {
      const rates = await original(...args);
      if (source === "holding") await db.update(holdings).set({ quantity: "11" }).where(eq(holdings.id, holdingIds.get("shared")!));
      if (source === "T-bill") await db.update(grzTBills).set({ faceValue: "22" }).where(eq(grzTBills.id, alternatives[0].billId));
      if (source === "pension") await db.update(pensionHoldings).set({ currentBalance: "26" }).where(eq(pensionHoldings.id, alternatives[0].pensionId));
      return rates;
    });
    const response = await get(path);
    expect(gate).toHaveBeenCalledOnce();
    const after = await financialState();
    expect(after).toEqual({ ...before,
      holdings: source === "holding" ? before.holdings.map(row => row.id === holdingIds.get("shared") ? { ...row, quantity: "11.00000000" } : row) : before.holdings,
      bills: source === "T-bill" ? before.bills.map(row => row.id === alternatives[0].billId ? { ...row, faceValue: "22.00" } : row) : before.bills,
      pensions: source === "pension" ? before.pensions.map(row => row.id === alternatives[0].pensionId ? { ...row, currentBalance: "26.00" } : row) : before.pensions,
    });
    expect(response.status).toBe(409); expect(response.body).not.toHaveProperty("data");
    for (const row of positions) expect(response.text).not.toContain(row.marker);
  });

  it.each(summaryPaths)("retires an actual missing-FX valuation error after late membership withdrawal through %s", async path => {
    await db.update(securities).set({ currency: "XTS" }).where(eq(securities.id, positions[0].securityId));
    const before = await financialState(), originalRates = calculations.getLatestFxRates;
    const originalMetrics = portfolioValuationService.computeHoldingMetrics.bind(portfolioValuationService);
    let failures = 0;
    vi.spyOn(portfolioValuationService, "computeHoldingMetrics").mockImplementation((...args) => {
      try { return originalMetrics(...args); }
      catch (error) { expect(error).toMatchObject({ code: "MISSING_FX_RATE" }); failures++; throw error; }
    });
    const gate = vi.spyOn(calculations, "getLatestFxRates").mockImplementationOnce(async (...args) => {
      const rates = await originalRates(...args);
      await db.delete(householdMembers).where(and(eq(householdMembers.householdId, householdId), eq(householdMembers.userId, actor("member").id)));
      return rates;
    });
    const response = await get(path);
    expect(gate).toHaveBeenCalledOnce(); expect(failures).toBe(1);
    expect(await financialState()).toEqual(before);
    expect(response.status).toBe(403); expect(response.body).not.toHaveProperty("data");
    for (const retired of ["XTS", "MISSING_FX_RATE", ...positions.map(row => row.marker)]) expect(response.text).not.toContain(retired);
  });
});
