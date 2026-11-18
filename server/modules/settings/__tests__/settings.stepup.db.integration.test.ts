/**
 * Settings Step-Up Re-Authentication — Real-DB Integration Tests
 *
 * Exercises the REAL requireStepUp middleware and the REAL step-up endpoint
 * against a real Postgres (NO mocked middleware), for the SCP-320 frontend
 * consolidation: session revocation and password change, both served under
 * /api/settings/security/* and gated at the SETTINGS level.
 *
 * RED→GREEN guard: before the consolidation, PUT /api/settings/security/password
 * was a 404 (the security router had no /password route and the only real
 * handler lived at the un-called /api/settings/password). So both password
 * cases below — "blocked without step-up" (expects 401, got 404) and "allowed
 * after step-up" (expects 200, got 404) — FAIL against the unfixed code and
 * PASS against the fix. The session-revoke audit assertion likewise fails
 * pre-fix (the live route wrote no audit row) and passes post-fix.
 *
 * See docs/architecture/step-up-reauth-design.md
 */

import request from "supertest";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { Express } from "express";
import { db } from "../../../db";
import { eq } from "drizzle-orm";
import {
  users,
  households,
  householdMembers,
  userSessions,
  auditLogs,
  passwordHistory,
} from "@shared/schema";
import {
  getTestApp,
  createTestUser,
  createTestHousehold,
} from "../../../__tests__/fixtures";
import { hashPassword, verifyPassword } from "../../../auth";
import { randomUUID } from "crypto";

describe("Settings Step-Up (sessions + password) — Real DB Integration", () => {
  let app: Express;
  let authCookie: string;
  let householdId: string;
  let userId: string;
  let sessionId: string;

  const timestamp = Date.now();
  const PASSWORD = "TestPassword123!";
  const NEW_PASSWORD = "BrandNewPassword456!";

  beforeAll(async () => {
    app = await getTestApp();

    const testUser = createTestUser({
      email: `settings-stepup-${timestamp}@example.com`,
      username: `settings-stepup-${timestamp}`,
      mfaEnabled: false,
    });
    const testHousehold = createTestHousehold(testUser.id, {
      name: "Settings Step-Up Household",
    });

    testUser.passwordHash = await hashPassword(PASSWORD);
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

    // Seed a revocable session row (distinct from the login session).
    sessionId = randomUUID();
    await db.insert(userSessions).values({
      id: sessionId,
      userId,
      sessionToken: `test-session-token-${timestamp}`,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    });

    const loginRes = await request(app).post("/api/auth/login").send({
      email: testUser.email,
      password: PASSWORD,
    });
    expect(loginRes.status).toBe(200);
    authCookie = loginRes.headers["set-cookie"][0];
  });

  afterAll(async () => {
    await db.delete(passwordHistory).where(eq(passwordHistory.userId, userId));
    await db.delete(auditLogs).where(eq(auditLogs.userId, userId));
    await db.delete(userSessions).where(eq(userSessions.userId, userId));
    await db
      .delete(householdMembers)
      .where(eq(householdMembers.householdId, householdId));
    await db.delete(users).where(eq(users.id, userId));
    await db.delete(households).where(eq(households.id, householdId));
  });

  // --- Blocked-without-step-up cases (must precede any successful step-up) ---

  it("blocks DELETE /settings/security/sessions/:id without step-up (401)", async () => {
    const res = await request(app)
      .delete(`/api/settings/security/sessions/${sessionId}`)
      .set("Cookie", authCookie);

    expect(res.status).toBe(401);
    expect(res.body.requiresStepUp).toBe(true);
    expect(res.body.error.code).toBe("STEP_UP_REQUIRED");

    // Still present — the gate blocked it before the handler ran.
    const [row] = await db
      .select()
      .from(userSessions)
      .where(eq(userSessions.id, sessionId));
    expect(row).toBeDefined();
  });

  // RED→GREEN: pre-consolidation this route was a 404, so this FAILS on the
  // unfixed code (404 !== 401) and PASSES on the fix.
  it("blocks PUT /settings/security/password without step-up (401)", async () => {
    const res = await request(app)
      .put("/api/settings/security/password")
      .set("Cookie", authCookie)
      .send({
        currentPassword: PASSWORD,
        newPassword: NEW_PASSWORD,
        confirmPassword: NEW_PASSWORD,
      });

    expect(res.status).toBe(401);
    expect(res.body.requiresStepUp).toBe(true);
    expect(res.body.error.code).toBe("STEP_UP_REQUIRED");
  });

  it("rejects step-up with wrong password and keeps actions blocked", async () => {
    const stepUpRes = await request(app)
      .post("/api/settings/security/step-up")
      .set("Cookie", authCookie)
      .send({ password: "WrongPassword!" });

    expect(stepUpRes.status).toBe(401);
    expect(stepUpRes.body.error.code).toBe("INVALID_CREDENTIALS");

    const delRes = await request(app)
      .delete(`/api/settings/security/sessions/${sessionId}`)
      .set("Cookie", authCookie);
    expect(delRes.status).toBe(401);
  });

  // --- Satisfiable by password for a non-MFA user ---

  it("allows session revoke after password step-up (non-MFA user)", async () => {
    const stepUpRes = await request(app)
      .post("/api/settings/security/step-up")
      .set("Cookie", authCookie)
      .send({ password: PASSWORD });
    expect(stepUpRes.status).toBe(200);
    expect(stepUpRes.body.success).toBe(true);

    const delRes = await request(app)
      .delete(`/api/settings/security/sessions/${sessionId}`)
      .set("Cookie", authCookie);
    expect(delRes.status).toBe(200);
    expect(delRes.body.success).toBe(true);

    // Persisted: the seeded session row is gone.
    const rows = await db
      .select()
      .from(userSessions)
      .where(eq(userSessions.id, sessionId));
    expect(rows.length).toBe(0);

    // DPA: a REVOKE_SESSION audit row was written. (Pre-fix the live route
    // wrote none; the dead duplicate used a "security" sentinel that silently
    // failed the UUID column — this asserts the householdId:null fix.)
    const audit = await db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.userId, userId));
    expect(audit.some((a) => a.action === "REVOKE_SESSION")).toBe(true);
  });

  // RED→GREEN: also a 404 pre-consolidation. Reuses the active SETTINGS step-up
  // window from the previous test (cross-action proof — no second step-up).
  it("allows password change under the active step-up window", async () => {
    const res = await request(app)
      .put("/api/settings/security/password")
      .set("Cookie", authCookie)
      .send({
        currentPassword: PASSWORD,
        newPassword: NEW_PASSWORD,
        confirmPassword: NEW_PASSWORD,
      });
    expect(res.status).toBe(200);

    // Persisted: the new password verifies, the old one no longer does.
    const [row] = await db.select().from(users).where(eq(users.id, userId));
    expect(await verifyPassword(NEW_PASSWORD, row.passwordHash!)).toBe(true);
    expect(await verifyPassword(PASSWORD, row.passwordHash!)).toBe(false);
  });
});
