/**
 * Transactions Module - REAL-DB HTTP + service Integration Tests (SCP-316)
 *
 * Audit gap (§3.11): Transactions had ZERO real-DB HTTP tests, and the transfer
 * FOR UPDATE / overdraft guard (SCP-320) was only ever exercised by mock-theater
 * suites that test nothing real.
 *
 * This file proves, against REAL Postgres (no mocks):
 *   1. POST /api/transactions creates a transaction over real HTTP and writes a
 *      CREATE audit row (Rule 9).
 *   2. A transaction referencing another household's account is rejected 404
 *      (household scoping, Rule 11) and nothing is persisted.
 *   3. The transfer write path prevents a double-spend under genuine concurrency:
 *      two transfers racing the same insufficient balance -> exactly one wins,
 *      the source never goes negative, and only one transfer pair is persisted.
 *      (The fix under test is TransferService.createTransfer FOR UPDATE +
 *      overdraft, already on main from SCP-320; this test must PASS against it.)
 *
 * The transfer concurrency is exercised at the service layer because the HTTP
 * transfer route is gated by requireStepUp("FINANCIAL"), which a fresh test
 * session does not satisfy; the row locks live in the service/repository, so the
 * service-level race is the meaningful test of the fix.
 *
 * NODE_ENV=test disables CSRF (see server/app.ts), so only the session cookie is
 * required for the HTTP tests.
 *
 * @module modules/transactions/__tests__/transactions.realdb.integration.test
 */

import request from "supertest";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { Express } from "express";
import { db, pool } from "../../../db";
import { eq, and, inArray, or, sql } from "drizzle-orm";
import {
  users,
  households,
  householdMembers,
  householdPreferences,
  accounts,
  transactions,
  auditLogs,
  outboxEvents,
  fxRates,
  securityAuditLogs,
  session,
  type Transaction,
} from "@shared/schema";
import {
  getTestApp,
  createTestUser,
  createTestHousehold,
} from "../../../__tests__/fixtures";
import { createFXRateRepository, createFXRateService, setGlobalFXService } from "../../../core/calculations";
import { AnalyticsCache, analyticsCache } from "../../../services/AnalyticsCache";
import { transferService } from "../../../services/TransferService";
import { transactionRepository } from "../../../repositories/TransactionRepository";
import { ValidationError } from "../../../utils/errorHandler";
import { hashPassword } from "../../../auth";
import { randomUUID } from "crypto";

interface AuditRow {
  id: string;
  householdId: string | null;
  userId: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
}

