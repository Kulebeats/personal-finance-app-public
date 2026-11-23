import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import request from "supertest";
import { and, eq, gte, inArray, or, sql } from "drizzle-orm";
import {
  auditLogs, fxRates, holdings, householdMembers, householdSecurityPriceOverrides, securities, securityPrices,
} from "@shared/schema";
import { hashPassword } from "../../auth";
import { createFXRateRepository, createFXRateService, setGlobalFXService } from "../../core/calculations";
import * as calculations from "../../core/calculations";
import { db, pool } from "../../db";
import { getTestApp } from "../../__tests__/fixtures";
import { roundMoney } from "../../core/money";
import { revokeSessionByToken } from "../../services/session-revocation";
import { businessAuditService } from "../../services/BusinessAuditService";
import { investmentService } from "../../modules/investments/investments.service";
import * as readAuthority from "../../modules/investments/investmentReadAuthority";
import * as transactions from "../../utils/withTransaction";
import type { TransactionType } from "../../utils/withTransaction";
import {
  cleanPriceFixture,
  createPriceFixture,
  globalPriceState,
  password,
  seedPriceFixture,
  setOtherRole,
  signed,
  type Actor,
  type PriceFixture,
} from "./completion-c3-06.price-confirmation.fixture";

let app: Awaited<ReturnType<typeof getTestApp>>;
let fixture: PriceFixture;
let passwordHash: string;
let fxQuoteId: string | undefined;
const valuationPaths = ["/holdings", "/portfolio", "/portfolio/summary"] as const;
const securityViews = ["catalogue", "detail"] as const;

function getSecurityView(actor: Actor, view: typeof securityViews[number], symbol: string) {
  const path = "/api/investments/securities";
  return view === "detail"
    ? signed(app, fixture, actor, "get", `${path}/${fixture.referenceSecurityId}`)
    : signed(app, fixture, actor, "get", path).query({ search: symbol });
}

function putPrice(actor: Actor, price: string, date = fixture.today, validThrough = date) {
  const path = `/api/investments/securities/${fixture.referenceSecurityId}/price`;
  return signed(app, fixture, actor, "put", path).send({ price, date, validThrough });
}

async function expectHoldingValue(actor: Actor, currentValue: number) {
  const response = await signed(app, fixture, actor, "get", "/api/investments/holdings")
    .query({ currency: "ZMW" })
    .expect(200);
  expect.soft(response.body, `${actor} holding valuation`).toMatchObject({
    success: true,
    meta: { baseCurrency: "ZMW" },
    data: [{
      accountId: actor === "home" ? fixture.homeAccountId : fixture.otherAccountId,
      securityId: fixture.referenceSecurityId,
      currentValue: { amount: roundMoney(currentValue), currency: "ZMW" },
    }],
  });
}

async function readAudits() {
  return db.select().from(auditLogs).where(or(
    eq(auditLogs.entityId, fixture.referenceSecurityId),
    inArray(auditLogs.householdId, [fixture.homeHouseholdId, fixture.otherHouseholdId]),
    inArray(auditLogs.userId, [fixture.home.id, fixture.other.id]),
  )).orderBy(auditLogs.id);
}

function fixtureOverrides() {
  return or(
    eq(householdSecurityPriceOverrides.securityId, fixture.referenceSecurityId),
    inArray(householdSecurityPriceOverrides.householdId, [fixture.homeHouseholdId, fixture.otherHouseholdId]),
    inArray(householdSecurityPriceOverrides.actorUserId, [fixture.home.id, fixture.other.id]),
  );
}

function readOverrides() {
  return db.select().from(householdSecurityPriceOverrides).where(fixtureOverrides())
    .orderBy(householdSecurityPriceOverrides.id);
}

async function readPriceState() {
  return {
    global: await globalPriceState(fixture),
    overrides: await readOverrides(),
    audits: await readAudits(),
    memberships: await db.select({
      id: householdMembers.id,
      householdId: householdMembers.householdId,
      userId: householdMembers.userId,
      role: householdMembers.role,
    }).from(householdMembers).where(or(
      inArray(householdMembers.householdId, [fixture.homeHouseholdId, fixture.otherHouseholdId]),
      inArray(householdMembers.userId, [fixture.home.id, fixture.other.id]),
    )).orderBy(householdMembers.id),
  };
}

function expectPriceAudit(rows: Awaited<ReturnType<typeof readAudits>>, actor: Actor, price: string) {
  expect.soft(rows, `${actor} price audit`).toMatchObject([{
    userId: fixture[actor].id,
    householdId: fixture[actor].householdId,
    entityId: fixture.referenceSecurityId,
    entityType: "security",
    action: "UPDATE",
    details: { newValue: { price } },
  }]);
}

