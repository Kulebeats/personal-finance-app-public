/**
 * Email Verification / Change Tokens — Hashed At Rest (Real-DB Integration Test)
 *
 * P7a finding: users.emailVerificationToken stored the RAW token, so a DB
 * read (backup leak, log spill, insider) would yield a usable token for
 * either the initial-verification or the email-CHANGE flow (both flows
 * share this single column, paired with pendingEmail for the change case -
 * there is no separate email-change token column). The password-reset flow
 * already stored only a SHA-256 hash (auth.password-reset.service.ts); this
 * proves the email verification/change flow now matches that standard end
 * to end:
 *   - the raw token is NEVER persisted (only its SHA-256 hash is)
 *   - verifying WITH the raw token still succeeds (hash-then-lookup)
 *   - a wrong/tampered token is rejected
 *
 * The raw token never appears in a DB row or an HTTP response in this app
 * (by design) - only in the outgoing email. To observe it for these
 * assertions we mock the email-sending boundary (server/services/
 * emailService.ts: sendVerificationEmail + sendEmail) to capture the raw
 * token argument the app hands it, without touching anything on the DB
 * side - the DB writes, lookups, and HTTP flow below are all real.
 *
 * Covers every route that reads/writes this column:
 *   - POST /api/auth/register + /api/auth/verify-email
 *     (auth.service.ts + auth.email.service.ts, initial signup)
 *   - POST /api/settings/security/email/{change,verify,resend}
 *     (routes/security.email.ts - also the email-CHANGE flow)
 *
 * Run against an ISOLATED database (finance_app_p7a_test), never finance_app.
 *
 * @module routes/__tests__/security.email-tokens-hashed.realdb.integration.test
 */

import request from "supertest";
import { createHash } from "crypto";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { Express } from "express";
import { eq } from "drizzle-orm";
import { db } from "../../db";
import { users, households, householdMembers } from "@shared/schema";
import {
  getTestApp,
  createTestUser,
  createTestHousehold,
} from "../../__tests__/fixtures";
import { hashPassword } from "../../auth";

// --- Capture the raw token at the email-sending boundary only. Nothing
// about the DB write/read path or the HTTP flow is mocked. ---
const capturedVerificationEmails: Array<{
  email: string;
  token: string;
  isEmailChange: boolean;
}> = [];
const capturedGenericEmails: Array<{
  to: string;
  subject: string;
  html: string;
  text?: string;
}> = [];

vi.mock("../../services/emailService", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../services/emailService")>();
  return {
    ...actual,
    sendVerificationEmail: vi.fn(
      async (email: string, token: string, isEmailChange = false) => {
        capturedVerificationEmails.push({ email, token, isEmailChange });
        return true;
      },
    ),
    sendEmail: vi.fn(
      async (options: {
        to: string;
        subject: string;
        html: string;
        text?: string;
      }) => {
        capturedGenericEmails.push(options);
        return true;
      },
    ),
  };
});

function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

async function loadUser(userId: string) {
  const [row] = await db.select().from(users).where(eq(users.id, userId));
  return row;
}

