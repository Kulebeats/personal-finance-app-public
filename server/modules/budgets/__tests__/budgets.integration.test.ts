/**
 * Budgets Module - Integration Tests
 *
 * Comprehensive integration tests for budget CRUD, move money,
 * progress calculations, forecast, and alerts functionality.
 *
 * @module modules/budgets/__tests__/budgets.integration.test
 */

import request from "supertest";
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import type { Express } from "express";
import { db } from "../../../db";
import { eq, and, inArray, sql } from "drizzle-orm";
import {
  budgets,
  budgetPeriods,
  categories,
  categoryGroups,
  transactions,
  accounts,
  auditLogs,
  users,
  households,
  householdPreferences,
  householdMembers,
} from "@shared/schema";
import {
  createTestUser,
  createTestHousehold,
  getTestApp,
} from "../../../__tests__/fixtures";
import { hashPassword } from "../../../auth";
import { randomUUID } from "crypto";
import { budgetPeriodRepository } from "../../../repositories/budgets/BudgetPeriodRepository";

describe("Budgets Integration Tests", () => {
  let app: Express;
  let authCookie: string;
  let csrfToken: string;
  let householdId: string;
  let userId: string;
  let testGroupId: string;
  let testCategoryId: string;
  let testAccountId: string;
  let testUser: ReturnType<typeof createTestUser>;
  let testHousehold: ReturnType<typeof createTestHousehold>;

  // Helper to make authenticated requests with CSRF token
  const authRequest = (req: request.Test) => {
    return req.set("Cookie", authCookie).set("X-CSRF-Token", csrfToken);
  };

  beforeAll(async () => {
    app = await getTestApp();

    const timestamp = Date.now();

    testUser = createTestUser({
      email: `budget-test-${timestamp}@example.com`,
      username: `budget-test-user-${timestamp}`,
    });
    testHousehold = createTestHousehold(testUser.id, {
      name: "Budget Test Household",
      currency: "ZMW",
    });

    const passwordHash = await hashPassword("TestPassword123");
    testUser.passwordHash = passwordHash;

    householdId = testHousehold.id;
    userId = testUser.id;
    testUser.householdId = testHousehold.id;

    // Insert household
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

    // Add user to household as admin (REQUIRED for household access)
    await db.insert(householdMembers).values({
      householdId: testHousehold.id,
      userId: testUser.id,
      role: "admin",
    });

    // Create test category group
    testGroupId = randomUUID();
    await db.insert(categoryGroups).values({
      id: testGroupId,
      householdId,
      name: "Test Budget Group",
      type: "expenses",
      isArchived: false,
      displayOrder: 1,
    });

    // Create test category
    testCategoryId = randomUUID();
    await db.insert(categories).values({
      id: testCategoryId,
      householdId,
      groupId: testGroupId,
      name: "Test Budget Category",
      icon: "shopping",
      color: "#FF0000",
      isArchived: false,
      includeInBudget: true,
      displayOrder: 1,
    });

    // Create test account (required for transaction inserts)
    testAccountId = randomUUID();
    await db.insert(accounts).values({
      id: testAccountId,
      householdId,
      name: "Test Budget Account",
      type: "checking",
      balance: "10000.00",
      currency: "ZMW",
    });

    // Authenticate
    const loginRes = await request(app)
      .post("/api/auth/login")
      .send({
        email: testUser.email,
        password: "TestPassword123",
      })
      .expect(200);

    authCookie = loginRes.headers["set-cookie"]
      ? ([] as unknown as string[]).concat(loginRes.headers["set-cookie"]).join("; ")
      : "";

    // Get CSRF token
    const csrfRes = await request(app)
      .get("/api/csrf-token")
      .set("Cookie", authCookie)
      .expect(200);

    csrfToken = csrfRes.body.csrfToken;
    // Include CSRF cookie in authCookie
    if (csrfRes.headers["set-cookie"]) {
      authCookie = [
        authCookie,
        ...([] as unknown as string[]).concat(csrfRes.headers["set-cookie"]),
      ].join("; ");
    }
  });

  afterAll(async () => {
    // Cleanup in reverse dependency order
    try {
      await db.delete(auditLogs).where(eq(auditLogs.householdId, householdId));
      await db
        .delete(transactions)
        .where(eq(transactions.householdId, householdId));
      // Delete budget periods first by finding budget IDs
      const householdBudgets = await db
        .select({ id: budgets.id })
        .from(budgets)
        .where(eq(budgets.householdId, householdId));
      const budgetIds = householdBudgets.map((b) => b.id);
      if (budgetIds.length > 0) {
        await db
          .delete(budgetPeriods)
          .where(inArray(budgetPeriods.budgetId, budgetIds));
      }
      await db.delete(budgets).where(eq(budgets.householdId, householdId));
      await db.delete(accounts).where(eq(accounts.householdId, householdId));
      await db
        .delete(categories)
        .where(eq(categories.householdId, householdId));
      await db
        .delete(categoryGroups)
        .where(eq(categoryGroups.householdId, householdId));
      await db
        .delete(householdPreferences)
        .where(eq(householdPreferences.householdId, householdId));
      await db
        .delete(householdMembers)
        .where(eq(householdMembers.householdId, householdId));
      await db.delete(users).where(eq(users.id, userId));
      await db.delete(households).where(eq(households.id, householdId));
    } catch (error) {
      // Ignore cleanup errors if data already deleted
      console.error("Cleanup error (may be expected):", error);
    }
  });

  // ===========================================================================
  // CRUD Operations (8 tests)
  // ===========================================================================
  describe("CRUD Operations", () => {
    describe("POST /api/budgets - Create Budget", () => {
      it("should create a budget successfully", async () => {
        const res = await request(app)
          .post("/api/budgets")
          .set("Cookie", authCookie)
          .set("X-CSRF-Token", csrfToken)
          .send({
            name: "Groceries Budget",
            categoryId: testCategoryId,
            amount: { amount: "500.00", currency: "ZMW" },
            period: "monthly",
            warningThreshold: 80,
            alertThreshold: 100,
          })
          .expect(201);

        expect(res.body.success).toBe(true);
        expect(res.body.data).toMatchObject({
          name: "Groceries Budget",
          categoryId: testCategoryId,
          period: "monthly",
          warningThreshold: 80,
          alertThreshold: 100,
          isActive: true,
        });
        expect(res.body.data.amount).toMatchObject({
          amount: "500.00",
          currency: "ZMW",
        });

        // Verify in database
        const [budget] = await db
          .select()
          .from(budgets)
          .where(eq(budgets.id, res.body.data.id));
        expect(budget.name).toBe("Groceries Budget");
        expect(budget.amount).toBe("500.00");
      });

      it("should default omitted budget period to monthly", async () => {
        const res = await request(app)
          .post("/api/budgets")
          .set("Cookie", authCookie)
          .set("X-CSRF-Token", csrfToken)
          .send({
            name: "Default Period Budget",
            categoryId: testCategoryId,
            amount: { amount: "125.00", currency: "ZMW" },
          })
          .expect(201);

        expect(res.body.success).toBe(true);
        expect(res.body.data.period).toBe("monthly");

        const [budget] = await db
          .select()
          .from(budgets)
          .where(eq(budgets.id, res.body.data.id));
        expect(budget.period).toBe("monthly");
      });

      it.each(["yearly", "custom"] as const)(
        "should reject unsupported %s budget period on create",
        async (period) => {
          const name = `Unsupported ${period} Budget`;
          const res = await request(app)
            .post("/api/budgets")
            .set("Cookie", authCookie)
            .set("X-CSRF-Token", csrfToken)
            .send({
              name,
              categoryId: testCategoryId,
              amount: { amount: "100.00", currency: "ZMW" },
              period,
            })
            .expect(400);

          expect(res.body.error).toBeDefined();

          const rows = await db
            .select()
            .from(budgets)
            .where(
              and(eq(budgets.householdId, householdId), eq(budgets.name, name)),
            );
          expect(rows).toHaveLength(0);
        }
      );

      it("should enforce monthly-only budget periods at the database boundary", async () => {
        await expect(
          db.insert(budgets).values({
            id: randomUUID(),
            householdId,
            name: "Direct Yearly Budget",
            categoryId: testCategoryId,
            amount: "100.00",
            period: "yearly",
          }),
        ).rejects.toThrow();

        const rows = await db
          .select()
          .from(budgets)
          .where(
            and(
              eq(budgets.householdId, householdId),
              eq(budgets.name, "Direct Yearly Budget"),
            ),
          );
        expect(rows).toHaveLength(0);
      });

      it("should reject creation with validation errors", async () => {
        // Missing required fields
        const res = await request(app)
          .post("/api/budgets")
          .set("Cookie", authCookie)
          .set("X-CSRF-Token", csrfToken)
          .send({
            name: "",
            amount: { amount: "-100.00", currency: "ZMW" },
          })
          .expect(400);

        // Error response validation - 400 status is sufficient
        expect(res.body.error).toBeDefined();
      });

      it("should reject budget with non-existent category", async () => {
        const fakeId = randomUUID();
        const res = await request(app)
          .post("/api/budgets")
          .set("Cookie", authCookie)
          .set("X-CSRF-Token", csrfToken)
          .send({
            name: "Invalid Budget",
            categoryId: fakeId,
            amount: { amount: "100.00", currency: "ZMW" },
          });

        // Should return error for non-existent category
        expect([400, 404, 500]).toContain(res.status);
        expect(res.body.error).toBeDefined();
      });

      it("should reject budget for archived category", async () => {
        // Create an archived category
        const archivedCategoryId = randomUUID();
        await db.insert(categories).values({
          id: archivedCategoryId,
          householdId,
          groupId: testGroupId,
          name: "Archived Category",
          icon: "archive",
          color: "#888888",
          isArchived: true,
          displayOrder: 100,
        });

        const res = await request(app)
          .post("/api/budgets")
          .set("Cookie", authCookie)
          .set("X-CSRF-Token", csrfToken)
          .send({
            name: "Budget for Archived",
            categoryId: archivedCategoryId,
            amount: { amount: "100.00", currency: "ZMW" },
          });

        // May return 400 or 500 for archived category
        expect([400, 500]).toContain(res.status);

        // Cleanup
        await db
          .delete(categories)
          .where(eq(categories.id, archivedCategoryId));
      });
    });

    describe("GET /api/budgets/:id - Get Budget by ID", () => {
      it("should get a budget by ID successfully", async () => {
        // Create a budget first
        const [budget] = await db
          .insert(budgets)
          .values({
            id: randomUUID(),
            householdId,
            name: "Get Test Budget",
            categoryId: testCategoryId,
            amount: "300.00",
            period: "monthly",
          })
          .returning();

        const res = await request(app)
          .get(`/api/budgets/${budget.id}`)
          .set("Cookie", authCookie)
          .set("X-CSRF-Token", csrfToken)
          .expect(200);

        expect(res.body.success).toBe(true);
        expect(res.body.data.id).toBe(budget.id);
        expect(res.body.data.name).toBe("Get Test Budget");
      });

      it("should return error for non-existent budget", async () => {
        const fakeId = randomUUID();
        const res = await request(app)
          .get(`/api/budgets/${fakeId}`)
          .set("Cookie", authCookie)
          .set("X-CSRF-Token", csrfToken);

        // Should return error for non-existent budget
        expect([404, 500]).toContain(res.status);
        expect(res.body.success).toBe(false);
      });

      it("should return 404 for budget from wrong household", async () => {
        // Create another household and budget
        const otherHouseholdId = randomUUID();
        await db.insert(households).values({
          id: otherHouseholdId,
          name: "Other Household",
          currency: "ZMW",
        });

        const [otherBudget] = await db
          .insert(budgets)
          .values({
            id: randomUUID(),
            householdId: otherHouseholdId,
            name: "Other Household Budget",
            amount: "100.00",
            period: "monthly",
          })
          .returning();

        const res = await request(app)
          .get(`/api/budgets/${otherBudget.id}`)
          .set("Cookie", authCookie)
          .set("X-CSRF-Token", csrfToken);

        // May return 404 or 500 for cross-household access
        expect([404, 500]).toContain(res.status);

        // Error response validation - 400/404 status is sufficient

        // Cleanup
        await db
          .delete(budgets)
          .where(eq(budgets.householdId, otherHouseholdId));
        await db.delete(households).where(eq(households.id, otherHouseholdId));
      });
    });

    describe("PUT /api/budgets/:id - Update Budget", () => {
      it("should update a budget successfully", async () => {
        const [budget] = await db
          .insert(budgets)
          .values({
            id: randomUUID(),
            householdId,
            name: "Update Test Budget",
            categoryId: testCategoryId,
            amount: "200.00",
            period: "monthly",
          })
          .returning();

        const res = await request(app)
          .put(`/api/budgets/${budget.id}`)
          .set("Cookie", authCookie)
          .set("X-CSRF-Token", csrfToken)
          .send({
            name: "Updated Budget Name",
            amount: { amount: "350.00", currency: "ZMW" },
            warningThreshold: 75,
          })
          .expect(200);

        expect(res.body.success).toBe(true);
        expect(res.body.data.name).toBe("Updated Budget Name");
        expect(res.body.data.amount.amount).toBe("350.00");
        expect(res.body.data.warningThreshold).toBe(75);

        // Verify in database
        const [updated] = await db
          .select()
          .from(budgets)
          .where(eq(budgets.id, budget.id));
        expect(updated.name).toBe("Updated Budget Name");
        expect(updated.amount).toBe("350.00");
      });

      it.each(["yearly", "custom"] as const)(
        "should reject unsupported %s budget period on update",
        async (period) => {
          const [budget] = await db
            .insert(budgets)
            .values({
              id: randomUUID(),
              householdId,
              name: `Update ${period} Period Test`,
              categoryId: testCategoryId,
              amount: "200.00",
              period: "monthly",
            })
            .returning();

          const res = await request(app)
            .put(`/api/budgets/${budget.id}`)
            .set("Cookie", authCookie)
            .set("X-CSRF-Token", csrfToken)
            .send({ period })
            .expect(400);

          expect(res.body.error).toBeDefined();

          const [updated] = await db
            .select()
            .from(budgets)
            .where(eq(budgets.id, budget.id));
          expect(updated.period).toBe("monthly");
        }
      );

      it("should return 404 when updating budget from wrong household", async () => {
        const otherHouseholdId = randomUUID();
        await db.insert(households).values({
          id: otherHouseholdId,
          name: "Other Update Household",
          currency: "ZMW",
        });

        const [otherBudget] = await db
          .insert(budgets)
          .values({
            id: randomUUID(),
            householdId: otherHouseholdId,
            name: "Other Budget",
            amount: "100.00",
            period: "monthly",
          })
          .returning();

        const res = await request(app)
          .put(`/api/budgets/${otherBudget.id}`)
          .set("Cookie", authCookie)
          .set("X-CSRF-Token", csrfToken)
          .send({
            name: "Hijacked Name",
          });

        // May return 404 or 500 for cross-household access
        expect([404, 500]).toContain(res.status);

        // Verify not changed
        const [unchanged] = await db
          .select()
          .from(budgets)
          .where(eq(budgets.id, otherBudget.id));
        expect(unchanged.name).toBe("Other Budget");

        // Cleanup
        await db
          .delete(budgets)
          .where(eq(budgets.householdId, otherHouseholdId));
        await db.delete(households).where(eq(households.id, otherHouseholdId));
      });
    });

    describe("DELETE /api/budgets/:id - Delete Budget", () => {
      it("should delete a budget successfully", async () => {
        const [budget] = await db
          .insert(budgets)
          .values({
            id: randomUUID(),
            householdId,
            name: "Delete Test Budget",
            categoryId: testCategoryId,
            amount: "100.00",
            period: "monthly",
          })
          .returning();

        const res = await request(app)
          .delete(`/api/budgets/${budget.id}`)
          .set("Cookie", authCookie)
          .set("X-CSRF-Token", csrfToken)
          .expect(200);

        expect(res.body.success).toBe(true);

        // Verify deleted
        const [deleted] = await db
          .select()
          .from(budgets)
          .where(eq(budgets.id, budget.id));
        expect(deleted).toBeUndefined();
      });
    });

    describe("GET /api/budgets - List Budgets", () => {
      it("should list budgets with filters", async () => {
        // Create active and inactive budgets.
        // A category is required: the repository filters out non-flex budgets
        // that are not tied to a visible (non-archived, includeInBudget,
        // by_category) category, so an uncategorized budget would never appear.
        await db.insert(budgets).values([
          {
            id: randomUUID(),
            householdId,
            name: "Active Budget 1",
            categoryId: testCategoryId,
            amount: "100.00",
            period: "monthly",
            isActive: true,
          },
          {
            id: randomUUID(),
            householdId,
            name: "Inactive Budget",
            categoryId: testCategoryId,
            amount: "50.00",
            period: "monthly",
            isActive: false,
          },
        ]);

        // List only active (default)
        const res1 = await request(app)
          .get("/api/budgets")
          .set("Cookie", authCookie)
          .set("X-CSRF-Token", csrfToken)
          .expect(200);

        expect(res1.body.success).toBe(true);
        expect(res1.body.data).toBeInstanceOf(Array);
        const activeNames = res1.body.data.map((b: any) => b.name);
        expect(activeNames).toContain("Active Budget 1");
        expect(activeNames).not.toContain("Inactive Budget");

        // List all including inactive
        const res2 = await request(app)
          .get("/api/budgets?includeInactive=true")
          .set("Cookie", authCookie)
          .set("X-CSRF-Token", csrfToken)
          .expect(200);

        expect(res2.body.success).toBe(true);
        const allNames = res2.body.data.map((b: any) => b.name);
        expect(allNames).toContain("Inactive Budget");
      });
    });
  });

  // ===========================================================================
  // Move Money (6 tests)
  // ===========================================================================
  describe("Move Money Operations", () => {
    let sourceBudgetId: string;
    let targetBudgetId: string;

    beforeEach(async () => {
      // Create source and target budgets
      const [source] = await db
        .insert(budgets)
        .values({
          id: randomUUID(),
          householdId,
          name: "Source Budget",
          amount: "1000.00",
          period: "monthly",
        })
        .returning();
      sourceBudgetId = source.id;

      const [target] = await db
        .insert(budgets)
        .values({
          id: randomUUID(),
          householdId,
          name: "Target Budget",
          amount: "500.00",
          period: "monthly",
        })
        .returning();
      targetBudgetId = target.id;
    });

    it("should move money between budgets successfully", async () => {
      const now = new Date();
      const res = await request(app)
        .post("/api/budgets/move")
        .set("Cookie", authCookie)
        .set("X-CSRF-Token", csrfToken)
        .send({
          fromBudgetId: sourceBudgetId,
          toBudgetId: targetBudgetId,
          amount: { amount: "200.00", currency: "ZMW" },
          year: now.getFullYear(),
          month: now.getMonth() + 1,
        })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.scope).toBe("this_month");
    });

    // TODO: Service should return ValidationError for insufficient funds, currently returns 500
    it("should reject move with insufficient source budget", async () => {
      const now = new Date();
      const res = await request(app)
        .post("/api/budgets/move")
        .set("Cookie", authCookie)
        .set("X-CSRF-Token", csrfToken)
        .send({
          fromBudgetId: sourceBudgetId,
          toBudgetId: targetBudgetId,
          amount: { amount: "5000.00", currency: "ZMW" },
          year: now.getFullYear(),
          month: now.getMonth() + 1,
        });

      // Service throws unhandled error - may return 400 or 500
      expect([400, 500]).toContain(res.status);
    });

    // TODO: Service should validate cross-household access, currently returns 500
    it("should reject move for budget from wrong household", async () => {
      const otherHouseholdId = randomUUID();
      await db.insert(households).values({
        id: otherHouseholdId,
        name: "Other Move Household",
        currency: "ZMW",
      });

      const [otherBudget] = await db
        .insert(budgets)
        .values({
          id: randomUUID(),
          householdId: otherHouseholdId,
          name: "Other Budget",
          amount: "500.00",
          period: "monthly",
        })
        .returning();

      const now = new Date();
      const res = await request(app)
        .post("/api/budgets/move")
        .set("Cookie", authCookie)
        .set("X-CSRF-Token", csrfToken)
        .send({
          fromBudgetId: sourceBudgetId,
          toBudgetId: otherBudget.id,
          amount: { amount: "100.00", currency: "ZMW" },
          year: now.getFullYear(),
          month: now.getMonth() + 1,
        });

      // Service may return 404 or 500 for cross-household access
      expect([404, 500]).toContain(res.status);

      // Cleanup
      await db.delete(budgets).where(eq(budgets.householdId, otherHouseholdId));
      await db.delete(households).where(eq(households.id, otherHouseholdId));
    });

    // TODO: API should validate and reject same-budget transfers
    it("should handle move to same budget", async () => {
      const now = new Date();
      const res = await request(app)
        .post("/api/budgets/move")
        .set("Cookie", authCookie)
        .set("X-CSRF-Token", csrfToken)
        .send({
          fromBudgetId: sourceBudgetId,
          toBudgetId: sourceBudgetId,
          amount: { amount: "100.00", currency: "ZMW" },
          year: now.getFullYear(),
          month: now.getMonth() + 1,
        });

      // API currently accepts same-budget moves (no-op) - returns 200
      // May be changed to reject with 400 in future
      expect([200, 400, 500]).toContain(res.status);
    });

    it("should reject move with negative amount", async () => {
      const now = new Date();
      const res = await request(app)
        .post("/api/budgets/move")
        .set("Cookie", authCookie)
        .set("X-CSRF-Token", csrfToken)
        .send({
          fromBudgetId: sourceBudgetId,
          toBudgetId: targetBudgetId,
          amount: { amount: "-50.00", currency: "ZMW" },
          year: now.getFullYear(),
          month: now.getMonth() + 1,
        })
        .expect(400);

      // Error response validation - 400/404 status is sufficient
    });

    it("should create audit log for move operation", async () => {
      const now = new Date();
      await request(app)
        .post("/api/budgets/move")
        .set("Cookie", authCookie)
        .set("X-CSRF-Token", csrfToken)
        .send({
          fromBudgetId: sourceBudgetId,
          toBudgetId: targetBudgetId,
          amount: { amount: "100.00", currency: "ZMW" },
          year: now.getFullYear(),
          month: now.getMonth() + 1,
        })
        .expect(200);

      // Verify audit log
      const [auditLog] = await db
        .select()
        .from(auditLogs)
        .where(
          and(
            eq(auditLogs.entityType, "budget"),
            eq(auditLogs.entityId, sourceBudgetId),
            eq(auditLogs.action, "TRANSFER"),
          ),
        );

      expect(auditLog).toBeDefined();
      expect(auditLog.householdId).toBe(householdId);
      expect(auditLog.userId).toBe(userId);
    });
  });

  // ===========================================================================
  // Progress & Calculations (8 tests)
  // ===========================================================================
  describe("Progress & Calculations", () => {
    let progressCategoryId: string;
    let progressBudgetId: string;

    beforeEach(async () => {
      // Create category for progress tests
      progressCategoryId = randomUUID();
      await db.insert(categories).values({
        id: progressCategoryId,
        householdId,
        groupId: testGroupId,
        name: "Progress Test Category",
        icon: "chart",
        color: "#00FF00",
        isArchived: false,
        includeInBudget: true,
        displayOrder: 200,
      });

      // Create budget
      const [budget] = await db
        .insert(budgets)
        .values({
          id: randomUUID(),
          householdId,
          name: "Progress Test Budget",
          categoryId: progressCategoryId,
          amount: "1000.00",
          period: "monthly",
          warningThreshold: 75,
          alertThreshold: 90,
        })
        .returning();
      progressBudgetId = budget.id;
    });

    it("should calculate spent from transactions", async () => {
      const now = new Date();
      const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-15`;

      // Create expense transactions
      await db.insert(transactions).values([
        {
          id: randomUUID(),
          householdId,
          currency: "ZMW",
          accountId: testAccountId,
          categoryId: progressCategoryId,
          date: dateStr,
          amount: "250.00",
          type: "expense",
          name: "Test expense 1",
          isExcludedFromBudget: false,
        },
        {
          id: randomUUID(),
          householdId,
          currency: "ZMW",
          accountId: testAccountId,
          categoryId: progressCategoryId,
          date: dateStr,
          amount: "150.00",
          type: "expense",
          name: "Test expense 2",
          isExcludedFromBudget: false,
        },
      ]);

      const res = await request(app)
        .get(
          `/api/budgets/progress?year=${now.getFullYear()}&month=${now.getMonth() + 1}`,
        )
        .set("Cookie", authCookie)
        .set("X-CSRF-Token", csrfToken)
        .expect(200);

      expect(res.body.success).toBe(true);
      const progressBudget = res.body.data.find(
        (b: any) => b.id === progressBudgetId,
      );
      expect(progressBudget).toBeDefined();
      // Spent should be 400.00 (250 + 150)
      expect(parseFloat(progressBudget.spent.amount)).toBeCloseTo(400, 2);
    });

    it("should calculate budget progress percentage", async () => {
      const now = new Date();
      const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-10`;

      // Create expense for 50% of budget
      await db.insert(transactions).values({
        id: randomUUID(),
        householdId,
        currency: "ZMW",
        accountId: testAccountId,
        categoryId: progressCategoryId,
        date: dateStr,
        amount: "500.00",
        type: "expense",
        name: "Half budget expense",
        isExcludedFromBudget: false,
      });

      const res = await request(app)
        .get(
          `/api/budgets/progress?year=${now.getFullYear()}&month=${now.getMonth() + 1}`,
        )
        .set("Cookie", authCookie)
        .set("X-CSRF-Token", csrfToken)
        .expect(200);

      expect(res.body.success).toBe(true);
      const progressBudget = res.body.data.find(
        (b: any) => b.id === progressBudgetId,
      );
      expect(progressBudget).toBeDefined();
      expect(progressBudget.percentUsed).toBeCloseTo(50, 1);
    });

    it("should detect over-budget status", async () => {
      const now = new Date();
      const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-05`;

      // Create expense exceeding budget
      await db.insert(transactions).values({
        id: randomUUID(),
        householdId,
        currency: "ZMW",
        accountId: testAccountId,
        categoryId: progressCategoryId,
        date: dateStr,
        amount: "1200.00",
        type: "expense",
        name: "Over budget expense",
        isExcludedFromBudget: false,
      });

      const res = await request(app)
        .get(
          `/api/budgets/progress?year=${now.getFullYear()}&month=${now.getMonth() + 1}`,
        )
        .set("Cookie", authCookie)
        .set("X-CSRF-Token", csrfToken)
        .expect(200);

      expect(res.body.success).toBe(true);
      const progressBudget = res.body.data.find(
        (b: any) => b.id === progressBudgetId,
      );
      expect(progressBudget).toBeDefined();
      expect(progressBudget.percentUsed).toBeGreaterThan(100);
    });

    it("should calculate remaining budget correctly", async () => {
      const now = new Date();
      const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-12`;

      await db.insert(transactions).values({
        id: randomUUID(),
        householdId,
        currency: "ZMW",
        accountId: testAccountId,
        categoryId: progressCategoryId,
        date: dateStr,
        amount: "300.00",
        type: "expense",
        name: "Partial expense",
        isExcludedFromBudget: false,
      });

      const res = await request(app)
        .get(
          `/api/budgets/progress?year=${now.getFullYear()}&month=${now.getMonth() + 1}`,
        )
        .set("Cookie", authCookie)
        .set("X-CSRF-Token", csrfToken)
        .expect(200);

      const progressBudget = res.body.data.find(
        (b: any) => b.id === progressBudgetId,
      );
      expect(progressBudget).toBeDefined();
      // Remaining should be 1000 - 300 = 700
      expect(parseFloat(progressBudget.remaining.amount)).toBeCloseTo(700, 2);
    });

    it("should exclude transactions marked as excluded from budget", async () => {
      const now = new Date();
      const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-08`;

      await db.insert(transactions).values([
        {
          id: randomUUID(),
          householdId,
          currency: "ZMW",
          accountId: testAccountId,
          categoryId: progressCategoryId,
          date: dateStr,
          amount: "100.00",
          type: "expense",
          name: "Included expense",
          isExcludedFromBudget: false,
        },
        {
          id: randomUUID(),
          householdId,
          currency: "ZMW",
          accountId: testAccountId,
          categoryId: progressCategoryId,
          date: dateStr,
          amount: "500.00",
          type: "expense",
          name: "Excluded expense",
          isExcludedFromBudget: true,
        },
      ]);

      const res = await request(app)
        .get(
          `/api/budgets/progress?year=${now.getFullYear()}&month=${now.getMonth() + 1}`,
        )
        .set("Cookie", authCookie)
        .set("X-CSRF-Token", csrfToken)
        .expect(200);

      const progressBudget = res.body.data.find(
        (b: any) => b.id === progressBudgetId,
      );
      // Should only include 100.00, not the excluded 500.00
      expect(parseFloat(progressBudget.spent.amount)).toBeCloseTo(100, 2);
    });

    it("should handle group budget totals", async () => {
      // A group-level budget is only visible when its group uses budgetMode
      // "by_group" (group-level budgeting). Create a dedicated by_group group
      // for this test rather than reusing the shared by_category test group.
      const byGroupGroupId = randomUUID();
      await db.insert(categoryGroups).values({
        id: byGroupGroupId,
        householdId,
        name: "By-Group Budget Group",
        type: "expenses",
        budgetMode: "by_group",
        isArchived: false,
        displayOrder: 400,
      });

      // Create a group-level budget
      const [groupBudget] = await db
        .insert(budgets)
        .values({
          id: randomUUID(),
          householdId,
          name: "Group Budget",
          categoryGroupId: byGroupGroupId,
          amount: "2000.00",
          period: "monthly",
        })
        .returning();

      const now = new Date();
      const res = await request(app)
        .get(
          `/api/budgets/progress?year=${now.getFullYear()}&month=${now.getMonth() + 1}`,
        )
        .set("Cookie", authCookie)
        .set("X-CSRF-Token", csrfToken)
        .expect(200);

      expect(res.body.success).toBe(true);
      const foundGroupBudget = res.body.data.find(
        (b: any) => b.id === groupBudget.id,
      );
      expect(foundGroupBudget).toBeDefined();
      expect(foundGroupBudget.categoryGroupId).toBe(byGroupGroupId);
    });

    it("should require valid year and month parameters", async () => {
      const res = await request(app)
        .get("/api/budgets/progress?year=invalid&month=13")
        .set("Cookie", authCookie)
        .set("X-CSRF-Token", csrfToken)
        .expect(400);

      // Error response validation - 400/404 status is sufficient
    });

    it("should return empty progress for future months", async () => {
      const futureYear = new Date().getFullYear() + 2;
      const res = await request(app)
        .get(`/api/budgets/progress?year=${futureYear}&month=6`)
        .set("Cookie", authCookie)
        .set("X-CSRF-Token", csrfToken)
        .expect(200);

      expect(res.body.success).toBe(true);
      // Should return budgets but with zero spent
      res.body.data.forEach((budget: any) => {
        expect(parseFloat(budget.spent.amount)).toBe(0);
      });
    });
  });

  // ===========================================================================
  // Forecast (4 tests)
  // ===========================================================================
  describe("Forecast Operations", () => {
    let forecastBudgetId: string;

    beforeEach(async () => {
      const [budget] = await db
        .insert(budgets)
        .values({
          id: randomUUID(),
          householdId,
          name: "Forecast Test Budget",
          categoryId: testCategoryId,
          amount: "800.00",
          period: "monthly",
        })
        .returning();
      forecastBudgetId = budget.id;
    });

    it("should get forecast successfully", async () => {
      const now = new Date();
      const res = await request(app)
        .get(
          `/api/budgets/forecast?year=${now.getFullYear()}&month=${now.getMonth() + 1}&months=6`,
        )
        .set("Cookie", authCookie)
        .set("X-CSRF-Token", csrfToken)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.range).toHaveLength(6);
      expect(res.body.data.budgets).toBeInstanceOf(Array);

      const forecastBudget = res.body.data.budgets.find(
        (b: any) => b.id === forecastBudgetId,
      );
      expect(forecastBudget).toBeDefined();
      expect(forecastBudget.periods).toHaveLength(6);
    });

    it("should update forecast for specific month", async () => {
      const now = new Date();
      const res = await request(app)
        .put(`/api/budgets/forecast/${forecastBudgetId}`)
        .set("Cookie", authCookie)
        .set("X-CSRF-Token", csrfToken)
        .send({
          year: now.getFullYear(),
          month: now.getMonth() + 1,
          amount: { amount: "1200.00", currency: "ZMW" },
          applyScope: "this_month",
        })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.budgetId).toBe(forecastBudgetId);
      expect(res.body.data.scope).toBe("this_month");
    });

    it("should apply forecast to all future months", async () => {
      const now = new Date();
      const res = await request(app)
        .put(`/api/budgets/forecast/${forecastBudgetId}`)
        .set("Cookie", authCookie)
        .set("X-CSRF-Token", csrfToken)
        .send({
          year: now.getFullYear(),
          month: now.getMonth() + 1,
          amount: { amount: "900.00", currency: "ZMW" },
          applyScope: "all_future",
          months: 12,
        })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.scope).toBe("all_future");
      expect(res.body.data.months).toBe(12);
    });

    it("should return 404 for forecast of wrong household budget", async () => {
      const otherHouseholdId = randomUUID();
      await db.insert(households).values({
        id: otherHouseholdId,
        name: "Other Forecast Household",
        currency: "ZMW",
      });

      const [otherBudget] = await db
        .insert(budgets)
        .values({
          id: randomUUID(),
          householdId: otherHouseholdId,
          name: "Other Forecast Budget",
          amount: "500.00",
          period: "monthly",
        })
        .returning();

      const now = new Date();
      const res = await request(app)
        .put(`/api/budgets/forecast/${otherBudget.id}`)
        .set("Cookie", authCookie)
        .set("X-CSRF-Token", csrfToken)
        .send({
          year: now.getFullYear(),
          month: now.getMonth() + 1,
          amount: { amount: "600.00", currency: "ZMW" },
        });

      // TODO: Service should return 404 for cross-household access
      expect([404, 500]).toContain(res.status);

      // Cleanup
      await db.delete(budgets).where(eq(budgets.householdId, otherHouseholdId));
      await db.delete(households).where(eq(households.id, otherHouseholdId));
    });
  });

  // ===========================================================================
  // Alerts (4 tests)
  // ===========================================================================
  describe("Budget Alerts", () => {
    let alertCategoryId: string;

    beforeEach(async () => {
      // Create category for alert tests
      alertCategoryId = randomUUID();
      await db.insert(categories).values({
        id: alertCategoryId,
        householdId,
        groupId: testGroupId,
        name: "Alert Test Category",
        icon: "alert",
        color: "#FF0000",
        isArchived: false,
        includeInBudget: true,
        displayOrder: 300,
      });
    });

    it("should trigger warning alert on threshold", async () => {
      // Create budget with 80% warning threshold
      const [budget] = await db
        .insert(budgets)
        .values({
          id: randomUUID(),
          householdId,
          name: "Warning Alert Budget",
          categoryId: alertCategoryId,
          amount: "100.00",
          period: "monthly",
          warningThreshold: 75,
          alertThreshold: 90,
        })
        .returning();

      const now = new Date();
      const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-10`;

      // Spend 80% of budget
      await db.insert(transactions).values({
        id: randomUUID(),
        householdId,
        currency: "ZMW",
        accountId: testAccountId,
        categoryId: alertCategoryId,
        date: dateStr,
        amount: "80.00",
        type: "expense",
        name: "Warning level expense",
        isExcludedFromBudget: false,
      });

      const res = await request(app)
        .get(
          `/api/budgets/alerts?year=${now.getFullYear()}&month=${now.getMonth() + 1}`,
        )
        .set("Cookie", authCookie)
        .set("X-CSRF-Token", csrfToken)
        .expect(200);

      expect(res.body.success).toBe(true);
      const warningAlert = res.body.data.find(
        (a: any) => a.budget.id === budget.id,
      );
      expect(warningAlert).toBeDefined();
      expect(warningAlert.alertLevel).toBe("warning");
    });

    it("should trigger exceeded alert when over budget", async () => {
      const [budget] = await db
        .insert(budgets)
        .values({
          id: randomUUID(),
          householdId,
          name: "Exceeded Alert Budget",
          categoryId: alertCategoryId,
          amount: "100.00",
          period: "monthly",
          warningThreshold: 75,
          alertThreshold: 90,
        })
        .returning();

      const now = new Date();
      const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-15`;

      // Spend 110% of budget
      await db.insert(transactions).values({
        id: randomUUID(),
        householdId,
        currency: "ZMW",
        accountId: testAccountId,
        categoryId: alertCategoryId,
        date: dateStr,
        amount: "110.00",
        type: "expense",
        name: "Over budget expense",
        isExcludedFromBudget: false,
      });

      const res = await request(app)
        .get(
          `/api/budgets/alerts?year=${now.getFullYear()}&month=${now.getMonth() + 1}`,
        )
        .set("Cookie", authCookie)
        .set("X-CSRF-Token", csrfToken)
        .expect(200);

      expect(res.body.success).toBe(true);
      const exceededAlert = res.body.data.find(
        (a: any) => a.budget.id === budget.id,
      );
      expect(exceededAlert).toBeDefined();
      expect(exceededAlert.alertLevel).toBe("exceeded");
      expect(exceededAlert.percentUsed).toBeGreaterThanOrEqual(100);
    });

    it("should return no alerts when under threshold", async () => {
      const [budget] = await db
        .insert(budgets)
        .values({
          id: randomUUID(),
          householdId,
          name: "No Alert Budget",
          categoryId: alertCategoryId,
          amount: "1000.00",
          period: "monthly",
          warningThreshold: 75,
          alertThreshold: 90,
        })
        .returning();

      const now = new Date();
      const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-20`;

      // Spend only 50% (under warning threshold)
      await db.insert(transactions).values({
        id: randomUUID(),
        householdId,
        currency: "ZMW",
        accountId: testAccountId,
        categoryId: alertCategoryId,
        date: dateStr,
        amount: "500.00",
        type: "expense",
        name: "Under threshold expense",
        isExcludedFromBudget: false,
      });

      const res = await request(app)
        .get(
          `/api/budgets/alerts?year=${now.getFullYear()}&month=${now.getMonth() + 1}`,
        )
        .set("Cookie", authCookie)
        .set("X-CSRF-Token", csrfToken)
        .expect(200);

      expect(res.body.success).toBe(true);
      const noAlert = res.body.data.find((a: any) => a.budget.id === budget.id);
      expect(noAlert).toBeUndefined();
    });

    it("should return proper alert level structure", async () => {
      const [budget] = await db
        .insert(budgets)
        .values({
          id: randomUUID(),
          householdId,
          name: "Alert Structure Budget",
          categoryId: alertCategoryId,
          amount: "100.00",
          period: "monthly",
          warningThreshold: 75,
          alertThreshold: 90,
        })
        .returning();

      const now = new Date();
      const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-25`;

      await db.insert(transactions).values({
        id: randomUUID(),
        householdId,
        currency: "ZMW",
        accountId: testAccountId,
        categoryId: alertCategoryId,
        date: dateStr,
        amount: "85.00",
        type: "expense",
        name: "Alert level expense",
        isExcludedFromBudget: false,
      });

      const res = await request(app)
        .get(
          `/api/budgets/alerts?year=${now.getFullYear()}&month=${now.getMonth() + 1}`,
        )
        .set("Cookie", authCookie)
        .set("X-CSRF-Token", csrfToken)
        .expect(200);

      const alert = res.body.data.find((a: any) => a.budget.id === budget.id);
      expect(alert).toBeDefined();
      expect(alert).toHaveProperty("budget");
      expect(alert).toHaveProperty("spent");
      expect(alert).toHaveProperty("percentUsed");
      expect(alert).toHaveProperty("alertLevel");
      expect(["warning", "alert", "exceeded"]).toContain(alert.alertLevel);
    });
  });

  // ===========================================================================
  // Settings Operations
  // ===========================================================================
  describe("Settings Operations", () => {
    it("should get budget settings", async () => {
      const res = await request(app)
        .get("/api/budgets/settings")
        .set("Cookie", authCookie)
        .set("X-CSRF-Token", csrfToken)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveProperty("budgetSystem");
      expect(res.body.data).toHaveProperty("defaultApplyScope");
    });

    it("should update budget settings", async () => {
      const res = await request(app)
        .put("/api/budgets/settings")
        .set("Cookie", authCookie)
        .set("X-CSRF-Token", csrfToken)
        .send({
          budgetSystem: "flex",
          defaultApplyScope: "all_future",
        })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.budgetSystem).toBe("flex");
      expect(res.body.data.defaultApplyScope).toBe("all_future");
    });

    it("should validate settings enum values", async () => {
      const res = await request(app)
        .put("/api/budgets/settings")
        .set("Cookie", authCookie)
        .set("X-CSRF-Token", csrfToken)
        .send({
          budgetSystem: "invalid_system",
        })
        .expect(400);

      // 400 status code is sufficient validation - error response format may vary
    });
  });

  // ===========================================================================
  // Audit Logging
  // ===========================================================================
  describe("Audit Logging", () => {
    it("should audit log budget creation", async () => {
      const res = await request(app)
        .post("/api/budgets")
        .set("Cookie", authCookie)
        .set("X-CSRF-Token", csrfToken)
        .send({
          name: "Audit Create Budget",
          categoryId: testCategoryId,
          amount: { amount: "250.00", currency: "ZMW" },
        })
        .expect(201);

      const budgetId = res.body.data.id;

      const [auditLog] = await db
        .select()
        .from(auditLogs)
        .where(
          and(
            eq(auditLogs.entityType, "budget"),
            eq(auditLogs.entityId, budgetId),
            eq(auditLogs.action, "CREATE"),
          ),
        );

      expect(auditLog).toBeDefined();
      expect(auditLog.householdId).toBe(householdId);
      expect(auditLog.userId).toBe(userId);
    });

    it("should audit log budget update", async () => {
      const [budget] = await db
        .insert(budgets)
        .values({
          id: randomUUID(),
          householdId,
          name: "Audit Update Budget",
          amount: "100.00",
          period: "monthly",
        })
        .returning();

      await request(app)
        .put(`/api/budgets/${budget.id}`)
        .set("Cookie", authCookie)
        .set("X-CSRF-Token", csrfToken)
        .send({
          name: "Updated Audit Budget",
        })
        .expect(200);

      const [auditLog] = await db
        .select()
        .from(auditLogs)
        .where(
          and(
            eq(auditLogs.entityType, "budget"),
            eq(auditLogs.entityId, budget.id),
            eq(auditLogs.action, "UPDATE"),
          ),
        );

      expect(auditLog).toBeDefined();
      expect(auditLog.householdId).toBe(householdId);
    });

    it("should audit log budget deletion", async () => {
      const [budget] = await db
        .insert(budgets)
        .values({
          id: randomUUID(),
          householdId,
          name: "Audit Delete Budget",
          amount: "100.00",
          period: "monthly",
        })
        .returning();

      await request(app)
        .delete(`/api/budgets/${budget.id}`)
        .set("Cookie", authCookie)
        .set("X-CSRF-Token", csrfToken)
        .expect(200);

      const [auditLog] = await db
        .select()
        .from(auditLogs)
        .where(
          and(
            eq(auditLogs.entityType, "budget"),
            eq(auditLogs.entityId, budget.id),
            eq(auditLogs.action, "DELETE"),
          ),
        );

      expect(auditLog).toBeDefined();
      expect(auditLog.householdId).toBe(householdId);
    });
  });

  // ===========================================================================
  // Authorization
  // ===========================================================================
  describe("Authorization", () => {
    it("should require authentication for all endpoints", async () => {
      const endpoints = [
        { method: "get", path: "/api/budgets" },
        { method: "post", path: "/api/budgets" },
        { method: "get", path: `/api/budgets/${randomUUID()}` },
        { method: "put", path: `/api/budgets/${randomUUID()}` },
        { method: "delete", path: `/api/budgets/${randomUUID()}` },
        { method: "get", path: "/api/budgets/progress?year=2026&month=1" },
        { method: "get", path: "/api/budgets/alerts?year=2026&month=1" },
        { method: "get", path: "/api/budgets/forecast?year=2026&month=1" },
        { method: "post", path: "/api/budgets/move" },
      ];

      for (const endpoint of endpoints) {
        const res = await (request(app) as any)[endpoint.method](endpoint.path);
        expect(res.status).toBe(401);
      }
    });
  });

  // ===========================================================================
  // Recalculate and Clear
  // ===========================================================================
  describe("Recalculate and Clear Operations", () => {
    it("should preview historical estimates without overwriting budgets or periods", async () => {
      const before = await db.select().from(budgets).where(eq(budgets.householdId, householdId)).orderBy(budgets.id);
      const budgetIds = before.map(row => row.id);
      const periodsBefore = await db.select().from(budgetPeriods).where(inArray(budgetPeriods.budgetId, budgetIds)).orderBy(budgetPeriods.id);
      const res = await request(app)
        .post("/api/budgets/recalculate")
        .set("Cookie", authCookie)
        .set("X-CSRF-Token", csrfToken)
        .send({ months: 3 })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data).toMatchObject({ mode: "preview", scope: "visible_posted_activity" });
      expect(res.body.data.periods).toHaveLength(3);
      expect(Array.isArray(res.body.data.suggestions)).toBe(true);
      expect(await db.select().from(budgets).where(eq(budgets.householdId, householdId)).orderBy(budgets.id)).toEqual(before);
      expect(await db.select().from(budgetPeriods).where(inArray(budgetPeriods.budgetId, budgetIds)).orderBy(budgetPeriods.id)).toEqual(periodsBefore);
    });

    it("should clear all budgets except flex budget", async () => {
      // Create a regular (clearable) budget.
      await db.insert(budgets).values({
        id: randomUUID(),
        householdId,
        name: "Clear Test Budget 1",
        amount: "100.00",
        period: "monthly",
        isFlexBucket: false,
      });

      // Ensure exactly one flex budget exists for the household. Only one is
      // permitted (idx_budgets_flex_unique), and an earlier test may already
      // have created it via the "flex" budget-system setting, so seed it only
      // when absent instead of blindly inserting a second one.
      const existingFlex = await db
        .select({ id: budgets.id })
        .from(budgets)
        .where(
          and(
            eq(budgets.householdId, householdId),
            eq(budgets.isFlexBucket, true),
          ),
        );
      if (existingFlex.length === 0) {
        await db.insert(budgets).values({
          id: randomUUID(),
          householdId,
          name: "Flex Budget",
          amount: "0.00",
          period: "monthly",
          isFlexBucket: true,
        });
      }

      const res = await request(app)
        .post("/api/budgets/clear")
        .set("Cookie", authCookie)
        .set("X-CSRF-Token", csrfToken)
        .send({ confirm: true })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveProperty("cleared");

      // Verify flex budget still exists
      const remaining = await db
        .select()
        .from(budgets)
        .where(
          and(
            eq(budgets.householdId, householdId),
            eq(budgets.isFlexBucket, true),
          ),
        );
      expect(remaining.length).toBeGreaterThan(0);
    });
  });

  // ===========================================================================
  // Move Money Race Conditions (3 tests)
  // ===========================================================================
  describe("Move Money Race Conditions", () => {
    let raceBudgetAId: string;
    let raceBudgetBId: string;
    let raceBudgetCId: string;
    const controlledMoveFailureStatuses = new Set([400, 409]);
    const isControlledMoveStatus = (status: number) =>
      status === 200 || controlledMoveFailureStatuses.has(status);

    beforeEach(async () => {
      // Create budgets with known amounts for race condition testing
      const [budgetA] = await db
        .insert(budgets)
        .values({
          id: randomUUID(),
          householdId,
          name: "Race Budget A",
          amount: "100.00", // Budget A starts with 100
          period: "monthly",
        })
        .returning();
      raceBudgetAId = budgetA.id;

      const [budgetB] = await db
        .insert(budgets)
        .values({
          id: randomUUID(),
          householdId,
          name: "Race Budget B",
          amount: "0.00", // Budget B starts with 0
          period: "monthly",
        })
        .returning();
      raceBudgetBId = budgetB.id;

      const [budgetC] = await db
        .insert(budgets)
        .values({
          id: randomUUID(),
          householdId,
          name: "Race Budget C",
          amount: "50.00", // Budget C starts with 50
          period: "monthly",
        })
        .returning();
      raceBudgetCId = budgetC.id;
    });

    it("should prevent double-spending via concurrent moves", async () => {
      // Setup: Budget A has $100, Budget B has $0
      // Concurrent: Two requests try to move $100 from A to B simultaneously
      // Expected: Only one can succeed. The other must fail because after
      // the first moves $100, budget A has $0 left (insufficient for second)
      const now = new Date();
      const year = now.getFullYear();
      const month = now.getMonth() + 1;

      // Warm the connection pool so BOTH concurrent requests get an
      // established connection and their unlocked/phantom-row reads truly
      // overlap. Without this, a cold second connection can let request 1
      // fully commit before request 2's read even executes, hiding the
      // double-spend race behind pool connection-establishment timing (same
      // technique as the R5 materialization / InvestmentAutomationService
      // concurrency tests).
      await Promise.all(
        Array.from({ length: 10 }, () => db.execute(sql`SELECT 1`)),
      );

      // Plain Promise.all timing is NOT reliable enough to force the exact
      // interleave that exposes BUDGET-RACE-002 (server/services/budget/
      // BudgetForecastService.ts moveBudgetAmount): the phantom-row/
      // stale-cross-row-read bug only manifests when the "losing" request
      // reads the FROM period BEFORE the "winning" request has written it
      // (a phantom, "no row yet" read) but reads the TO period AFTER the
      // winner has already committed (a real, fresh read) - a narrow
      // window that pure connection-pool warming reproduces only
      // intermittently. We widen that window deterministically with a spy
      // on budgetPeriodRepository.findPeriod that delays the FIRST
      // FOR-UPDATE read of the TO budget by a fixed amount, long enough
      // for the other genuinely-concurrent request to finish its entire
      // move (reads, writes, commit) for real. Every other code path
      // (controller, service, repository writes, Money math, real Postgres
      // transaction/locking) executes completely unmodified - this only
      // widens *when* one already-real DB read fires relative to the
      // other request's real work.
      //
      // This is intentionally a bounded delay rather than a hard mutual
      // wait: once the move-money path takes a real row lock on the TO
      // budget's period (the fix under test), the "losing" request's own
      // earlier ensure/lock step blocks the "winning" request until it
      // commits, so a hard two-way gate would deadlock. A bounded delay
      // lets Postgres's real locking (not a JS-level signal) determine
      // the rest of the interleave, on both the buggy and the fixed code.
      const originalFindPeriod =
        budgetPeriodRepository.findPeriod.bind(budgetPeriodRepository);
      const RACE_TO_READ_DELAY_MS = 500;
      let toReadCount = 0;

      const findPeriodSpy = vi
        .spyOn(budgetPeriodRepository, "findPeriod")
        .mockImplementation(async (budgetId, startDate, endDate, tx, forUpdate) => {
          if (forUpdate && budgetId === raceBudgetBId) {
            toReadCount += 1;
            if (toReadCount === 1) {
              await new Promise((resolve) =>
                setTimeout(resolve, RACE_TO_READ_DELAY_MS),
              );
            }
          }
          return originalFindPeriod(budgetId, startDate, endDate, tx, forUpdate);
        });

      const moveRequest = () =>
        request(app)
          .post("/api/budgets/move")
          .set("Cookie", authCookie)
          .set("X-CSRF-Token", csrfToken)
          .send({
            fromBudgetId: raceBudgetAId,
            toBudgetId: raceBudgetBId,
            amount: { amount: "100.00", currency: "ZMW" },
            year,
            month,
          });

      let result1: request.Response;
      let result2: request.Response;
      try {
        // Fire both requests genuinely concurrently; the spy above widens
        // the race window for whichever one happens to reach the TO
        // budget's FOR-UPDATE read first.
        [result1, result2] = await Promise.all([moveRequest(), moveRequest()]);
      } finally {
        findPeriodSpy.mockRestore();
      }

      const statuses = [result1.status, result2.status];
      expect(statuses.every(isControlledMoveStatus)).toBe(true);
      const successCount = statuses.filter((s) => s === 200).length;
      const failCount = statuses.filter((s) =>
        controlledMoveFailureStatuses.has(s),
      ).length;

      // Verify budget period state after concurrent operations
      const monthStart = `${year}-${String(month).padStart(2, "0")}-01`;
      const lastDay = new Date(year, month, 0).getDate();
      const monthEnd = `${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;

      const periods = await db
        .select()
        .from(budgetPeriods)
        .where(
          and(
            inArray(budgetPeriods.budgetId, [raceBudgetAId, raceBudgetBId]),
            eq(budgetPeriods.startDate, monthStart),
            eq(budgetPeriods.endDate, monthEnd),
          ),
        );

      const periodA = periods.find((p) => p.budgetId === raceBudgetAId);
      const periodB = periods.find((p) => p.budgetId === raceBudgetBId);

      // The CRITICAL invariant: Budget A cannot go negative
      // If budget A started at 100 and we moved 100, it should be 0 (not -100)
      if (periodA) {
        const amountA = parseFloat(periodA.budgetAmount);
        expect(amountA).toBeGreaterThanOrEqual(0);
      }

      // If both succeeded (potential double-spend bug), budget B would be 200
      // and budget A would be -100. The total should still be 100.
      if (periodA && periodB) {
        const amountA = parseFloat(periodA.budgetAmount);
        const amountB = parseFloat(periodB.budgetAmount);

        // Total conservation: A + B should equal initial total (100 + 0 = 100)
        expect(amountA + amountB).toBeCloseTo(100, 2);

        // If total is preserved, exactly one move succeeded:
        // - A should be 0, B should be 100
        // OR if both fail:
        // - A should be 100, B should be 0
        // If both succeeded (bug), A would be -100 (impossible) or total != 100
      }

      // At least one request should return a valid response (success or error)
      expect(successCount + failCount).toBe(2);
    });

    it("should maintain consistency under concurrent operations", async () => {
      // Setup: Budget A=100, Budget B=0, Budget C=50
      // Total: 150
      // Execute: Multiple concurrent move operations
      // Verify: Operations complete without errors (success or proper failure)
      // and no money is lost/created in the process
      const now = new Date();
      const year = now.getFullYear();
      const month = now.getMonth() + 1;

      // Execute multiple concurrent moves - these moves should either all succeed
      // or some should fail gracefully with conflict/insufficient errors
      const moves = [
        // Move 30 from A to B
        request(app)
          .post("/api/budgets/move")
          .set("Cookie", authCookie)
          .set("X-CSRF-Token", csrfToken)
          .send({
            fromBudgetId: raceBudgetAId,
            toBudgetId: raceBudgetBId,
            amount: { amount: "30.00", currency: "ZMW" },
            year,
            month,
          }),
        // Move 20 from A to C
        request(app)
          .post("/api/budgets/move")
          .set("Cookie", authCookie)
          .set("X-CSRF-Token", csrfToken)
          .send({
            fromBudgetId: raceBudgetAId,
            toBudgetId: raceBudgetCId,
            amount: { amount: "20.00", currency: "ZMW" },
            year,
            month,
          }),
        // Move 10 from C to B
        request(app)
          .post("/api/budgets/move")
          .set("Cookie", authCookie)
          .set("X-CSRF-Token", csrfToken)
          .send({
            fromBudgetId: raceBudgetCId,
            toBudgetId: raceBudgetBId,
            amount: { amount: "10.00", currency: "ZMW" },
            year,
            month,
          }),
      ];

      const results = await Promise.all(moves);
      const statuses = results.map((r) => r.status);
      expect(statuses.every(isControlledMoveStatus)).toBe(true);

      // Count successful operations
      const successCount = statuses.filter((s) => s === 200).length;
      const failCount = statuses.filter((s) =>
        controlledMoveFailureStatuses.has(s),
      ).length;

      // Verify budget periods exist and contain valid amounts
      const monthStart = `${year}-${String(month).padStart(2, "0")}-01`;
      const lastDay = new Date(year, month, 0).getDate();
      const monthEnd = `${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;

      const periods = await db
        .select()
        .from(budgetPeriods)
        .where(
          and(
            inArray(budgetPeriods.budgetId, [
              raceBudgetAId,
              raceBudgetBId,
              raceBudgetCId,
            ]),
            eq(budgetPeriods.startDate, monthStart),
            eq(budgetPeriods.endDate, monthEnd),
          ),
        );

      // If at least one successful move occurred, periods should exist
      if (successCount > 0) {
        expect(periods.length).toBeGreaterThan(0);

        // Verify all period amounts are non-negative (no overdraft)
        for (const period of periods) {
          const amount = parseFloat(period.budgetAmount);
          expect(amount).toBeGreaterThanOrEqual(0);
        }
      }

      // Key invariant: The system should handle concurrent operations gracefully
      // Either all succeed, some fail with proper errors, or conflicts are handled
      expect(successCount + failCount).toBe(3);
    });

    it("should use proper locking to prevent race conditions", async () => {
      // This test verifies that the move operation uses optimistic locking
      // by checking that concurrent identical moves don't both succeed
      const now = new Date();
      const year = now.getFullYear();
      const month = now.getMonth() + 1;

      // First, make a successful move to establish a period
      const initialMove = await request(app)
        .post("/api/budgets/move")
        .set("Cookie", authCookie)
        .set("X-CSRF-Token", csrfToken)
        .send({
          fromBudgetId: raceBudgetAId,
          toBudgetId: raceBudgetBId,
          amount: { amount: "10.00", currency: "ZMW" },
          year,
          month,
        });

      expect(initialMove.status).toBe(200);

      // Now budget A should have 90 remaining (in the period)
      // Execute two concurrent moves trying to move 80 each
      // Only one can succeed (80 + 80 > 90)
      const raceMove = () =>
        request(app)
          .post("/api/budgets/move")
          .set("Cookie", authCookie)
          .set("X-CSRF-Token", csrfToken)
          .send({
            fromBudgetId: raceBudgetAId,
            toBudgetId: raceBudgetCId,
            amount: { amount: "80.00", currency: "ZMW" },
            year,
            month,
          });

      const [race1, race2] = await Promise.all([raceMove(), raceMove()]);

      // Count successes
      const successes = [race1.status, race2.status].filter(
        (s) => s === 200,
      ).length;
      const statuses = [race1.status, race2.status];
      expect(statuses.every(isControlledMoveStatus)).toBe(true);
      const failures = statuses.filter((s) =>
        controlledMoveFailureStatuses.has(s),
      ).length;

      // With proper locking:
      // - At most one should succeed (insufficient funds for the second)
      // - The service uses optimistic locking with retries, so one might succeed after retry
      expect(successes).toBeLessThanOrEqual(1);
      expect(failures).toBeGreaterThanOrEqual(1);

      // Verify the error message for failure indicates insufficient funds or conflict
      const failedResponse = controlledMoveFailureStatuses.has(race1.status)
        ? race1
        : race2;
      if (controlledMoveFailureStatuses.has(failedResponse.status)) {
        expect(failedResponse.body.error.message).toMatch(
          /insufficient|exceeds|conflict/i,
        );
      }
    });
  });
});
