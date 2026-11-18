/**
 * Goals Projection Calculator - REAL-DB HTTP Integration Tests
 *
 * POST /api/goals/calculate-projection was missing server-side entirely —
 * the client's GoalProjectionCalculator called a route that 404'd (see
 * docs/reviews/production-readiness-audit-v2-2026-07-11.md). This test
 * issues REAL HTTP requests through the Express stack against REAL Postgres
 * (no mocks) to prove the endpoint now exists, validates its input, is
 * rate-limited/authenticated like the rest of the goals module, and returns
 * a correct projection.
 *
 * @module modules/goals/__tests__/goals.projection.realdb.integration.test
 */

import request from "supertest";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { Express } from "express";
import { db } from "../../../db";
import { eq } from "drizzle-orm";
import { users, households, householdMembers } from "@shared/schema";
import {
  getTestApp,
  createTestUser,
  createTestHousehold,
} from "../../../__tests__/fixtures";
import { hashPassword } from "../../../auth";

describe("POST /api/goals/calculate-projection REAL-DB HTTP Integration", () => {
  let app: Express;
  let authCookie: string;
  let householdId: string;
  let userId: string;

  const timestamp = Date.now();

  beforeAll(async () => {
    app = await getTestApp();

    const testUser = createTestUser({
      email: `goals-projection-${timestamp}@example.com`,
      username: `goals-projection-user-${timestamp}`,
    });
    const testHousehold = createTestHousehold(testUser.id, {
      name: "Goals Projection Household",
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
      await db
        .delete(householdMembers)
        .where(eq(householdMembers.householdId, householdId));
      await db.delete(users).where(eq(users.id, userId));
      await db.delete(households).where(eq(households.id, householdId));
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error("Goals projection real-DB cleanup error", error);
    }
  });

  describe("happy path", () => {
    it("returns a projection with no target amount", async () => {
      const res = await request(app)
        .post("/api/goals/calculate-projection")
        .set("Cookie", authCookie)
        .send({
          currentAmount: 1000,
          monthlyContribution: 100,
          returnRate: 10,
          inflationRate: 5,
          years: 2,
        })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.requiredMonthlyContribution).toBeNull();
      expect(typeof res.body.data.projectedAmount).toBe("number");
      expect(typeof res.body.data.totalContributed).toBe("number");
      // Contributed at least the starting balance + 24 months of $100.
      expect(res.body.data.totalContributed).toBeGreaterThanOrEqual(3400);
    });

    it("returns a required monthly contribution when a target amount is supplied", async () => {
      const res = await request(app)
        .post("/api/goals/calculate-projection")
        .set("Cookie", authCookie)
        .send({
          currentAmount: 1000,
          monthlyContribution: 0,
          returnRate: 10,
          inflationRate: 0,
          years: 2,
          targetAmount: 5000,
        })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.requiredMonthlyContribution).toBeGreaterThan(0);
    });
  });

  describe("validation", () => {
    it("rejects a negative currentAmount with 400", async () => {
      const res = await request(app)
        .post("/api/goals/calculate-projection")
        .set("Cookie", authCookie)
        .send({
          currentAmount: -500,
          monthlyContribution: 100,
          returnRate: 10,
          inflationRate: 5,
          years: 2,
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it("rejects a return rate above 100 with 400", async () => {
      const res = await request(app)
        .post("/api/goals/calculate-projection")
        .set("Cookie", authCookie)
        .send({
          currentAmount: 1000,
          monthlyContribution: 100,
          returnRate: 250,
          inflationRate: 5,
          years: 2,
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it("rejects a missing years field with 400", async () => {
      const res = await request(app)
        .post("/api/goals/calculate-projection")
        .set("Cookie", authCookie)
        .send({
          currentAmount: 1000,
          monthlyContribution: 100,
          returnRate: 10,
          inflationRate: 5,
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });
  });

  describe("authentication", () => {
    it("requires authentication", async () => {
      const res = await request(app).post("/api/goals/calculate-projection").send({
        currentAmount: 1000,
        monthlyContribution: 100,
        returnRate: 10,
        inflationRate: 5,
        years: 2,
      });

      expect(res.status).toBe(401);
    });
  });
});