describe("Transactions REAL-DB Integration (SCP-316)", () => {
  let app: Express;
  let authCookie: string;
  let householdId: string;
  let userId: string;
  let accountId: string;

  // Second household: proves cross-household account access is rejected.
  let otherHouseholdId: string;
  let otherUserId: string;
  let otherAccountId: string;

  const timestamp = Date.now();

  beforeAll(async () => {
    app = await getTestApp();

    // --- Primary household + user + account ---
    const testUser = createTestUser({
      email: `txn-realdb-${timestamp}@example.com`,
      username: `txn-realdb-user-${timestamp}`,
    });
    const testHousehold = createTestHousehold(testUser.id, {
      name: "Txn RealDB Household",
      currency: "ZMW",
    });
    testUser.passwordHash = await hashPassword("TestPassword123");
    householdId = testHousehold.id;
    userId = testUser.id;
    testUser.householdId = testHousehold.id;

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
      name: "Primary Checking",
      type: "checking",
      balance: "10000.00",
      currency: "ZMW",
      isAsset: true,
    });

    // --- Second household + account (no shared membership) ---
    const otherUser = createTestUser({
      email: `txn-realdb-other-${timestamp}@example.com`,
      username: `txn-realdb-other-${timestamp}`,
    });
    const otherHousehold = createTestHousehold(otherUser.id, {
      name: "Txn RealDB Other Household",
      currency: "ZMW",
    });
    otherUser.passwordHash = await hashPassword("OtherPassword123");
    otherHouseholdId = otherHousehold.id;
    otherUserId = otherUser.id;
    otherUser.householdId = otherHousehold.id;

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

    otherAccountId = randomUUID();
    await db.insert(accounts).values({
      id: otherAccountId,
      householdId: otherHouseholdId,
      name: "Foreign Checking",
      type: "checking",
      balance: "5000.00",
      currency: "ZMW",
      isAsset: true,
    });

    const loginRes = await request(app)
      .post("/api/auth/login")
      .send({ email: testUser.email, password: "TestPassword123" })
      .expect(200);
    authCookie = loginRes.headers["set-cookie"]
      ? (loginRes.headers["set-cookie"] as unknown as string[]).join("; ")
      : "";
  });

  afterAll(async () => {
    const fixtureUserIds = [userId, otherUserId].filter(Boolean);
    const fixtureHouseholdIds = [householdId, otherHouseholdId].filter(Boolean);

    // Non-cascading identity rows and nullable-user audits must go before users.
    // Let errors reject afterAll so incomplete teardown cannot look successful.
    await db.transaction(async (tx) => {
      if (fixtureUserIds.length > 0) {
        await tx.delete(session).where(or(
          inArray(sql<string>`${session.sess}->>'userId'`, fixtureUserIds),
          inArray(sql<string>`${session.sess}->>'mfaPendingUserId'`, fixtureUserIds),
        ));
        await tx.delete(securityAuditLogs).where(or(
          inArray(securityAuditLogs.userId, fixtureUserIds),
          inArray(securityAuditLogs.targetUserId, fixtureUserIds),
        ));
        await tx.delete(auditLogs).where(inArray(auditLogs.userId, fixtureUserIds));
        await tx.delete(outboxEvents).where(
          inArray(sql<string>`${outboxEvents.payload}->>'userId'`, fixtureUserIds),
        );
      }

      if (fixtureHouseholdIds.length > 0) {
        await tx.delete(outboxEvents).where(inArray(outboxEvents.householdId, fixtureHouseholdIds));
        await tx.delete(auditLogs).where(inArray(auditLogs.householdId, fixtureHouseholdIds));
        await tx.delete(transactions).where(inArray(transactions.householdId, fixtureHouseholdIds));
        await tx.delete(accounts).where(inArray(accounts.householdId, fixtureHouseholdIds));
        await tx.delete(householdMembers).where(inArray(householdMembers.householdId, fixtureHouseholdIds));
      }

      if (fixtureUserIds.length > 0) {
        await tx.delete(users).where(inArray(users.id, fixtureUserIds));
      }
      if (fixtureHouseholdIds.length > 0) {
        await tx.delete(households).where(inArray(households.id, fixtureHouseholdIds));
      }
    });
  });

  it("shows a card purchase in a previously read net-worth report after the ledger commits", async () => {
    // getTestApp registers routes without the FX service installed by runApp.
    setGlobalFXService(createFXRateService(createFXRateRepository(db, fxRates), {
      cacheTtlSeconds: 300, baseCurrency: "USD", fallbackDays: 30,
    }));

    const creditId = randomUUID();
    await db.insert(accounts).values({ id: creditId, householdId: otherHouseholdId, ownerUserId: otherUserId,
      name: "Card purchase net worth", type: "credit", currency: "ZMW", isAsset: false,
      initialBalance: "500.00", balance: "500.00" });
    const login = await request(app).post("/api/auth/login")
      .send({ email: `txn-realdb-other-${timestamp}@example.com`, password: "OtherPassword123" }).expect(200);
    const headers = { Cookie: (login.headers["set-cookie"] as unknown as string[]).join("; "),
      "X-Capital-Subject": otherUserId, "X-Capital-Household": otherHouseholdId };
    const money = (amount: string) => ({ amount, currency: "ZMW" });
    const before = { assets: money("5000.00"), liabilities: money("500.00"), netWorth: money("4500.00") };
    // Simulate a previously stored response from a worker running the old cache policy.
    const legacy = { data: { latest: before }, generatedAt: "2026-01-31T00:00:00.000Z" };
    let legacyReads = 0, legacyWrites = 0;
    const backend = {
      assertCurrent() {},
      async getJson<T>(key: string) {
        if (!key.startsWith("analytics:netWorth:")) return null;
        legacyReads++;
        return legacy as T;
      },
      async setJson(key: string) { if (key.startsWith("analytics:netWorth:")) legacyWrites++; },
      invalidate: async () => 0,
    };
    const cache = new AnalyticsCache(backend);
    const read = vi.spyOn(analyticsCache, "getOrCompute").mockImplementation(cache.getOrCompute.bind(cache));
    const endpoint = vi.spyOn(analyticsCache, "invalidateEndpoint").mockImplementation(cache.invalidateEndpoint.bind(cache));
    const household = vi.spyOn(analyticsCache, "invalidateHousehold").mockImplementation(cache.invalidateHousehold.bind(cache));
    const report = async (to = "2026-01-31") => (await request(app).get("/api/reports/net-worth").set(headers)
      .query({ from: "2026-01-01", to }).expect(200)).body.data.latest;
    try {
      expect(await report()).toMatchObject(before);
      const purchaseBody = { accountId: creditId, type: "expense", date: "2026-01-10",
        name: "Card purchase oracle", amount: money("45.50"), idempotencyKey: randomUUID() };
      const post = () => request(app).post("/api/transactions").set(headers).send(purchaseBody);
      const purchase = await post().expect(201);
      const [card] = await db.select({ balance: accounts.balance }).from(accounts).where(eq(accounts.id, creditId));
      const [expense] = await db.select({ amount: transactions.amount, type: transactions.type, currency: transactions.currency })
        .from(transactions).where(eq(transactions.id, purchase.body.data.id));
      expect(card.balance).toBe("545.50");
      expect(expense).toEqual({ amount: "45.50", type: "expense", currency: "ZMW" });
      const after = { assets: money("5000.00"), liabilities: money("545.50"), netWorth: money("4454.50") };
      expect(await report("2026-01-30")).toMatchObject(after);
      expect(await report()).toMatchObject(after);
      expect((await post().expect(200)).body.isDuplicate).toBe(true);
      expect(await report()).toMatchObject(after);

      // A transfer changes assets and liabilities while preserving net worth.
      const cashId = randomUUID();
      await db.insert(accounts).values({ id: cashId, householdId: otherHouseholdId, ownerUserId: otherUserId,
        name: "Card advance destination", type: "checking", currency: "ZMW", isAsset: true, initialBalance: "0.00", balance: "0.00" });
      await request(app).post("/api/settings/security/step-up").set(headers).send({ password: "OtherPassword123" }).expect(200);
      await request(app).post("/api/transactions/transfer").set(headers).send({ fromAccountId: creditId, toAccountId: cashId,
        amount: money("100.00"), date: "2026-01-10", name: "Card advance", idempotencyKey: randomUUID() }).expect(201);
      expect(await report()).toMatchObject({ assets: money("5100.00"), liabilities: money("645.50"), netWorth: money("4454.50") });

      const uri = "/api/transactions/" + purchase.body.data.id;
      await request(app).put(uri).set(headers).send({ amount: money("65.50"), expectedUpdatedAt: purchase.body.data.updatedAt }).expect(200);
      expect(await report()).toMatchObject({ assets: money("5100.00"), liabilities: money("665.50"), netWorth: money("4434.50") });
      await request(app).delete(uri).set(headers).expect(200);
      expect(await report()).toMatchObject({ assets: money("5100.00"), liabilities: money("600.00"), netWorth: money("4500.00") });
      expect(legacyReads).toBe(0);
      expect(legacyWrites).toBe(0);
    } finally {
      household.mockRestore();
      endpoint.mockRestore();
      read.mockRestore();
    }
  });

  it("labels every transaction summary amount in the household currency before and after a posting", async () => {
    const id = randomUUID(), currency = "USD", date = "2026-02-12";
    await db.insert(accounts).values({ id, householdId, ownerUserId: userId, name: "USD ledger",
      type: "checking", currency, isAsset: true, initialBalance: "100.00", balance: "100.00" });
    await db.update(households).set({ currency }).where(eq(households.id, householdId));
    const summary = () => request(app).get("/api/transactions/summary").set("Cookie", authCookie)
      .query({ startDate: date, endDate: date, accountId: id }).expect(200);
    try {
      const empty = await summary();
      await request(app).post("/api/transactions").set("Cookie", authCookie).send({
        accountId: id, date, name: "USD summary expense", type: "expense", amount: { amount: "12.35", currency },
      }).expect(201);
      const posted = await summary();
      expect.soft(empty.body.data).toMatchObject({ currency, transactionCount: 0,
        totalIncome: { amount: "0.00", currency }, totalExpenses: { amount: "0.00", currency }, netFlow: { amount: "0.00", currency } });
      expect(posted.body.data).toMatchObject({ currency, transactionCount: 1,
        totalIncome: { amount: "0.00", currency }, totalExpenses: { amount: "12.35", currency }, netFlow: { amount: "-12.35", currency } });
    } finally {
      await db.update(households).set({ currency: "ZMW" }).where(eq(households.id, householdId));
    }
  });

  describe("FIN-17 dated flow FX over signed HTTP", () => {
    const legacyIds: string[] = [];
    const headers = () => ({ Cookie: authCookie, "X-Capital-Subject": userId, "X-Capital-Household": householdId });
    let fxService: ReturnType<typeof createFXRateService>;
    beforeAll(async () => {
      // getTestApp omits runApp's FX initialization. Install the real DB reader
      // so the old implementation fails on its wrong latest-rate result, not an
      // uninitialized service. No FX/network/summary implementation is mocked.
      fxService = createFXRateService(createFXRateRepository(db, fxRates), { cacheTtlSeconds: 0, baseCurrency: "USD", fallbackDays: 30 });
      setGlobalFXService(fxService);
      const id = randomUUID(); legacyIds.push(id);
      // FIN-06: the summary resolves rates as Reports does. A far later shared
      // rate must never convert an earlier posting (no latest/spot conversion).
      await db.insert(fxRates).values({ id, fromCurrency: "USD", toCurrency: "ZMW", date: "2199-12-31", rate: "99.9900", source: "yahoo_finance" });
    });
    afterAll(async () => {
      try {
        await db.transaction(async tx => {
          if (legacyIds.length) await tx.delete(fxRates).where(inArray(fxRates.id, legacyIds));
        });
      } finally { fxService?.clearCache(); }
    });

    async function freshAccount(currency = "USD") {
      const id = randomUUID();
      await db.insert(accounts).values({ id, householdId, ownerUserId: userId, name: "FIN-17 dated flow fixture", type: "checking",
        currency, isAsset: true, isPrivate: false, initialBalance: "1000.00", balance: "1000.00" });
      return id;
    }
    async function observe(date: string, rate: string, fromCurrency = "USD") {
      const id = randomUUID(); legacyIds.push(id);
      // Synthetic shared rate shaped like the market refresh's fx_rates mirror.
      await db.insert(fxRates).values({ id, fromCurrency, toCurrency: "ZMW", date, rate, source: "yahoo_finance" });
      return id;
    }
    const post = (id: string, date: string, type: "income" | "expense", amount: string, currency = "USD") => request(app)
      .post("/api/transactions").set(headers()).send({ accountId: id, date, type, name: "FIN-17 signed dated posting", amount: { amount, currency }, idempotencyKey: randomUUID() });
    const summary = (id: string, startDate: string, endDate = startDate) => request(app)
      .get("/api/transactions/summary").set(headers()).query({ accountId: id, startDate, endDate });
    const money = (amount: string) => ({ amount, currency: "ZMW" });
    async function assertNoOtherQuotes(start: string, end: string, fromCurrency = "USD") {
      const existing = await pool.query("SELECT id FROM fx_rates WHERE from_currency=$3 AND to_currency='ZMW' AND date BETWEEN $1::date AND $2::date", [start, end, fromCurrency]);
      expect(existing.rows).toEqual([]);
    }

    it("honors both pending markers and retains legacy null status across summary, list and count", async () => {
      const id = await freshAccount("ZMW");
      const date = "1985-07-10";
      const common = { householdId, accountId: id, ownerUserId: userId, date,
        type: "income" as const, currency: "ZMW", name: "Pending preference control" };
      // is_pending is NOT NULL in the ledger. status and legacy posting receipts are nullable.
      const posted = await db.insert(transactions).values([
        { ...common, amount: "2.00", isPending: false, status: null },
        { ...common, amount: "3.00", isPending: false, status: "cleared" },
        { ...common, amount: "5.00", isPending: false, status: "reconciled" },
      ]).returning({ id: transactions.id });
      const pending = await db.insert(transactions).values([
        { ...common, amount: "7.00", isPending: true, status: "cleared" },
        { ...common, amount: "11.00", isPending: false, status: "pending" },
        { ...common, amount: "13.00", isPending: true, status: "pending" },
      ]).returning({ id: transactions.id });
      const [previous] = await db.select().from(householdPreferences)
        .where(eq(householdPreferences.householdId, householdId));
      try {
        for (const showPendingTransactions of [false, true]) {
          await db.insert(householdPreferences).values({ householdId, showPendingTransactions })
            .onConflictDoUpdate({ target: householdPreferences.householdId, set: { showPendingTransactions } });
          const ids = (showPendingTransactions ? [...posted, ...pending] : posted).map(row => row.id).sort();
          const expectedIncome = money(showPendingTransactions ? "41.00" : "10.00");
          const totals = await summary(id, date).expect(200);
          expect(totals.body.data).toMatchObject({ transactionCount: ids.length, totalIncome: expectedIncome,
            totalExpenses: money("0.00"), netFlow: expectedIncome });
          const list = await request(app).get("/api/transactions").set(headers())
            .query({ accountId: id, startDate: date, endDate: date }).expect(200);
          expect(list.body.data.map((row: { id: string }) => row.id).sort()).toEqual(ids);
          expect(list.body.pagination.totalCount).toBe(ids.length);
        }
      } finally {
        if (previous) {
          await db.update(householdPreferences).set({ showPendingTransactions: previous.showPendingTransactions })
            .where(eq(householdPreferences.householdId, householdId));
        } else {
          await db.delete(householdPreferences).where(eq(householdPreferences.householdId, householdId));
        }
      }
    });

    it("uses each posting date, inclusive prior validity and household currency instead of either later trap", async () => {
      const id = await freshAccount();
      await assertNoOtherQuotes("1976-04-07", "1976-04-18");
      const early = await observe("1976-04-10", "25.1234");
      const later = await observe("1976-04-14", "26.5000");
      await observe("1976-04-15", "90.0000");
      const stored = await db.select().from(fxRates).where(inArray(fxRates.id, [early, later]));
      expect(stored).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: early, rate: "25.1234", date: "1976-04-10" }),
        expect.objectContaining({ id: later, rate: "26.5000", date: "1976-04-14" }),
      ]));
      const empty = await summary(id, "1976-04-10", "1976-04-14").expect(200);
      expect(empty.body.data).toMatchObject({ currency: "ZMW", transactionCount: 0, totalIncome: money("0.00"), totalExpenses: money("0.00"), netFlow: money("0.00") });
      expect(empty.body.data).toMatchObject({ largestIncome: money("0.00"), largestExpense: money("0.00"), firstTransactionDate: null, lastTransactionDate: null });
      const posted = [
        await post(id, "1976-04-10", "expense", "25.00").expect(201),
        await post(id, "1976-04-13", "expense", "10.00").expect(201),
        await post(id, "1976-04-14", "expense", "75.00").expect(201),
        await post(id, "1976-04-14", "income", "20.00").expect(201),
      ];
      const captured = (await pool.query("SELECT id, date::text, type, amount, currency FROM transactions WHERE account_id=$1 ORDER BY id", [id])).rows;
      expect(captured).toHaveLength(4);
      for (const [index, value] of [["1976-04-10", "expense", "25.00"], ["1976-04-13", "expense", "10.00"], ["1976-04-14", "expense", "75.00"], ["1976-04-14", "income", "20.00"]].entries()) {
        expect(captured).toContainEqual({ id: posted[index].body.data.id, date: value[0], type: value[1], amount: value[2], currency: "USD" });
      }
      expect((await pool.query("SELECT balance, currency FROM accounts WHERE id=$1", [id])).rows).toEqual([{ balance: "910.00", currency: "USD" }]);
      expect((await pool.query("SELECT currency FROM households WHERE id=$1", [householdId])).rows[0].currency).toBe("ZMW");
      const first = await summary(id, "1976-04-10").expect(200);
      expect.soft(first.body.data).toMatchObject({ currency: "ZMW", transactionCount: 1, totalIncome: money("0.00"), totalExpenses: money("628.09"), netFlow: money("-628.09") });
      const prior = await summary(id, "1976-04-13").expect(200);
      expect.soft(prior.body.data).toMatchObject({ currency: "ZMW", transactionCount: 1, totalIncome: money("0.00"), totalExpenses: money("251.23"), netFlow: money("-251.23") });
      const second = await summary(id, "1976-04-14").expect(200);
      expect.soft(second.body.data).toMatchObject({ currency: "ZMW", transactionCount: 2, totalIncome: money("530.00"), totalExpenses: money("1987.50"), netFlow: money("-1457.50") });
      const total = await summary(id, "1976-04-10", "1976-04-14").expect(200);
      expect.soft(total.body.data).toMatchObject({ currency: "ZMW", transactionCount: 4, totalIncome: money("530.00"), totalExpenses: money("2866.82"), netFlow: money("-2336.82") });
      expect(total.body.data).toMatchObject({ largestIncome: money("530.00"), largestExpense: money("1987.50"), firstTransactionDate: "1976-04-10", lastTransactionDate: "1976-04-14" });
      const income = await summary(id, "1976-04-10", "1976-04-14").query({ type: "income", ownerUserId: userId,
        search: "signed dated", amountMin: 19, amountMax: 21, reviewed: "unreviewed" }).expect(200);
      expect(income.body.data).toMatchObject({ transactionCount: 1, totalIncome: money("530.00"), totalExpenses: money("0.00") });
      const shared = await summary(id, "1976-04-10", "1976-04-14").query({ ownerUserId: "shared" }).expect(200);
      expect(shared.body.data).toMatchObject({ transactionCount: 0, netFlow: money("0.00") });
    }, 15000);

    it("aggregates fractional-cent flows before rounding and derives dates only from list-eligible rows", async () => {
      const id = await freshAccount(), date = "1980-02-10";
      await assertNoOtherQuotes("1980-02-07", "1980-02-15");
      await observe(date, "0.6000");
      const hiddenFirst = await post(id, "1980-02-08", "expense", "7.00").expect(201);
      const excludedFirst = await post(id, "1980-02-09", "expense", "13.00").expect(201);
      const tiny = [
        await post(id, date, "income", "0.01").expect(201),
        await post(id, date, "income", "0.01").expect(201),
        await post(id, date, "expense", "0.01").expect(201),
      ];
      const excludedLast = await post(id, "1980-02-11", "income", "17.00").expect(201);
      const hiddenLast = await post(id, "1980-02-12", "income", "11.00").expect(201);
      const hiddenIds = [hiddenFirst.body.data.id, hiddenLast.body.data.id] as string[];
      const excludedIds = [excludedFirst.body.data.id, excludedLast.body.data.id] as string[];
      await db.update(transactions).set({ isExcludedFromReports: true }).where(inArray(transactions.id, excludedIds));
      await db.update(transactions).set({ isPrivate: true, ownerUserId: null }).where(inArray(transactions.id, hiddenIds));
      expect((await pool.query("SELECT id, date::text, amount, currency FROM transactions WHERE id=ANY($1::uuid[]) ORDER BY id", [tiny.map(row => row.body.data.id)])).rows)
        .toEqual(expect.arrayContaining(tiny.map(row => ({ id: row.body.data.id, date, amount: "0.01", currency: "USD" }))));
      expect((await pool.query("SELECT balance, currency FROM accounts WHERE id=$1", [id])).rows).toEqual([{ balance: "1008.01", currency: "USD" }]);
      const listed = await request(app).get("/api/transactions").set(headers())
        .query({ accountId: id, startDate: "1980-02-08", endDate: "1980-02-12", limit: 100 }).expect(200);
      const eligibleIds = [...tiny.map(row => row.body.data.id), ...excludedIds].sort();
      expect(listed.body.data.map((row: { id: string }) => row.id).sort()).toEqual(eligibleIds);
      // Exact unrounded buckets are 0.012 and 0.006 ZMW: two incomes must
      // aggregate to 0.01, not the 0.02 produced by rounding each posting.
      // Net is the difference of displayed buckets, not round(0.012-0.006).
      const result = await summary(id, "1980-02-08", "1980-02-12").expect(200);
      expect(result.body.data).toMatchObject({ currency: "ZMW", transactionCount: 5,
        totalIncome: money("0.01"), totalExpenses: money("0.01"), netFlow: money("0.00"),
        largestIncome: money("0.01"), largestExpense: money("0.01"),
        firstTransactionDate: "1980-02-09", lastTransactionDate: "1980-02-11" });
    }, 15000);

    it("keeps signed net equal to displayed buckets when dated sub-cent income and expense round differently", async () => {
      const id = await freshAccount();
      await assertNoOtherQuotes("1982-03-07", "1982-03-14");
      await observe("1982-03-10", "0.6000");
      await observe("1982-03-11", "0.4000");
      const income = await post(id, "1982-03-10", "income", "0.01").expect(201);
      const expense = await post(id, "1982-03-11", "expense", "0.01").expect(201);
      expect((await pool.query("SELECT id, date::text, type, amount, currency FROM transactions WHERE account_id=$1 ORDER BY date", [id])).rows).toEqual([
        { id: income.body.data.id, date: "1982-03-10", type: "income", amount: "0.01", currency: "USD" },
        { id: expense.body.data.id, date: "1982-03-11", type: "expense", amount: "0.01", currency: "USD" },
      ]);
      expect((await pool.query("SELECT balance FROM accounts WHERE id=$1", [id])).rows).toEqual([{ balance: "1000.00" }]);
      const result = await summary(id, "1982-03-10", "1982-03-11").expect(200);
      // 0.006 income -> 0.01, 0.004 expense -> 0.00. Rounding their raw
      // difference would report 0.00 and contradict the displayed buckets.
      expect(result.body.data).toMatchObject({ currency: "ZMW", transactionCount: 2,
        totalIncome: money("0.01"), totalExpenses: money("0.00"), netFlow: money("0.01"),
        largestIncome: money("0.01"), largestExpense: money("0.00"),
        firstTransactionDate: "1982-03-10", lastTransactionDate: "1982-03-11" });
    });

    it("refuses a visible nonzero legacy row with no captured denomination without returning a total", async () => {
      const id = await freshAccount(), txId = randomUUID(), date = "1983-05-10";
      // Deliberately historical, pre-receipt data: the current account's USD
      // denomination is not evidence of this old row's missing source currency.
      await db.insert(transactions).values({ id: txId, householdId, accountId: id, ownerUserId: userId,
        date, name: "FIN-17 unresolved legacy denomination", type: "expense", amount: "1.00", currency: null });
      expect((await pool.query("SELECT amount, currency, posted_balance_delta, posting_mode, posted_account_is_asset FROM transactions WHERE id=$1", [txId])).rows)
        .toEqual([{ amount: "1.00", currency: null, posted_balance_delta: null, posting_mode: null, posted_account_is_asset: null }]);
      const result = await summary(id, date);
      expect(result.status).toBe(422);
      expect(result.body).toMatchObject({ success: false, error: { code: "FINANCIAL_DATA_UNAVAILABLE" } });
      expect(result.body).not.toHaveProperty("data");
      for (const field of ["totalIncome", "totalExpenses", "netFlow", "largestIncome", "largestExpense"]) expect(result.body).not.toHaveProperty(field);
      for (const value of ["currency", "ZMW", date]) expect(JSON.stringify(result.body.error)).toContain(value);
      expect((await pool.query("SELECT balance, currency FROM accounts WHERE id=$1", [id])).rows).toEqual([{ balance: "1000.00", currency: "USD" }]);
    });

    it("summarizes a schema-admissible zero native adjustment without requiring a foreign quote", async () => {
      const id = await freshAccount(), date = "1984-06-10";
      await assertNoOtherQuotes("1984-06-07", "1984-06-13");
      // Zero ordinary income/expense is prohibited by the actual schema. Use
      // its admitted neutral adjustment through the real posting repository.
      const created = await transactionRepository.create({ householdId, accountId: id, ownerUserId: userId,
        date, name: "FIN-17 zero native adjustment", type: "balance_adjustment", amount: "0.00", currency: "USD" });
      expect((await pool.query("SELECT amount, currency, posted_balance_delta, posting_mode FROM transactions WHERE id=$1", [created.transaction.id])).rows)
        .toEqual([{ amount: "0.00", currency: "USD", posted_balance_delta: "0.00", posting_mode: "posted" }]);
      expect((await pool.query("SELECT balance FROM accounts WHERE id=$1", [id])).rows).toEqual([{ balance: "1000.00" }]);
      const result = await summary(id, date).expect(200);
      expect(result.body.data).toMatchObject({ currency: "ZMW", transactionCount: 1,
        totalIncome: money("0.00"), totalExpenses: money("0.00"), netFlow: money("0.00"),
        largestIncome: money("0.00"), largestExpense: money("0.00"), firstTransactionDate: date, lastTransactionDate: date });
    });

    // Each scenario uses its own currency: shared rates carry forward, so a USD
    // rate left by an earlier case would otherwise price these flows.
    it.each([
      { label: "no rate at all", currency: "NAD", date: "1977-06-10", rateDate: null },
      { label: "only a rate dated after the flow", currency: "LSL", date: "1977-07-10", rateDate: "1977-07-11" },
    ])("fails closed with $label despite the later legacy trap", async scenario => {
      const id = await freshAccount(scenario.currency);
      await assertNoOtherQuotes("1900-01-01", scenario.date, scenario.currency);
      if (scenario.rateDate) await observe(scenario.rateDate, "26.5000", scenario.currency);
      const created = await post(id, scenario.date, "expense", "1.00", scenario.currency);
      expect(created.status, JSON.stringify(created.body)).toBe(201);
      expect((await pool.query("SELECT date::text, currency, amount FROM transactions WHERE id=$1", [created.body.data.id])).rows)
        .toEqual([{ date: scenario.date, currency: scenario.currency, amount: "1.00" }]);
      const result = await summary(id, scenario.date);
      expect.soft(result.status).toBe(422);
      expect.soft(result.body).toMatchObject({ success: false, error: { code: "FINANCIAL_DATA_UNAVAILABLE" } });
      const diagnostic = JSON.stringify(result.body.error ?? result.body);
      for (const value of [scenario.currency, "ZMW", scenario.date]) expect.soft(diagnostic).toContain(value);
    });

    it("does not require FX for an excluded or currently invisible signed foreign posting", async () => {
      const id = await freshAccount("EUR"), date = "1978-10-10";
      const created = await post(id, date, "expense", "1.00", "EUR").expect(201);
      const txId = created.body.data.id as string;
      await db.update(transactions).set({ isExcludedFromReports: true }).where(eq(transactions.id, txId));
      const excluded = await summary(id, date).expect(200);
      expect(excluded.body.data).toMatchObject({ currency: "ZMW", transactionCount: 1, totalIncome: money("0.00"), totalExpenses: money("0.00"), netFlow: money("0.00") });
      // This valid nullable-owner privacy state also arises after owner erasure.
      // The posting itself remains real; only its current metadata is changed.
      await db.update(transactions).set({ isExcludedFromReports: false, isPrivate: true, ownerUserId: null }).where(eq(transactions.id, txId));
      const hidden = await summary(id, date).expect(200);
      expect(hidden.body.data).toMatchObject({ currency: "ZMW", transactionCount: 0, totalIncome: money("0.00"), totalExpenses: money("0.00"), netFlow: money("0.00") });
    });
  });
  // Seed a fresh source/destination account pair in the primary household.
  async function seedTransferPair(sourceBalance: string): Promise<{
    fromId: string;
    toId: string;
  }> {
    const fromId = randomUUID();
    const toId = randomUUID();
    await db.insert(accounts).values([
      {
        id: fromId,
        householdId,
        name: `xfer-src-${fromId.slice(0, 8)}`,
        type: "checking",
        balance: sourceBalance,
        currency: "ZMW",
        isAsset: true,
      },
      {
        id: toId,
        householdId,
        name: `xfer-dst-${toId.slice(0, 8)}`,
        type: "checking",
        balance: "0.00",
        currency: "ZMW",
        isAsset: true,
      },
    ]);
    return { fromId, toId };
  }

  const balanceOf = async (id: string): Promise<string> => {
    const [row] = await db
      .select({ balance: accounts.balance })
      .from(accounts)
      .where(eq(accounts.id, id))
      .limit(1);
    return row.balance;
  };

  describe("GET /api/transactions (visibility pagination)", () => {
    it("applies transaction visibility before limit/offset pagination", async () => {
      const deletedAccountId = randomUUID();
      await db.insert(accounts).values({
        id: deletedAccountId,
        householdId,
        name: "Deleted account",
        type: "checking",
        balance: "0.00",
        currency: "ZMW",
        isAsset: true,
        deletedAt: new Date(),
      });

      await db.insert(transactions).values([
        {
          householdId,
          accountId,
          ownerUserId: otherUserId,
          date: "2026-12-31",
          name: "Invisible private transaction",
          amount: "10.00",
          currency: "ZMW",
          type: "expense",
          isPrivate: true,
        },
        {
          householdId,
          accountId,
          ownerUserId: userId,
          date: "2026-12-30",
          name: "Visible page transaction",
          amount: "20.00",
          currency: "ZMW",
          type: "expense",
          isPrivate: false,
        },
        {
          householdId,
          accountId: deletedAccountId,
          ownerUserId: userId,
          date: "2026-12-29",
          name: "Deleted account transaction",
          amount: "30.00",
          currency: "ZMW",
          type: "expense",
          isPrivate: false,
        },
      ]);

      const res = await request(app)
        .get(
          "/api/transactions?limit=1&offset=0&startDate=2026-12-01&endDate=2026-12-31",
        )
        .set("Cookie", authCookie)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].name).toBe("Visible page transaction");
      expect(res.body.pagination.total).toBe(1);
      expect(res.body.pagination.hasNext).toBe(false);
    });
  });

  describe("POST /api/transactions (create)", () => {
    it("creates an expense over real HTTP and persists it", async () => {
      const res = await request(app)
        .post("/api/transactions")
        .set("Cookie", authCookie)
        .send({
          accountId,
          amount: { amount: "120.50", currency: "ZMW" },
          type: "expense",
          date: "2026-02-10",
          name: "Groceries",
        })
        .expect(201);

      expect(res.body.success).toBe(true);
      const txnId: string = res.body.data.id;

      const [persisted] = await db
        .select()
        .from(transactions)
        .where(eq(transactions.id, txnId));
      expect(persisted).toBeDefined();
      expect(persisted.householdId).toBe(householdId);
      expect(persisted.accountId).toBe(accountId);
      expect(persisted.amount).toBe("120.50");
      expect(persisted.type).toBe("expense");
    });

    it("writes a CREATE audit row for the transaction (Rule 9)", async () => {
      const res = await request(app)
        .post("/api/transactions")
        .set("Cookie", authCookie)
        .send({
          accountId,
          amount: { amount: "75.00", currency: "ZMW" },
          type: "expense",
          date: "2026-02-11",
          name: "Audited Expense",
        })
        .expect(201);

      const txnId: string = res.body.data.id;

      const [audit] = (await db
        .select()
        .from(auditLogs)
        .where(
          and(
            eq(auditLogs.entityType, "transaction"),
            eq(auditLogs.entityId, txnId),
            eq(auditLogs.action, "CREATE"),
          ),
        )) as AuditRow[];

      expect(audit).toBeDefined();
      expect(audit.householdId).toBe(householdId);
      expect(audit.userId).toBe(userId);
    });

    it("rejects invalid payload with 400", async () => {
      const res = await request(app)
        .post("/api/transactions")
        .set("Cookie", authCookie)
        .send({
          accountId,
          amount: { amount: "-5.00", currency: "ZMW" },
          type: "expense",
          date: "2026-02-12",
          name: "Bad",
        });
      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it("rejects asset-account expenses that would overdraw the account", async () => {
      const guardedAccountId = randomUUID();
      await db.insert(accounts).values({
        id: guardedAccountId,
        householdId,
        name: "Guarded Checking",
        type: "checking",
        balance: "25.00",
        currency: "ZMW",
        isAsset: true,
      });

      const res = await request(app)
        .post("/api/transactions")
        .set("Cookie", authCookie)
        .send({
          accountId: guardedAccountId,
          amount: { amount: "30.00", currency: "ZMW" },
          type: "expense",
          date: "2026-02-12",
          name: "Overdraft attempt",
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(await balanceOf(guardedAccountId)).toBe("25.00");

      const persisted = await db
        .select()
        .from(transactions)
        .where(eq(transactions.accountId, guardedAccountId));
      expect(persisted).toHaveLength(0);
    });

    it("accepts income into a negative-balance asset account (deposit is never an overdraft)", async () => {
      const overdrawnAccountId = randomUUID();
      await db.insert(accounts).values({
        id: overdrawnAccountId,
        householdId,
        name: "Overdrawn Checking",
        type: "checking",
        balance: "-80.00",
        currency: "ZMW",
        isAsset: true,
      });

      const res = await request(app)
        .post("/api/transactions")
        .set("Cookie", authCookie)
        .send({
          accountId: overdrawnAccountId,
          amount: { amount: "50.00", currency: "ZMW" },
          type: "income",
          date: "2026-02-13",
          name: "Partial repayment",
        })
        .expect(201);

      expect(res.body.success).toBe(true);
      expect(await balanceOf(overdrawnAccountId)).toBe("-30.00");
    });


    it("R08 refuses deleting spent income without partial reversal and permits recovery", async () => {
      const guardedAccountId = randomUUID();
      await db.insert(accounts).values({ id: guardedAccountId, householdId, name: "R08 spent income",
        type: "checking", balance: "0.00", initialBalance: "0.00", currency: "ZMW", isAsset: true });
      const headers = { Cookie: authCookie, "X-Capital-Subject": userId, "X-Capital-Household": householdId };
      const income = await request(app).post("/api/transactions").set(headers).send({
        accountId: guardedAccountId, amount: { amount: "100.00", currency: "ZMW" },
        type: "income", date: "2026-02-15", name: "R08 guarded deposit",
      }).expect(201);
      const expense = await request(app).post("/api/transactions").set(headers).send({
        accountId: guardedAccountId, amount: { amount: "80.00", currency: "ZMW" },
        type: "expense", date: "2026-02-15", name: "R08 spent deposit",
      }).expect(201);
      const incomeId: string = income.body.data.id, expenseId: string = expense.body.data.id;
      const ids = [incomeId, expenseId];
      const snapshot = async () => ({
        account: await db.select().from(accounts).where(eq(accounts.id, guardedAccountId)),
        transactions: await db.select().from(transactions).where(inArray(transactions.id, ids)).orderBy(transactions.id),
        audit: await db.select().from(auditLogs).where(inArray(auditLogs.entityId, ids)).orderBy(auditLogs.id),
        events: await db.select().from(outboxEvents).where(inArray(outboxEvents.aggregateId, ids)).orderBy(outboxEvents.id),
      });
      expect(await balanceOf(guardedAccountId)).toBe("20.00");
      const before = await snapshot();
      const rejected = await request(app).delete("/api/transactions/" + incomeId).set(headers).expect(400);
      expect(rejected.body.success).toBe(false);
      expect(await snapshot()).toEqual(before);
      await request(app).delete("/api/transactions/" + expenseId).set(headers).expect(200);
      expect(await balanceOf(guardedAccountId)).toBe("100.00");
      await request(app).delete("/api/transactions/" + incomeId).set(headers).expect(200);
      expect(await balanceOf(guardedAccountId)).toBe("0.00");
    });

    it("R08 zero-debt liability expense records positive debt", async () => {
      const liabilityAccountId = randomUUID();
      await db.insert(accounts).values({
        id: liabilityAccountId,
        householdId,
        name: "Zero-debt Credit Card",
        type: "credit",
        balance: "0.00",
        initialBalance: "0.00",
        currency: "ZMW",
        isAsset: false,
      });

      const created = await request(app)
        .post("/api/transactions")
        .set("Cookie", authCookie)
        .set("X-Capital-Subject", userId)
        .set("X-Capital-Household", householdId)
        .send({
          accountId: liabilityAccountId,
          amount: { amount: "30.00", currency: "ZMW" },
          type: "expense",
          date: "2026-02-12",
          name: "Credit spend",
        })
        .expect(201);
      expect(created.body.success).toBe(true);

      const [postedAccount] = await db
        .select()
        .from(accounts)
        .where(eq(accounts.id, liabilityAccountId));
      expect.soft(postedAccount).toMatchObject({
        balance: "30.00",
        initialBalance: "0.00",
        currency: "ZMW",
        isAsset: false,
      });
      const postedRows = await db
        .select()
        .from(transactions)
        .where(eq(transactions.accountId, liabilityAccountId));
      expect(postedRows).toHaveLength(1);
      expect(postedRows[0]).toMatchObject({
        id: created.body.data.id,
        accountId: liabilityAccountId,
        householdId,
        amount: "30.00",
        currency: "ZMW",
        type: "expense",
        deletedAt: null,
      });
    });

    it.each([
      {
        label: "asset",
        accountType: "checking" as const,
        currency: "USD",
        isAsset: true,
        openingBalance: "1000.00",
        createdBalance: "954.50",
        editedBalance: "940.00",
      },
      {
        label: "liability with positive debt",
        accountType: "credit" as const,
        currency: "ZMW",
        isAsset: false,
        openingBalance: "500.00",
        createdBalance: "545.50",
        editedBalance: "560.00",
      },
    ])(
      "R08 manual expense lifecycle preserves $label balances and denomination",
      async ({
        label,
        accountType,
        currency,
        isAsset,
        openingBalance,
        createdBalance,
        editedBalance,
      }) => {
        const lifecycleAccountId = randomUUID();
        await db.insert(accounts).values({
          id: lifecycleAccountId,
          householdId,
          name: `R08 ${label}`,
          type: accountType,
          balance: openingBalance,
          initialBalance: openingBalance,
          currency,
          isAsset,
        });

        const [openingAccount] = await db
          .select()
          .from(accounts)
          .where(eq(accounts.id, lifecycleAccountId));
        expect(openingAccount).toMatchObject({
          balance: openingBalance,
          initialBalance: openingBalance,
          currency,
          isAsset,
        });

        const created = await request(app)
          .post("/api/transactions")
          .set("Cookie", authCookie)
          .set("X-Capital-Subject", userId)
          .set("X-Capital-Household", householdId)
          .send({
            accountId: lifecycleAccountId,
            amount: { amount: "45.50", currency },
            type: "expense",
            date: "2026-02-12",
            name: `R08 ${label} expense`,
          })
          .expect(201);
        expect(created.body.success).toBe(true);
        const transactionId: string = created.body.data.id;

        // Read persisted rows directly; the production delta helper is not an oracle.
        const assertPostedState = async (
          expectedBalance: string,
          expectedAmount: string,
          deleted: boolean,
        ) => {
          const [account] = await db
            .select()
            .from(accounts)
            .where(eq(accounts.id, lifecycleAccountId));
          const postedRows = await db
            .select()
            .from(transactions)
            .where(eq(transactions.accountId, lifecycleAccountId));

          // Continue through edit/delete even when the create balance is wrong.
          expect.soft(account).toMatchObject({
            householdId,
            balance: expectedBalance,
            initialBalance: openingBalance,
            currency,
            isAsset,
          });
          expect.soft(postedRows).toHaveLength(1);
          expect.soft(postedRows[0]).toMatchObject({
            id: transactionId,
            householdId,
            accountId: lifecycleAccountId,
            amount: expectedAmount,
            currency,
            type: "expense",
            date: "2026-02-12",
            deletedAt: deleted ? expect.any(Date) : null,
          });
        };

        await assertPostedState(createdBalance, "45.50", false);

        const edited = await request(app)
          .put(`/api/transactions/${transactionId}`)
          .set("Cookie", authCookie)
          .set("X-Capital-Subject", userId)
          .set("X-Capital-Household", householdId)
          .send({ amount: { amount: "60.00", currency } })
          .expect(200);
        expect(edited.body.success).toBe(true);
        await assertPostedState(editedBalance, "60.00", false);

        const deleted = await request(app)
          .delete(`/api/transactions/${transactionId}`)
          .set("Cookie", authCookie)
          .set("X-Capital-Subject", userId)
          .set("X-Capital-Household", householdId)
          .expect(200);
        expect(deleted.body.success).toBe(true);
        await assertPostedState(openingBalance, "60.00", true);
      },
    );
  });

  describe("PUT /api/transactions/:id (update)", () => {
    it("rejects an asset expense update that would overdraw and rolls back", async () => {
      const guardedAccountId = randomUUID();
      await db.insert(accounts).values({
        id: guardedAccountId,
        householdId,
        name: "Update Guard Checking",
        type: "checking",
        balance: "100.00",
        currency: "ZMW",
        isAsset: true,
      });

      const createRes = await request(app)
        .post("/api/transactions")
        .set("Cookie", authCookie)
        .send({
          accountId: guardedAccountId,
          amount: { amount: "40.00", currency: "ZMW" },
          type: "expense",
          date: "2026-02-14",
          name: "Initial expense",
        })
        .expect(201);

      expect(await balanceOf(guardedAccountId)).toBe("60.00");

      const txnId: string = createRes.body.data.id;
      const updateRes = await request(app)
        .put(`/api/transactions/${txnId}`)
        .set("Cookie", authCookie)
        .send({
          amount: { amount: "150.00", currency: "ZMW" },
        });

      expect(updateRes.status).toBe(400);
      expect(updateRes.body.success).toBe(false);
      expect(await balanceOf(guardedAccountId)).toBe("60.00");

      const [persisted] = await db
        .select()
        .from(transactions)
        .where(eq(transactions.id, txnId));
      expect(persisted.amount).toBe("40.00");
    });

    it("moves balance impact between locked accounts when accountId changes", async () => {
      const sourceAccountId = randomUUID();
      const targetAccountId = randomUUID();
      await db.insert(accounts).values([
        {
          id: sourceAccountId,
          householdId,
          name: "Original Checking",
          type: "checking",
          balance: "100.00",
          currency: "ZMW",
          isAsset: true,
        },
        {
          id: targetAccountId,
          householdId,
          name: "Target Checking",
          type: "checking",
          balance: "20.00",
          currency: "ZMW",
          isAsset: true,
        },
      ]);

      const createRes = await request(app)
        .post("/api/transactions")
        .set("Cookie", authCookie)
        .send({
          accountId: sourceAccountId,
          amount: { amount: "40.00", currency: "ZMW" },
          type: "expense",
          date: "2026-02-14",
          name: "Move account expense",
        })
        .expect(201);

      expect(await balanceOf(sourceAccountId)).toBe("60.00");
      expect(await balanceOf(targetAccountId)).toBe("20.00");

      const txnId: string = createRes.body.data.id;
      const updateResult = await transactionRepository.update(
        txnId,
        householdId,
        {
          accountId: targetAccountId,
          amount: "15.00",
          currency: "ZMW",
        } satisfies Partial<Transaction>,
      );

      expect(updateResult.conflict).toBe(false);
      expect(updateResult.transaction?.accountId).toBe(targetAccountId);
      expect(await balanceOf(sourceAccountId)).toBe("100.00");
      expect(await balanceOf(targetAccountId)).toBe("5.00");
    });
  });

  describe("Household scoping (Rule 11)", () => {
    it("rejects a transaction referencing another household's account (404)", async () => {
      const res = await request(app)
        .post("/api/transactions")
        .set("Cookie", authCookie)
        .send({
          accountId: otherAccountId,
          amount: { amount: "10.00", currency: "ZMW" },
          type: "expense",
          date: "2026-02-13",
          name: "Cross-household attempt",
        });

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);

      // Nothing was written against the foreign account.
      const leaked = await db
        .select()
        .from(transactions)
        .where(eq(transactions.accountId, otherAccountId));
      expect(leaked.length).toBe(0);
    });
  });

  describe("Transfer no-double-spend under concurrency (SCP-320 fix)", () => {
    it("lets exactly one of two racing full-balance transfers win", async () => {
      // Source has exactly 100; two concurrent transfers of 100 each race.
      const { fromId, toId } = await seedTransferPair("100.00");

      const results = await Promise.allSettled([
        transferService.createTransfer(
          fromId,
          toId,
          "100.00",
          householdId,
          userId,
          { name: "race-A" },
        ),
        transferService.createTransfer(
          fromId,
          toId,
          "100.00",
          householdId,
          userId,
          { name: "race-B" },
        ),
      ]);

      const fulfilled = results.filter((r) => r.status === "fulfilled");
      const rejected = results.filter((r) => r.status === "rejected");

      // Exactly one transfer succeeds; the other fails for insufficient funds.
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      const reason = (rejected[0] as PromiseRejectedResult).reason;
      expect(reason).toBeInstanceOf(ValidationError);

      // No double-spend: source drained to exactly 0, destination got exactly 100.
      expect(await balanceOf(fromId)).toBe("0.00");
      expect(await balanceOf(toId)).toBe("100.00");

      // Only one transfer pair persisted (one outflow row on the source).
      const sourceRows = await db
        .select()
        .from(transactions)
        .where(eq(transactions.accountId, fromId));
      expect(sourceRows.length).toBe(1);
    });
  });
});
