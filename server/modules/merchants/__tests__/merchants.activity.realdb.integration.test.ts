/**
 * Merchant detail routes (ORG-006) and the merchant usage count, real HTTP
 * against real Postgres.
 *
 * GET /api/merchants/:id/analytics and GET /api/merchants/:id/transactions back
 * the merchant detail view. Both are household-scoped, hide another member's
 * private accounts and transactions (the transaction list's own visibility
 * predicate), return amounts as MoneyDto in the household currency converted
 * with the household FX lookup, and fail closed with 422 MISSING_FX_RATE when
 * a rate is missing (never rate 1). An archived merchant still answers; an
 * unknown or other-household id is 404.
 *
 * merchants.transactionCount is derived at read time from the visible rows,
 * so it cannot go stale when transactions are created, edited or deleted.
 */
import request from "supertest";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  householdFxRateOverrides, householdMembers, households, merchants, transactions, users,
} from "@shared/schema";
import { db } from "../../../db";
import {
  createSignedHousehold, insertAccount, type SignedHousehold,
} from "../../../__tests__/signed-household-fixture";

let fx: SignedHousehold;
let usdAccount: string;
let zmwAccount: string;
let otherMemberId: string;
let otherHouseholdId: string;
let merchantId: string;
let otherHouseholdMerchantId: string;
const ids: Record<string, string> = {};

const usd = (amount: string) => ({ amount, currency: "USD" });

async function insertMerchant(householdId: string, name: string, extra: Partial<typeof merchants.$inferInsert> = {}) {
  const [row] = await db.insert(merchants)
    .values({ householdId, name, isActive: true, ...extra })
    .returning({ id: merchants.id });
  return row.id;
}

async function insertTxn(key: string, values: Partial<typeof transactions.$inferInsert>): Promise<string> {
  const id = randomUUID();
  await db.insert(transactions).values({
    id, householdId: fx.householdId, accountId: usdAccount, merchantId, ownerUserId: fx.userId,
    amount: "1.00", currency: "USD", date: "2026-03-01", name: `Synthetic ${key}`,
    type: "expense", isPending: false, isRecurring: false, isPrivate: false, ...values,
  });
  ids[key] = id;
  return id;
}

function analytics(id: string, query = "startDate=2026-03-01&endDate=2026-04-30&groupBy=month") {
  return request(fx.app).get(`/api/merchants/${id}/analytics?${query}`).set(fx.headers);
}

function merchantTransactions(id: string, query = "") {
  return request(fx.app).get(`/api/merchants/${id}/transactions${query ? `?${query}` : ""}`).set(fx.headers);
}

