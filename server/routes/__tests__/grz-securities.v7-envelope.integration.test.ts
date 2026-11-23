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
import { eq, inArray } from "drizzle-orm";
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
  let privateReaderId: string | undefined;
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
      // A settled sale's bond and cash can only be deleted with their household,
      // in one transaction, as account erasure does (migration 0039).
      for (const hh of [householdId, otherHouseholdId]) {
        await db.transaction(async (tx) => {
          await tx.delete(auditLogs).where(eq(auditLogs.householdId, hh));
          const bonds = tx
            .select({ id: grzBonds.id })
            .from(grzBonds)
            .where(eq(grzBonds.householdId, hh));
          await tx.delete(grzBondPayments).where(inArray(grzBondPayments.bondId, bonds));
          await tx.delete(grzBonds).where(eq(grzBonds.householdId, hh));
          await tx.delete(grzTBills).where(eq(grzTBills.householdId, hh));
          await tx
            .delete(investmentTransactions)
            .where(eq(investmentTransactions.householdId, hh));
          await tx.delete(transactions).where(eq(transactions.householdId, hh));
          await tx.delete(accounts).where(eq(accounts.householdId, hh));
          await tx
            .delete(householdMembers)
            .where(eq(householdMembers.householdId, hh));
          await tx.delete(households).where(eq(households.id, hh));
        });
      }
      await db.delete(users).where(eq(users.id, userId));
      await db.delete(users).where(eq(users.id, otherUserId));
      if (privateReaderId) await db.delete(users).where(eq(users.id, privateReaderId));
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
    couponRate: "0.1100",
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

  it("scopes bond and bill lists to readable holdings and linked receipt transactions", async () => {
    const privateReader = createTestUser();
    const [reader] = await db.insert(users).values({ id: privateReader.id, username: `grz-private-${privateReader.id}`,
      email: `grz-private-${privateReader.id}@example.com`, emailVerified: true, passwordHash: await hashPassword("TestPassword123") }).returning();
    privateReaderId = reader.id;
    await db.insert(householdMembers).values({ householdId, userId: reader.id, role: "member" });
    const signer = await loginAndGetCsrf(reader.email, "TestPassword123");
    const shared = (await authRequest(request(app).post("/api/grz/bonds")).send(bondPayload()).expect(201)).body.data;
    const [restricted] = await db.insert(accounts).values({ householdId, ownerUserId: reader.id, isPrivate: true,
      name: "Restricted destination", type: "checking", currency: "ZMW", balance: "0" }).returning();
    const privateBond = bondPayload({ accountId: restricted.id }), privateBill = tbillPayload({ accountId: restricted.id });
    for (const [path, payload] of [["bonds", privateBond], ["tbills", privateBill]] as const) {
      const rejected = await authRequest(request(app).post(`/api/grz/${path}`)).send(payload);
      expect.soft(rejected.status).toBe(404);
    }
    expect.soft(await db.select({ id: grzBonds.id }).from(grzBonds).where(eq(grzBonds.accountId, restricted.id))).toEqual([]);
    expect.soft(await db.select({ id: grzTBills.id }).from(grzTBills).where(eq(grzTBills.accountId, restricted.id))).toEqual([]);
    const ownerPost = (path: string) => request(app).post(`/api/grz/${path}`).set("Cookie", signer.cookie).set("X-CSRF-Token", signer.csrfToken);
    const hidden = (await ownerPost("bonds").send(privateBond).expect(201)).body.data;
    const bill = (await ownerPost("tbills").send(privateBill).expect(201)).body.data;
    const payments = await db.select().from(grzBondPayments).where(eq(grzBondPayments.bondId, shared.id));
    const [privatePosting] = await db.insert(transactions).values({
      householdId, accountId, name: "Private receipt", date: "2026-07-01", type: "income",
      amount: "25.00", currency: "ZMW", isPrivate: true, ownerUserId: reader.id,
    }).returning();
    await db.update(grzBondPayments).set({ status: "paid", incomeTransactionId: privatePosting.id })
      .where(eq(grzBondPayments.id, payments[0].id));
    const [privateInvestment] = await db.insert(investmentTransactions).values({ householdId, accountId: restricted.id,
      type: "sell", amount: "25.00", currency: "ZMW", transactionDate: "2026-07-01" }).returning();
    await db.update(grzBondPayments).set({ investmentTransactionId: privateInvestment.id })
      .where(eq(grzBondPayments.id, payments[1].id));
    const invalidBills = [{ maturityIncomeTxId: privatePosting.id }, { maturityInvestmentTxId: privateInvestment.id },
      { rolloverToId: bill.id }, { status: "matured" }, { maturedDate: "2026-04-02" }];
    for (const extra of invalidBills) {
      const response = await authRequest(request(app).post("/api/grz/tbills"))
        .send(tbillPayload({ accountId: null, tbillName: "Unadmitted acquisition", ...extra }));
      expect.soft(response.status).toBe(400);
    }
    const sold = await authRequest(request(app).post("/api/grz/bonds"))
      .send(bondPayload({ accountId: null, bondName: "Unadmitted acquisition", soldDate: "2026-01-01" }));
    expect.soft(sold.status).toBe(400);
    expect.soft(await db.select({ id: grzTBills.id }).from(grzTBills).where(eq(grzTBills.tbillName, "Unadmitted acquisition"))).toEqual([]);
    expect.soft(await db.select({ id: grzBonds.id }).from(grzBonds).where(eq(grzBonds.bondName, "Unadmitted acquisition"))).toEqual([]);
    const bonds = (await authRequest(request(app).get("/api/grz/bonds")).expect(200)).body.data as Array<{ id: string; payments: { id: string }[] }>;
    expect.soft(bonds.map(row => row.id)).not.toContain(hidden.id);
    const visiblePayments = bonds.find(row => row.id === shared.id)?.payments.map(row => row.id);
    expect.soft(visiblePayments).not.toContain(payments[0].id);
    expect.soft(visiblePayments).not.toContain(payments[1].id);
    expect(visiblePayments).toContain(payments[2].id);
    const newBill = async () => (await authRequest(request(app).post("/api/grz/tbills")).send(tbillPayload()).expect(201)).body.data.id as string;
    const cashBill = await newBill(), investmentBill = await newBill(), rollover = await newBill();
    await db.update(grzTBills).set({ maturityIncomeTxId: privatePosting.id }).where(eq(grzTBills.id, cashBill));
    await db.update(grzTBills).set({ maturityInvestmentTxId: privateInvestment.id }).where(eq(grzTBills.id, investmentBill));
    await db.update(grzTBills).set({ rolloverToId: cashBill }).where(eq(grzTBills.id, rollover));
    type BillRow = { id: string; rolloverToId: string | null };
    const bills = (await authRequest(request(app).get("/api/grz/tbills")).expect(200)).body.data as BillRow[];
    const visibleIds = bills.map(row => row.id);
    for (const restrictedId of [bill.id, cashBill, investmentBill]) expect.soft(visibleIds).not.toContain(restrictedId);
    expect(bills.find(row => row.id === rollover)?.rolloverToId).toBeNull();
    const ownerBills = (await request(app).get("/api/grz/tbills").set("Cookie", signer.cookie).expect(200)).body.data as BillRow[];
    expect(ownerBills.map(row => row.id)).toEqual(expect.arrayContaining([bill.id, cashBill, investmentBill, rollover]));
    expect(ownerBills.find(row => row.id === rollover)?.rolloverToId).toBe(cashBill);
    const ownerBonds = (await request(app).get("/api/grz/bonds").set("Cookie", signer.cookie).expect(200)).body.data as typeof bonds;
    expect(ownerBonds.map(row => row.id)).toContain(hidden.id);
    expect(ownerBonds.find(row => row.id === shared.id)?.payments.map(row => row.id)).toEqual(expect.arrayContaining(payments.map(row => row.id)));
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

  it.each(["separate", "hidden source", "hidden destination", "foreign currency"] as const)(
    "validates the chosen sale destination and holding access for %s", async mode => {
      const name = `GRZ disposal ${randomUUID()}`;
      const created = await authRequest(request(app).post("/api/grz/bonds")).send(bondPayload({ bondName: name })).expect(201);
      const bondId = created.body.data.id as string;
      const [alternate] = await db.insert(accounts).values({
        householdId, name: "Synthetic sale destination", type: "checking", balance: "20.00",
        currency: mode === "foreign currency" ? "USD" : "ZMW",
        isPrivate: mode.startsWith("hidden"), ownerUserId: mode.startsWith("hidden") ? otherUserId : userId,
      }).returning();
      if (mode === "hidden source") {
        await db.update(grzBonds).set({ accountId: alternate.id }).where(eq(grzBonds.id, bondId));
      }
      const chosen = mode === "hidden source" ? accountId : alternate.id;
      const reply = await authRequest(request(app).put(`/api/grz/bonds/${bondId}/sell`))
        .send({ soldPrice: "97000.00", soldDate: "2026-06-01", accountId: chosen });
      expect(reply.status).toBe(mode === "separate" ? 200 : mode === "foreign currency" ? 400 : 404);
      const [holding] = await db.select().from(grzBonds).where(eq(grzBonds.id, bondId));
      const sales = await db.select().from(investmentTransactions).where(eq(investmentTransactions.notes, `GRZ Bond Sale: ${name}`));
      if (mode === "separate") {
        expect(sales.map(sale => sale.accountId)).toEqual([chosen]);
        expect(holding.status).toBe("sold");
      } else {
        if (mode.startsWith("hidden")) expect(reply.body.error.message).toBe("Bond not found");
        expect(sales).toHaveLength(0);
        expect(holding.status).toBe("active");
        expect(holding.soldDate).toBeNull();
      }
    },
  );

  it("returns the existing disposal conflict for a visible sold bond before checking the selected currency", async () => {
    const created = await authRequest(request(app).post("/api/grz/bonds")).send(bondPayload()).expect(201);
    const url = `/api/grz/bonds/${created.body.data.id}/sell`;
    await authRequest(request(app).put(url)).send({ soldPrice: "97000.00", accountId }).expect(200);
    const [dollars] = await db.insert(accounts).values({
      householdId, name: "Synthetic USD account", type: "checking", balance: "0", currency: "USD",
    }).returning();
    const denied = await authRequest(request(app).put(url)).send({ soldPrice: "97000.00", accountId: dollars.id }).expect(409);
    expect(denied.body.error.message).toBe("Bond is already sold");
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

  it("PUT /api/grz/bonds/:id/sell returns the same NOT_FOUND response as an absent bond for another household's bond", async () => {
    const createRes = await authRequest(request(app).post("/api/grz/bonds"))
      .send(bondPayload({ bondName: "GRZ Envelope Cross-HH Bond" }))
      .expect(201);
    const bondId = createRes.body.data.id as string;

    const res = await otherAuthRequest(
      request(app).put(`/api/grz/bonds/${bondId}/sell`),
    )
      .send({ soldPrice: "97000.00" })
      .expect(404);
    expect(res.body.success).toBe(false);
    const missing = await otherAuthRequest(request(app).put(`/api/grz/bonds/${randomUUID()}/sell`))
      .send({ soldPrice: "97000.00" }).expect(404);
    expect([res.body.error.code, res.body.error.message]).toEqual([missing.body.error.code, missing.body.error.message]);
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