function expectOverride(
  rows: Awaited<ReturnType<typeof readOverrides>>,
  actor: Actor,
  price: string,
  effectiveDate = fixture.today,
  validThrough = effectiveDate,
) {
  expect.soft(rows, `${actor} durable override`).toMatchObject([{
    actorUserId: fixture[actor].id,
    householdId: fixture[actor].householdId,
    securityId: fixture.referenceSecurityId,
    effectiveDate,
    validThrough,
    price,
    currency: "ZMW",
    source: "manual",
    recordedAt: expect.any(Date),
  }]);
}

async function expectLateWithdrawal(change: () => Promise<void>, status: number) {
  await setOtherRole(fixture, "admin");
  const before = await readPriceState();
  const runTransaction = transactions.withTransaction;
  const admission = vi.spyOn(transactions, "withTransaction").mockImplementationOnce(
    async <T>(operation: (tx: TransactionType) => Promise<T>) => {
      await change();
      return runTransaction(operation);
    },
  );
  try {
    const response = await putPrice("other", "8.7654");
    expect(response.status).toBe(status);
    expect(admission).toHaveBeenCalledTimes(1);
  } finally {
    admission.mockRestore();
  }
  const after = await readPriceState();
  expect(after.overrides).toEqual(before.overrides);
  expect(after.global).toEqual(before.global);
  expect(after.audits).toEqual(before.audits);
}

