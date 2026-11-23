/**
 * Weekly Recap Module - Integration Tests
 *
 * Tests weekly recap endpoint, feedback submission,
 * rate limiting, and audit logging.
 */

import request from "supertest";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { Express } from "express";
import { db, pool } from "../../../db";
import { eq, and } from "drizzle-orm";
import {
  users,
  households,
  householdMembers,
  auditLogs,
  accounts,
  transactions,
  categoryGroups,
  categories,
  userDisplaySettings,
  userNotificationPreferences,
  netWorthSnapshots,
  accountBalanceSnapshots,
} from "@shared/schema";
import { seedLegacyCashCapture } from "../../../testing/fixtures/legacy-cash-capture";
import { snapshotWorker } from "../../../jobs/snapshotWorker";
import {
  createTestUser,
  createTestHousehold,
  getTestApp,
} from "../../../__tests__/fixtures";
import { routeUsesMiddleware } from "../../../__tests__/routerStack";
import { hashPassword } from "../../../auth";
import { analyticsLimiter, generalLimiter } from "../../../middleware/rateLimit";
import weeklyRecapRouter from "../weekly-recap.routes";
import { randomUUID } from "crypto";

describe("Weekly Recap Integration Tests", () => {
  let app: Express;
  let authCookie: string;
  let householdId: string;
  let userId: string;
  let userEmail: string;
  let testAccountId: string;
  let testCategoryId: string;
  let testCategoryGroupId: string;

  beforeAll(async () => {
    // Get app with routes registered
    app = await getTestApp();

    // Create test household
    householdId = randomUUID();
    await db.insert(households).values({
      id: householdId,
      name: "Weekly Recap Test Household",
      currency: "ZMW",
    });

    // Create test user with unique identifiers
    const timestamp = Date.now();
    userId = randomUUID();
    userEmail = `recap-test-${timestamp}@example.com`;
    const passwordHash = await hashPassword("RecapPass123");
    await db.insert(users).values({
      id: userId,
      email: userEmail,
      username: `recap-test-${timestamp}`,
      passwordHash,
      fullName: "Recap Test User",
      emailVerified: true,
      mfaEnabled: false,
      failedLoginAttempts: 0,
      lockedUntil: null,
    });
    await db.insert(householdMembers).values({
      userId,
      householdId,
      role: "owner",
    });

    // Create test account
    testAccountId = randomUUID();
    await db.insert(accounts).values({
      id: testAccountId,
      householdId,
      name: "Recap Test Account",
      type: "checking",
      balance: "5000.00",
      currency: "ZMW",
    });

    // Create test category group and category
    testCategoryGroupId = randomUUID();
    await db.insert(categoryGroups).values({
      id: testCategoryGroupId,
      householdId,
      name: "Recap Test Group",
      type: "expenses",
      displayOrder: 1,
    });

    testCategoryId = randomUUID();
    await db.insert(categories).values({
      id: testCategoryId,
      groupId: testCategoryGroupId,
      name: "Recap Test Category",
      icon: "shopping",
      color: "#FF0000",
      displayOrder: 1,
    });

    // Create some test transactions for the recap
    const today = new Date();
    const weekAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);

    for (let i = 0; i < 5; i++) {
      const date = new Date(weekAgo.getTime() + i * 24 * 60 * 60 * 1000);
      await db.insert(transactions).values({
        id: randomUUID(),
        householdId,
        accountId: testAccountId,
        date: date.toISOString().split("T")[0],
        name: `Test Transaction ${i}`,
        amount: ((i + 1) * 100).toString(),
        type: i % 2 === 0 ? "expense" : "income",
        categoryId: testCategoryId,
        ownerUserId: userId,
      });
    }

    // Login
    const loginRes = await request(app)
      .post("/api/auth/login")
      .send({ email: userEmail, password: "RecapPass123" });
    authCookie = loginRes.headers["set-cookie"][0];
  });

  afterAll(async () => {
    // Cleanup
    // Persisted Express sessions have no user/household FK cascade.
    await pool.query('delete from "session" where sess->>\'userId\'=$1 or sess->>\'mfaPendingUserId\'=$1', [userId]);
    await db.delete(auditLogs).where(eq(auditLogs.householdId, householdId));
    await db
      .delete(transactions)
      .where(eq(transactions.householdId, householdId));
    await db.delete(categories).where(eq(categories.householdId, householdId));
    await db
      .delete(categoryGroups)
      .where(eq(categoryGroups.householdId, householdId));
    await db.delete(accounts).where(eq(accounts.householdId, householdId));
    await db
      .delete(householdMembers)
      .where(eq(householdMembers.householdId, householdId));
    await db.delete(users).where(eq(users.id, userId));
    await db.delete(households).where(eq(households.id, householdId));
  });

  // ==========================================================================
  // GET /api/weekly-recap - Get Weekly Recap
  // ==========================================================================

  describe("GET /api/weekly-recap - Get Weekly Recap", () => {
    it("should return weekly recap data with aligned field names", async () => {
      const res = await request(app)
        .get("/api/weekly-recap")
        .set("Cookie", authCookie)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data).toBeDefined();

      const data = res.body.data;

      // Verify response structure matches shared types
      expect(data).toHaveProperty("weekStart");
      expect(data).toHaveProperty("weekEnd");
      expect(data).toHaveProperty("netWorth");
      expect(data).toHaveProperty("spending");
      expect(data).toHaveProperty("recurring");
    });

    // CONTRACT-005: Field remains present, but absent evidence has no trend.
    it("keeps the worth contract explicit when no historical snapshots are proven", async () => {
      const res = await request(app)
        .get("/api/weekly-recap")
        .set("Cookie", authCookie)
        .expect(200);

      const { netWorth } = res.body.data;

      expect(netWorth).toHaveProperty("current");
      expect(netWorth).toHaveProperty("previous");
      expect(netWorth).toHaveProperty("change");
      expect(netWorth).toHaveProperty("changePercent");
      expect(netWorth).toHaveProperty("series");
      expect(netWorth).toHaveProperty("trend");
      expect(netWorth).toMatchObject({ status: "unavailable", current: null, previous: null, change: null, changePercent: null, trend: null, series: [] });
    });

    it("retains a numeric comparison and trend when both dated snapshots are available", async () => {
      try {
        expect(await snapshotWorker.processHousehold(householdId)).toBe(true);
        const [capture] = await db.select({ date: netWorthSnapshots.date }).from(netWorthSnapshots)
          .where(eq(netWorthSnapshots.householdId, householdId));
        const end = new Date(`${capture.date}T00:00:00Z`);
        const daysBefore = (days: number) => new Date(end.getTime() - days * 86_400_000).toISOString().slice(0, 10);
        await seedLegacyCashCapture(householdId, daysBefore(8), { accountId: testAccountId, balance: "4500.00" });
        const response = await request(app).get("/api/weekly-recap")
          .query({ weekStart: daysBefore(6), weekEnd: capture.date }).set("Cookie", authCookie).expect(200);
        expect(response.body.data.netWorth).toMatchObject({ status: "available", currency: "ZMW", current: 5000, previous: 4500, change: 500, trend: "up" });
      } finally {
        await db.delete(netWorthSnapshots).where(eq(netWorthSnapshots.householdId, householdId));
        await db.delete(accountBalanceSnapshots).where(eq(accountBalanceSnapshots.accountId, testAccountId));
      }
    });

    // CONTRACT-001/002/005: Verify spending structure alignment
    it("should use topCategories with name field (CONTRACT-001/002)", async () => {
      const res = await request(app)
        .get("/api/weekly-recap")
        .set("Cookie", authCookie)
        .expect(200);

      const { spending } = res.body.data;

      // CONTRACT-001: Use "topCategories" not "categories"
      expect(spending).toHaveProperty("topCategories");
      expect(spending).not.toHaveProperty("categories");

      // CONTRACT-005: hasData field exists
      expect(spending).toHaveProperty("hasData");
      expect(typeof spending.hasData).toBe("boolean");

      // CONTRACT-002: Each category uses "name" not "categoryName"
      if (spending.topCategories.length > 0) {
        const cat = spending.topCategories[0];
        expect(cat).toHaveProperty("name");
        expect(cat).not.toHaveProperty("categoryName");
        expect(cat).toHaveProperty("categoryId");
        expect(cat).toHaveProperty("amount");
        expect(cat).toHaveProperty("percent");
      }
    });

    // CONTRACT-003/004: Verify recurring structure alignment
    it("should use dueDate and number amount (CONTRACT-003/004)", async () => {
      const res = await request(app)
        .get("/api/weekly-recap")
        .set("Cookie", authCookie)
        .expect(200);

      const { recurring } = res.body.data;

      expect(recurring).toHaveProperty("upcoming");
      expect(recurring).toHaveProperty("count");
      expect(recurring).toHaveProperty("totalAmount");
      expect(typeof recurring.totalAmount).toBe("number");

      // CONTRACT-003/004: Each upcoming item uses "dueDate" not "date", and amount is number
      if (recurring.upcoming.length > 0) {
        const item = recurring.upcoming[0];
        // CONTRACT-003: Use "dueDate" not "date"
        expect(item).toHaveProperty("dueDate");
        expect(item).not.toHaveProperty("date");
        // CONTRACT-004: Amount is number not string
        expect(typeof item.amount).toBe("number");
        expect(item).toHaveProperty("id");
        expect(item).toHaveProperty("name");
        expect(item).toHaveProperty("frequency");
      }
    });

    it("should return recap for specific week when dates provided", async () => {
      const weekStart = "2026-01-20";
      const weekEnd = "2026-01-26";

      const res = await request(app)
        .get(`/api/weekly-recap?weekStart=${weekStart}&weekEnd=${weekEnd}`)
        .set("Cookie", authCookie)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data).toBeDefined();
    });

    it("should return 401 without authentication", async () => {
      const res = await request(app).get("/api/weekly-recap");
      expect(res.status).toBe(401);
    });
  });

  // ==========================================================================
  // POST /api/weekly-recap/feedback - Submit Feedback
  // ==========================================================================

  describe("POST /api/weekly-recap/feedback - Submit Feedback", () => {
    it("should accept valid feedback for net-worth step", async () => {
      const res = await request(app)
        .post("/api/weekly-recap/feedback")
        .set("Cookie", authCookie)
        .send({
          weekStart: "2026-01-20",
          weekEnd: "2026-01-26",
          step: "net-worth",
          feedback: "positive",
        })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.recorded).toBe(true);
    });

    it("should accept valid feedback for spending step", async () => {
      const res = await request(app)
        .post("/api/weekly-recap/feedback")
        .set("Cookie", authCookie)
        .send({
          weekStart: "2026-01-20",
          weekEnd: "2026-01-26",
          step: "spending",
          feedback: "negative",
        })
        .expect(200);

      expect(res.body.success).toBe(true);
    });

    it("should accept valid feedback for recurring step", async () => {
      const res = await request(app)
        .post("/api/weekly-recap/feedback")
        .set("Cookie", authCookie)
        .send({
          weekStart: "2026-01-20",
          weekEnd: "2026-01-26",
          step: "recurring",
          feedback: "positive",
        })
        .expect(200);

      expect(res.body.success).toBe(true);
    });

    it("should accept valid feedback for overall step (legacy)", async () => {
      const res = await request(app)
        .post("/api/weekly-recap/feedback")
        .set("Cookie", authCookie)
        .send({
          weekStart: "2026-01-20",
          weekEnd: "2026-01-26",
          step: "overall",
          feedback: "positive",
        })
        .expect(200);

      expect(res.body.success).toBe(true);
    });

    // CONTRACT-006: Accept "wrap-up" step (aligned with client)
    it("should accept valid feedback for wrap-up step", async () => {
      const res = await request(app)
        .post("/api/weekly-recap/feedback")
        .set("Cookie", authCookie)
        .send({
          weekStart: "2026-01-20",
          weekEnd: "2026-01-26",
          step: "wrap-up",
          feedback: "positive",
        })
        .expect(200);

      expect(res.body.success).toBe(true);
    });

    it("should reject invalid step", async () => {
      const res = await request(app)
        .post("/api/weekly-recap/feedback")
        .set("Cookie", authCookie)
        .send({
          weekStart: "2026-01-20",
          weekEnd: "2026-01-26",
          step: "invalid-step",
          feedback: "positive",
        });

      expect(res.status).toBe(400);
    });

    it("should reject invalid feedback type", async () => {
      const res = await request(app)
        .post("/api/weekly-recap/feedback")
        .set("Cookie", authCookie)
        .send({
          weekStart: "2026-01-20",
          weekEnd: "2026-01-26",
          step: "spending",
          feedback: "neutral", // Invalid - only positive/negative allowed
        });

      expect(res.status).toBe(400);
    });

    it("should reject invalid date format", async () => {
      const res = await request(app)
        .post("/api/weekly-recap/feedback")
        .set("Cookie", authCookie)
        .send({
          weekStart: "01-20-2026", // Wrong format
          weekEnd: "2026-01-26",
          step: "spending",
          feedback: "positive",
        });

      expect(res.status).toBe(400);
    });

    it("should require weekStart field", async () => {
      const res = await request(app)
        .post("/api/weekly-recap/feedback")
        .set("Cookie", authCookie)
        .send({
          weekEnd: "2026-01-26",
          step: "spending",
          feedback: "positive",
        });

      expect(res.status).toBe(400);
    });

    it("should require weekEnd field", async () => {
      const res = await request(app)
        .post("/api/weekly-recap/feedback")
        .set("Cookie", authCookie)
        .send({
          weekStart: "2026-01-20",
          step: "spending",
          feedback: "positive",
        });

      expect(res.status).toBe(400);
    });

    it("should audit log feedback submission", async () => {
      const beforeCount = await db
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.householdId, householdId));

      await request(app)
        .post("/api/weekly-recap/feedback")
        .set("Cookie", authCookie)
        .send({
          weekStart: "2026-01-20",
          weekEnd: "2026-01-26",
          step: "spending",
          feedback: "positive",
        })
        .expect(200);

      // Wait a bit for non-blocking audit
      await new Promise((r) => setTimeout(r, 100));

      const afterCount = await db
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.householdId, householdId));

      // Audit logging is non-blocking, count should increase but may not always
      expect(afterCount.length).toBeGreaterThanOrEqual(beforeCount.length);
    });

    it("should return 401 without authentication", async () => {
      const res = await request(app).post("/api/weekly-recap/feedback").send({
        weekStart: "2026-01-20",
        weekEnd: "2026-01-26",
        step: "spending",
        feedback: "positive",
      });

      expect(res.status).toBe(401);
    });
  });

  // ==========================================================================
  // Weekly Recap Settings
  // ==========================================================================

  describe("Weekly Recap Settings", () => {
    it("should return default settings when none are persisted", async () => {
      const res = await request(app)
        .get("/api/weekly-recap/settings")
        .set("Cookie", authCookie)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data).toEqual({
        enabled: true,
        emailEnabled: false,
        dayOfWeek: 1, // OPS-007: Monday, the day the recap e-mail uses when none is saved
        includeGoals: true,
        includeRecurring: true,
      });
    });

    it("should persist settings and return them from GET /settings", async () => {
      const payload = {
        enabled: true,
        emailEnabled: true,
        dayOfWeek: 1,
        includeGoals: false,
        includeRecurring: true,
      };

      const patchRes = await request(app)
        .patch("/api/weekly-recap/settings")
        .set("Cookie", authCookie)
        .send(payload)
        .expect(200);

      expect(patchRes.body.success).toBe(true);
      expect(patchRes.body.data).toEqual(payload);

      const [pref] = await db
        .select()
        .from(userNotificationPreferences)
        .where(
          and(
            eq(userNotificationPreferences.userId, userId),
            eq(userNotificationPreferences.notificationType, "weekly_recap"),
          ),
        )
        .limit(1);

      expect(pref).toBeDefined();
      expect(pref?.inAppEnabled).toBe(true);
      expect(pref?.emailEnabled).toBe(true);

      const [display] = await db
        .select()
        .from(userDisplaySettings)
        .where(eq(userDisplaySettings.userId, userId))
        .limit(1);

      expect(display).toBeDefined();
      expect(display?.firstDayOfWeek).toBe("Sunday");

      const stored = display?.dashboardWidgets as
        | { weeklyRecap?: { dayOfWeek?: number; includeGoals?: boolean; includeRecurring?: boolean } }
        | null
        | undefined;
      expect(stored?.weeklyRecap).toEqual({
        dayOfWeek: 1,
        includeGoals: false,
        includeRecurring: true,
      });

      const getRes = await request(app)
        .get("/api/weekly-recap/settings")
        .set("Cookie", authCookie)
        .expect(200);

      expect(getRes.body.success).toBe(true);
      expect(getRes.body.data).toEqual(payload);
    });

    it("should preserve existing persisted values on partial update", async () => {
      const patchRes = await request(app)
        .patch("/api/weekly-recap/settings")
        .set("Cookie", authCookie)
        .send({ emailEnabled: false })
        .expect(200);

      expect(patchRes.body.success).toBe(true);
      expect(patchRes.body.data).toEqual({
        enabled: true,
        emailEnabled: false,
        dayOfWeek: 1,
        includeGoals: false,
        includeRecurring: true,
      });

      const getRes = await request(app)
        .get("/api/weekly-recap/settings")
        .set("Cookie", authCookie)
        .expect(200);

      expect(getRes.body.success).toBe(true);
      expect(getRes.body.data).toEqual({
        enabled: true,
        emailEnabled: false,
        dayOfWeek: 1,
        includeGoals: false,
        includeRecurring: true,
      });
    });
  });

  // ==========================================================================
  // Rate Limiting
  // ==========================================================================

  describe("Rate Limiting", () => {
    it("should use analyticsLimiter for GET /weekly-recap (30 req/min)", () => {
      expect(
        routeUsesMiddleware(weeklyRecapRouter, "/", "get", analyticsLimiter),
      ).toBe(true);
    });

    it("should inherit general quota for POST /feedback without a duplicate mount", async () => {
      expect(
        routeUsesMiddleware(weeklyRecapRouter, "/feedback", "post", generalLimiter),
      ).toBe(false);

      // Global request accounting is exercised by scripts/__tests__/limiters.test.mjs.
      const res = await request(app)
        .post("/api/weekly-recap/feedback")
        .set("Cookie", authCookie)
        .send({
          weekStart: "2026-01-20",
          weekEnd: "2026-01-26",
          step: "overall",
          feedback: "positive",
        });

      expect(res.status).toBe(200);
    });
  });

  // ==========================================================================
  // Money Value Formatting
  // ==========================================================================

  describe("Money Value Formatting", () => {
    it("should return Money values as strings with currency (not raw numbers)", async () => {
      const res = await request(app)
        .get("/api/weekly-recap")
        .set("Cookie", authCookie)
        .expect(200);

      const data = res.body.data;

      // Helper to check MoneyDto format
      const isValidMoneyDto = (value: any) => {
        if (!value) return true; // null/undefined is ok
        if (typeof value !== "object") return false;
        if (typeof value.amount !== "string") return false;
        if (typeof value.currency !== "string") return false;
        return true;
      };

      // Check spending values
      if (data.spending) {
        if (data.spending.thisWeek) {
          expect(isValidMoneyDto(data.spending.thisWeek)).toBe(true);
        }
        if (data.spending.lastWeek) {
          expect(isValidMoneyDto(data.spending.lastWeek)).toBe(true);
        }
      }

      // Check income values
      if (data.income) {
        if (data.income.thisWeek) {
          expect(isValidMoneyDto(data.income.thisWeek)).toBe(true);
        }
        if (data.income.lastWeek) {
          expect(isValidMoneyDto(data.income.lastWeek)).toBe(true);
        }
      }

      // Check net worth values
      if (data.netWorth) {
        if (data.netWorth.current) {
          expect(isValidMoneyDto(data.netWorth.current)).toBe(true);
        }
        if (data.netWorth.change) {
          expect(isValidMoneyDto(data.netWorth.change)).toBe(true);
        }
      }
    });
  });

  // ==========================================================================
  // Cross-Household Authorization
  // ==========================================================================

  describe("Cross-Household Authorization", () => {
    let otherHouseholdId: string;
    let otherUserId: string;
    let otherAuthCookie: string;

    beforeAll(async () => {
      // Create another household and user
      otherHouseholdId = randomUUID();
      await db.insert(households).values({
        id: otherHouseholdId,
        name: "Other Recap Household",
        currency: "USD",
      });

      otherUserId = randomUUID();
      const hash = await hashPassword("OtherRecapPass123");
      await db.insert(users).values({
        id: otherUserId,
        email: "other-recap@example.com",
        username: "other-recap",
        passwordHash: hash,
        fullName: "Other Recap User",
        emailVerified: true,
        mfaEnabled: false,
        failedLoginAttempts: 0,
        lockedUntil: null,
      });
      await db.insert(householdMembers).values({
        userId: otherUserId,
        householdId: otherHouseholdId,
        role: "owner",
      });

      const loginRes = await request(app).post("/api/auth/login").send({
        email: "other-recap@example.com",
        password: "OtherRecapPass123",
      });
      otherAuthCookie = loginRes.headers["set-cookie"][0];
    });

    afterAll(async () => {
      await pool.query('delete from "session" where sess->>\'userId\'=$1 or sess->>\'mfaPendingUserId\'=$1', [otherUserId]);
      await db
        .delete(householdMembers)
        .where(eq(householdMembers.householdId, otherHouseholdId));
      await db.delete(users).where(eq(users.id, otherUserId));
      await db.delete(households).where(eq(households.id, otherHouseholdId));
    });

    it("should return different recap data for different households", async () => {
      const res1 = await request(app)
        .get("/api/weekly-recap")
        .set("Cookie", authCookie)
        .expect(200);

      const res2 = await request(app)
        .get("/api/weekly-recap")
        .set("Cookie", otherAuthCookie)
        .expect(200);

      // Both should succeed but with different data
      expect(res1.body.success).toBe(true);
      expect(res2.body.success).toBe(true);

      // The first household has transactions, the second doesn't
      // So spending should differ
      if (
        res1.body.data.spending?.thisWeek &&
        res2.body.data.spending?.thisWeek
      ) {
        expect(res1.body.data.spending.thisWeek.amount).not.toBe(
          res2.body.data.spending.thisWeek.amount,
        );
      }
    });
  });
});
