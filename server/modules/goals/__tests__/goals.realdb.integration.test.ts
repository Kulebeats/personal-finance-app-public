/**
 * Goals Module - REAL-DB HTTP Integration Tests (SCP-316)
 *
 * Audit gap (§3.11): Goals had ZERO real-DB HTTP tests. The household-scoping
 * and audit-row writes claimed "verified" were unproven for this module.
 *
 * These tests issue REAL HTTP requests through the Express stack against REAL
 * Postgres (no mocks): login -> session cookie -> request -> assert via Drizzle.
 * They prove:
 *   - POST /api/goals creates a save_up goal and writes a CREATE audit row.
 *   - POST /api/goals/:id/contribute increases currentAmount and writes an
 *     UPDATE audit row (financial write -> Rule 9 audit requirement).
 *   - A goal owned by another household is invisible (404) and cannot be
 *     contributed to (household scoping, Rule 11).
 *
 * NODE_ENV=test disables CSRF (see server/app.ts), so only the session cookie
 * is required. Tests clean up everything they create in afterAll.
 *
 * @module modules/goals/__tests__/goals.realdb.integration.test
 */

import request from "supertest";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { Express } from "express";
import { db } from "../../../db";
import { eq, and } from "drizzle-orm";
import {
  users,
  households,
  householdMembers,
  accounts,
  goals,
  goalContributions,
  auditLogs,
} from "@shared/schema";
import {
  getTestApp,
  createTestUser,
  createTestHousehold,
} from "../../../__tests__/fixtures";
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

