import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq, inArray, sql } from "drizzle-orm";
import { accounts, fxRates, holdings, householdMembers, securities, session, sessionRevocations, userSessions, users } from "@shared/schema";
import { db } from "../../db";
import { roundMoney } from "../../core/money";
const zmw = (value: number | string) => ({ amount: roundMoney(value), currency: "ZMW" });
import * as calculations from "../../core/calculations";
import { CalculationError } from "../../core/calculations/errors";
import { investmentService } from "../../modules/investments/investments.service";
import { portfolioValuationService } from "../../services/PortfolioValuationService";
import { sessionIdentityHash } from "../../services/session-identity";
import { revokeSessionByToken, revokeUserSessions } from "../../services/session-revocation";
import { a, b, actors, app, ids, reset, start, stop, type Role } from "../../modules/tags/__tests__/completion-r04.tags.fixture";

const publicHolding = randomUUID(), privateHolding = randomUUID(), publicSecurity = randomUUID(), privateSecurity = randomUUID();
const publicMarker = "R13_VISIBLE_HOLDING", privateMarker = "R13_PRIVATE_HOLDING";
const list = "/api/investments/holdings", detail = (id: string) => `${list}/${id}`;
// Every scalar in a response body. An amount is checked as a value, never as a
// substring of the text, where "21.00" also matches a timestamp such as ":21.008Z".
const scalars = (node: unknown): unknown[] => Array.isArray(node) ? node.flatMap(scalars)
  : node !== null && typeof node === "object" ? Object.values(node).flatMap(scalars) : [node];
const get = (path = list, role: Role = "member") => request(app).get(path).set("Cookie", actors.get(role)!.cookie)
  .set("X-Capital-Subject", actors.get(role)!.id).set("X-Capital-Household", a);
async function clean() {
  await db.delete(holdings).where(inArray(holdings.householdId, [a, b]));
  await db.delete(securities).where(inArray(securities.id, [publicSecurity, privateSecurity]));
}
async function withdraw(source: string) {
  if (source === "privacy") await db.update(accounts).set({ isPrivate: true, ownerUserId: actors.get("owner")!.id }).where(eq(accounts.id, ids.sharedAccount));
  if (source === "deleted custody") await db.update(accounts).set({ deletedAt: new Date() }).where(eq(accounts.id, ids.sharedAccount));
  if (source === "membership") await db.delete(householdMembers).where(and(eq(householdMembers.householdId, a), eq(householdMembers.userId, actors.get("member")!.id)));
  if (source === "identity") await db.update(users).set({ erasedAt: new Date() }).where(eq(users.id, actors.get("member")!.id));
}
async function credentialState(userId: string) {
  const [identity] = await db.select({ generation: users.securityGeneration, passwordHash: users.passwordHash,
    verified: users.emailVerified, erasedAt: users.erasedAt }).from(users).where(eq(users.id, userId));
  const persisted = await db.select({ sid: session.sid, payload: session.sess }).from(session)
    .where(sql`${session.sess}->>'userId' = ${userId}`).orderBy(session.sid);
  const devices = await db.select().from(userSessions).where(eq(userSessions.userId, userId)).orderBy(userSessions.id);
  const revoked = await db.select().from(sessionRevocations).where(eq(sessionRevocations.userId, userId)).orderBy(sessionRevocations.sessionIdHash);
  return { identity, persisted, devices, revoked };
}

