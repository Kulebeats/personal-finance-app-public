/**
 * AI Consent - REAL-DB HTTP Integration Tests (packet R4)
 *
 * Audit findings (production-readiness audit, 2026-07-12):
 *   (a) The client "AI Features" consent card called a nonexistent endpoint
 *       (/api/settings/ai-preferences). The real consent endpoints live at
 *       GET/POST /api/ai/consent (server/modules/ai/ai.routes.ts).
 *   (b) POST /api/ai/consent's audit-log call passed a non-UUID string
 *       (`consent_${householdId}`) as `entityId`, but auditLogs.entityId is a
 *       uuid column. The insert throws, and BusinessAuditService swallows the
 *       error (non-blocking by design), so consent changes were NEVER
 *       recorded — a Zambia DPA compliance gap.
 *
 * These tests issue REAL HTTP requests through the Express stack against REAL
 * Postgres (no mocks): login -> session cookie -> request -> assert via
 * Drizzle that an auditLogs row was actually written for grant AND revoke.
 *
 * @module modules/ai/__tests__/ai.consent.realdb.integration.test
 */

import request from "supertest";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { Express } from "express";
import { db } from "../../../db";
import { eq, and } from "drizzle-orm";
import { users, households, householdMembers, auditLogs } from "@shared/schema";
import {
  getTestApp,
  createTestUser,
  createTestHousehold,
} from "../../../__tests__/fixtures";
import { hashPassword } from "../../../auth";

interface AuditRow {
  id: string;
  householdId: string | null;
  userId: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  details: Record<string, unknown> | null;
}

describe("AI Consent REAL-DB HTTP Integration (packet R4)", () => {
  let app: Express;
  let authCookie: string;
  let householdId: string;
  let userId: string;

  const timestamp = Date.now();

  beforeAll(async () => {
    app = await getTestApp();

    const testUser = createTestUser({
      email: `ai-consent-realdb-${timestamp}@example.com`,
      username: `ai-consent-realdb-${timestamp}`,
    });
    const testHousehold = createTestHousehold(testUser.id, {
      name: "AI Consent RealDB Household",
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
    // requireRole('admin') gates POST /api/ai/consent (SEC-RBAC-001).
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
      await db.delete(auditLogs).where(eq(auditLogs.householdId, householdId));
      await db
        .delete(householdMembers)
        .where(eq(householdMembers.householdId, householdId));
      await db.delete(users).where(eq(users.id, userId));
      await db.delete(households).where(eq(households.id, householdId));
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error("AI consent realdb cleanup error", error);
    }
  });

  async function findConsentAudit(action: "CREATE" | "DELETE"): Promise<AuditRow | undefined> {
    const rows = (await db
      .select()
      .from(auditLogs)
      .where(
        and(
          eq(auditLogs.householdId, householdId),
          eq(auditLogs.entityType, "ai_consent"),
          eq(auditLogs.entityId, householdId),
          eq(auditLogs.action, action),
        ),
      )) as AuditRow[];
    return rows[0];
  }

  describe("GET /api/ai/consent", () => {
    it("returns the current consent status for the household", async () => {
      const res = await request(app)
        .get("/api/ai/consent")
        .set("Cookie", authCookie)
        .expect(200);

      // Not V7-enveloped: the AI module returns raw JSON on this endpoint
      // (verified against server/modules/ai/ai.controller.ts:getConsent).
      expect(res.body).toHaveProperty("consentGiven");
      expect(res.body.consentGiven).toBe(false);
    });
  });

  describe("POST /api/ai/consent (grant)", () => {
    it("persists consentGiven=true on the household", async () => {
      const res = await request(app)
        .post("/api/ai/consent")
        .set("Cookie", authCookie)
        .send({ consentGiven: true })
        .expect(200);

      expect(res.body.consentGiven).toBe(true);

      const [household] = await db
        .select()
        .from(households)
        .where(eq(households.id, householdId));
      expect(household.aiConsentGiven).toBe(true);
    });

    it("writes a CREATE audit row for the consent grant (Rule 9 / DPA)", async () => {
      const audit = await findConsentAudit("CREATE");

      expect(audit).toBeDefined();
      expect(audit?.householdId).toBe(householdId);
      expect(audit?.userId).toBe(userId);
      expect(audit?.entityId).toBe(householdId);
    });
  });

  describe("POST /api/ai/consent (revoke)", () => {
    it("persists consentGiven=false on the household", async () => {
      const res = await request(app)
        .post("/api/ai/consent")
        .set("Cookie", authCookie)
        .send({ consentGiven: false })
        .expect(200);

      expect(res.body.consentGiven).toBe(false);

      const [household] = await db
        .select()
        .from(households)
        .where(eq(households.id, householdId));
      expect(household.aiConsentGiven).toBe(false);
    });

    it("writes a DELETE audit row for the consent revoke (Rule 9 / DPA)", async () => {
      const audit = await findConsentAudit("DELETE");

      expect(audit).toBeDefined();
      expect(audit?.householdId).toBe(householdId);
      expect(audit?.userId).toBe(userId);
      expect(audit?.entityId).toBe(householdId);
    });
  });

  describe("Authentication", () => {
    it("requires authentication to read consent status", async () => {
      const res = await request(app).get("/api/ai/consent");
      expect(res.status).toBe(401);
    });

    it("requires authentication to set consent", async () => {
      const res = await request(app)
        .post("/api/ai/consent")
        .send({ consentGiven: true });
      expect(res.status).toBe(401);
    });
  });
});