describe("C3-06 signed household security price overrides", () => {
  beforeAll(async () => {
    app = await getTestApp();
    passwordHash = await hashPassword(password);
    setGlobalFXService(createFXRateService(createFXRateRepository(db, fxRates)));
  });

  beforeEach(async () => {
    fxQuoteId = undefined;
    fixture = createPriceFixture();
    await seedPriceFixture(fixture, app, passwordHash);
    await db.insert(holdings).values([
      { householdId: fixture.homeHouseholdId, accountId: fixture.homeAccountId,
        securityId: fixture.referenceSecurityId, quantity: "100", costBasis: "100.00" },
      { householdId: fixture.otherHouseholdId, accountId: fixture.otherAccountId,
        securityId: fixture.referenceSecurityId, quantity: "100", costBasis: "100.00" },
    ]);
    await db.insert(securityPrices).values({
      securityId: fixture.referenceSecurityId,
      date: "2000-01-01",
      price: "2.0000",
      source: "synthetic_provider",
    });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    if (!fixture) return;
    if (fxQuoteId) await db.delete(fxRates).where(eq(fxRates.id, fxQuoteId));
    await db.delete(householdSecurityPriceOverrides).where(fixtureOverrides());
    await cleanPriceFixture(fixture);
  });

  it.each(["home", "other"] as const)("returns a bounded receipt for %s and retains author provenance", async actor => {
    await setOtherRole(fixture, "admin");
    const beforeAudits = await readAudits();
    const response = await putPrice(actor, "3.1415").expect(200);
    const rows = await readOverrides();
    expectOverride(rows, actor, "3.1415");
    expect(rows).toHaveLength(1);
    const [override] = rows;
    const [instrument] = await db.select({ symbol: securities.symbol }).from(securities)
      .where(eq(securities.id, fixture.referenceSecurityId));

    expect(response.body.data).toEqual({
      id: override.id,
      householdId: override.householdId,
      securityId: override.securityId,
      symbol: instrument.symbol,
      effectiveDate: override.effectiveDate,
      validThrough: override.validThrough,
      price: override.price,
      currency: override.currency,
      source: override.source,
      recordedAt: override.recordedAt.toISOString(),
    });
    expect(response.body.data).not.toHaveProperty("actorUserId");
    const beforeAuditIds = new Set(beforeAudits.map(row => row.id));
    const newAudits = (await readAudits()).filter(row => !beforeAuditIds.has(row.id));
    expectPriceAudit(newAudits, actor, "3.1415");
  });

  it("keeps the same dated instrument override separate for an owner and an unrelated admin", async () => {
    await setOtherRole(fixture, "admin");
    const beforePrices = await globalPriceState(fixture);
    const beforeAudits = await readAudits();
    expect(await readOverrides()).toEqual([]);
    await expectHoldingValue("home", 200);
    await expectHoldingValue("other", 200);

    const owner = await putPrice("home", "3.1415");
    expect.soft(owner.status, "owner update").toBe(200);
    expect.soft(await globalPriceState(fixture)).toEqual(beforePrices);
    await expectHoldingValue("home", 314.15);
    await expectHoldingValue("other", 200);
    const ownerOverrides = await readOverrides();
    expectOverride(ownerOverrides, "home", "3.1415");
    const ownerAudits = await readAudits();
    const beforeAuditIds = new Set(beforeAudits.map(row => row.id));
    expectPriceAudit(ownerAudits.filter(row => !beforeAuditIds.has(row.id)), "home", "3.1415");

    const admin = await putPrice("other", "7.2718");
    expect.soft(admin.status, "admin update").toBe(200);
    expect.soft(await globalPriceState(fixture)).toEqual(beforePrices);
    await expectHoldingValue("home", 314.15);
    await expectHoldingValue("other", 727.18);
    const bothOverrides = await readOverrides();
    const ownerOverrideIds = new Set(ownerOverrides.map(row => row.id));
    expect.soft(bothOverrides.filter(row => ownerOverrideIds.has(row.id))).toEqual(ownerOverrides);
    expectOverride(bothOverrides.filter(row => !ownerOverrideIds.has(row.id)), "other", "7.2718");
    const bothAudits = await readAudits();
    const ownerAuditIds = new Set(ownerAudits.map(row => row.id));
    expect.soft(bothAudits.filter(row => ownerAuditIds.has(row.id))).toEqual(ownerAudits);
    expectPriceAudit(bothAudits.filter(row => !ownerAuditIds.has(row.id)), "other", "7.2718");
  });

  it.each(securityViews)("shows each household's own eligible manual price through the signed %s", async view => {
    await setOtherRole(fixture, "admin");
    await putPrice("home", "3.1415").expect(200);
    await putPrice("other", "7.2718").expect(200);
    const before = await readPriceState();
    const reference = before.global.instruments.find(row => row.id === fixture.referenceSecurityId)!;

    for (const [actor, price] of [["home", "3.1415"], ["other", "7.2718"]] as const) {
      const response = await getSecurityView(actor, view, reference.symbol).expect(200);
      if (view === "catalogue") expect(response.body.data).toHaveLength(1);
      const row = view === "catalogue" ? response.body.data[0] : response.body.data;
      expect(row).toMatchObject({
        id: reference.id, symbol: reference.symbol, name: reference.name,
        currency: "ZMW", currentPrice: price,
      });
      expect(row.valuationPrice).toEqual({
        source: "manual", effectiveDate: fixture.today, validThrough: fixture.today,
        recordedAt: expect.any(String),
      });
      for (const field of ["priceEvidence", "actorUserId", "householdId", "overrideId", "overrides"]) {
        expect(row).not.toHaveProperty(field);
      }
      for (const hidden of [
        fixture.home.id, fixture.other.id, fixture.homeHouseholdId, fixture.otherHouseholdId,
        ...before.overrides.map(mark => mark.id),
      ]) expect(response.text).not.toContain(hidden);
    }
    expect(await readPriceState()).toEqual(before);
  });

  it.each(securityViews)("keeps %s metadata available when the reference and eligible manual price are absent", async view => {
    await db.update(securities).set({ currentPrice: null }).where(eq(securities.id, fixture.referenceSecurityId));
    const before = await readPriceState();
    const reference = before.global.instruments.find(row => row.id === fixture.referenceSecurityId)!;
    const response = await getSecurityView("home", view, reference.symbol).expect(200);
    if (view === "catalogue") expect(response.body.data).toHaveLength(1);
    const row = view === "catalogue" ? response.body.data[0] : response.body.data;
    expect(row).toMatchObject({ id: reference.id, symbol: reference.symbol, currentPrice: null, valuationPrice: null });
    expect(await readPriceState()).toEqual(before);
  });

  it.each(securityViews)("uses the reference again after the household window expires through %s", async view => {
    const past = new Date(`${fixture.today}T00:00:00Z`);
    past.setUTCDate(past.getUTCDate() - 1);
    const yesterday = past.toISOString().slice(0, 10);
    await putPrice("home", "3.1415", yesterday, yesterday).expect(200);
    const before = await readPriceState();
    const reference = before.global.instruments.find(row => row.id === fixture.referenceSecurityId)!;
    const response = await getSecurityView("home", view, reference.symbol).expect(200);
    const row = view === "catalogue" ? response.body.data[0] : response.body.data;
    expect(row).toMatchObject({ currentPrice: reference.currentPrice, valuationPrice: null });
    expect(await readPriceState()).toEqual(before);
  });

  it.each(securityViews)("requires overlap resolution through the signed %s", async view => {
    await putPrice("home", "2.0000").expect(200);
    const previous = new Date(`${fixture.today}T00:00:00Z`);
    previous.setUTCDate(previous.getUTCDate() - 1);
    await db.insert(householdSecurityPriceOverrides).values({
      householdId: fixture.homeHouseholdId, securityId: fixture.referenceSecurityId,
      actorUserId: fixture.home.id, effectiveDate: previous.toISOString().slice(0, 10),
      validThrough: fixture.today, price: "2.0000", currency: "ZMW", source: "manual",
    });
    const before = await readPriceState();
    const reference = before.global.instruments.find(row => row.id === fixture.referenceSecurityId)!;
    const response = await getSecurityView("home", view, reference.symbol).expect(409);
    expect(response.body).toMatchObject({ success: false, error: { code: "CONFLICT" } });
    expect(response.body.error.message).toMatch(/overlap/i);
    expect(response.body).not.toHaveProperty("data");
    expect(await readPriceState()).toEqual(before);
  });

  it.each(securityViews)("checks current membership after route admission through %s", async view => {
    const [reference] = await db.select().from(securities).where(eq(securities.id, fixture.referenceSecurityId));
    const before = await readPriceState();
    const lockActor = readAuthority.lockInvestmentReadActor;
    const admission = vi.spyOn(readAuthority, "lockInvestmentReadActor").mockImplementationOnce(async (...args) => {
      await db.delete(householdMembers).where(and(
        eq(householdMembers.householdId, fixture.otherHouseholdId),
        eq(householdMembers.userId, fixture.other.id),
      ));
      return lockActor(...args);
    });
    try {
      const response = await getSecurityView("other", view, reference.symbol).expect(403);
      expect(admission).toHaveBeenCalledOnce();
      expect(response.body).not.toHaveProperty("data");
    } finally {
      admission.mockRestore();
    }
    const after = await readPriceState();
    expect(after.global).toEqual(before.global);
    expect(after.overrides).toEqual(before.overrides);
    expect(after.audits).toEqual(before.audits);
  });

  it("retains global reference history for both households after their manual price writes", async () => {
    await setOtherRole(fixture, "admin");
    await putPrice("home", "3.1415").expect(200);
    await putPrice("other", "7.2718").expect(200);
    const before = await readPriceState();
    const expected = before.global.prices.map(row => ({ ...row, createdAt: row.createdAt?.toISOString() ?? null }));
    for (const actor of ["home", "other"] as const) {
      const response = await signed(app, fixture, actor, "get",
        `/api/investments/securities/${fixture.referenceSecurityId}/prices`)
        .query({ startDate: "2000-01-01", endDate: "2000-01-01", limit: 1 }).expect(200);
      expect(response.body.data).toEqual(expected);
    }
    expect(await readPriceState()).toEqual(before);
  });

  it("preserves catalogue filters while selecting the household price", async () => {
    await db.update(securities).set({ exchange: "luse" }).where(eq(securities.id, fixture.referenceSecurityId));
    await putPrice("home", "3.1415").expect(200);
    const before = await readPriceState();
    const reference = before.global.instruments.find(row => row.id === fixture.referenceSecurityId)!;
    const matching = { search: reference.symbol.toLowerCase(), type: "stock", currency: "ZMW", exchange: "luse" };
    const selected = await signed(app, fixture, "home", "get", "/api/investments/securities")
      .query(matching).expect(200);
    expect(selected.body.data).toMatchObject([{ id: reference.id, currentPrice: "3.1415" }]);
    for (const mismatch of [{ type: "bond" }, { currency: "USD" }, { exchange: "nyse" }]) {
      const response = await signed(app, fixture, "home", "get", "/api/investments/securities")
        .query({ ...matching, ...mismatch }).expect(200);
      expect(response.body.data).toEqual([]);
    }
    expect(await readPriceState()).toEqual(before);
  });

  it.each(["member", "professional", "view_only"] as const)(
    "refuses a %s and preserves price and audit state",
    async role => {
      await db.update(householdMembers).set({ role }).where(and(
        eq(householdMembers.householdId, fixture.otherHouseholdId),
        eq(householdMembers.userId, fixture.other.id),
      ));
      const before = await readPriceState();
      await expectHoldingValue("home", 200);
      await expectHoldingValue("other", 200);

      const response = await putPrice("other", "9.8765");
      expect.soft(response.status).toBe(403);
      expect.soft(await readPriceState()).toEqual(before);
      await expectHoldingValue("home", 200);
      await expectHoldingValue("other", 200);
    },
  );

  it("rechecks the owner or admin role after route admission", async () => {
    await expectLateWithdrawal(async () => {
      await db.update(householdMembers).set({ role: "member" }).where(and(
        eq(householdMembers.householdId, fixture.otherHouseholdId),
        eq(householdMembers.userId, fixture.other.id),
      ));
    }, 403);
  });

  it("rejects the genuinely revoked signed session before inserting a price", async () => {
    const current = await pool.query<{ sid: string }>(
      `SELECT sid FROM "session" WHERE sess->>'userId'=$1`,
      [fixture.other.id],
    );
    expect(current.rows).toHaveLength(1);
    const runTransaction = transactions.withTransaction;
    await expectLateWithdrawal(async () => {
      await runTransaction(tx => revokeSessionByToken(tx, fixture.other.id, current.rows[0].sid));
    }, 401);
  });

  it("refuses a changed same-date submission without replacing its recorded evidence", async () => {
    await setOtherRole(fixture, "admin");
    await putPrice("other", "3.1415").expect(200);
    const before = await readPriceState();

    const response = await putPrice("other", "7.2718");
    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({
      success: false,
      error: {
        code: "CONFLICT",
        existingOverride: {
          id: before.overrides[0].id,
          effectiveDate: fixture.today,
          validThrough: fixture.today,
        },
      },
    });
    expect(await readPriceState()).toEqual(before);
  });

  it("requires resolution when different effective dates share an inclusive valuation day", async () => {
    await setOtherRole(fixture, "admin");
    const first = new Date(`${fixture.today}T00:00:00Z`);
    first.setUTCDate(first.getUTCDate() - 2);
    const firstDate = first.toISOString().slice(0, 10);
    await putPrice("other", "3.1415", firstDate, fixture.today).expect(200);
    const before = await readPriceState();

    const response = await putPrice("other", "7.2718", fixture.today, fixture.today);
    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({ success: false, error: { code: "CONFLICT" } });
    expect(await readPriceState()).toEqual(before);
  });

  it("serializes two signed household authors with overlapping windows and different effective dates", async () => {
    const original = await readPriceState();
    const previous = new Date(`${fixture.today}T00:00:00Z`);
    previous.setUTCDate(previous.getUTCDate() - 1);
    const submissions = [
      { userId: fixture.home.id, price: "3.1415", date: previous.toISOString().slice(0, 10) },
      { userId: fixture.other.id, price: "7.2718", date: fixture.today },
    ];
    expect(submissions[0].date).not.toBe(submissions[1].date);
    const moved = await db.update(householdMembers).set({
      householdId: fixture.homeHouseholdId, role: "admin",
    }).where(and(
      eq(householdMembers.householdId, fixture.otherHouseholdId),
      eq(householdMembers.userId, fixture.other.id),
    )).returning({ id: householdMembers.id });
    expect(moved).toHaveLength(1);

    try {
      const login = await request(app).post("/api/auth/login")
        .send({ email: fixture.other.email, password }).expect(200);
      const cookie = (login.headers["set-cookie"] as unknown as string[]).join("; ");
      const path = `/api/investments/securities/${fixture.referenceSecurityId}/price`;
      const adminRequest = request(app).put(path).set("Cookie", cookie)
        .set("X-Capital-Subject", fixture.other.id)
        .set("X-Capital-Household", fixture.homeHouseholdId);
      const ownerRequest = signed(app, fixture, "home", "put", path);
      const before = await readPriceState();
      expect(before.overrides).toEqual([]);

      const admitted = new Set<string>();
      let firstBackendPid: number | undefined;
      let firstAuditActor: string | null | undefined;
      let releaseAudit!: () => void;
      const auditRelease = new Promise<void>(resolve => { releaseAudit = resolve; });
      const realWriter = investmentService.updateSecurityPrice.bind(investmentService);
      const realAudit = businessAuditService.logUpdate.bind(businessAuditService);
      const pendingWrites: ReturnType<typeof investmentService.updateSecurityPrice>[] = [];
      const writerAdmission = vi.spyOn(investmentService, "updateSecurityPrice").mockImplementation(async (...args) => {
        if (args[0] === fixture.referenceSecurityId && args[2].householdId === fixture.homeHouseholdId) {
          admitted.add(args[2].userId);
        }
        const write = realWriter(...args);
        pendingWrites.push(write);
        return write;
      });
      const auditGate = vi.spyOn(businessAuditService, "logUpdate").mockImplementation(async entry => {
        if (entry.entityType === "security" && entry.entityId === fixture.referenceSecurityId
          && entry.householdId === fixture.homeHouseholdId && firstAuditActor === undefined) {
          firstAuditActor = entry.userId;
          if (!entry.tx) throw new Error("Price audit must use its writer transaction");
          const backend = await entry.tx.execute<{ pid: number }>(sql`select pg_backend_pid() as pid`);
          firstBackendPid = backend.rows[0].pid;
          await auditRelease;
        }
        return realAudit(entry);
      });
      const responses = Promise.allSettled([
        ownerRequest.send({ price: submissions[0].price, date: submissions[0].date, validThrough: fixture.today })
          .timeout({ deadline: 12_000 }),
        adminRequest.send({ price: submissions[1].price, date: submissions[1].date, validThrough: fixture.today })
          .timeout({ deadline: 12_000 }),
      ]);
      let completed: PromiseSettledResult<request.Response>[] = [];
      try {
        await vi.waitFor(() => {
          expect(admitted).toEqual(new Set(submissions.map(row => row.userId)));
          expect(firstBackendPid).toBeTypeOf("number");
        }, { timeout: 5_000, interval: 20 });
        await vi.waitFor(async () => {
          const waiting = await pool.query<{ count: number }>(`
            select count(*)::integer as count from pg_locks l
            where l.locktype = 'advisory' and not l.granted
              and $1::integer = any(pg_blocking_pids(l.pid))
          `, [firstBackendPid]);
          expect(waiting.rows[0].count).toBe(1);
        }, { timeout: 5_000, interval: 20 });
        // The first INSERT exists only inside its uncommitted writer. The
        // second signed author is admitted and waiting on that interval mutex.
        expect(await readPriceState()).toEqual(before);
      } finally {
        releaseAudit();
        completed = await responses;
        await Promise.allSettled(pendingWrites);
        auditGate.mockRestore();
        writerAdmission.mockRestore();
      }

      const results = completed.map(result => {
        if (result.status === "rejected") throw result.reason;
        return result.value;
      });
      expect(results.map(result => result.status).sort()).toEqual([200, 409]);
      const winnerIndex = results.findIndex(result => result.status === 200);
      const winner = submissions[winnerIndex];
      const loser = results[1 - winnerIndex];
      expect(winner.userId).toBe(firstAuditActor);
      expect(loser.body).toMatchObject({ success: false, error: { code: "CONFLICT" } });
      const after = await readPriceState();
      expect(after.global).toEqual(before.global);
      expect(after.memberships).toEqual(before.memberships);
      expect(after.overrides).toHaveLength(1);
      expect(after.overrides).toMatchObject([{
        householdId: fixture.homeHouseholdId, securityId: fixture.referenceSecurityId,
        actorUserId: winner.userId, effectiveDate: winner.date, validThrough: fixture.today,
        price: winner.price, currency: "ZMW", source: "manual",
      }]);
      expect(loser.body.error.existingOverride).toEqual({
        id: after.overrides[0].id,
        effectiveDate: winner.date,
        validThrough: fixture.today,
      });
      const priorAuditIds = new Set(before.audits.map(row => row.id));
      const addedAudits = after.audits.filter(row => !priorAuditIds.has(row.id));
      expect(addedAudits).toHaveLength(1);
      expect(addedAudits).toMatchObject([{
        householdId: fixture.homeHouseholdId, userId: winner.userId,
        entityType: "security", entityId: fixture.referenceSecurityId, action: "UPDATE",
        details: { newValue: {
          overrideId: after.overrides[0].id, price: winner.price,
          date: winner.date, validThrough: fixture.today, source: "manual",
        } },
      }]);
    } finally {
      await db.update(householdMembers).set({
        householdId: fixture.otherHouseholdId, role: "member",
      }).where(inArray(householdMembers.id, moved.map(row => row.id)));
    }
    expect((await readPriceState()).memberships).toEqual(original.memberships);
  });

  it("retains separate prices in nonoverlapping validity periods", async () => {
    await setOtherRole(fixture, "admin");
    const past = new Date(`${fixture.today}T00:00:00Z`);
    past.setUTCDate(past.getUTCDate() - 1);
    const yesterday = past.toISOString().slice(0, 10);
    await putPrice("other", "3.1415", yesterday, yesterday).expect(200);
    const original = await readOverrides();
    await putPrice("other", "7.2718", fixture.today, fixture.today).expect(200);
    const prices = await readOverrides();
    expect(prices).toHaveLength(2);
    expect(prices.filter(row => row.id === original[0].id)).toEqual(original);
    expectOverride(prices.filter(row => row.id !== original[0].id), "other", "7.2718");
  });

  it.each([
    { period: "ends today", endOffset: 0, value: 432.19 },
    { period: "ended yesterday", endOffset: -1, value: 200 },
  ])("stores the supplied dates and uses today's eligible price when the period $period", async ({ endOffset, value }) => {
    await setOtherRole(fixture, "admin");
    const start = new Date(`${fixture.today}T00:00:00Z`);
    const end = new Date(start);
    start.setUTCDate(start.getUTCDate() - 2);
    end.setUTCDate(end.getUTCDate() + endOffset);
    const date = start.toISOString().slice(0, 10);
    const validThrough = end.toISOString().slice(0, 10);
    const price = "4.3219";
    await db.insert(securityPrices).values({
      securityId: fixture.referenceSecurityId,
      date: fixture.today,
      price: "2.0000",
      source: "synthetic_provider",
    });
    const beforePrices = await globalPriceState(fixture);
    expect(await readOverrides()).toEqual([]);
    await expectHoldingValue("home", 200);
    await expectHoldingValue("other", 200);

    await putPrice("other", price, date, validThrough).expect(200);

    expectOverride(await readOverrides(), "other", price, date, validThrough);
    expect.soft(await globalPriceState(fixture)).toEqual(beforePrices);
    await expectHoldingValue("home", 200);
    await expectHoldingValue("other", value);
  });

  it("rolls back a signed price override if its required security UPDATE audit fails", async () => {
    await setOtherRole(fixture, "admin");
    const { id: userId, householdId } = fixture.other;
    const price = "5.4321";
    const before = await readPriceState();
    expect(before.overrides).toEqual([]);
    await expectHoldingValue("home", 200);
    await expectHoldingValue("other", 200);

    const fault = `c306_price_audit_${userId.replaceAll("-", "")}`;
    try {
      await pool.query(`
        CREATE FUNCTION ${fault}() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
          IF NEW.user_id = '${userId}'::uuid
            AND NEW.household_id = '${householdId}'::uuid
            AND NEW.entity_id = '${fixture.referenceSecurityId}'::uuid
            AND NEW.entity_type = 'security' AND NEW.action = 'UPDATE'
            AND NEW.details->'newValue'->>'price' = '${price}' THEN
            RAISE EXCEPTION 'Synthetic mandatory security price audit failure';
          END IF;
          RETURN NEW;
        END;
        $$;
        CREATE TRIGGER ${fault} BEFORE INSERT ON audit_logs
          FOR EACH ROW EXECUTE FUNCTION ${fault}()
      `);

      const rejected = await putPrice("other", price);
      expect.soft(rejected.status).toBe(500);
      expect.soft(rejected.body).toMatchObject({ success: false, error: { code: "INTERNAL_ERROR" } });
      expect.soft(await readPriceState()).toEqual(before);
      await expectHoldingValue("home", 200);
      await expectHoldingValue("other", 200);
    } finally {
      await pool.query(`DROP TRIGGER IF EXISTS ${fault} ON audit_logs; DROP FUNCTION IF EXISTS ${fault}()`);
    }

    await putPrice("other", price).expect(200);
    const after = await readPriceState();
    expectOverride(after.overrides, "other", price);
    const priorAuditIds = new Set(before.audits.map(row => row.id));
    expectPriceAudit(after.audits.filter(row => !priorAuditIds.has(row.id)), "other", price);
    expect.soft(after.global).toEqual(before.global);
    expect.soft(after.memberships).toEqual(before.memberships);
    await expectHoldingValue("home", 200);
    await expectHoldingValue("other", 543.21);
  });

  it.each(valuationPaths.flatMap(path => [null, "NaN"].map(price => ({ path, price }))))(
    "returns unavailable for a nonzero holding with price $price through $path and retains a zero-share shell",
    async ({ path, price }) => {
      await db.update(securities).set({ currentPrice: price }).where(eq(securities.id, fixture.referenceSecurityId));
      const unavailable = await signed(app, fixture, "home", "get", `/api/investments${path}`)
        .query({ currency: "ZMW" })
        .expect(422);
      expect(unavailable.body).toMatchObject({ success: false, error: { code: "FINANCIAL_DATA_UNAVAILABLE" } });
      expect(unavailable.body).not.toHaveProperty("data");

      await db.update(holdings).set({ quantity: "0" }).where(and(
        eq(holdings.householdId, fixture.homeHouseholdId),
        eq(holdings.securityId, fixture.referenceSecurityId),
      ));
      const shell = await signed(app, fixture, "home", "get", `/api/investments${path}`)
        .query({ currency: "ZMW" })
        .expect(200);
      const zero = { amount: "0.00", currency: "ZMW" };
      if (path === "/holdings") expect(shell.body.data).toMatchObject([{ currentValue: zero }]);
      else expect(shell.body.data).toMatchObject({ totalValue: zero });
    },
  );

  it.each(valuationPaths)("returns unavailable for a nonfinite share quantity through %s", async path => {
    await db.update(holdings).set({ quantity: "NaN" }).where(and(
      eq(holdings.householdId, fixture.homeHouseholdId),
      eq(holdings.securityId, fixture.referenceSecurityId),
    ));
    const response = await signed(app, fixture, "home", "get", `/api/investments${path}`)
      .query({ currency: "ZMW" })
      .expect(422);
    expect(response.body).toMatchObject({ success: false, error: { code: "FINANCIAL_DATA_UNAVAILABLE" } });
    expect(response.body).not.toHaveProperty("data");
  });

  it.each(valuationPaths)("requires resolution of existing overlapping eligible evidence through %s", async path => {
    await putPrice("home", "2.0000").expect(200);
    const earlier = new Date(`${fixture.today}T00:00:00Z`);
    earlier.setUTCDate(earlier.getUTCDate() - 1);
    // Existing storage permits distinct start dates. Seed the legacy ambiguous
    // state without changing the signed writer's overlap refusal or its guards.
    await db.insert(householdSecurityPriceOverrides).values({
      householdId: fixture.homeHouseholdId,
      securityId: fixture.referenceSecurityId,
      actorUserId: fixture.home.id,
      effectiveDate: earlier.toISOString().slice(0, 10),
      validThrough: fixture.today,
      price: "2.0000",
      currency: "ZMW",
      source: "manual",
    });
    const before = await readPriceState();
    expect(before.overrides).toHaveLength(2);
    const response = await signed(app, fixture, "home", "get", `/api/investments${path}`)
      .query({ currency: "ZMW" })
      .expect(409);
    expect(response.body).toMatchObject({ success: false, error: { code: "CONFLICT" } });
    expect(response.body.error.message).toMatch(/overlap/i);
    expect(response.body).not.toHaveProperty("data");
    expect(await readPriceState()).toEqual(before);
    await expectHoldingValue("other", 200);
  });

  it.each(["/holdings", "/portfolio/summary"])("retires %s when an equal-price override arrives during the real FX await", async path => {
    expect(await db.select({ id: fxRates.id }).from(fxRates).where(and(
      eq(fxRates.fromCurrency, "ZMW"), eq(fxRates.toCurrency, "USD"), gte(fxRates.date, fixture.today),
    ))).toEqual([]);
    fxQuoteId = randomUUID();
    await db.insert(fxRates).values({
      id: fxQuoteId, fromCurrency: "ZMW", toCurrency: "USD",
      rate: "0.0500", date: fixture.today, source: "synthetic_c306_publication",
    });
    const before = await readPriceState();
    const originalRates = calculations.getLatestFxRates;
    const gate = vi.spyOn(calculations, "getLatestFxRates").mockImplementationOnce(async (...args) => {
      const rates = await originalRates(...args);
      expect(args).toEqual([["ZMW"], "USD", fixture.homeHouseholdId]);
      expect(rates.get("ZMW")).toBe(0.05);
      await putPrice("home", "2.0000").expect(200);
      return rates;
    });
    try {
      const response = await signed(app, fixture, "home", "get", `/api/investments${path}`)
        .query({ currency: "USD" })
        .expect(409);
      expect(gate).toHaveBeenCalledOnce();
      expect(response.body).toMatchObject({ success: false, error: { code: "CONFLICT" } });
      expect(response.body).not.toHaveProperty("data");
    } finally {
      gate.mockRestore();
    }
    const after = await readPriceState();
    expectOverride(after.overrides, "home", "2.0000");
    expect(after.global).toEqual(before.global);
    const fresh = await signed(app, fixture, "home", "get", `/api/investments${path}`)
      .query({ currency: "USD" })
      .expect(200);
    const ten = { amount: "10.00", currency: "USD" };
    if (path === "/holdings") expect(fresh.body.data).toMatchObject([{ currentValue: ten }]);
    else expect(fresh.body.data).toMatchObject({ totalValue: ten });
    expect(fresh.text).not.toContain("priceEvidence");
    expect(fresh.text).not.toContain("actorUserId");
  });
});