describe("R13 generic holdings GET/list reauthorizes actual custody before values or valuation errors", () => {
  beforeAll(async () => {
    await start();
    // getTestApp registers routes without application startup. Use the real
    // database-backed FX service so startup failure cannot mask read behavior.
    calculations.setGlobalFXService(calculations.createFXRateService(
      calculations.createFXRateRepository(db, fxRates),
      { cacheTtlSeconds: 5 * 60, baseCurrency: "USD", fallbackDays: 30 },
    ));
  }, 30_000);
  beforeEach(async () => {
    await clean(); await reset();
    await db.update(users).set({ erasedAt: null }).where(eq(users.id, actors.get("member")!.id));
    await db.insert(securities).values([
      { id: publicSecurity, symbol: "R13_READ_PUBLIC", name: publicMarker, type: "stock", currency: "ZMW", currentPrice: "10.00" },
      { id: privateSecurity, symbol: "R13_READ_PRIVATE", name: privateMarker, type: "stock", currency: "ZMW", currentPrice: "10.00" },
    ]);
    // Existing native holdings are fixtures. This packet exercises only real
    // signed read callers and does not certify the separate opening writer.
    await db.insert(holdings).values([
      // Created at the instant that once read as a leak: its timestamp contains "21.00".
      { id: publicHolding, householdId: a, accountId: ids.sharedAccount, securityId: publicSecurity, quantity: "2", costBasis: "15.00", acquiredDate: "2030-01-01", createdAt: new Date("2026-11-20T18:52:21.008Z") },
      { id: privateHolding, householdId: a, accountId: ids.privateAccount, securityId: privateSecurity, quantity: "3", costBasis: "21.00", acquiredDate: "2030-01-01" },
    ]);
  });
  afterEach(async () => { vi.restoreAllMocks(); await clean(); });
  afterAll(async () => { await clean(); await stop(); });

  it.each(["admin", "member", "view_only", "professional"] as const)("keeps the private owner's holding out of %s list/detail", async role => {
    const response = await get(list, role).expect(200);
    expect(response.body.data).toEqual([expect.objectContaining({ id: publicHolding, quantity: "2.00000000", costBasis: "15.00",
      costBasisBase: zmw(15), currentValue: zmw(20), gainLoss: zmw(5) })]);
    for (const hidden of [privateHolding, privateSecurity, privateMarker]) expect(response.text).not.toContain(hidden);
    // The private cost basis is 21 in the converted list and "21.00" natively.
    expect(scalars(response.body).filter(value => value === 21 || value === "21" || value === "21.00")).toEqual([]);
    const hidden = await get(detail(privateHolding), role), absent = await get(detail(randomUUID()), role);
    expect(hidden.status).toBe(404); expect(absent.status).toBe(404); expect(hidden.body.error).toEqual(absent.body.error);
    expect(hidden.text).not.toContain(privateHolding); expect(hidden.text).not.toContain(privateMarker);
    expect((await get(detail(publicHolding), role).expect(200)).body.data).toMatchObject({ id: publicHolding, costBasis: "15.00", security: { name: publicMarker } });
  });
  it("retains the owner's private holding and the existing converted-list/native-detail contracts", async () => {
    const response = await get(list, "owner").expect(200), row = await get(detail(privateHolding), "owner").expect(200);
    expect(response.body.data).toHaveLength(2);
    expect(response.body.data).toEqual(expect.arrayContaining([expect.objectContaining({ id: privateHolding, quantity: "3.00000000", costBasis: "21.00",
      costBasisBase: zmw(21), currentValue: zmw(30), gainLoss: zmw(9) })]));
    expect(response.body.meta).toMatchObject({ baseCurrency: "ZMW" });
    expect(row.body.data).toMatchObject({ id: privateHolding, costBasis: "21.00", security: { name: privateMarker, currency: "ZMW" } });
    expect(row.body.data).not.toHaveProperty("currentValue");
  });
  it("applies custody visibility to explicit private-account filters", async () => {
    expect((await get(`${list}?accountId=${ids.privateAccount}`).expect(200)).body.data).toEqual([]);
    expect((await get(`${list}?accountId=${ids.privateAccount}`, "owner").expect(200)).body.data).toEqual([expect.objectContaining({ id: privateHolding })]);
  });
  it.each(["holding household", "account household", "deleted custody"])("requires current household/custody binding after %s withdrawal", async source => {
    if (source === "holding household") await db.update(holdings).set({ householdId: b }).where(eq(holdings.id, publicHolding));
    if (source === "account household") await db.update(holdings).set({ accountId: ids.foreignAccount }).where(eq(holdings.id, publicHolding));
    if (source === "deleted custody") await withdraw(source);
    expect((await get().expect(200)).body.data).toEqual([]);
    const response = await get(detail(publicHolding)); expect(response.status).toBe(404); expect(response.text).not.toContain(publicMarker);
  });
  it("preserves list-only hidden-account eligibility while direct visible detail remains supported", async () => {
    await db.update(accounts).set({ isHidden: true }).where(eq(accounts.id, ids.sharedAccount));
    expect((await get().expect(200)).body.data).toEqual([]);
    expect((await get(detail(publicHolding)).expect(200)).body.data.id).toBe(publicHolding);
  });
  it("excludes private denomination before asking the existing valuation/FX path for rates", async () => {
    await db.update(securities).set({ currency: "XTS" }).where(eq(securities.id, privateSecurity));
    const rates = vi.spyOn(calculations, "getLatestFxRates");
    const response = await get().expect(200);
    expect(response.body.data).toEqual([expect.objectContaining({ id: publicHolding, currentValue: zmw(20) })]);
    expect(rates.mock.calls.every(([currencies]) => !currencies.includes("XTS"))).toBe(true);
    expect(response.text).not.toContain("XTS"); expect(response.text).not.toContain(privateMarker);
  });
  it.each(["membership", "identity"])("rejects stale signed HTTP %s even when no holdings remain", async source => {
    await db.delete(holdings).where(eq(holdings.householdId, a));
    const original = investmentService.getHoldings.bind(investmentService);
    vi.spyOn(investmentService, "getHoldings").mockImplementationOnce(async (...args) => { await withdraw(source); return original(...args); });
    const response = await get(); expect(response.status).toBe(403); expect(response.text).not.toContain(publicMarker); expect(response.text).not.toContain(privateMarker);
  });
  it.each(["privacy", "deleted custody", "membership", "identity"])("retires the earlier financial display when %s changes during the existing FX await", async source => {
    const original = calculations.getLatestFxRates;
    vi.spyOn(calculations, "getLatestFxRates").mockImplementationOnce(async (...args) => { await withdraw(source); return original(...args); });
    const response = await get(); expect(response.status).toBe(source === "membership" || source === "identity" ? 403 : 409);
    expect(response.text).not.toContain(publicMarker); expect(response.text).not.toContain(privateMarker); expect(response.body).not.toHaveProperty("data");
    if (source === "privacy" || source === "deleted custody") expect((await get().expect(200)).body.data).toEqual([]);
  });
  it("returns a fresh empty scope instead of redisclosing a retired missing-FX error", async () => {
    await db.update(securities).set({ currency: "XTS" }).where(eq(securities.id, publicSecurity));
    const original = calculations.getLatestFxRates;
    vi.spyOn(calculations, "getLatestFxRates").mockImplementationOnce(async (...args) => { await withdraw("privacy"); return original(...args); });
    const response = await get(); expect(response.status).toBe(409);
    for (const retired of ["XTS", publicMarker, publicHolding, "MISSING_FX_RATE"]) expect(response.text).not.toContain(retired);
    expect((await get().expect(200)).body.data).toEqual([]);
  });
  it("returns a typed unavailable valuation for a current credential's real missing-FX failure", async () => {
    const reader = actors.get("member")!;
    const before = await credentialState(reader.id);
    await db.update(securities).set({ currency: "XTS" }).where(eq(securities.id, publicSecurity));
    const rates = vi.spyOn(calculations, "getLatestFxRates");
    const metrics = vi.spyOn(portfolioValuationService, "computeHoldingMetrics");
    const response = await get().expect(422);
    expect(rates).toHaveBeenCalledTimes(1);
    expect(rates).toHaveBeenCalledWith(["XTS"], "ZMW", expect.any(String));
    const resolvedRates = await rates.mock.results[0].value;
    expect(resolvedRates).toBeInstanceOf(Map);
    expect(resolvedRates.has("XTS")).toBe(false);
    expect(metrics).toHaveBeenCalledTimes(1);
    expect(metrics).toHaveBeenCalledWith(expect.objectContaining({ id: publicHolding }),
      expect.objectContaining({ id: publicSecurity, currency: "XTS" }), "ZMW", resolvedRates);
    expect(metrics.mock.results[0]).toMatchObject({ type: "throw", value: {
      code: "MISSING_FX_RATE", context: { from: "XTS", to: "ZMW" },
    } });
    expect(metrics.mock.results[0].value).toBeInstanceOf(CalculationError);
    expect(response.body).toEqual({ success: false, error: {
      code: "FINANCIAL_DATA_UNAVAILABLE", message: "The holding valuation is unavailable because an exchange rate is missing.",
      timestamp: expect.any(String),
    } });
    expect(response.body).not.toHaveProperty("data");
    expect(await credentialState(reader.id)).toEqual(before);
  });
  it.each(["owner", "admin", "member", "view_only", "professional"] as const)("keeps normal %s holdings reads free of credential/session mutations", async role => {
    const reader = actors.get(role)!;
    const before = await credentialState(reader.id);
    await get(list, role).expect(200);
    await get(detail(publicHolding), role).expect(200);
    expect(await credentialState(reader.id)).toEqual(before);
  });
  it.each([
    { role: "admin", source: "selected SID", missingFx: false },
    { role: "member", source: "user generation", missingFx: false },
    { role: "view_only", source: "selected SID", missingFx: true },
    { role: "professional", source: "user generation", missingFx: true },
  ] as const)("rejects $source revocation during FX (missing rate: $missingFx) for $role", async ({ role, source, missingFx }) => {
    const reader = actors.get(role)!;
    const before = await credentialState(reader.id);
    expect(before.persisted).toHaveLength(1);
    const sid = before.persisted[0].sid;
    if (missingFx) await db.update(securities).set({ currency: "XTS" }).where(eq(securities.id, publicSecurity));
    const original = calculations.getLatestFxRates;
    const metrics = vi.spyOn(portfolioValuationService, "computeHoldingMetrics");
    const rates = vi.spyOn(calculations, "getLatestFxRates").mockImplementationOnce(async (...args) => {
      // Exercise the actual credential revocation writers after the signed GET
      // has entered its real FX await. Both must finish before valuation resumes.
      const [result] = await Promise.all([
        original(...args),
        db.transaction(tx => source === "selected SID"
          ? revokeSessionByToken(tx, reader.id, sid)
          : revokeUserSessions(tx, reader.id)),
      ]);
      return result;
    });
    const response = await get(list, role);
    expect(rates).toHaveBeenCalledTimes(1);
    const resolvedRates = await rates.mock.results[0].value;
    expect(resolvedRates).toBeInstanceOf(Map);
    expect(metrics).toHaveBeenCalledTimes(1);
    expect(metrics).toHaveBeenCalledWith(expect.objectContaining({ id: publicHolding }),
      expect.objectContaining({ id: publicSecurity, currency: missingFx ? "XTS" : "ZMW" }), "ZMW", resolvedRates);
    if (missingFx) {
      // The FX resolver returns a sparse map; the real valuation consumer throws.
      expect(resolvedRates.has("XTS")).toBe(false);
      expect(metrics.mock.results[0]).toMatchObject({ type: "throw", value: {
        code: "MISSING_FX_RATE", context: { from: "XTS", to: "ZMW" },
      } });
      expect(metrics.mock.results[0].value).toBeInstanceOf(CalculationError);
    } else {
      expect(metrics.mock.results[0].type).toBe("return");
      const value = metrics.mock.results[0].value;
      expect([value.currentValueBase, value.costBasisBase, value.gainLoss].map(money => money && zmw(money.amount.toString())))
        .toEqual([zmw(20), zmw(15), zmw(5)]);
      expect(value.currentValueBase.currency).toBe("ZMW");
    }
    const after = await credentialState(reader.id);
    expect(after.persisted).toEqual([]);
    expect(after.devices).toEqual([]);
    expect(after.identity?.generation).toBe(before.identity!.generation + (source === "user generation" ? 1 : 0));
    if (source === "selected SID") expect(after.revoked).toEqual(expect.arrayContaining([
      expect.objectContaining({ sessionIdHash: sessionIdentityHash(sid), userId: reader.id }),
    ]));
    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe("UNAUTHORIZED");
    expect(response.body).not.toHaveProperty("data");
    for (const retired of [publicMarker, privateMarker, publicHolding, privateHolding, "XTS", "MISSING_FX_RATE"]) expect(response.text).not.toContain(retired);
    await get(list, role).expect(401);
  });
});
