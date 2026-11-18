/**
 * Password Change — Other-Session Revocation (Real-DB Integration Test)
 *
 * Audit v2 P2 finding: changing your password via
 * PUT /api/settings/security/password did NOT revoke a thief's stolen
 * session, so an attacker who had grabbed a session cookie kept access even
 * after the victim rotated their password. The password-RESET flow already
 * revoked sessions correctly (auth.password-reset.service.ts); this proves
 * the authenticated CHANGE flow now shares that behavior via the extracted
 * server/services/session-revocation.ts helper, with one deliberate
 * difference: the CURRENT session (the one making the change request) must
 * stay alive, so the user isn't logged out of the device they're using.
 *
 * Run against an ISOLATED database (finance_app_p5a_test), never finance_app.
 *
 * @module modules/settings/__tests__/settings.password-change-session-revocation.realdb.integration.test
 */

import request from "supertest";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { Express } from "express";
import { eq } from "drizzle-orm";
import { db, pool } from "../../../db";
import { users, households, householdMembers, userSessions } from "@shared/schema";
import {
  getTestApp,
  createTestUser,
  createTestHousehold,
} from "../../../__tests__/fixtures";
import { hashPassword, verifyPassword } from "../../../auth";

describe("Password Change - Other-Session Revocation (Real DB Integration)", () => {
  let app: Express;
  let householdId: string;
  let userId: string;
  let email: string;

  const timestamp = Date.now();
  const OLD_PASSWORD = "OldPassword123!";
  const NEW_PASSWORD = "NewPassword456!";

  beforeAll(async () => {
    app = await getTestApp();

    const testUser = createTestUser({
      email: `pw-change-revoke-${timestamp}@example.com`,
      username: `pw-change-revoke-${timestamp}`,
      mfaEnabled: false,
    });
    const testHousehold = createTestHousehold(testUser.id, {
      name: "Password Change Revocation Household",
    });

    testUser.passwordHash = await hashPassword(OLD_PASSWORD);
    householdId = testHousehold.id;
    userId = testUser.id;
    email = testUser.email;

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
  });

  afterAll(async () => {
    await db.delete(userSessions).where(eq(userSessions.userId, userId));
    await db
      .delete(householdMembers)
      .where(eq(householdMembers.householdId, householdId));
    await db.delete(users).where(eq(users.id, userId));
    await db.delete(households).where(eq(households.id, householdId));
  });

  it("keeps the current session alive but revokes every OTHER session on password change", async () => {
    // --- Two independent logins simulate: the victim's current device (A)
    // and a thief's stolen session established earlier (B). ---
    const loginA = await request(app)
      .post("/api/auth/login")
      .send({ email, password: OLD_PASSWORD })
      .expect(200);
    const cookieA = (loginA.headers["set-cookie"] as unknown as string[]).join(
      "; ",
    );

    const loginB = await request(app)
      .post("/api/auth/login")
      .send({ email, password: OLD_PASSWORD })
      .expect(200);
    const cookieB = (loginB.headers["set-cookie"] as unknown as string[]).join(
      "; ",
    );

    // Both sessions work before the change.
    await request(app).get("/api/auth/me").set("Cookie", cookieA).expect(200);
    await request(app).get("/api/auth/me").set("Cookie", cookieB).expect(200);

    expect(
      (
        await db
          .select()
          .from(userSessions)
          .where(eq(userSessions.userId, userId))
      ).length,
    ).toBe(2);

    // Step-up is required before a password change (SETTINGS level) - do it
    // on session A only, the session that will perform the change.
    const stepUpRes = await request(app)
      .post("/api/settings/security/step-up")
      .set("Cookie", cookieA)
      .send({ password: OLD_PASSWORD });
    expect(stepUpRes.status).toBe(200);

    // --- Change the password from session A ---
    const changeRes = await request(app)
      .put("/api/settings/security/password")
      .set("Cookie", cookieA)
      .send({
        currentPassword: OLD_PASSWORD,
        newPassword: NEW_PASSWORD,
        confirmPassword: NEW_PASSWORD,
      });
    expect(changeRes.status).toBe(200);

    // Password actually rotated.
    const [row] = await db.select().from(users).where(eq(users.id, userId));
    expect(await verifyPassword(NEW_PASSWORD, row.passwordHash!)).toBe(true);
    expect(await verifyPassword(OLD_PASSWORD, row.passwordHash!)).toBe(false);

    // --- Session A (current device) is STILL logged in - no self-lockout. ---
    await request(app).get("/api/auth/me").set("Cookie", cookieA).expect(200);

    // --- Session B (the "stolen" session) is dead: store row AND tracking
    // row are both gone, so the cookie no longer authenticates. ---
    await request(app).get("/api/auth/me").set("Cookie", cookieB).expect(401);

    const remainingTrackedSessions = await db
      .select()
      .from(userSessions)
      .where(eq(userSessions.userId, userId));
    expect(remainingTrackedSessions).toHaveLength(1);

    const storeRows = await pool.query(
      `SELECT sid FROM "session" WHERE sess->>'userId' = $1`,
      [userId],
    );
    expect(storeRows.rows.length).toBe(1);
  });
});