describe("Goals REAL-DB HTTP Integration (SCP-316)", () => {
  let app: Express;
  let authCookie: string;
  let householdId: string;
  let userId: string;

  // Second household used to prove cross-household scoping (Rule 11).
  let otherHouseholdId: string;
  let otherUserId: string;

  const timestamp = Date.now();

  beforeAll(async () => {
    app = await getTestApp();

    // --- Primary household + user ---
    const testUser = createTestUser({
      email: `goals-realdb-${timestamp}@example.com`,
      username: `goals-realdb-user-${timestamp}`,
    });
    const testHousehold = createTestHousehold(testUser.id, {
      name: "Goals RealDB Household",
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

    // --- Second household + user (no shared membership) ---
    const otherUser = createTestUser({
      email: `goals-realdb-other-${timestamp}@example.com`,
      username: `goals-realdb-other-${timestamp}`,
    });
    const otherHousehold = createTestHousehold(otherUser.id, {
      name: "Goals RealDB Other Household",
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

    const loginRes = await request(app)
      .post("/api/auth/login")
      .send({ email: testUser.email, password: "TestPassword123" })
      .expect(200);
    authCookie = loginRes.headers["set-cookie"]
      ? (loginRes.headers["set-cookie"] as unknown as string[]).join("; ")
      : "";
  });

  afterAll(async () => {
    try {
      // goalContributions cascade off goals, but delete explicitly to be safe.
      const ownGoals = await db
        .select({ id: goals.id })
        .from(goals)
        .where(eq(goals.householdId, householdId));
      for (const g of ownGoals) {
        await db
          .delete(goalContributions)
          .where(eq(goalContributions.goalId, g.id));
      }
      await db.delete(auditLogs).where(eq(auditLogs.householdId, householdId));
      await db
        .delete(auditLogs)
        .where(eq(auditLogs.householdId, otherHouseholdId));
      await db.delete(goals).where(eq(goals.householdId, householdId));
      await db.delete(goals).where(eq(goals.householdId, otherHouseholdId));
      await db
        .delete(householdMembers)
        .where(eq(householdMembers.householdId, householdId));
      await db
        .delete(householdMembers)
        .where(eq(householdMembers.householdId, otherHouseholdId));
      await db.delete(users).where(eq(users.id, userId));
      await db.delete(users).where(eq(users.id, otherUserId));
      await db.delete(households).where(eq(households.id, householdId));
      await db.delete(households).where(eq(households.id, otherHouseholdId));
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error("Goals SCP-316 cleanup error", error);
    }
  });

  // Seed a goal directly in the DB for the given household.
  async function seedGoal(
    targetHouseholdId: string,
    overrides?: { name?: string; targetAmount?: string; currentAmount?: string },
  ): Promise<string> {
    const id = randomUUID();
    await db.insert(goals).values({
      id,
      householdId: targetHouseholdId,
      name: overrides?.name ?? `seed-goal-${id.slice(0, 8)}`,
      targetAmount: overrides?.targetAmount ?? "1000.00",
      currentAmount: overrides?.currentAmount ?? "0",
      currency: "ZMW",
      type: "save_up",
      goalType: "other",
    });
    return id;
  }

  describe("POST /api/goals (create)", () => {
    it("creates a save_up goal over real HTTP and persists it", async () => {
      const res = await request(app)
        .post("/api/goals")
        .set("Cookie", authCookie)
        .send({
          name: "Vacation Fund",
          type: "save_up",
          goalType: "vacation",
          targetAmount: { amount: "5000.00", currency: "ZMW" },
        })
        .expect(201);

      expect(res.body.success).toBe(true);
      expect(res.body.data.name).toBe("Vacation Fund");

      const goalId: string = res.body.data.id;
      const [persisted] = await db
        .select()
        .from(goals)
        .where(eq(goals.id, goalId));
      expect(persisted).toBeDefined();
      expect(persisted.householdId).toBe(householdId);
      expect(persisted.targetAmount).toBe("5000.00");
    });

    it("validates each payment denomination when editing an existing pay-down goal", async () => {
      const [account] = await db.insert(accounts).values({ householdId, ownerUserId: userId,
        name: "USD credit", type: "credit", currency: "USD", balance: "600", isAsset: false }).returning();
      const [goal] = await db.insert(goals).values({ householdId, createdBy: userId, type: "pay_down",
        goalType: "credit_card", name: "Existing credit payoff", debtAccountId: account.id, currency: "USD",
        targetAmount: "600", currentAmount: "600", originalBalance: "600", minimumPayment: "10", monthlyPayment: "50",
      }).returning();
      const change = (body: Record<string, unknown>) => request(app).put(`/api/goals/${goal.id}`).set("Cookie", authCookie).send(body);
      const stored = () => db.select().from(goals).where(eq(goals.id, goal.id));
      for (const field of ["minimumPayment", "monthlyPayment", "oneTimePayment"]) {
        await change({ [field]: { amount: "25.00", currency: "ZMW" } }).expect(400);
        expect(await stored()).toEqual([goal]);
      }
      await change({ minimumPayment: { amount: "20.00", currency: "USD" }, monthlyPayment: { amount: "60.00", currency: "ZMW" } }).expect(400);
      expect(await stored()).toEqual([goal]);
      await change({ monthlyPayment: { amount: "60.00", currency: "USD" } }).expect(200);
      expect((await stored())[0]).toMatchObject({ currency: "USD", minimumPayment: "10.00", monthlyPayment: "60.00" });
    });

    it("writes a CREATE audit row for the goal (Rule 9)", async () => {
      const res = await request(app)
        .post("/api/goals")
        .set("Cookie", authCookie)
        .send({
          name: "Audited Goal",
          type: "save_up",
          goalType: "emergency_fund",
          targetAmount: { amount: "2500.00", currency: "ZMW" },
        })
        .expect(201);

      const goalId: string = res.body.data.id;

      const [audit] = (await db
        .select()
        .from(auditLogs)
        .where(
          and(
            eq(auditLogs.entityType, "goal"),
            eq(auditLogs.entityId, goalId),
            eq(auditLogs.action, "CREATE"),
          ),
        )) as AuditRow[];

      expect(audit).toBeDefined();
      expect(audit.householdId).toBe(householdId);
      expect(audit.userId).toBe(userId);
    });

    it("rejects invalid goal payload with 400", async () => {
      const res = await request(app)
        .post("/api/goals")
        .set("Cookie", authCookie)
        .send({
          name: "",
          type: "save_up",
          goalType: "other",
          targetAmount: { amount: "-100.00", currency: "ZMW" },
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });
  });

  describe("POST /api/goals/:id/contribute", () => {
    it("increases currentAmount, records a contribution, and audits the write", async () => {
      const goalId = await seedGoal(householdId, {
        name: "Contribution Target",
        targetAmount: "1000.00",
        currentAmount: "0",
      });

      const res = await request(app)
        .post(`/api/goals/${goalId}/contribute`)
        .set("Cookie", authCookie)
        .send({ amount: { amount: "250.00", currency: "ZMW" } })
        .expect(201);

      expect(res.body.success).toBe(true);

      // currentAmount moved from 0 -> 250 in real Postgres.
      const [updated] = await db
        .select()
        .from(goals)
        .where(eq(goals.id, goalId));
      expect(Number(updated.currentAmount)).toBeCloseTo(250, 2);

      // A contribution row was persisted.
      const contributions = await db
        .select()
        .from(goalContributions)
        .where(eq(goalContributions.goalId, goalId));
      expect(contributions.length).toBe(1);
      expect(Number(contributions[0].amount)).toBeCloseTo(250, 2);

      // An UPDATE audit row was written for the financial change.
      const [audit] = (await db
        .select()
        .from(auditLogs)
        .where(
          and(
            eq(auditLogs.entityType, "goal"),
            eq(auditLogs.entityId, goalId),
            eq(auditLogs.action, "UPDATE"),
          ),
        )) as AuditRow[];
      expect(audit).toBeDefined();
      expect(audit.householdId).toBe(householdId);
    });
  });

  describe("Household scoping (Rule 11)", () => {
    it("returns 404 when reading a goal owned by another household", async () => {
      const foreignGoalId = await seedGoal(otherHouseholdId, {
        name: "Foreign Goal",
      });

      const res = await request(app)
        .get(`/api/goals/${foreignGoalId}`)
        .set("Cookie", authCookie);

      expect([403, 404]).toContain(res.status);
      expect(res.body.success).toBe(false);
    });

    it("cannot contribute to a goal owned by another household", async () => {
      const foreignGoalId = await seedGoal(otherHouseholdId, {
        name: "Foreign Contribution Target",
        currentAmount: "0",
      });

      const res = await request(app)
        .post(`/api/goals/${foreignGoalId}/contribute`)
        .set("Cookie", authCookie)
        .send({ amount: { amount: "999.00", currency: "ZMW" } });

      expect([403, 404]).toContain(res.status);

      // The foreign goal's balance must be untouched by the attacker.
      const [foreign] = await db
        .select()
        .from(goals)
        .where(eq(goals.id, foreignGoalId));
      expect(Number(foreign.currentAmount)).toBe(0);

      // No contribution row leaked into the foreign goal.
      const contributions = await db
        .select()
        .from(goalContributions)
        .where(eq(goalContributions.goalId, foreignGoalId));
      expect(contributions.length).toBe(0);
    });
  });

  describe("Authentication", () => {
    it("requires authentication for goal creation", async () => {
      const res = await request(app)
        .post("/api/goals")
        .send({
          name: "Unauthed Goal",
          type: "save_up",
          goalType: "other",
          targetAmount: { amount: "100.00", currency: "ZMW" },
        });
      expect(res.status).toBe(401);
    });
  });
});