describe("Email verification/change tokens are hashed at rest (Real DB Integration)", () => {
  let app: Express;

  const timestamp = Date.now();
  const PASSWORD = "TokenHashTest123!";

  async function seedUser(suffix: string) {
    const testUser = createTestUser({
      email: `p7a-email-token-${suffix}-${timestamp}@example.com`,
      username: `p7a-email-token-${suffix}-${timestamp}`,
      emailVerified: true,
    });
    const testHousehold = createTestHousehold(testUser.id, {
      name: `P7a Email Token Household ${suffix}`,
    });
    testUser.passwordHash = await hashPassword(PASSWORD);

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
      mfaEnabled: false,
      failedLoginAttempts: 0,
      lockedUntil: null,
    });
    await db.insert(householdMembers).values({
      householdId: testHousehold.id,
      userId: testUser.id,
      role: "admin",
    });

    return { testUser, testHousehold };
  }

  async function cleanupUser(userId: string, householdId: string) {
    await db
      .delete(householdMembers)
      .where(eq(householdMembers.householdId, householdId));
    await db.delete(users).where(eq(users.id, userId));
    await db.delete(households).where(eq(households.id, householdId));
  }

  beforeAll(async () => {
    app = await getTestApp();
  });

  describe("email CHANGE flow (POST /api/settings/security/email/change + /verify)", () => {
    let userId: string;
    let householdId: string;
    let cookie: string;

    beforeAll(async () => {
      const { testUser, testHousehold } = await seedUser("change");
      userId = testUser.id;
      householdId = testHousehold.id;

      const login = await request(app)
        .post("/api/auth/login")
        .send({ email: testUser.email, password: PASSWORD })
        .expect(200);
      cookie = (login.headers["set-cookie"] as unknown as string[]).join("; ");
    });

    afterAll(async () => {
      await cleanupUser(userId, householdId);
    });

    it("persists only a SHA-256 hash of the raw token, never the raw value, and the raw token still verifies", async () => {
      const newEmail = `p7a-changed-${timestamp}@example.com`;

      const changeRes = await request(app)
        .post("/api/settings/security/email/change")
        .set("Cookie", cookie)
        .send({ newEmail, password: PASSWORD })
        .expect(200);
      expect(changeRes.body.success).toBe(true);

      const rowAfterChange = await loadUser(userId);
      expect(rowAfterChange.pendingEmail).toBe(newEmail);
      expect(rowAfterChange.emailVerificationToken).toBeTruthy();

      // Raw token as the app actually sent it to the (mocked) email boundary.
      const sentEmail = capturedVerificationEmails.find(
        (call) => call.email === newEmail,
      );
      expect(sentEmail).toBeDefined();
      const rawToken = sentEmail!.token;
      expect(rawToken).toMatch(/^[0-9a-f]{64}$/); // 32 random bytes, hex
      expect(sentEmail!.isEmailChange).toBe(true);

      // THE CORE ASSERTION (RED on pre-fix code, which stored `rawToken`
      // itself in this column): the stored column is the SHA-256 hash of
      // the raw token, NOT the raw token itself.
      expect(rowAfterChange.emailVerificationToken).not.toBe(rawToken);
      expect(rowAfterChange.emailVerificationToken).toBe(sha256Hex(rawToken));

      // --- Verifying WITH the raw (correct) token still succeeds end to
      // end, proving the hash-then-lookup path works. ---
      const verifyRes = await request(app)
        .post("/api/settings/security/email/verify")
        .send({ token: rawToken })
        .expect(200);
      expect(verifyRes.body.success).toBe(true);

      const rowAfterVerify = await loadUser(userId);
      expect(rowAfterVerify.email).toBe(newEmail);
      expect(rowAfterVerify.pendingEmail).toBeNull();
      expect(rowAfterVerify.emailVerificationToken).toBeNull();
    });

    it("rejects a wrong/tampered token", async () => {
      const newEmail = `p7a-changed-tampered-${timestamp}@example.com`;

      await request(app)
        .post("/api/settings/security/email/change")
        .set("Cookie", cookie)
        .send({ newEmail, password: PASSWORD })
        .expect(200);

      const sentEmail = capturedVerificationEmails.find(
        (call) => call.email === newEmail,
      );
      const realRawToken = sentEmail!.token;
      // Tamper: flip the token so it's still 64 hex chars (passes schema
      // validation) but hashes to something different.
      const tamperedToken =
        realRawToken.slice(0, -1) + (realRawToken.endsWith("0") ? "1" : "0");

      const res = await request(app)
        .post("/api/settings/security/email/verify")
        .send({ token: tamperedToken })
        .expect(400);
      expect(res.body.error.message).toMatch(/invalid|expired/i);

      // The pending change must still be intact - a wrong token must not
      // consume or clear it.
      const row = await loadUser(userId);
      expect(row.pendingEmail).toBe(newEmail);
      expect(row.emailVerificationToken).toBe(sha256Hex(realRawToken));
    });
  });

  describe("initial-verification flow (POST /api/auth/register + /api/auth/verify-email)", () => {
    let userId: string;
    let householdId: string | undefined;

    afterAll(async () => {
      if (householdId) {
        await db
          .delete(householdMembers)
          .where(eq(householdMembers.householdId, householdId));
        await db.delete(households).where(eq(households.id, householdId));
      }
      await db.delete(users).where(eq(users.id, userId));
    });

    it("stores only the SHA-256 hash of the registration verification token, and the raw token still verifies", async () => {
      const email = `p7a-register-${timestamp}@example.com`;
      const username = `p7a-register-${timestamp}`;

      const registerRes = await request(app)
        .post("/api/auth/register")
        .send({
          email,
          username,
          password: PASSWORD,
          fullName: "P7a Register Test",
        })
        .expect(201);
      userId = registerRes.body.data.user.id;

      const [membership] = await db
        .select()
        .from(householdMembers)
        .where(eq(householdMembers.userId, userId));
      householdId = membership?.householdId ?? undefined;

      const row = await loadUser(userId);
      expect(row.emailVerificationToken).toBeTruthy();

      // Raw token as sent to the (mocked) generic email boundary -
      // auth.email.service.ts builds the link itself and calls sendEmail
      // directly, so pull it back out of the captured email body.
      const sentEmail = capturedGenericEmails
        .filter((call) => call.to === email)
        .pop();
      expect(sentEmail).toBeDefined();
      const match = (sentEmail!.text || sentEmail!.html).match(
        /token=([0-9a-f]{64})/,
      );
      expect(match).toBeTruthy();
      const rawToken = match![1];

      // THE CORE ASSERTION: stored value is the hash, not the raw token.
      expect(row.emailVerificationToken).not.toBe(rawToken);
      expect(row.emailVerificationToken).toBe(sha256Hex(rawToken));

      // Using the stored (hashed) value directly as a bearer token must
      // fail - if it were the raw token, this would succeed, which is
      // exactly the vulnerability this packet closes.
      const wrongRes = await request(app)
        .post("/api/auth/verify-email")
        .send({ token: row.emailVerificationToken })
        .expect(400);
      expect(wrongRes.body.success).toBe(false);

      const rowStillUnverified = await loadUser(userId);
      expect(rowStillUnverified.emailVerified).toBe(false);
      expect(rowStillUnverified.emailVerificationToken).toBe(
        row.emailVerificationToken,
      );

      // The actual raw token from the email verifies successfully.
      const verifyRes = await request(app)
        .post("/api/auth/verify-email")
        .send({ token: rawToken })
        .expect(200);
      expect(verifyRes.body.success).toBe(true);

      const rowAfterVerify = await loadUser(userId);
      expect(rowAfterVerify.emailVerified).toBe(true);
      expect(rowAfterVerify.emailVerificationToken).toBeNull();
    });
  });

  describe("resend flow (POST /api/settings/security/email/resend)", () => {
    let userId: string;
    let householdId: string;
    let cookie: string;

    beforeAll(async () => {
      const { testUser, testHousehold } = await seedUser("resend");
      userId = testUser.id;
      householdId = testHousehold.id;

      const login = await request(app)
        .post("/api/auth/login")
        .send({ email: testUser.email, password: PASSWORD })
        .expect(200);
      cookie = (login.headers["set-cookie"] as unknown as string[]).join("; ");

      await db
        .update(users)
        .set({ emailVerified: false })
        .where(eq(users.id, userId));
    });

    afterAll(async () => {
      await cleanupUser(userId, householdId);
    });

    it("rotates to a new hashed token that differs from the previous one, and only the new raw token verifies", async () => {
      const firstRow = await loadUser(userId);

      const resendRes = await request(app)
        .post("/api/settings/security/email/resend")
        .set("Cookie", cookie)
        .send({})
        .expect(200);
      expect(resendRes.body.success).toBe(true);

      const secondRow = await loadUser(userId);
      expect(secondRow.emailVerificationToken).toBeTruthy();
      expect(secondRow.emailVerificationToken).not.toBe(
        firstRow.emailVerificationToken,
      );
      expect(secondRow.emailVerificationToken).toMatch(/^[0-9a-f]{64}$/);

      const sentEmail = capturedVerificationEmails
        .filter((call) => call.email === firstRow.email)
        .pop();
      expect(sentEmail).toBeDefined();
      const rawToken = sentEmail!.token;
      expect(secondRow.emailVerificationToken).toBe(sha256Hex(rawToken));

      const verifyRes = await request(app)
        .post("/api/settings/security/email/verify")
        .send({ token: rawToken })
        .expect(200);
      expect(verifyRes.body.success).toBe(true);
    });
  });
});