describe("merchant analytics and transactions (real Postgres)", () => {
  beforeAll(async () => {
    fx = await createSignedHousehold("merchant-activity", "USD");
    usdAccount = await insertAccount(fx);
    zmwAccount = await insertAccount(fx, { currency: "ZMW", name: "Synthetic kwacha account" });

    otherMemberId = randomUUID();
    await db.insert(users).values({
      id: otherMemberId, email: `merchant-activity-member-${otherMemberId}@example.invalid`,
      username: `merchant-activity-member-${otherMemberId}`, passwordHash: "!synthetic-not-a-login!",
      emailVerified: true,
    });
    await db.insert(householdMembers).values({ householdId: fx.householdId, userId: otherMemberId, role: "member" });
    const privateAccount = await insertAccount(fx, {
      ownerUserId: otherMemberId, isPrivate: true, name: "Synthetic private account",
    });

    // The household's own ZMW -> USD rate for 2026.
    await db.insert(householdFxRateOverrides).values({
      householdId: fx.householdId, actorUserId: fx.userId, fromCurrency: "ZMW", toCurrency: "USD",
      effectiveDate: "2026-01-01", validThrough: "2026-12-31", rate: "0.05",
    });

    // A deliberately stale stored count: the API must not report it.
    merchantId = await insertMerchant(fx.householdId, "Synthetic Grocer", { transactionCount: 99 });
    await insertTxn("march1", { amount: "10.00", date: "2026-03-04" });
    await insertTxn("march2", { amount: "20.50", date: "2026-03-20" });
    await insertTxn("aprilZmw", { accountId: zmwAccount, currency: "ZMW", amount: "200.00", date: "2026-04-02" });
    await insertTxn("refund", { type: "income", amount: "5.00", date: "2026-04-11" });
    await insertTxn("privateAccount", {
      accountId: privateAccount, ownerUserId: otherMemberId, amount: "1000.00", date: "2026-03-05",
    });
    await insertTxn("privateTxn", {
      ownerUserId: otherMemberId, isPrivate: true, amount: "500.00", date: "2026-04-10",
    });
    await insertTxn("deleted", { amount: "700.00", date: "2026-03-06", deletedAt: new Date() });

    otherHouseholdId = randomUUID();
    await db.insert(households).values({ id: otherHouseholdId, name: "Synthetic other household", currency: "USD" });
    otherHouseholdMerchantId = await insertMerchant(otherHouseholdId, "Synthetic Elsewhere");
  }, 30000);

  afterAll(async () => {
    if (fx) await fx.cleanup(async () => {
      await db.delete(merchants).where(eq(merchants.householdId, otherHouseholdId));
      await db.delete(households).where(eq(households.id, otherHouseholdId));
    });
    if (otherMemberId) await db.delete(users).where(eq(users.id, otherMemberId));
  });

  describe("GET /api/merchants/:id/analytics", () => {
    it("totals the visible spending in the household currency, converted with the household rate", async () => {
      const res = await analytics(merchantId);

      expect(res.status).toBe(200);
      // 10.00 + 20.50 USD + 200.00 ZMW at 0.05 = 40.50 USD over three expenses.
      // The refund is income; the other member's private rows and the deleted row are excluded.
      expect(res.body.data).toEqual({
        totalSpent: usd("40.50"),
        transactionCount: 3,
        averageTransaction: usd("13.50"),
        trend: [
          { period: "2026-03", total: usd("30.50"), count: 2 },
          { period: "2026-04", total: usd("10.00"), count: 1 },
        ],
      });
    });

    it("groups the trend by day", async () => {
      const res = await analytics(merchantId, "startDate=2026-03-01&endDate=2026-03-31&groupBy=day");

      expect(res.status).toBe(200);
      expect(res.body.data.trend).toEqual([
        { period: "2026-03-04", total: usd("10.00"), count: 1 },
        { period: "2026-03-20", total: usd("20.50"), count: 1 },
      ]);
    });

    it("still answers for an archived merchant", async () => {
      const archived = await insertMerchant(fx.householdId, "Synthetic Archived Grocer", { isActive: false });
      await insertTxn("archived", { merchantId: archived, amount: "7.25", date: "2026-03-08" });

      const res = await analytics(archived);

      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({ totalSpent: usd("7.25"), transactionCount: 1 });
    });

    it("is 404 for another household's merchant and for an unknown id", async () => {
      expect((await analytics(otherHouseholdMerchantId)).status).toBe(404);
      expect((await analytics(randomUUID())).status).toBe(404);
    });

    it("rejects an invalid id, date or groupBy with 400", async () => {
      expect((await analytics("not-a-uuid")).status).toBe(400);
      expect((await analytics(merchantId, "startDate=2026-02-30&endDate=2026-03-31")).status).toBe(400);
      expect((await analytics(merchantId, "startDate=2026-04-01&endDate=2026-03-01")).status).toBe(400);
      expect((await analytics(merchantId, "groupBy=year")).status).toBe(400);
    });
  });

  describe("GET /api/merchants/:id/transactions", () => {
    it("pages the visible transactions, newest first, with amounts in the household currency", async () => {
      const res = await merchantTransactions(merchantId, "limit=2&offset=0");

      expect(res.status).toBe(200);
      expect(res.body.data.pagination).toEqual({ limit: 2, offset: 0, count: 4 });
      expect(res.body.data.transactions).toEqual([
        expect.objectContaining({ id: ids.refund, date: "2026-04-11", type: "income", amount: usd("5.00"), accountId: usdAccount }),
        expect.objectContaining({ id: ids.aprilZmw, date: "2026-04-02", type: "expense", amount: usd("10.00"), accountId: zmwAccount }),
      ]);

      const next = await merchantTransactions(merchantId, "limit=2&offset=2");
      expect(next.body.data.transactions.map((row: { id: string }) => row.id)).toEqual([ids.march2, ids.march1]);
    });

    it("never lists another member's private account or private transaction", async () => {
      const res = await merchantTransactions(merchantId, "limit=50");

      const listed = res.body.data.transactions.map((row: { id: string }) => row.id);
      expect(listed).not.toContain(ids.privateAccount);
      expect(listed).not.toContain(ids.privateTxn);
      expect(listed).not.toContain(ids.deleted);
    });

    it("filters by date range and by converted amount", async () => {
      const april = await merchantTransactions(merchantId, "startDate=2026-04-01&endDate=2026-04-30");
      expect(april.body.data.transactions.map((row: { id: string }) => row.id)).toEqual([ids.refund, ids.aprilZmw]);

      const large = await merchantTransactions(merchantId, "minAmount=10.01&maxAmount=25");
      expect(large.body.data.transactions.map((row: { id: string }) => row.id)).toEqual([ids.march2]);
    });

    it("is 404 for another household's merchant and 400 for an invalid query", async () => {
      expect((await merchantTransactions(otherHouseholdMerchantId)).status).toBe(404);
      expect((await merchantTransactions(merchantId, "limit=0")).status).toBe(400);
      expect((await merchantTransactions(merchantId, "minAmount=abc")).status).toBe(400);
    });
  });

  describe("a missing exchange rate", () => {
    it("fails both routes closed with 422 MISSING_FX_RATE, never converting at 1", async () => {
      const noRate = await insertMerchant(fx.householdId, "Synthetic No Rate Merchant");
      await insertTxn("noRate", { merchantId: noRate, currency: "XTS", amount: "50.00", date: "2026-03-10" });

      const stats = await analytics(noRate);
      expect(stats.status).toBe(422);
      expect(stats.body.error).toMatchObject({ code: "MISSING_FX_RATE", details: { from: "XTS", to: "USD" } });

      const list = await merchantTransactions(noRate);
      expect(list.status).toBe(422);
      expect(list.body.error.code).toBe("MISSING_FX_RATE");
    });
  });

  describe("merchant transactionCount", () => {
    it("is counted from the visible rows, not the stored column, in the list and the detail", async () => {
      const list = await request(fx.app).get("/api/merchants").set(fx.headers);
      const listed = list.body.data.merchants.find((row: { id: string }) => row.id === merchantId);
      // march1, march2, aprilZmw, refund: not the stored 99, not the private or deleted rows.
      expect(listed.transactionCount).toBe(4);

      const detail = await request(fx.app).get(`/api/merchants/${merchantId}`).set(fx.headers);
      expect(detail.body.data.merchant.transactionCount).toBe(4);
    });

    it("follows a new transaction and a delete without any write to the merchant", async () => {
      const added = await insertTxn("added", { amount: "3.00", date: "2026-05-01" });
      const afterAdd = await request(fx.app).get(`/api/merchants/${merchantId}`).set(fx.headers);
      expect(afterAdd.body.data.merchant.transactionCount).toBe(5);

      await db.update(transactions).set({ deletedAt: new Date() }).where(eq(transactions.id, added));
      const afterDelete = await request(fx.app).get(`/api/merchants/${merchantId}`).set(fx.headers);
      expect(afterDelete.body.data.merchant.transactionCount).toBe(4);
    });
  });
});
