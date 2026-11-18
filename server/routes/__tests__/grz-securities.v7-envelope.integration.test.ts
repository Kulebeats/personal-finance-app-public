/**
 * GRZ V7 Envelope — Integration Tests (P8a)
 *
 * server/routes/grz-securities.ts previously returned raw arrays/objects on
 * success and a bare `{ error }` shape on failure, inconsistently even within
 * the same router (production-readiness audit v2 finding). Every other module
 * uses the V7 envelope: `{ success: true, data }` on success and
 * `{ success: false, error: { code, message } }` on failure.
 *
 * This suite proves EVERY converted endpoint now returns the V7 envelope on
 * both success and error paths, over a real HTTP request against real
 * Postgres. It does not re-verify money math, locking, or audit logging —
 * those are covered by grz-money.integration.test.ts,
 * grz-securities.sell-race.db.integration.test.ts, and
 * grz-audit.integration.test.ts respectively.
 */
import request from "supertest";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { Express } from "express";
import { randomUUID } from "crypto";
import { eq } from "drizzle-orm";
import { db } from "../../db";
import {
  grzBonds,
  grzBondPayments,
  grzTBills,
  investmentTransactions,
  transactions,
  accounts,
  auditLogs,
  users,
  households,
  householdMembers,
} from "@shared/schema";
import {
  createTestUser,
  createTestHousehold,
  getTestApp,
} from "../../__tests__/fixtures";
import { hashPassword } from "../../auth";

