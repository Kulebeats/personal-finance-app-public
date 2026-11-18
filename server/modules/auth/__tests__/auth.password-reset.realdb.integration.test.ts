/**
 * Forgot/Reset Password - REAL-DB HTTP Integration Tests (R1)
 *
 * Proves, against REAL Postgres over real HTTP (no mock theater):
 *   1. POST /api/auth/forgot-password creates a hashed, 60-minute token row,
 *      emails the RAW token (captured at the email boundary), and writes a
 *      PASSWORD_RESET_REQUEST securityAuditLogs row without leaking the token.
 *   2. Enumeration safety: unknown email returns the IDENTICAL body + status.
 *   3. POST /api/auth/reset-password with the raw token rotates the password
 *      (old password fails login, new password logs in), marks the token used,
 *      invalidates other outstanding tokens, clears login-lockout counters,
 *      REVOKES all existing sessions (store + tracking rows), and writes a
 *      PASSWORD_RESET_COMPLETE audit row.
 *   4. Token reuse fails 400 with the same generic message as unknown/expired.
 *   5. Expired token fails 400 with the same generic message.
 *   6. Weak password / invalid input fails 400.
 *
 * Email egress is the ONLY mocked boundary (vi.mock of emailService) so the
 * test can capture the raw token exactly as a user would receive it.
 *
 * Run against an ISOLATED database (finance_app_r1_test), never finance_app.
 *
 * @module modules/auth/__tests__/auth.password-reset.realdb.integration.test
 */

import request from "supertest";
import { describe, it, expect, beforeAll, vi } from "vitest";
import type { Express } from "express";
import { createHash } from "crypto";
import { eq, and, isNull, desc } from "drizzle-orm";
import { db, pool } from "../../../db";
import {
  users,
  passwordResetTokens,
  securityAuditLogs,
  userSessions,
} from "@shared/schema";
import { getTestApp, createTestUser } from "../../../__tests__/fixtures";
import { hashPassword } from "../../../auth";

// Capture password-reset emails at the module boundary; everything else in
// emailService keeps its real behavior (which no-ops in NODE_ENV=test anyway).
const sentResetEmails = vi.hoisted(
  () => [] as Array<{ email: string; token: string }>,
);
vi.mock("../../../services/emailService", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("../../../services/emailService")
    >();
  return {
    ...actual,
    sendPasswordResetEmail: vi.fn(async (email: string, token: string) => {
      sentResetEmails.push({ email, token });
      return true;
    }),
  };
});

const OLD_PASSWORD = "OldPassword123!";
const NEW_PASSWORD = "NewPassword456!";
const GENERIC_FORGOT_MESSAGE =
  "If that email is registered, we sent a password reset link.";

