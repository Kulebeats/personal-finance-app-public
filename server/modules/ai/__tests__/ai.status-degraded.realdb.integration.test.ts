/**
 * AI Status - Availability Honesty (v1.1 Workstream E4) - REAL-DB HTTP tests
 *
 * GET /api/ai/status hardcoded `available: true` even when GEMINI_API_KEY is
 * unset, because the keyword-matching fallback genuinely answers when Gemini
 * isn't configured — reporting `available: false` would be false. Product
 * stance (see docs/ai-integration/implementation/ai-assistant-v1.1-implementation-plan.md
 * §6, E4): keep `available: true` and add an ADDITIVE, non-breaking
 * `degraded: boolean` field, wired to the real Gemini client's configuration
 * state (`geminiClient.isAvailable()`), not to an ad-hoc `process.env` read
 * in the route.
 *
 * These tests issue REAL HTTP requests through the Express stack against
 * REAL Postgres (no mocks for the request path) — pattern mirrors
 * ai.consent.realdb.integration.test.ts. The response body is verified to
 * stay RAW JSON (no V7 envelope), per the AI module's contract.
 *
 * @module modules/ai/__tests__/ai.status-degraded.realdb.integration.test
 */

import request from "supertest";
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
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
import { geminiClient } from "../ai.gemini";
import { claudeClient } from "../ai.claude";

describe("AI Status degraded field REAL-DB HTTP (v1.1 Workstream E4)", () => {
  let app: Express;
  let authCookie: string;
  let householdId: string;
  let userId: string;

  const timestamp = Date.now();

  beforeAll(async () => {
    app = await getTestApp();

    const testUser = createTestUser({
      email: `ai-status-degraded-${timestamp}@example.com`,
      username: `ai-status-degraded-${timestamp}`,
    });
    const testHousehold = createTestHousehold(testUser.id, {
      name: "AI Status Degraded Household",
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
      role: "member",
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
      console.error("AI status degraded realdb cleanup error", error);
    }
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("keeps available: true even when the provider is not configured (fallback genuinely answers)", async () => {
    const res = await request(app)
      .get("/api/ai/status")
      .set("Cookie", authCookie)
      .expect(200);

    // Not V7-enveloped: the AI module returns raw JSON on this endpoint.
    expect(res.body.available).toBe(true);
  });

  it("reports degraded: true when the provider is not configured", async () => {
    // Control the provider state explicitly rather than depending on ambient
    // env: CI sets GEMINI_API_KEY (`test-key-not-used`), so an earlier version
    // of this test that asserted the real singleton was unconfigured passed
    // locally and failed in CI. The wiring under test is
    // `degraded === !geminiClient.isAvailable()`, so stubbing that accessor —
    // exactly as the sibling configured-case test does — proves the mapping
    // deterministically on any runner. The request still goes over real HTTP
    // against real Postgres.
    // R17: Claude is the primary; neither provider configured is degraded.
    vi.spyOn(claudeClient, "isAvailable").mockReturnValue(false);
    vi.spyOn(geminiClient, "isAvailable").mockReturnValue(false);

    const res = await request(app)
      .get("/api/ai/status")
      .set("Cookie", authCookie)
      .expect(200);

    expect(res.body.degraded).toBe(true);
  });

  it("reports degraded: false when the primary (Claude) client reports configured", async () => {
    // R17: degraded tracks the PRIMARY provider. Gemini alone is the backup
    // operating, which is degraded (see completion-r17.status suite).
    vi.spyOn(claudeClient, "isAvailable").mockReturnValue(true);
    vi.spyOn(claudeClient, "configuredModel").mockReturnValue(`status-degraded-${Date.now()}`);

    const res = await request(app)
      .get("/api/ai/status")
      .set("Cookie", authCookie)
      .expect(200);

    expect(res.body.available).toBe(true);
    expect(res.body.degraded).toBe(false);
  });

  it("still returns the existing rateLimit shape unchanged (additive field only)", async () => {
    const res = await request(app)
      .get("/api/ai/status")
      .set("Cookie", authCookie)
      .expect(200);

    expect(res.body.rateLimit).toMatchObject({
      remaining: expect.any(Number),
      resetTime: expect.any(String),
      isLimited: expect.any(Boolean),
    });
  });

  it("requires authentication", async () => {
    const res = await request(app).get("/api/ai/status");
    expect(res.status).toBe(401);
  });
});