describe("GRZ V7 envelope (P8a)", () => {
  let app: Express;
  let authCookie: string;
  let csrfToken: string;
  let householdId: string;
  let userId: string;
  let accountId: string;

  // A second household, used only to prove the cross-household 403 path.
  let otherHouseholdId: string;
  let otherUserId: string;
  let otherAuthCookie: string;
  let otherCsrfToken: string;

  const authRequest = (req: request.Test) =>
    req.set("Cookie", authCookie).set("X-CSRF-Token", csrfToken);
  const otherAuthRequest = (req: request.Test) =>
    req.set("Cookie", otherAuthCookie).set("X-CSRF-Token", otherCsrfToken);

  async function loginAndGetCsrf(email: string, password: string) {
    const loginRes = await request(app)
      .post("/api/auth/login")
      .send({ email, password })
      .expect(200);
    let cookie = loginRes.headers["set-cookie"]
      ? (loginRes.headers["set-cookie"] as unknown as string[]).join("; ")
      : "";

    const csrfRes = await request(app)
      .get("/api/csrf-token")
      .set("Cookie", cookie)
      .expect(200);
    if (csrfRes.headers["set-cookie"]) {
      cookie = [cookie, ...csrfRes.headers["set-cookie"]].join("; ");
    }
    return { cookie, csrfToken: csrfRes.body.csrfToken as string };
  }

  beforeAll(async () => {
    app = await getTestApp();
    const timestamp = Date.now();

    const testUser = createTestUser({
      email: `grz-envelope-${timestamp}@example.com`,
      username: `grz-envelope-user-${timestamp}`,
    });
    const testHousehold = createTestHousehold(testUser.id, {
      name: "GRZ Envelope Household",
      currency: "ZMW",
    });
    householdId = testHousehold.id;
    userId = testUser.id;
    testUser.passwordHash = await hashPassword("TestPassword123");

    await db.insert(households).values({
      id: testHousehold.id,
      name: testHousehold.name,
      currency: testHousehold.currency,
    });
    await db.insert(users).values({
      id: testUser.id,
      email: testUser.email,
      username: testUser.username,
      passwordHash: testUser.passwordHash,
      fullName: testUser.fullName,
      emailVerified: testUser.emailVerified,
      mfaEnabled: testUser.mfaEnabled,
      failedLoginAttempts: testUser.failedLoginAttempts,
      lockedUntil: testUser.lockedUntil,
    });
    await db.insert(householdMembers).values({
      householdId: testHousehold.id,
      userId: testUser.id,
      role: "admin",
    });

    accountId = randomUUID();
    await db.insert(accounts).values({
      id: accountId,
      householdId,
      name: "GRZ Envelope Account",
      type: "investment",
      balance: "1000000.00",
      currency: "ZMW",
    });

    const primary = await loginAndGetCsrf(testUser.email, "TestPassword123");
    authCookie = primary.cookie;
    csrfToken = primary.csrfToken;

    // Second, unrelated household/user — used to hit cross-household 403s.
    const otherUser = createTestUser({
      email: `grz-envelope-other-${timestamp}@example.com`,
      username: `grz-envelope-other-user-${timestamp}`,
    });
    const otherHousehold = createTestHousehold(otherUser.id, {
      name: "GRZ Envelope Other Household",
      currency: "ZMW",
    });
    otherHouseholdId = otherHousehold.id;
    otherUserId = otherUser.id;
    otherUser.passwordHash = await hashPassword("TestPassword123");

    await db.insert(households).values({
      id: otherHousehold.id,
      name: otherHousehold.name,
      currency: otherHousehold.currency,
    });
    await db.insert(users).values({
      id: otherUser.id,
      email: otherUser.email,
      username: otherUser.username,
      passwordHash: otherUser.passwordHash,
      fullName: otherUser.fullName,
      emailVerified: otherUser.emailVerified,
      mfaEnabled: otherUser.mfaEnabled,
      failedLoginAttempts: otherUser.failedLoginAttempts,
      lockedUntil: otherUser.lockedUntil,
    });
    await db.insert(householdMembers).values({
      householdId: otherHousehold.id,
      userId: otherUser.id,
      role: "admin",
    });

    const other = await loginAndGetCsrf(otherUser.email, "TestPassword123");
    otherAuthCookie = other.cookie;
    otherCsrfToken = other.csrfToken;
  });

  afterAll(async () => {
    try {
      for (const hh of [householdId, otherHouseholdId]) {
        await db.delete(auditLogs).where(eq(auditLogs.householdId, hh));
        const bonds = await db
          .select({ id: grzBonds.id })
          .from(grzBonds)
          .where(eq(grzBonds.householdId, hh));
        for (const b of bonds) {
          await db
            .delete(grzBondPayments)
            .where(eq(grzBondPayments.bondId, b.id));
        }
        await db.delete(grzBonds).where(eq(grzBonds.householdId, hh));
        await db.delete(grzTBills).where(eq(grzTBills.householdId, hh));
        await db
          .delete(investmentTransactions)
          .where(eq(investmentTransactions.householdId, hh));
        await db.delete(transactions).where(eq(transactions.householdId, hh));
        await db.delete(accounts).where(eq(accounts.householdId, hh));
        await db
          .delete(householdMembers)
          .where(eq(householdMembers.householdId, hh));
        await db.delete(households).where(eq(households.id, hh));
      }
      await db.delete(users).where(eq(users.id, userId));
      await db.delete(users).where(eq(users.id, otherUserId));
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error("GRZ envelope test cleanup error", error);
    }
  });

  const bondPayload = (overrides?: Record<string, unknown>) => ({
    bondName: "GRZ Envelope Test Bond",
    tenorYears: 5,
    faceValue: "100000.00",
    purchasePrice: "98000.00",
    purchaseDate: "2026-01-01",
    couponRate: "11.0000",
    maturityDate: "2031-01-01",
    accountId,
    ...overrides,
  });

  const tbillPayload = (overrides?: Record<string, unknown>) => ({
    tbillName: "GRZ Envelope Test TBill",
    tenorDays: 91,
    faceValue: "10000.00",
    purchasePrice: "9600.00",
    purchaseDate: "2026-01-01",
    maturityDate: "2026-04-02",
    accountId,
    ...overrides,
  });

  it("GET /api/grz/bonds returns { success: true, data: [] } on success", async () => {
    const res = await authRequest(request(app).get("/api/grz/bonds")).expect(
      200,
    );
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  it("GET /api/grz/tbills returns { success: true, data: [] } on success", async () => {
    const res = await authRequest(request(app).get("/api/grz/tbills")).expect(
      200,
    );
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  it("POST /api/grz/bonds returns { success: true, data: bond } on success (201)", async () => {
    const res = await authRequest(request(app).post("/api/grz/bonds"))
      .send(bondPayload())
      .expect(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.id).toBeTruthy();
    expect(res.body.data.bondName).toBe("GRZ Envelope Test Bond");
  });

  it("POST /api/grz/bonds returns a VALIDATION_ERROR envelope (400) for invalid input", async () => {
    const res = await authRequest(request(app).post("/api/grz/bonds"))
      .send(bondPayload({ faceValue: undefined, bondName: undefined }))
      .expect(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
    expect(typeof res.body.error.message).toBe("string");
  });

  it("POST /api/grz/bonds returns a NOT_FOUND envelope (404) for a foreign accountId", async () => {
    const res = await authRequest(request(app).post("/api/grz/bonds"))
      .send(bondPayload({ accountId: randomUUID() }))
      .expect(404);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe("NOT_FOUND");
  });

  it("POST /api/grz/tbills returns { success: true, data: tbill } on success (201)", async () => {
    const res = await authRequest(request(app).post("/api/grz/tbills"))
      .send(tbillPayload())
      .expect(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.id).toBeTruthy();
    expect(res.body.data.tbillName).toBe("GRZ Envelope Test TBill");
  });

  it("POST /api/grz/tbills returns a NOT_FOUND envelope (404) for a foreign accountId", async () => {
    const res = await authRequest(request(app).post("/api/grz/tbills"))
      .send(tbillPayload({ accountId: randomUUID() }))
      .expect(404);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe("NOT_FOUND");
  });

  it("PUT /api/grz/bonds/:id/sell returns { success: true, data } on success (200)", async () => {
    const createRes = await authRequest(request(app).post("/api/grz/bonds"))
      .send(bondPayload({ bondName: "GRZ Envelope Sell Bond" }))
      .expect(201);
    const bondId = createRes.body.data.id as string;

    const res = await authRequest(
      request(app).put(`/api/grz/bonds/${bondId}/sell`),
    )
      .send({ soldPrice: "97000.00", soldDate: "2026-06-01", accountId })
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.updated.status).toBe("sold");
    expect(res.body.data.investmentTx.amount).toBe("97000.00");
  });

  it("PUT /api/grz/bonds/:id/sell returns a NOT_FOUND envelope (404) for an unknown bond", async () => {
    const res = await authRequest(
      request(app).put(`/api/grz/bonds/${randomUUID()}/sell`),
    )
      .send({ soldPrice: "97000.00", accountId })
      .expect(404);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe("NOT_FOUND");
  });

  it("PUT /api/grz/bonds/:id/sell returns a FORBIDDEN envelope (403) for another household's bond", async () => {
    const createRes = await authRequest(request(app).post("/api/grz/bonds"))
      .send(bondPayload({ bondName: "GRZ Envelope Cross-HH Bond" }))
      .expect(201);
    const bondId = createRes.body.data.id as string;

    const res = await otherAuthRequest(
      request(app).put(`/api/grz/bonds/${bondId}/sell`),
    )
      .send({ soldPrice: "97000.00" })
      .expect(403);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe("FORBIDDEN");
  });

  it("PUT /api/grz/bonds/:id/sell returns a CONFLICT envelope (409) when already sold", async () => {
    const createRes = await authRequest(request(app).post("/api/grz/bonds"))
      .send(bondPayload({ bondName: "GRZ Envelope Double Sell Bond" }))
      .expect(201);
    const bondId = createRes.body.data.id as string;

    await authRequest(request(app).put(`/api/grz/bonds/${bondId}/sell`))
      .send({ soldPrice: "97000.00", accountId })
      .expect(200);

    const res = await authRequest(
      request(app).put(`/api/grz/bonds/${bondId}/sell`),
    )
      .send({ soldPrice: "96000.00", accountId })
      .expect(409);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe("CONFLICT");
    expect(res.body.error.message).toBe("Bond is already sold");
  });

  it("POST /api/grz/payments/:id/pay returns { success: true, data } on success (200)", async () => {
    const bondRes = await authRequest(request(app).post("/api/grz/bonds"))
      .send(bondPayload({ bondName: "GRZ Envelope Pay Bond" }))
      .expect(201);
    const bondId = bondRes.body.data.id as string;

    const [payment] = await db
      .select()
      .from(grzBondPayments)
      .where(eq(grzBondPayments.bondId, bondId))
      .limit(1);
    expect(payment).toBeDefined();

    const res = await authRequest(
      request(app).post(`/api/grz/payments/${payment.id}/pay`),
    )
      .send({ accountId })
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.status).toBe("paid");
  });

  it("POST /api/grz/payments/:id/pay returns a VALIDATION_ERROR envelope (400) when accountId is missing", async () => {
    const res = await authRequest(
      request(app).post(`/api/grz/payments/${randomUUID()}/pay`),
    )
      .send({})
      .expect(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("POST /api/grz/payments/:id/pay returns a NOT_FOUND envelope (404) for an unknown payment", async () => {
    const res = await authRequest(
      request(app).post(`/api/grz/payments/${randomUUID()}/pay`),
    )
      .send({ accountId })
      .expect(404);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe("NOT_FOUND");
  });
});