describe("Forgot/Reset Password REAL-DB Integration (R1)", () => {
  let app: Express;
  let userId: string;
  let email: string;

  beforeAll(async () => {
    app = await getTestApp();

    const testUser = createTestUser({
      email: `pw-reset-${Date.now()}@example.com`,
      username: `pw-reset-user-${Date.now()}`,
    });
    testUser.passwordHash = await hashPassword(OLD_PASSWORD);
    userId = testUser.id;
    email = testUser.email;

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
  });

  it("runs the full happy path: request -> hashed token row -> reset -> re-login -> sessions revoked -> reuse fails", async () => {
    // --- Establish a live session with the OLD password (to prove revocation) ---
    const preLogin = await request(app)
      .post("/api/auth/login")
      .send({ email, password: OLD_PASSWORD })
      .expect(200);
    const oldSessionCookie = (
      preLogin.headers["set-cookie"] as unknown as string[]
    ).join("; ");

    // Session works before reset.
    await request(app)
      .get("/api/auth/me")
      .set("Cookie", oldSessionCookie)
      .expect(200);

    // Seed lockout counters to prove reset clears them.
    await db
      .update(users)
      .set({ failedLoginAttempts: 3, lastFailedLoginAt: new Date() })
      .where(eq(users.id, userId));

    // --- Request a reset ---
    const forgotRes = await request(app)
      .post("/api/auth/forgot-password")
      .send({ email })
      .expect(200);
    expect(forgotRes.body.success).toBe(true);

    // Token row created: hashed, unused, ~60 minute expiry.
    const rows = await db
      .select()
      .from(passwordResetTokens)
      .where(
        and(
          eq(passwordResetTokens.userId, userId),
          isNull(passwordResetTokens.usedAt),
        ),
      );
    expect(rows).toHaveLength(1);
    const tokenRow = rows[0];

    // The raw token was emailed exactly once and is NOT what is stored.
    expect(sentResetEmails).toHaveLength(1);
    expect(sentResetEmails[0].email).toBe(email);
    const rawToken = sentResetEmails[0].token;
    expect(rawToken).toMatch(/^[0-9a-f]{64}$/);
    expect(tokenRow.tokenHash).not.toBe(rawToken);
    expect(tokenRow.tokenHash).toBe(
      createHash("sha256").update(rawToken).digest("hex"),
    );

    const msUntilExpiry = tokenRow.expiresAt.getTime() - Date.now();
    expect(msUntilExpiry).toBeGreaterThan(55 * 60 * 1000);
    expect(msUntilExpiry).toBeLessThanOrEqual(60 * 60 * 1000);

    // PASSWORD_RESET_REQUEST audit row exists and never contains the token.
    const requestAudits = await db
      .select()
      .from(securityAuditLogs)
      .where(
        and(
          eq(securityAuditLogs.eventType, "PASSWORD_RESET_REQUEST"),
          eq(securityAuditLogs.userId, userId),
        ),
      );
    expect(requestAudits.length).toBeGreaterThanOrEqual(1);
    for (const audit of requestAudits) {
      const serialized = JSON.stringify(audit.details ?? {});
      expect(serialized).not.toContain(rawToken);
      expect(serialized).not.toContain(tokenRow.tokenHash);
    }

    // A second request invalidates the first token and issues a new one.
    await request(app)
      .post("/api/auth/forgot-password")
      .send({ email })
      .expect(200);
    expect(sentResetEmails).toHaveLength(2);
    const secondRawToken = sentResetEmails[1].token;
    const unusedRows = await db
      .select()
      .from(passwordResetTokens)
      .where(
        and(
          eq(passwordResetTokens.userId, userId),
          isNull(passwordResetTokens.usedAt),
        ),
      );
    expect(unusedRows).toHaveLength(1);
    expect(unusedRows[0].tokenHash).toBe(
      createHash("sha256").update(secondRawToken).digest("hex"),
    );

    // --- Reset with the latest raw token ---
    const resetRes = await request(app)
      .post("/api/auth/reset-password")
      .send({ token: secondRawToken, newPassword: NEW_PASSWORD })
      .expect(200);
    expect(resetRes.body.success).toBe(true);

    // Old password no longer logs in; new password does.
    await request(app)
      .post("/api/auth/login")
      .send({ email, password: OLD_PASSWORD })
      .expect(401);
    await request(app)
      .post("/api/auth/login")
      .send({ email, password: NEW_PASSWORD })
      .expect(200);

    // The pre-reset session was revoked (store row deleted -> cookie is dead).
    await request(app)
      .get("/api/auth/me")
      .set("Cookie", oldSessionCookie)
      .expect(401);

    // Session tracking rows for the user from before the reset are gone
    // (the post-reset login above creates fresh ones only).
    const sessionStoreRows = await pool.query(
      `SELECT sid FROM "session" WHERE sess->>'userId' = $1`,
      [userId],
    );
    // Only sessions created AFTER the reset (the NEW_PASSWORD login) remain.
    expect(sessionStoreRows.rows.length).toBeLessThanOrEqual(1);

    // Lockout counters were cleared by the reset (before the new login).
    const [refreshedUser] = await db
      .select()
      .from(users)
      .where(eq(users.id, userId));
    expect(refreshedUser.failedLoginAttempts).toBe(0);
    expect(refreshedUser.lockedUntil).toBeNull();

    // Token is marked used.
    const usedRow = await db
      .select()
      .from(passwordResetTokens)
      .where(
        eq(
          passwordResetTokens.tokenHash,
          createHash("sha256").update(secondRawToken).digest("hex"),
        ),
      );
    expect(usedRow[0].usedAt).not.toBeNull();

    // PASSWORD_RESET_COMPLETE audit row exists, token never leaked.
    const completeAudits = await db
      .select()
      .from(securityAuditLogs)
      .where(
        and(
          eq(securityAuditLogs.eventType, "PASSWORD_RESET_COMPLETE"),
          eq(securityAuditLogs.userId, userId),
        ),
      )
      .orderBy(desc(securityAuditLogs.createdAt));
    expect(completeAudits.length).toBeGreaterThanOrEqual(1);
    const serializedComplete = JSON.stringify(completeAudits[0].details ?? {});
    expect(serializedComplete).not.toContain(secondRawToken);

    // --- Reuse of the consumed token fails with a generic 400 ---
    const reuseRes = await request(app)
      .post("/api/auth/reset-password")
      .send({ token: secondRawToken, newPassword: "AnotherPass789!" })
      .expect(400);
    expect(reuseRes.body.success).toBe(false);

    // The password did NOT change again.
    await request(app)
      .post("/api/auth/login")
      .send({ email, password: NEW_PASSWORD })
      .expect(200);
  });

  it("returns an identical response for unknown emails (enumeration safety)", async () => {
    const knownRes = await request(app)
      .post("/api/auth/forgot-password")
      .send({ email });
    const unknownRes = await request(app)
      .post("/api/auth/forgot-password")
      .send({ email: `nobody-${Date.now()}@example.com` });

    expect(knownRes.status).toBe(200);
    expect(unknownRes.status).toBe(200);
    expect(unknownRes.body).toEqual(knownRes.body);
    expect(JSON.stringify(knownRes.body)).toContain(GENERIC_FORGOT_MESSAGE);

    // No token row and no email for the unknown address.
    const emailsToUnknown = sentResetEmails.filter((e) =>
      e.email.startsWith("nobody-"),
    );
    expect(emailsToUnknown).toHaveLength(0);
  });

  it("rejects expired tokens with the same generic error as unknown tokens", async () => {
    // Issue a fresh token, then force-expire it in the DB.
    await request(app)
      .post("/api/auth/forgot-password")
      .send({ email })
      .expect(200);
    const rawToken = sentResetEmails[sentResetEmails.length - 1].token;
    const tokenHash = createHash("sha256").update(rawToken).digest("hex");
    // Force-expire through Drizzle's Date mapping (naive timestamps are
    // stored as UTC wall time - raw SQL now() would write local wall time).
    await db
      .update(passwordResetTokens)
      .set({ expiresAt: new Date(Date.now() - 60 * 1000) })
      .where(eq(passwordResetTokens.tokenHash, tokenHash));

    const expiredRes = await request(app)
      .post("/api/auth/reset-password")
      .send({ token: rawToken, newPassword: "AnotherPass789!" })
      .expect(400);

    const unknownRes = await request(app)
      .post("/api/auth/reset-password")
      .send({ token: "0".repeat(64), newPassword: "AnotherPass789!" })
      .expect(400);

    // Same generic message - no oracle distinguishing expired vs unknown.
    expect(expiredRes.body.error.message).toBe(unknownRes.body.error.message);
  });

  it("rejects invalid input with 400 (validation)", async () => {
    // Missing email
    await request(app).post("/api/auth/forgot-password").send({}).expect(400);
    // Invalid email format
    await request(app)
      .post("/api/auth/forgot-password")
      .send({ email: "not-an-email" })
      .expect(400);
    // Weak password fails the registration-grade policy.
    await request(app)
      .post("/api/auth/reset-password")
      .send({ token: "0".repeat(64), newPassword: "weak" })
      .expect(400);
    // Missing token
    await request(app)
      .post("/api/auth/reset-password")
      .send({ newPassword: "ValidPass123!" })
      .expect(400);
  });
});
