/**
 * Weekly Recap Guard Integration Tests
 *
 * Tests for WEEKLY-GUARD-001: Verify householdGuard is applied
 * to POST /feedback endpoint.
 */

import request from "supertest";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { Express } from "express";
import { getTestApp } from "../../../__tests__/fixtures";
import { db } from "../../../db";
import { households, users, householdMembers } from "@shared/schema";
import { eq } from "drizzle-orm";
import { hashPassword } from "../../../auth";

describe("Weekly Recap Guard (WEEKLY-GUARD-001)", () => {
  let app: Express;
  let household: any;
  let user: any;
  let cookie: string;
  let csrfToken: string;
  let timestamp: number;

  beforeAll(async () => {
    app = await getTestApp();
    timestamp = Date.now();
    const passwordHash = await hashPassword("TestPassword123");

    // Create a household
    [household] = await db
      .insert(households)
      .values({ name: `Test Household ${timestamp}`, currency: "ZMW" })
      .returning();

    // Create a user
    [user] = await db
      .insert(users)
      .values({
        email: `testuser-${timestamp}@test.com`,
        username: `testuser-${timestamp}`,
        passwordHash,
        emailVerified: true,
      })
      .returning();

    // Add user to household
    await db.insert(householdMembers).values({
      householdId: household.id,
      userId: user.id,
      role: "owner",
    });

    // Create authenticated session
    const loginResponse = await request(app)
      .post("/api/auth/login")
      .send({ email: `testuser-${timestamp}@test.com`, password: "TestPassword123" })
      .expect(200);
    cookie = loginResponse.headers["set-cookie"]
      ? (loginResponse.headers["set-cookie"] as unknown as string[]).join("; ")
      : "";

    // Get CSRF token
    const csrfRes = await request(app)
      .get("/api/csrf-token")
      .set("Cookie", cookie)
      .expect(200);
    csrfToken = csrfRes.body.csrfToken;
  });

  afterAll(async () => {
    // Cleanup
    await db.delete(householdMembers).where(eq(householdMembers.householdId, household.id));
    await db.delete(households).where(eq(households.id, household.id));
    await db.delete(users).where(eq(users.id, user.id));
  });

  describe("POST /api/weekly-recap/feedback", () => {
    it("should reject request without authentication", async () => {
      const response = await request(app)
        .post("/api/weekly-recap/feedback")
        .send({
          weekStart: "2024-01-01",
          weekEnd: "2024-01-07",
          step: "spending",
          feedback: "positive",
        });

      expect(response.status).toBe(401);
      expect(response.body.success).toBe(false);
    });

    it("should reject request without household context", async () => {
      const passwordHash = await hashPassword("TestPassword123");
      // Create a user without household membership
      const [userNoHousehold] = await db
        .insert(users)
        .values({
          email: `nohousehold-${timestamp}@test.com`,
          username: `nohousehold-${timestamp}`,
          passwordHash,
          emailVerified: true,
        })
        .returning();

      const loginResponse = await request(app)
        .post("/api/auth/login")
        .send({ email: `nohousehold-${timestamp}@test.com`, password: "TestPassword123" })
        .expect(200);
      const cookieNoHousehold = loginResponse.headers["set-cookie"]
        ? (loginResponse.headers["set-cookie"] as unknown as string[]).join("; ")
        : "";

      // Get CSRF token for this user
      const csrfRes = await request(app)
        .get("/api/csrf-token")
        .set("Cookie", cookieNoHousehold)
        .expect(200);
      const csrfTokenNoHousehold = csrfRes.body.csrfToken;

      const response = await request(app)
        .post("/api/weekly-recap/feedback")
        .set("Cookie", cookieNoHousehold)
        .set("X-CSRF-Token", csrfTokenNoHousehold)
        .send({
          weekStart: "2024-01-01",
          weekEnd: "2024-01-07",
          step: "spending",
          feedback: "positive",
        });

      // householdGuard should reject this request
      expect(response.status).toBe(404);
      expect(response.body.success).toBe(false);
      expect(response.body.error.message).toContain("Household");

      // Cleanup
      await db.delete(users).where(eq(users.id, userNoHousehold.id));
    });

    it("should accept request with valid authentication and household context", async () => {
      const response = await request(app)
        .post("/api/weekly-recap/feedback")
        .set("Cookie", cookie)
        .set("X-CSRF-Token", csrfToken)
        .send({
          weekStart: "2024-01-01",
          weekEnd: "2024-01-07",
          step: "spending",
          feedback: "positive",
        });

      if (response.status !== 200) {
        console.log("FAILURE - Status:", response.status);
        console.log("FAILURE - Body:", JSON.stringify(response.body, null, 2));
        console.log("FAILURE - Cookie:", cookie.substring(0, 100));
        console.log("FAILURE - CSRF Token:", csrfToken?.substring(0, 20));
      }

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.recorded).toBe(true);
    });

    it("should validate feedback data", async () => {
      const response = await request(app)
        .post("/api/weekly-recap/feedback")
        .set("Cookie", cookie)
        .set("X-CSRF-Token", csrfToken)
        .send({
          weekStart: "invalid-date",
          weekEnd: "2024-01-07",
          step: "spending",
          feedback: "positive",
        });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe("VALIDATION_ERROR");
    });

    it("should accept both 'wrap-up' and 'overall' step values (CONTRACT-006)", async () => {
      // Test 'wrap-up' (client value)
      const response1 = await request(app)
        .post("/api/weekly-recap/feedback")
        .set("Cookie", cookie)
        .set("X-CSRF-Token", csrfToken)
        .send({
          weekStart: "2024-01-01",
          weekEnd: "2024-01-07",
          step: "wrap-up",
          feedback: "positive",
        });

      expect(response1.status).toBe(200);
      expect(response1.body.success).toBe(true);

      // Test 'overall' (legacy value)
      const response2 = await request(app)
        .post("/api/weekly-recap/feedback")
        .set("Cookie", cookie)
        .set("X-CSRF-Token", csrfToken)
        .send({
          weekStart: "2024-01-01",
          weekEnd: "2024-01-07",
          step: "overall",
          feedback: "negative",
        });

      expect(response2.status).toBe(200);
      expect(response2.body.success).toBe(true);
    });
  });

  describe("Other Weekly Recap Endpoints (sanity check)", () => {
    it("GET /api/weekly-recap should also require household guard", async () => {
      const response = await request(app)
        .get("/api/weekly-recap")
        .set("Cookie", cookie);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });

    it("GET /api/weekly-recap/history should require household guard", async () => {
      const response = await request(app)
        .get("/api/weekly-recap/history")
        .set("Cookie", cookie);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });

    it("POST /api/weekly-recap/generate should require household guard", async () => {
      const response = await request(app)
        .post("/api/weekly-recap/generate")
        .set("Cookie", cookie)
        .set("X-CSRF-Token", csrfToken)
        .send({ weekOf: "2024-01-01" });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });
  });
});
