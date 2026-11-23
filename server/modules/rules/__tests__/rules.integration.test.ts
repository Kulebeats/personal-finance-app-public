/**
 * Rules Module - Integration Tests
 *
 * Real database integration tests for CRUD operations, reordering, and apply-to-past functionality.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { db } from "../../../db";
import { eq, or, sql } from "drizzle-orm";
import {
  users,
  households,
  householdMembers,
  rules,
  categoryGroups,
  categories,
  auditLogs,
  session,
} from "@shared/schema";
import {
  createTestUser,
  createTestHousehold,
  getTestApp,
} from "../../../__tests__/fixtures";
import {
  routeUsesMiddleware,
  routerUsesMiddlewareBeforeRoutes,
} from "../../../__tests__/routerStack";
import { hashPassword } from "../../../auth";
import { analyticsLimiter, generalLimiter } from "../../../middleware/rateLimit";
import rulesRouter from "../rules.routes";

describe("Rules Integration Tests", () => {
  let app: Express;
  let authCookie: string;
  let householdId: string;
  let userId: string;
  let categoryId: string;
  let categoryGroupId: string;
  let testUser: any;
  let testHousehold: any;

  beforeAll(async () => {
    // Get app with routes registered
    app = await getTestApp();

    // Use unique timestamp to avoid conflicts from previous failed runs
    const timestamp = Date.now();

    // Create test user and household
    testUser = createTestUser({
      email: `rules-test-${timestamp}@example.com`,
      username: `rules-test-user-${timestamp}`,
    });
    testHousehold = createTestHousehold(testUser.id, {
      name: "Rules Test Household",
    });

    const passwordHash = await hashPassword("TestPassword123");
    testUser.passwordHash = passwordHash;

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
      emailVerified: true,
      mfaEnabled: false,
      failedLoginAttempts: 0,
      lockedUntil: null,
    });

    // Insert household membership (CRITICAL: required for auth context)
    await db.insert(householdMembers).values({
      householdId: testHousehold.id,
      userId: testUser.id,
      role: "owner",
    });

    // Create a category group and category for rules
    const [group] = await db
      .insert(categoryGroups)
      .values({
        householdId: testHousehold.id,
        name: "Test Expenses",
        type: "expenses",
        displayOrder: 1,
      })
      .returning();

    categoryGroupId = group.id;

    const [category] = await db
      .insert(categories)
      .values({
        householdId: testHousehold.id,
        groupId: categoryGroupId,
        name: "Test Category",
        icon: "shopping-cart",
        color: "#FF0000",
        displayOrder: 1,
      })
      .returning();

    categoryId = category.id;

    // Login
    const loginRes = await request(app).post("/api/auth/login").send({
      email: testUser.email,
      password: "TestPassword123",
    });

    authCookie = loginRes.headers["set-cookie"][0];
    userId = testUser.id;
    householdId = testHousehold.id;
  });

  afterAll(async () => {
    // Express sessions outlive their users unless the fixture removes them.
    await db.delete(session).where(or(
      eq(sql<string>`${session.sess}->>'userId'`, userId),
      eq(sql<string>`${session.sess}->>'mfaPendingUserId'`, userId),
    ));
    // Cleanup
    await db.delete(auditLogs).where(eq(auditLogs.householdId, householdId));
    await db.delete(rules).where(eq(rules.householdId, householdId));
    await db.delete(categories).where(eq(categories.groupId, categoryGroupId));
    await db
      .delete(categoryGroups)
      .where(eq(categoryGroups.id, categoryGroupId));
    await db
      .delete(householdMembers)
      .where(eq(householdMembers.userId, userId));
    await db.delete(users).where(eq(users.id, userId));
    await db.delete(households).where(eq(households.id, householdId));
  });

  // ==========================================================================
  // POST /api/rules - Create Rule
  // ==========================================================================
  describe("POST /api/rules", () => {
    it("should create a new rule with valid data", async () => {
      const res = await request(app)
        .post("/api/rules")
        .set("Cookie", authCookie)
        .send({
          name: "Test Rule",
          conditions: [
            {
              type: "merchant_name",
              operator: "contains",
              value: "Amazon",
            },
          ],
          conditionLogic: "all",
          actions: [
            {
              type: "categorize",
              value: categoryId,
            },
          ],
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.rule.name).toBe("Test Rule");

      // Verify in database
      const [rule] = await db
        .select()
        .from(rules)
        .where(eq(rules.id, res.body.data.rule.id));

      expect(rule.name).toBe("Test Rule");
      expect(rule.householdId).toBe(householdId);
      expect(rule.enabled).toBe(true);

      // Cleanup
      await db.delete(rules).where(eq(rules.id, res.body.data.rule.id));
    });

    it("should reject rule with no conditions", async () => {
      const res = await request(app)
        .post("/api/rules")
        .set("Cookie", authCookie)
        .send({
          name: "No Conditions Rule",
          conditions: [],
          actions: [
            {
              type: "categorize",
              value: categoryId,
            },
          ],
        });

      expect(res.status).toBe(400);
    });

    it("should reject rule with no actions", async () => {
      const res = await request(app)
        .post("/api/rules")
        .set("Cookie", authCookie)
        .send({
          name: "No Actions Rule",
          conditions: [
            {
              type: "merchant_name",
              operator: "contains",
              value: "Test",
            },
          ],
          actions: [],
        });

      expect(res.status).toBe(400);
    });

    it("should audit log rule creation", async () => {
      const beforeCount = await db
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.householdId, householdId));

      const res = await request(app)
        .post("/api/rules")
        .set("Cookie", authCookie)
        .send({
          name: "Audit Test Rule",
          conditions: [
            {
              type: "merchant_name",
              operator: "equals",
              value: "TestMerchant",
            },
          ],
          actions: [
            {
              type: "categorize",
              value: categoryId,
            },
          ],
        });

      const afterCount = await db
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.householdId, householdId));

      expect(afterCount.length).toBeGreaterThan(beforeCount.length);

      // Cleanup
      if (res.body.data?.rule?.id) {
        await db.delete(rules).where(eq(rules.id, res.body.data.rule.id));
      }
    });
  });

  // ==========================================================================
  // GET /api/rules - List Rules
  // ==========================================================================
  describe("GET /api/rules", () => {
    it("should return all rules for household", async () => {
      // Create a test rule
      const [rule] = await db
        .insert(rules)
        .values({
          householdId,
          name: "List Test Rule",
          priority: 1,
          conditions: [{ type: "amount", operator: "greater_than", value: "100" }],
          actions: [{ type: "categorize", value: categoryId }],
        })
        .returning();

      const res = await request(app)
        .get("/api/rules")
        .set("Cookie", authCookie);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data.rules)).toBe(true);
      expect(res.body.data.rules.length).toBeGreaterThan(0);

      // Cleanup
      await db.delete(rules).where(eq(rules.id, rule.id));
    });

    it("should return 401 without authentication", async () => {
      const res = await request(app).get("/api/rules");

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });

    it("should not return rules from other households", async () => {
      // Create another household and rule
      const otherHousehold = createTestHousehold(testUser.id, {
        name: "Other Household",
      });

      await db.insert(households).values({
        id: otherHousehold.id,
        name: otherHousehold.name,
        currency: otherHousehold.currency,
      });

      const [otherRule] = await db
        .insert(rules)
        .values({
          householdId: otherHousehold.id,
          name: "Other Household Rule",
          priority: 1,
          conditions: [{ type: "amount", operator: "less_than", value: "50" }],
          actions: [{ type: "set_note", value: "Other note" }],
        })
        .returning();

      const res = await request(app)
        .get("/api/rules")
        .set("Cookie", authCookie);

      const ruleIds = res.body.data.rules.map((r: any) => r.id);
      expect(ruleIds).not.toContain(otherRule.id);

      // Cleanup
      await db.delete(rules).where(eq(rules.id, otherRule.id));
      await db.delete(households).where(eq(households.id, otherHousehold.id));
    });
  });

  // ==========================================================================
  // GET /api/rules/:id - Get Rule by ID
  // ==========================================================================
  describe("GET /api/rules/:id", () => {
    it("should return rule by id", async () => {
      const [rule] = await db
        .insert(rules)
        .values({
          householdId,
          name: "Get By ID Rule",
          priority: 1,
          conditions: [{ type: "description", operator: "contains", value: "test" }],
          actions: [{ type: "set_note", value: "Test note" }],
        })
        .returning();

      const res = await request(app)
        .get(`/api/rules/${rule.id}`)
        .set("Cookie", authCookie);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.rule.id).toBe(rule.id);
      expect(res.body.data.rule.name).toBe("Get By ID Rule");

      // Cleanup
      await db.delete(rules).where(eq(rules.id, rule.id));
    });

    it("should return 404 for non-existent rule", async () => {
      const fakeId = "00000000-0000-0000-0000-000000000000";
      const res = await request(app)
        .get(`/api/rules/${fakeId}`)
        .set("Cookie", authCookie);

      expect(res.status).toBe(404);
    });

    it("should return 404 for rule in different household", async () => {
      // Create another household and rule
      const otherHousehold = createTestHousehold(testUser.id);

      await db.insert(households).values({
        id: otherHousehold.id,
        name: otherHousehold.name,
        currency: otherHousehold.currency,
      });

      const [otherRule] = await db
        .insert(rules)
        .values({
          householdId: otherHousehold.id,
          name: "Cross Household Rule",
          priority: 1,
          conditions: [{ type: "amount", operator: "equals", value: "100" }],
          actions: [{ type: "set_note", value: "Note" }],
        })
        .returning();

      const res = await request(app)
        .get(`/api/rules/${otherRule.id}`)
        .set("Cookie", authCookie);

      expect(res.status).toBe(404);

      // Cleanup
      await db.delete(rules).where(eq(rules.id, otherRule.id));
      await db.delete(households).where(eq(households.id, otherHousehold.id));
    });
  });

  // ==========================================================================
  // PUT /api/rules/:id - Update Rule
  // ==========================================================================
  describe("PUT /api/rules/:id", () => {
    it("should update rule name", async () => {
      const [rule] = await db
        .insert(rules)
        .values({
          householdId,
          name: "Original Name",
          priority: 1,
          conditions: [{ type: "amount", operator: "greater_than", value: "50" }],
          actions: [{ type: "categorize", value: categoryId }],
        })
        .returning();

      const res = await request(app)
        .put(`/api/rules/${rule.id}`)
        .set("Cookie", authCookie)
        .send({
          name: "Updated Name",
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.rule.name).toBe("Updated Name");

      // Verify in database
      const [updatedRule] = await db
        .select()
        .from(rules)
        .where(eq(rules.id, rule.id));

      expect(updatedRule.name).toBe("Updated Name");

      // Cleanup
      await db.delete(rules).where(eq(rules.id, rule.id));
    });

    it("should update rule enabled status", async () => {
      const [rule] = await db
        .insert(rules)
        .values({
          householdId,
          name: "Enable Toggle Rule",
          priority: 1,
          enabled: true,
          conditions: [{ type: "amount", operator: "less_than", value: "10" }],
          actions: [{ type: "set_note", value: "Small amount" }],
        })
        .returning();

      const res = await request(app)
        .put(`/api/rules/${rule.id}`)
        .set("Cookie", authCookie)
        .send({
          enabled: false,
        });

      expect(res.status).toBe(200);
      expect(res.body.data.rule.enabled).toBe(false);

      // Cleanup
      await db.delete(rules).where(eq(rules.id, rule.id));
    });

    it("should audit log rule update", async () => {
      const [rule] = await db
        .insert(rules)
        .values({
          householdId,
          name: "Audit Update Rule",
          priority: 1,
          conditions: [{ type: "description", operator: "equals", value: "test" }],
          actions: [{ type: "set_note", value: "note" }],
        })
        .returning();

      const beforeCount = await db
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.householdId, householdId));

      await request(app)
        .put(`/api/rules/${rule.id}`)
        .set("Cookie", authCookie)
        .send({
          name: "Audit Updated",
        });

      const afterCount = await db
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.householdId, householdId));

      expect(afterCount.length).toBeGreaterThan(beforeCount.length);

      // Cleanup
      await db.delete(rules).where(eq(rules.id, rule.id));
    });
  });

  // ==========================================================================
  // DELETE /api/rules/:id - Delete Rule
  // ==========================================================================
  describe("DELETE /api/rules/:id", () => {
    it("should delete a rule", async () => {
      const [rule] = await db
        .insert(rules)
        .values({
          householdId,
          name: "To Be Deleted",
          priority: 1,
          conditions: [{ type: "amount", operator: "equals", value: "999" }],
          actions: [{ type: "set_note", value: "delete me" }],
        })
        .returning();

      const res = await request(app)
        .delete(`/api/rules/${rule.id}`)
        .set("Cookie", authCookie);

      expect(res.status).toBe(200);

      // Verify deleted
      const deleted = await db.select().from(rules).where(eq(rules.id, rule.id));
      expect(deleted.length).toBe(0);
    });

    it("should audit log rule deletion", async () => {
      const [rule] = await db
        .insert(rules)
        .values({
          householdId,
          name: "Audit Delete Rule",
          priority: 1,
          conditions: [{ type: "amount", operator: "greater_than", value: "1000" }],
          actions: [{ type: "categorize", value: categoryId }],
        })
        .returning();

      const beforeCount = await db
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.householdId, householdId));

      await request(app)
        .delete(`/api/rules/${rule.id}`)
        .set("Cookie", authCookie);

      const afterCount = await db
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.householdId, householdId));

      expect(afterCount.length).toBeGreaterThan(beforeCount.length);
    });
  });

  // ==========================================================================
  // PUT /api/rules/reorder - Reorder Rules
  // ==========================================================================
  describe("PUT /api/rules/reorder", () => {
    it("should reorder rules", async () => {
      // Create three rules
      const [rule1] = await db
        .insert(rules)
        .values({
          householdId,
          name: "Rule 1",
          priority: 1,
          conditions: [{ type: "amount", operator: "greater_than", value: "10" }],
          actions: [{ type: "set_note", value: "1" }],
        })
        .returning();

      const [rule2] = await db
        .insert(rules)
        .values({
          householdId,
          name: "Rule 2",
          priority: 2,
          conditions: [{ type: "amount", operator: "greater_than", value: "20" }],
          actions: [{ type: "set_note", value: "2" }],
        })
        .returning();

      const [rule3] = await db
        .insert(rules)
        .values({
          householdId,
          name: "Rule 3",
          priority: 3,
          conditions: [{ type: "amount", operator: "greater_than", value: "30" }],
          actions: [{ type: "set_note", value: "3" }],
        })
        .returning();

      // Reorder: rule3, rule1, rule2
      const res = await request(app)
        .put("/api/rules/reorder")
        .set("Cookie", authCookie)
        .send({
          rules: [
            { id: rule3.id, priority: 1 },
            { id: rule1.id, priority: 2 },
            { id: rule2.id, priority: 3 },
          ],
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      // Verify priorities updated
      const reorderedRules = await db
        .select()
        .from(rules)
        .where(eq(rules.householdId, householdId));

      const rule1Updated = reorderedRules.find((r: any) => r.id === rule1.id);
      const rule2Updated = reorderedRules.find((r: any) => r.id === rule2.id);
      const rule3Updated = reorderedRules.find((r: any) => r.id === rule3.id);

      expect(rule3Updated?.priority).toBeLessThan(rule1Updated!.priority);
      expect(rule1Updated?.priority).toBeLessThan(rule2Updated!.priority);

      // Cleanup
      await db.delete(rules).where(eq(rules.id, rule1.id));
      await db.delete(rules).where(eq(rules.id, rule2.id));
      await db.delete(rules).where(eq(rules.id, rule3.id));
    });

    it("should audit log reorder action", async () => {
      const [rule1] = await db
        .insert(rules)
        .values({
          householdId,
          name: "Reorder Rule 1",
          priority: 1,
          conditions: [{ type: "amount", operator: "equals", value: "5" }],
          actions: [{ type: "set_note", value: "a" }],
        })
        .returning();

      const beforeCount = await db
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.householdId, householdId));

      await request(app)
        .put("/api/rules/reorder")
        .set("Cookie", authCookie)
        .send({
          rules: [{ id: rule1.id, priority: 1 }],
        });

      const afterCount = await db
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.householdId, householdId));

      expect(afterCount.length).toBeGreaterThan(beforeCount.length);

      // Cleanup
      await db.delete(rules).where(eq(rules.id, rule1.id));
    });
  });

  // ==========================================================================
  // POST /api/rules/preview - Preview Rule
  // ==========================================================================
  describe("POST /api/rules/preview", () => {
    it("should return matching transactions", async () => {
      const res = await request(app)
        .post("/api/rules/preview")
        .set("Cookie", authCookie)
        .send({
          conditions: [
            {
              type: "amount",
              operator: "greater_than",
              value: "100",
            },
          ],
          conditionLogic: "all",
        });

      // Endpoint should return successfully (even if no transactions match)
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data.matchingTransactions)).toBe(true);
    });

    it("should not apply changes (read-only)", async () => {
      // Preview should not modify any data
      const beforeRules = await db
        .select()
        .from(rules)
        .where(eq(rules.householdId, householdId));

      await request(app)
        .post("/api/rules/preview")
        .set("Cookie", authCookie)
        .send({
          conditions: [
            {
              type: "merchant_name",
              operator: "contains",
              value: "Test",
            },
          ],
        });

      const afterRules = await db
        .select()
        .from(rules)
        .where(eq(rules.householdId, householdId));

      // No new rules should be created
      expect(afterRules.length).toBe(beforeRules.length);
    });
  });

  // ==========================================================================
  // Rate Limiting
  // ==========================================================================
  describe("Rate Limiting", () => {
    it("should inherit general quota without a duplicate rules mount", () => {
      expect(routerUsesMiddlewareBeforeRoutes(rulesRouter, generalLimiter)).toBe(
        false,
      );
    });

    it("should use analyticsLimiter for preview endpoint (30 req/min)", () => {
      expect(
        routeUsesMiddleware(rulesRouter, "/preview", "post", analyticsLimiter),
      ).toBe(true);
    });
  });

  // ==========================================================================
  // Cross-Household Authorization
  // ==========================================================================
  describe("Cross-Household Authorization", () => {
    let otherHouseholdId: string;
    let otherRuleId: string;

    beforeAll(async () => {
      // Create another household with a rule
      const otherHousehold = createTestHousehold(testUser.id, {
        name: "Other Rules Household",
      });
      otherHouseholdId = otherHousehold.id;

      await db.insert(households).values({
        id: otherHouseholdId,
        name: otherHousehold.name,
        currency: otherHousehold.currency,
      });

      // Create rule in other household
      const [otherRule] = await db
        .insert(rules)
        .values({
          householdId: otherHouseholdId,
          name: "Other Household Rule",
          priority: 1,
          conditions: [{ type: "amount", operator: "equals", value: "500" }],
          actions: [{ type: "set_note", value: "Other" }],
        })
        .returning();
      otherRuleId = otherRule.id;
    });

    afterAll(async () => {
      await db.delete(rules).where(eq(rules.householdId, otherHouseholdId));
      await db.delete(households).where(eq(households.id, otherHouseholdId));
    });

    it("should not allow updating rule from another household", async () => {
      const res = await request(app)
        .put(`/api/rules/${otherRuleId}`)
        .set("Cookie", authCookie)
        .send({
          name: "Hijacked Rule",
        });

      expect(res.status).toBe(404);

      // Verify rule was not modified
      const [unchanged] = await db
        .select()
        .from(rules)
        .where(eq(rules.id, otherRuleId));
      expect(unchanged.name).toBe("Other Household Rule");
    });

    it("should not allow deleting rule from another household", async () => {
      const res = await request(app)
        .delete(`/api/rules/${otherRuleId}`)
        .set("Cookie", authCookie);

      expect(res.status).toBe(404);

      // Verify rule still exists
      const [stillExists] = await db
        .select()
        .from(rules)
        .where(eq(rules.id, otherRuleId));
      expect(stillExists).toBeDefined();
    });

    it("should not allow getting rule from another household", async () => {
      const res = await request(app)
        .get(`/api/rules/${otherRuleId}`)
        .set("Cookie", authCookie);

      expect(res.status).toBe(404);
    });
  });

  // ==========================================================================
  // INT-RULES-001: Rule Splits → Budget Integration Flow
  // ==========================================================================
  describe("INT-RULES-001: Rule Splits → Budget Integration", () => {
    let account1Id: string;
    let foodCategoryId: string;
    let transportCategoryId: string;

    beforeAll(async () => {
      // Import dependencies for this test suite
      const { accounts, transactions, transactionSplits } = await import("@shared/schema");
      const { budgetRepository } = await import("../../../repositories/BudgetRepository");
      const { transactionRepository } = await import("../../../repositories/TransactionRepository");

      // Create test account
      const [account] = await db
        .insert(accounts)
        .values({
          householdId,
          name: "Test Checking",
          type: "checking",
          balance: "1000.00",
          currency: "ZMW",
        })
        .returning();
      account1Id = account.id;

      // Create food category
      const [foodCategory] = await db
        .insert(categories)
        .values({
          householdId,
          groupId: categoryGroupId,
          name: "Food & Dining",
          icon: "utensils",
          color: "#FF5733",
          displayOrder: 2,
        })
        .returning();
      foodCategoryId = foodCategory.id;

      // Create transport category
      const [transportCategory] = await db
        .insert(categories)
        .values({
          householdId,
          groupId: categoryGroupId,
          name: "Transportation",
          icon: "car",
          color: "#33FF57",
          displayOrder: 3,
        })
        .returning();
      transportCategoryId = transportCategory.id;
    });

    afterAll(async () => {
      const { accounts, transactions } = await import("@shared/schema");

      // Cleanup: delete transactions first (foreign key constraint)
      await db.delete(transactions).where(eq(transactions.accountId, account1Id));
      await db.delete(accounts).where(eq(accounts.id, account1Id));
      await db.delete(categories).where(eq(categories.id, foodCategoryId));
      await db.delete(categories).where(eq(categories.id, transportCategoryId));
    });

    it("should persist rule-generated splits without flagging the parent excluded", async () => {
      const { transactions, transactionSplits } = await import("@shared/schema");

      // Step 1: Create a rule with split action
      const ruleRes = await request(app)
        .post("/api/rules")
        .set("Cookie", authCookie)
        .send({
          name: "Split Uber Rides",
          priority: 1,
          enabled: true,
          conditions: [
            {
              type: "merchant_name",
              operator: "contains",
              value: "Uber",
            },
          ],
          conditionLogic: "all",
          actions: [
            {
              type: "split_transaction",
              value: "splits",
              splitConfig: [
                {
                  categoryId: foodCategoryId,
                  percentage: 60,
                  note: "Food delivery",
                },
                {
                  categoryId: transportCategoryId,
                  percentage: 40,
                  note: "Ride share",
                },
              ],
            },
          ],
        });

      expect(ruleRes.status).toBe(201);
      const ruleId = ruleRes.body.data.rule.id;

      // Step 2: Create a transaction that matches the rule
      const transactionRes = await request(app)
        .post("/api/transactions")
        .set("Cookie", authCookie)
        .send({
          accountId: account1Id,
          name: "Uber Eats - Dinner",
          type: "expense",
          amount: { amount: "100.00", currency: "ZMW" },
          date: "2026-01-15",
        });

      expect(transactionRes.status).toBe(201);
      const transactionId = transactionRes.body.data.id;

      // Step 3: Verify splits were persisted to transaction_splits table
      const splits = await db
        .select()
        .from(transactionSplits)
        .where(eq(transactionSplits.transactionId, transactionId));

      expect(splits.length).toBe(2);
      expect(splits[0].categoryId).toBe(foodCategoryId);
      expect(splits[0].amount).toBe("60.00"); // 60% of 100
      expect(splits[1].categoryId).toBe(transportCategoryId);
      expect(splits[1].amount).toBe("40.00"); // 40% of 100

      // Step 4: Verify parent transaction remains normally visible. Budget and
      // report readers skip the parent lump with NOT EXISTS guards and count
      // the split rows instead.
      const [parentTransaction] = await db
        .select()
        .from(transactions)
        .where(eq(transactions.id, transactionId));

      expect(parentTransaction.isExcludedFromBudget).toBe(false);
      expect(parentTransaction.isExcludedFromReports).toBe(false);

      const { calculateCategorySpentSplit } = await import(
        "../../../repositories/BudgetSpendBatchQueries"
      );
      const spentByCategory = await calculateCategorySpentSplit(
        householdId,
        [foodCategoryId, transportCategoryId],
        "2026-01-01",
        "2026-01-31",
        { kind: "system", purpose: "rule-split-reconciliation-regression" },
        "ZMW",
      );
      expect(
        spentByCategory.find((row) => row.categoryId === foodCategoryId)?.total,
      ).toBe("60.00");
      expect(
        spentByCategory.find((row) => row.categoryId === transportCategoryId)
          ?.total,
      ).toBe("40.00");

      // Cleanup
      await db.delete(transactionSplits).where(eq(transactionSplits.transactionId, transactionId));
      await db.delete(transactions).where(eq(transactions.id, transactionId));
      await db.delete(rules).where(eq(rules.id, ruleId));
    });

    // Regression guard: split parents remain unflagged; non-split reads skip the parent lump and split reads count the rows.
    it("should handle split transactions in budget progress calculations", async () => {
      const { transactions, transactionSplits, budgets } = await import("@shared/schema");

      // Create a budget for Food category
      const budgetRes = await request(app)
        .post("/api/budgets")
        .set("Cookie", authCookie)
        .send({
          name: "Food Budget",
          amount: { amount: "500.00", currency: "ZMW" },
          categoryId: foodCategoryId,
        });

      expect(budgetRes.status).toBe(201);
      const budgetId = budgetRes.body.data.id;

      // Create rule with splits
      const ruleRes = await request(app)
        .post("/api/rules")
        .set("Cookie", authCookie)
        .send({
          name: "Split Groceries",
          priority: 1,
          enabled: true,
          conditions: [
            {
              type: "merchant_name",
              operator: "contains",
              value: "Shoprite",
            },
          ],
          conditionLogic: "all",
          actions: [
            {
              type: "split_transaction",
              value: "splits",
              splitConfig: [
                {
                  categoryId: foodCategoryId,
                  percentage: 70,
                  note: "Groceries",
                },
                {
                  categoryId: transportCategoryId,
                  percentage: 30,
                  note: "Gas",
                },
              ],
            },
          ],
        });

      const ruleId = ruleRes.body.data.rule.id;

      // Create two transactions that match the rule
      const tx1Res = await request(app)
        .post("/api/transactions")
        .set("Cookie", authCookie)
        .send({
          accountId: account1Id,
          name: "Shoprite - Weekly shopping",
          type: "expense",
          amount: { amount: "200.00", currency: "ZMW" },
          date: "2026-01-10",
        });

      const tx2Res = await request(app)
        .post("/api/transactions")
        .set("Cookie", authCookie)
        .send({
          accountId: account1Id,
          name: "Shoprite - Groceries",
          type: "expense",
          amount: { amount: "150.00", currency: "ZMW" },
          date: "2026-01-20",
        });

      const tx1Id = tx1Res.body.data.id;
      const tx2Id = tx2Res.body.data.id;

      // Get budget progress
      const progressRes = await request(app)
        .get("/api/budgets/progress")
        .set("Cookie", authCookie)
        .query({ year: 2026, month: 1 });

      expect(progressRes.status).toBe(200);

      const foodBudget = progressRes.body.data.find(
        (b: { id: string }) => b.id === budgetId
      );
      expect(foodBudget).toBeDefined();

      // Food category should show: 70% of 200 + 70% of 150 = 140 + 105 = 245
      const spent = Number(foodBudget.spent.amount);
      expect(spent).toBeCloseTo(245, 2);

      // Progress should be 245 / 500 = 49% (percentUsed is 0-100)
      const percentUsed = Number(foodBudget.percentUsed);
      expect(percentUsed).toBeCloseTo(49, 1);

      // Cleanup
      await db.delete(transactionSplits).where(eq(transactionSplits.transactionId, tx1Id));
      await db.delete(transactionSplits).where(eq(transactionSplits.transactionId, tx2Id));
      await db.delete(transactions).where(eq(transactions.id, tx1Id));
      await db.delete(transactions).where(eq(transactions.id, tx2Id));
      await db.delete(budgets).where(eq(budgets.id, budgetId));
      await db.delete(rules).where(eq(rules.id, ruleId));
    });

    it("recalculateBudgets sums rule splits per category without parent double-count", async () => {
      const { transactions, transactionSplits, budgets } = await import("@shared/schema");
      const { Money } = await import("../../../core/money");
      const { budgetService } = await import("../../../services/BudgetService");

      const ruleRes = await request(app)
        .post("/api/rules")
        .set("Cookie", authCookie)
        .send({
          name: "Split RecalcMart",
          priority: 1,
          enabled: true,
          conditions: [
            { type: "merchant_name", operator: "contains", value: "RecalcMart" },
          ],
          conditionLogic: "all",
          actions: [
            {
              type: "split_transaction",
              value: "splits",
              splitConfig: [
                { categoryId: foodCategoryId, percentage: 50, note: "food" },
                { categoryId: transportCategoryId, percentage: 50, note: "transport" },
              ],
            },
          ],
        });
      expect(ruleRes.status).toBe(201);
      const ruleId = ruleRes.body.data.rule.id;

      const now = new Date();
      const inWindow = new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 15),
      );
      const dateStr = inWindow.toISOString().slice(0, 10);

      const txRes = await request(app)
        .post("/api/transactions")
        .set("Cookie", authCookie)
        .send({
          accountId: account1Id,
          name: "RecalcMart Groceries",
          type: "expense",
          amount: { amount: "100.00", currency: "ZMW" },
          date: dateStr,
        });
      expect(txRes.status).toBe(201);
      const txId = txRes.body.data.id;

      await db.delete(budgets).where(eq(budgets.householdId, householdId));
      await budgetService.recalculateBudgets(householdId, 3);

      const created = await db
        .select()
        .from(budgets)
        .where(eq(budgets.householdId, householdId));

      const foodBudget = created.find((budget) => budget.categoryId === foodCategoryId);
      const transportBudget = created.find(
        (budget) => budget.categoryId === transportCategoryId,
      );

      expect(foodBudget?.amount).toBe("50.00");
      expect(transportBudget?.amount).toBe("50.00");

      const total = created.reduce(
        (sum, budget) => {
          if (budget.amount === null) throw new Error("Legacy direct recalculation must create a recurring default");
          return sum.add(new Money(budget.amount, "ZMW"));
        },
        Money.zero("ZMW"),
      );
      expect(total.toString()).toBe("100.00");

      await db.delete(budgets).where(eq(budgets.householdId, householdId));
      await db
        .delete(transactionSplits)
        .where(eq(transactionSplits.transactionId, txId));
      await db.delete(transactions).where(eq(transactions.id, txId));
      await db.delete(rules).where(eq(rules.id, ruleId));
    });

    it("spending breakdown attributes rule splits without double-counting the parent", async () => {
      const { transactions, transactionSplits } = await import("@shared/schema");
      const { spendingReportRepository } = await import(
        "../../../repositories/reports/SpendingReportRepository"
      );
      const { reportsSpendingBreakdownQuerySchema } = await import(
        "../../reports/reports.validation"
      );

      const ruleRes = await request(app)
        .post("/api/rules")
        .set("Cookie", authCookie)
        .send({
          name: "Split ReportMart",
          priority: 1,
          enabled: true,
          conditions: [
            { type: "merchant_name", operator: "contains", value: "ReportMart" },
          ],
          conditionLogic: "all",
          actions: [
            {
              type: "split_transaction",
              value: "splits",
              splitConfig: [
                { categoryId: foodCategoryId, percentage: 50, note: "food" },
                { categoryId: transportCategoryId, percentage: 50, note: "transport" },
              ],
            },
          ],
        });
      expect(ruleRes.status).toBe(201);
      const ruleId = ruleRes.body.data.rule.id;

      const txRes = await request(app)
        .post("/api/transactions")
        .set("Cookie", authCookie)
        .send({
          accountId: account1Id,
          name: "ReportMart Shop",
          type: "expense",
          amount: { amount: "200.00", currency: "ZMW" },
          date: "2026-02-15",
        });
      expect(txRes.status).toBe(201);
      const txId = txRes.body.data.id;

      const query = reportsSpendingBreakdownQuerySchema.parse({
        from: "2026-02-01",
        to: "2026-02-28",
        groupBy: "category",
        type: "expense",
      });
      const breakdown = await spendingReportRepository.getSpendingBreakdown(
        householdId,
        { ...query, userId },
      );

      const food = breakdown.items.find((item) => item.entityId === foodCategoryId);
      const transport = breakdown.items.find(
        (item) => item.entityId === transportCategoryId,
      );

      expect(food?.value.amount).toBe("100.00");
      expect(transport?.value.amount).toBe("100.00");
      expect(breakdown.total.amount).toBe("200.00");

      await db
        .delete(transactionSplits)
        .where(eq(transactionSplits.transactionId, txId));
      await db.delete(transactions).where(eq(transactions.id, txId));
      await db.delete(rules).where(eq(rules.id, ruleId));
    });

    it("transactions and sankey reports count a rule-split purchase by its splits, never the parent amount too (NEW-14)", async () => {
      const { transactions, transactionSplits } = await import("@shared/schema");

      const ruleRes = await request(app)
        .post("/api/rules")
        .set("Cookie", authCookie)
        .send({
          name: "Split ReportGuard",
          priority: 1,
          enabled: true,
          conditions: [
            { type: "merchant_name", operator: "contains", value: "ReportGuard" },
          ],
          conditionLogic: "all",
          actions: [
            {
              type: "split_transaction",
              value: "splits",
              splitConfig: [
                { categoryId: foodCategoryId, percentage: 50, note: "food" },
                { categoryId: transportCategoryId, percentage: 50, note: "transport" },
              ],
            },
          ],
        });
      expect(ruleRes.status).toBe(201);
      const ruleId = ruleRes.body.data.rule.id;

      const splitTxRes = await request(app)
        .post("/api/transactions")
        .set("Cookie", authCookie)
        .send({
          accountId: account1Id,
          name: "ReportGuard Store",
          type: "expense",
          amount: { amount: "100.00", currency: "ZMW" },
          date: "2026-04-10",
          categoryId: foodCategoryId,
        });
      expect(splitTxRes.status).toBe(201);
      const splitTxId = splitTxRes.body.data.id;

      const txReport = await request(app)
        .get("/api/reports/transactions?from=2026-04-01&to=2026-04-30&type=expense")
        .set("Cookie", authCookie);
      expect(txReport.status).toBe(200);
      const splitRows = (txReport.body.data.items as Array<{ id: string; splitId?: string | null; amount: { amount: string }; category?: { id: string } | null }>)
        .filter((item) => item.id === splitTxId)
        .map((item) => [item.category?.id, item.amount.amount, typeof item.splitId])
        .sort();
      expect(splitRows).toEqual([[foodCategoryId, "50.00", "string"], [transportCategoryId, "50.00", "string"]].sort());

      const sankey = await request(app)
        .get("/api/reports/sankey?from=2026-04-01&to=2026-04-30&mode=expense_groups_to_categories")
        .set("Cookie", authCookie);
      expect(sankey.status).toBe(200);
      const categoryLinks = (sankey.body.data.sankey.links as Array<{ value: { amount: string }; meta?: { entityId?: string } }>)
        .filter((link) => link.meta?.entityId === foodCategoryId || link.meta?.entityId === transportCategoryId);
      expect(categoryLinks.map((link) => link.value.amount).sort()).toEqual(["50.00", "50.00"]);

      await db
        .delete(transactionSplits)
        .where(eq(transactionSplits.transactionId, splitTxId));
      await db.delete(transactions).where(eq(transactions.id, splitTxId));
      await db.delete(rules).where(eq(rules.id, ruleId));
    });
  });
});
