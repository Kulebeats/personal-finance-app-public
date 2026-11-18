/**
 * Merchants Module - Integration Tests
 *
 * Tests CRUD operations and atomic merge functionality.
 */

import request from "supertest";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { Express } from "express";
import { db } from "../../../db";
import { and, eq, inArray } from "drizzle-orm";
import {
  merchants,
  transactions,
  auditLogs,
  users,
  households,
  accounts,
  householdMembers,
  categories,
  merchantAliases,
  merchantMergeHistory,
} from "../../../../shared/schema";
import {
  createTestUser,
  createTestHousehold,
  getTestApp,
} from "../../../__tests__/fixtures";
import {
  routerUsesMiddlewareBeforeRoutes,
  routeUsesMiddleware,
} from "../../../__tests__/routerStack";
import { hashPassword } from "../../../auth";
import { generalLimiter } from "../../../middleware/rateLimit";
import merchantsRouter from "../merchants.routes";
import { randomUUID } from "node:crypto";

describe("Merchants Integration Tests", () => {
  let app: Express;
  let authCookie: string;
  let householdId: string;
  let userId: string;
  let testUser: ReturnType<typeof createTestUser>;
  let testHousehold: ReturnType<typeof createTestHousehold>;
  let testAccountId: string;
  let testCategoryId: string;

  beforeAll(async () => {
    // Get app with routes registered
    app = await getTestApp();

    // Use unique timestamp to avoid conflicts from previous failed runs
    const timestamp = Date.now();

    // Create test user and household
    testUser = createTestUser({
      email: `merchant-test-${timestamp}@example.com`,
      username: `merchant-test-user-${timestamp}`,
    });
    testHousehold = createTestHousehold(testUser.id, {
      name: "Merchant Test Household",
    });

    // Hash password for real authentication
    const passwordHash = await hashPassword("TestPassword123");
    testUser.passwordHash = passwordHash;

    householdId = testHousehold.id;
    userId = testUser.id;

    // Link user to the test household
    testUser.householdId = testHousehold.id;

    // Insert household first
    await db.insert(households).values({
      id: testHousehold.id,
      name: testHousehold.name,
      currency: testHousehold.currency,
    });

    // Insert user
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

    // Insert household member (REQUIRED for householdGuard)
    await db.insert(householdMembers).values({
      userId: testUser.id,
      householdId: testHousehold.id,
      role: "owner",
      joinedAt: new Date(),
    });

    // Create test account for transactions
    testAccountId = randomUUID();
    await db.insert(accounts).values({
      id: testAccountId,
      householdId,
      name: "Test Checking",
      type: "checking",
      balance: "1000.00",
      currency: "ZMW",
    });

    // Create test category
    testCategoryId = randomUUID();
    await db.insert(categories).values({
      id: testCategoryId,
      householdId,
      name: "Test Category",

      displayOrder: 1,
    });

    // Authenticate and get session cookie
    const loginRes = await request(app)
      .post("/api/auth/login")
      .send({
        email: testUser.email,
        password: "TestPassword123",
      })
      .expect(200);

    authCookie = loginRes.headers["set-cookie"][0];
  });

  afterAll(async () => {
    try {
      // Cleanup: Delete in reverse dependency order
      await db.delete(auditLogs).where(eq(auditLogs.householdId, householdId));
      await db
        .delete(transactions)
        .where(eq(transactions.householdId, householdId));
      await db.delete(merchantMergeHistory).where(
        inArray(
          merchantMergeHistory.targetMerchantId,
          db
            .select({ id: merchants.id })
            .from(merchants)
            .where(eq(merchants.householdId, householdId)),
        ),
      );
      await db.delete(merchants).where(eq(merchants.householdId, householdId));
      await db
        .delete(categories)
        .where(eq(categories.householdId, householdId));
      await db.delete(accounts).where(eq(accounts.householdId, householdId));
      await db
        .delete(householdMembers)
        .where(eq(householdMembers.householdId, householdId));

      await db.delete(households).where(eq(households.id, householdId));
    } catch (e) {
      console.error("Cleanup failed:", e);
    }
  });

  describe("POST /api/merchants - Create Merchant", () => {
    it("should create a new merchant with valid data", async () => {
      const res = await request(app)
        .post("/api/merchants")
        .set("Cookie", authCookie)
        .send({
          name: "Test Merchant",
        })
        .expect(201);

      expect(res.body.success).toBe(true);
      expect(res.body.data.merchant).toMatchObject({
        name: "Test Merchant",
        householdId,
        isActive: true,
      });
      expect(res.body.data.merchant.id).toBeDefined();

      // Verify in database
      const [merchant] = await db
        .select()
        .from(merchants)
        .where(eq(merchants.id, res.body.data.merchant.id));
      expect(merchant.name).toBe("Test Merchant");
      expect(merchant.householdId).toBe(householdId);
    });

    it("should reject merchant with empty name", async () => {
      const res = await request(app)
        .post("/api/merchants")
        .set("Cookie", authCookie)
        .send({
          name: "",
        })
        .expect(400);

      expect(res.body.success).toBe(false);
      expect(res.body.error).toBeDefined();
    });

    it("should audit log merchant creation", async () => {
      const res = await request(app)
        .post("/api/merchants")
        .set("Cookie", authCookie)
        .send({
          name: "Audit Test Merchant",
        })
        .expect(201);

      const merchantId = res.body.data.merchant.id;

      // Verify audit log entry
      const [auditLog] = await db
        .select()
        .from(auditLogs)
        .where(
          and(
            eq(auditLogs.entityType, "merchant"),
            eq(auditLogs.entityId, merchantId),
            eq(auditLogs.action, "CREATE"),
          ),
        );

      expect(auditLog).toBeDefined();
      expect(auditLog.householdId).toBe(householdId);
      expect(auditLog.userId).toBe(userId);
    });
  });

  describe("GET /api/merchants - List Merchants", () => {
    it("should return all active merchants for household", async () => {
      // Create test merchants
      const [merchant1] = await db
        .insert(merchants)
        .values({
          id: randomUUID(),
          householdId,
          name: "Merchant A",
          isActive: true,
        })
        .returning();

      const [merchant2] = await db
        .insert(merchants)
        .values({
          id: randomUUID(),
          householdId,
          name: "Merchant B",
          isActive: true,
        })
        .returning();

      const res = await request(app)
        .get("/api/merchants")
        .set("Cookie", authCookie)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.merchants).toBeInstanceOf(Array);
      expect(res.body.data.merchants.length).toBeGreaterThanOrEqual(2);

      const merchantIds = res.body.data.merchants.map((m: any) => m.id);
      expect(merchantIds).toContain(merchant1.id);
      expect(merchantIds).toContain(merchant2.id);
    });

    it("should filter by search query", async () => {
      // Create merchant with unique name
      const [searchMerchant] = await db
        .insert(merchants)
        .values({
          id: randomUUID(),
          householdId,
          name: "UniqueSearchMerchant",
          isActive: true,
        })
        .returning();

      const res = await request(app)
        .get("/api/merchants?search=UniqueSearch")
        .set("Cookie", authCookie)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.merchants).toBeInstanceOf(Array);

      const found = res.body.data.merchants.find(
        (m: any) => m.id === searchMerchant.id,
      );
      expect(found).toBeDefined();
    });

    it("should include hidden merchants when requested", async () => {
      // Create inactive merchant
      const [hiddenMerchant] = await db
        .insert(merchants)
        .values({
          id: randomUUID(),
          householdId,
          name: "Hidden Merchant",
          isActive: false,
        })
        .returning();

      const res = await request(app)
        .get("/api/merchants?includeHidden=true")
        .set("Cookie", authCookie)
        .expect(200);

      expect(res.body.success).toBe(true);
      const found = res.body.data.merchants.find(
        (m: any) => m.id === hiddenMerchant.id,
      );
      expect(found).toBeDefined();
      expect(found.isActive).toBe(false);
    });

    it("should return 401 without authentication", async () => {
      const res = await request(app).get("/api/merchants").expect(401);

      expect(res.body.success).toBe(false);
    });

    it("should not return merchants from other households", async () => {
      // Create another household
      const otherHouseholdId = randomUUID();
      await db.insert(households).values({
        id: otherHouseholdId,
        name: "Other Household",
        currency: "ZMW",
      });

      // Create merchant in other household
      const [otherMerchant] = await db
        .insert(merchants)
        .values({
          id: randomUUID(),
          householdId: otherHouseholdId,
          name: "Other Household Merchant",
          isActive: true,
        })
        .returning();

      const res = await request(app)
        .get("/api/merchants")
        .set("Cookie", authCookie)
        .expect(200);

      expect(res.body.success).toBe(true);
      const merchantIds = res.body.data.merchants.map((m: any) => m.id);
      expect(merchantIds).not.toContain(otherMerchant.id);

      // Cleanup
      await db
        .delete(merchants)
        .where(eq(merchants.householdId, otherHouseholdId));
      await db.delete(households).where(eq(households.id, otherHouseholdId));
    });
  });

  describe("Settings merchant compatibility endpoints", () => {
    it("returns duplicate merchant groups without treating duplicates as an id", async () => {
      await db.insert(merchants).values([
        {
          id: randomUUID(),
          householdId,
          name: "Manda Hill",
          isActive: true,
        },
        {
          id: randomUUID(),
          householdId,
          name: "Manda-Hill",
          isActive: true,
        },
      ]);

      const res = await request(app)
        .get("/api/merchants/duplicates")
        .set("Cookie", authCookie)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.groups).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            similarity: 100,
            merchants: expect.arrayContaining([
              expect.objectContaining({ name: "Manda Hill" }),
              expect.objectContaining({ name: "Manda-Hill" }),
            ]),
          }),
        ]),
      );
    });

    it("returns merge history without routing merge/history through getById", async () => {
      const [targetMerchant] = await db
        .insert(merchants)
        .values({
          id: randomUUID(),
          householdId,
          name: "Merge History Target",
          isActive: true,
        })
        .returning();

      const sourceMerchantId = randomUUID();
      const [history] = await db
        .insert(merchantMergeHistory)
        .values({
          id: randomUUID(),
          sourceMerchantId,
          sourceMerchantName: "Merge History Source",
          targetMerchantId: targetMerchant.id,
          mergedBy: userId,
          canUndo: true,
        })
        .returning();

      const res = await request(app)
        .get("/api/merchants/merge/history")
        .set("Cookie", authCookie)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.history).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: history.id,
            sourceMerchantId,
            sourceMerchantName: "Merge History Source",
            targetMerchantId: targetMerchant.id,
            targetMerchantName: targetMerchant.name,
          }),
        ]),
      );
    });

    it("seeds default merchants from the settings action", async () => {
      const res = await request(app)
        .post("/api/merchants/seed")
        .set("Cookie", authCookie)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.inserted).toBeGreaterThan(0);
      expect(res.body.data.merchants).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: "Shoprite" }),
        ]),
      );
    });

    it("returns merchant autocomplete results before the dynamic id route", async () => {
      const [merchant] = await db
        .insert(merchants)
        .values({
          id: randomUUID(),
          householdId,
          name: "Autocomplete Market",
          isActive: true,
        })
        .returning();

      const res = await request(app)
        .get("/api/merchants/autocomplete?q=Autocomplete&limit=5")
        .set("Cookie", authCookie)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.merchants).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: merchant.id }),
        ]),
      );
    });

    it("records merge history when settings merges a source merchant into a target", async () => {
      const [sourceMerchant] = await db
        .insert(merchants)
        .values({
          id: randomUUID(),
          householdId,
          name: "Settings Merge Source",
          isActive: true,
          transactionCount: 1,
        })
        .returning();

      const [targetMerchant] = await db
        .insert(merchants)
        .values({
          id: randomUUID(),
          householdId,
          name: "Settings Merge Target",
          isActive: true,
          transactionCount: 2,
        })
        .returning();

      const [transaction] = await db
        .insert(transactions)
        .values({
          id: randomUUID(),
          householdId,
          accountId: testAccountId,
          merchantId: sourceMerchant.id,
          amount: "42.00",
          currency: "ZMW",
          date: "2026-01-20",
          name: "Settings merge transaction",
          type: "expense",
          categoryId: testCategoryId,
          isPending: false,
          isRecurring: false,
          ownerUserId: userId,
          isPrivate: false,
        })
        .returning();

      const res = await request(app)
        .post(`/api/merchants/${sourceMerchant.id}/merge`)
        .set("Cookie", authCookie)
        .send({ targetMerchantId: targetMerchant.id })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data).toMatchObject({
        merged: true,
        targetMerchantId: targetMerchant.id,
        mergeHistoryId: expect.any(String),
      });

      const [history] = await db
        .select()
        .from(merchantMergeHistory)
        .where(eq(merchantMergeHistory.id, res.body.data.mergeHistoryId));

      expect(history).toMatchObject({
        sourceMerchantId: sourceMerchant.id,
        sourceMerchantName: sourceMerchant.name,
        targetMerchantId: targetMerchant.id,
        mergedBy: userId,
        canUndo: true,
      });
      expect(history.mergedTransactionIds).toEqual([transaction.id]);

      const [movedTransaction] = await db
        .select()
        .from(transactions)
        .where(eq(transactions.id, transaction.id));
      expect(movedTransaction.merchantId).toBe(targetMerchant.id);
    });

    it("undoes a settings merchant merge using the stored history row", async () => {
      const [sourceMerchant] = await db
        .insert(merchants)
        .values({
          id: randomUUID(),
          householdId,
          name: "Undo Merge Source",
          isActive: true,
          transactionCount: 1,
        })
        .returning();

      const [targetMerchant] = await db
        .insert(merchants)
        .values({
          id: randomUUID(),
          householdId,
          name: "Undo Merge Target",
          isActive: true,
          transactionCount: 4,
        })
        .returning();

      const [transaction] = await db
        .insert(transactions)
        .values({
          id: randomUUID(),
          householdId,
          accountId: testAccountId,
          merchantId: sourceMerchant.id,
          amount: "12.00",
          currency: "ZMW",
          date: "2026-01-21",
          name: "Undo merge transaction",
          type: "expense",
          categoryId: testCategoryId,
          isPending: false,
          isRecurring: false,
          ownerUserId: userId,
          isPrivate: false,
        })
        .returning();

      const mergeRes = await request(app)
        .post(`/api/merchants/${sourceMerchant.id}/merge`)
        .set("Cookie", authCookie)
        .send({ targetMerchantId: targetMerchant.id })
        .expect(200);

      const historyId = mergeRes.body.data.mergeHistoryId;
      expect(historyId).toEqual(expect.any(String));

      const undoRes = await request(app)
        .post(`/api/merchants/merge/${historyId}/undo`)
        .set("Cookie", authCookie)
        .expect(200);

      expect(undoRes.body.success).toBe(true);
      expect(undoRes.body.data.restoredMerchant).toMatchObject({
        id: sourceMerchant.id,
        isActive: true,
        transactionCount: 1,
      });
      expect(undoRes.body.data.target).toMatchObject({
        id: targetMerchant.id,
        transactionCount: 4,
      });

      const [restoredTransaction] = await db
        .select()
        .from(transactions)
        .where(eq(transactions.id, transaction.id));
      expect(restoredTransaction.merchantId).toBe(sourceMerchant.id);

      const [history] = await db
        .select()
        .from(merchantMergeHistory)
        .where(eq(merchantMergeHistory.id, historyId));
      expect(history.canUndo).toBe(false);

      await request(app)
        .post(`/api/merchants/merge/${historyId}/undo`)
        .set("Cookie", authCookie)
        .expect(409);
    });
  });

  describe("GET /api/merchants/:id - Get Merchant by ID", () => {
    it("should return merchant by id", async () => {
      const [merchant] = await db
        .insert(merchants)
        .values({
          id: randomUUID(),
          householdId,
          name: "Get By ID Merchant",
          isActive: true,
        })
        .returning();

      const res = await request(app)
        .get(`/api/merchants/${merchant.id}`)
        .set("Cookie", authCookie)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.merchant.id).toBe(merchant.id);
      expect(res.body.data.merchant.name).toBe("Get By ID Merchant");
    });

    it("should include aliases for the edit merchant dialog", async () => {
      const [merchant] = await db
        .insert(merchants)
        .values({
          id: randomUUID(),
          householdId,
          name: "Alias Merchant",
          isActive: true,
        })
        .returning();

      const [alias] = await db
        .insert(merchantAliases)
        .values({
          id: randomUUID(),
          merchantId: merchant.id,
          aliasName: "Alias Merchant POS",
        })
        .returning();

      const res = await request(app)
        .get(`/api/merchants/${merchant.id}`)
        .set("Cookie", authCookie)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.aliases).toEqual([
        expect.objectContaining({
          id: alias.id,
          merchantId: merchant.id,
          aliasName: "Alias Merchant POS",
        }),
      ]);
    });

    it("should return 404 for non-existent merchant", async () => {
      const fakeId = randomUUID();
      const res = await request(app)
        .get(`/api/merchants/${fakeId}`)
        .set("Cookie", authCookie);

      // Should return error for non-existent merchant
      expect([404, 500]).toContain(res.status);
      expect(res.body.success).toBe(false);
    });

    it("should return error for merchant in different household", async () => {
      // Create another household
      const otherHouseholdId = randomUUID();
      await db.insert(households).values({
        id: otherHouseholdId,
        name: "Other Household 2",
        currency: "ZMW",
      });

      // Create merchant in other household
      const [otherMerchant] = await db
        .insert(merchants)
        .values({
          id: randomUUID(),
          householdId: otherHouseholdId,
          name: "Other Merchant",
          isActive: true,
        })
        .returning();

      const res = await request(app)
        .get(`/api/merchants/${otherMerchant.id}`)
        .set("Cookie", authCookie);

      // Should prevent cross-household access
      expect([404, 500]).toContain(res.status);
      expect(res.body.success).toBe(false);

      // Cleanup
      await db
        .delete(merchants)
        .where(eq(merchants.householdId, otherHouseholdId));
      await db.delete(households).where(eq(households.id, otherHouseholdId));
    });
  });

  describe("PUT /api/merchants/:id - Update Merchant", () => {
    it("should update merchant name", async () => {
      const [merchant] = await db
        .insert(merchants)
        .values({
          id: randomUUID(),
          householdId,
          name: "Original Name",
          isActive: true,
        })
        .returning();

      const res = await request(app)
        .put(`/api/merchants/${merchant.id}`)
        .set("Cookie", authCookie)
        .send({
          name: "Updated Name",
        })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.merchant.name).toBe("Updated Name");

      // Verify in database
      const [updated] = await db
        .select()
        .from(merchants)
        .where(eq(merchants.id, merchant.id));
      expect(updated.name).toBe("Updated Name");
    });

    it("should audit log merchant update", async () => {
      const [merchant] = await db
        .insert(merchants)
        .values({
          id: randomUUID(),
          householdId,
          name: "Audit Update Test",
          isActive: true,
        })
        .returning();

      await request(app)
        .put(`/api/merchants/${merchant.id}`)
        .set("Cookie", authCookie)
        .send({
          name: "Updated for Audit",
        })
        .expect(200);

      // Verify audit log
      const [auditLog] = await db
        .select()
        .from(auditLogs)
        .where(
          and(
            eq(auditLogs.entityType, "merchant"),
            eq(auditLogs.entityId, merchant.id),
            eq(auditLogs.action, "UPDATE"),
          ),
        );

      expect(auditLog).toBeDefined();
      expect(auditLog.householdId).toBe(householdId);
    });
  });

  describe("DELETE /api/merchants/:id - Delete Merchant", () => {
    it("should delete a merchant with no transactions", async () => {
      const [merchant] = await db
        .insert(merchants)
        .values({
          id: randomUUID(),
          householdId,
          name: "Deletable Merchant",
          isActive: true,
        })
        .returning();

      const res = await request(app)
        .delete(`/api/merchants/${merchant.id}`)
        .set("Cookie", authCookie)
        .expect(200);

      expect(res.body.success).toBe(true);

      // Verify merchant is inactive
      const [deletedMerchant] = await db
        .select()
        .from(merchants)
        .where(eq(merchants.id, merchant.id));

      expect(deletedMerchant.isActive).toBe(false);
    });

    it("should fail to delete merchant with transactions", async () => {
      // Create merchant
      const [merchant] = await db
        .insert(merchants)
        .values({
          id: randomUUID(),
          householdId,
          name: "Merchant With Transactions",
          isActive: true,
        })
        .returning();

      // Create transaction with this merchant
      await db.insert(transactions).values({
        id: randomUUID(),
        householdId,
        accountId: testAccountId,
        merchantId: merchant.id,
        amount: "50.00",
        currency: "ZMW",
        date: "2026-01-15",

        type: "expense",
        categoryId: null,
        isPending: false,
        isRecurring: false,
        ownerUserId: userId,
        isPrivate: false,
        name: "Test transaction",
      });

      const res = await request(app)
        .delete(`/api/merchants/${merchant.id}`)
        .set("Cookie", authCookie);

      // Should reject deletion if merchant has transactions
      expect([400, 409, 500]).toContain(res.status);
      expect(res.body.success).toBe(false);

      // Verify merchant still active
      const [stillActive] = await db
        .select()
        .from(merchants)
        .where(eq(merchants.id, merchant.id));
      expect(stillActive.isActive).toBe(true);
    });

    it("should audit log merchant deletion", async () => {
      const [merchant] = await db
        .insert(merchants)
        .values({
          id: randomUUID(),
          householdId,
          name: "Audit Delete Test",
          isActive: true,
        })
        .returning();

      await request(app)
        .delete(`/api/merchants/${merchant.id}`)
        .set("Cookie", authCookie)
        .expect(200);

      // Verify audit log
      const [auditLog] = await db
        .select()
        .from(auditLogs)
        .where(
          and(
            eq(auditLogs.entityType, "merchant"),
            eq(auditLogs.entityId, merchant.id),
            eq(auditLogs.action, "DELETE"),
          ),
        );

      expect(auditLog).toBeDefined();
      expect(auditLog.householdId).toBe(householdId);
    });
  });

  describe("POST /api/merchants/merge - Merge Merchants (ATOMIC)", () => {
    it("should merge merchants atomically with transaction", async () => {
      // Create source merchant with transactions
      const [sourceMerchant] = await db
        .insert(merchants)
        .values({
          id: randomUUID(),
          householdId,
          name: "Source Merchant",
          isActive: true,
        })
        .returning();

      // Create target merchant
      const [targetMerchant] = await db
        .insert(merchants)
        .values({
          id: randomUUID(),
          householdId,
          name: "Target Merchant",
          isActive: true,
        })
        .returning();

      // Create transactions linked to source merchant
      const [tx1] = await db
        .insert(transactions)
        .values({
          id: randomUUID(),
          householdId,
          accountId: testAccountId,
          merchantId: sourceMerchant.id,
          amount: "25.00",
          currency: "ZMW",
          date: "2026-01-10",
          name: "Source tx 1",

          type: "expense",
          categoryId: null,

          isPending: false,
          isRecurring: false,
          ownerUserId: userId,
          isPrivate: false,
        })
        .returning();

      const [tx2] = await db
        .insert(transactions)
        .values({
          id: randomUUID(),
          householdId,
          accountId: testAccountId,
          merchantId: sourceMerchant.id,
          amount: "30.00",
          currency: "ZMW",
          date: "2026-01-12",
          name: "Source tx 2",

          type: "expense",
          categoryId: null,

          isPending: false,
          isRecurring: false,
          ownerUserId: userId,
          isPrivate: false,
        })
        .returning();

      // Call merge endpoint
      const res = await request(app)
        .post("/api/merchants/merge")
        .set("Cookie", authCookie)
        .send({
          sourceId: sourceMerchant.id,
          targetId: targetMerchant.id,
        })
        .expect(200);

      expect(res.body.success).toBe(true);

      // Verify all transactions moved to targetId
      const movedTransactions = await db
        .select()
        .from(transactions)
        .where(
          and(
            eq(transactions.householdId, householdId),
            eq(transactions.merchantId, targetMerchant.id),
          ),
        );

      const txIds = movedTransactions.map((t: any) => t.id);
      expect(txIds).toContain(tx1.id);
      expect(txIds).toContain(tx2.id);

      // Verify sourceId marked inactive
      const [source] = await db
        .select()
        .from(merchants)
        .where(eq(merchants.id, sourceMerchant.id));
      expect(source.isActive).toBe(false);
      expect(source.transactionCount).toBe(0);

      const [target] = await db
        .select()
        .from(merchants)
        .where(eq(merchants.id, targetMerchant.id));
      expect(target.transactionCount).toBe(2);

      // Verify audit log entry with MERGE action
      const auditLog = await db
        .select()
        .from(auditLogs)
        .where(
          and(
            eq(auditLogs.entityType, "merchant"),
            eq(auditLogs.action, "MERGE"),
          ),
        );
      expect(auditLog.length).toBeGreaterThan(0);
    });

    it("should rollback on failure (transaction integrity)", async () => {
      // Create source merchant
      const [sourceMerchant] = await db
        .insert(merchants)
        .values({
          id: randomUUID(),
          householdId,
          name: "Rollback Source",
          isActive: true,
        })
        .returning();

      // Create transaction for source
      await db.insert(transactions).values({
        id: randomUUID(),
        householdId,
        accountId: testAccountId,
        merchantId: sourceMerchant.id,
        amount: "15.00",
        currency: "ZMW",
        date: "2026-01-11",

        type: "expense",
        isRecurring: false,
        ownerUserId: userId,
        isPrivate: false,
        name: "Rollback test",
      });

      // Force failure with invalid targetId
      const fakeTargetId = randomUUID();
      const res = await request(app)
        .post("/api/merchants/merge")
        .set("Cookie", authCookie)
        .send({
          sourceId: sourceMerchant.id,
          targetId: fakeTargetId,
        });

      // Should fail with invalid target
      expect([404, 500]).toContain(res.status);
      expect(res.body.success).toBe(false);

      // Verify no partial state: transactions not moved, source still active
      const txs = await db
        .select()
        .from(transactions)
        .where(eq(transactions.merchantId, sourceMerchant.id));
      expect(txs.length).toBe(1); // Still linked to source

      const [source] = await db
        .select()
        .from(merchants)
        .where(eq(merchants.id, sourceMerchant.id));
      expect(source.isActive).toBe(true); // Still active (rollback worked)
    });

    it("should not allow merging merchants from different households", async () => {
      // Create another household
      const otherHouseholdId = randomUUID();
      await db.insert(households).values({
        id: otherHouseholdId,
        name: "Other Household 3",
        currency: "ZMW",
      });

      // Create merchant in current household
      const [sourceMerchant] = await db
        .insert(merchants)
        .values({
          id: randomUUID(),
          householdId,
          name: "My Merchant",
          isActive: true,
        })
        .returning();

      // Create merchant in other household
      const [otherMerchant] = await db
        .insert(merchants)
        .values({
          id: randomUUID(),
          householdId: otherHouseholdId,
          name: "Other Merchant",
          isActive: true,
        })
        .returning();

      // Attempt merge across households
      const res = await request(app)
        .post("/api/merchants/merge")
        .set("Cookie", authCookie)
        .send({
          sourceId: sourceMerchant.id,
          targetId: otherMerchant.id,
        });

      // Should prevent cross-household merge
      expect([404, 500]).toContain(res.status);
      expect(res.body.success).toBe(false);

      // Cleanup
      await db
        .delete(merchants)
        .where(eq(merchants.householdId, otherHouseholdId));
      await db.delete(households).where(eq(households.id, otherHouseholdId));
    });

    it("should audit log merge action", async () => {
      // Create source and target merchants
      const [sourceMerchant] = await db
        .insert(merchants)
        .values({
          id: randomUUID(),
          householdId,
          name: "Audit Merge Source",
          isActive: true,
        })
        .returning();

      const [targetMerchant] = await db
        .insert(merchants)
        .values({
          id: randomUUID(),
          householdId,
          name: "Audit Merge Target",
          isActive: true,
        })
        .returning();

      // Perform merge
      await request(app)
        .post("/api/merchants/merge")
        .set("Cookie", authCookie)
        .send({
          sourceId: sourceMerchant.id,
          targetId: targetMerchant.id,
        })
        .expect(200);

      // Verify audit_logs table has MERGE action
      const auditLog = await db
        .select()
        .from(auditLogs)
        .where(
          and(
            eq(auditLogs.entityType, "merchant"),
            eq(auditLogs.action, "MERGE"),
          ),
        );

      expect(auditLog.length).toBeGreaterThan(0);

      // Verify details include sourceId and targetId
      const mergeLog = auditLog.find((log: any) => {
        const details = log.details as any;
        return (
          details?.sourceId === sourceMerchant.id &&
          details?.targetId === targetMerchant.id
        );
      });
      expect(mergeLog).toBeDefined();
    });
  });

  describe("Rate Limiting", () => {
    it("charges generalLimiter once: global /api mount ahead of the router, none inside it", () => {
      // A second mount inside the router counted every merchant request twice.
      expect(
        routerUsesMiddlewareBeforeRoutes(merchantsRouter, generalLimiter),
      ).toBe(false);
      expect(
        routeUsesMiddleware(merchantsRouter, "/autocomplete", "get", generalLimiter),
      ).toBe(false);

      const appStack =
        (app as unknown as { _router: { stack: Array<{ handle?: unknown }> } })
          ._router.stack;
      const limiterIndex = appStack.findIndex(
        (layer) => layer.handle === generalLimiter,
      );
      const merchantsIndex = appStack.findIndex(
        (layer) => layer.handle === merchantsRouter,
      );
      expect(limiterIndex).toBeGreaterThanOrEqual(0);
      expect(merchantsIndex).toBeGreaterThan(limiterIndex);
    });
  });
});
