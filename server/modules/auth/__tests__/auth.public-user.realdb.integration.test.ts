/**
 * Auth responses expose only public user fields (REAL DB, REAL HTTP).
 *
 * register, login, MFA verify and GET /auth/me stripped only passwordHash
 * and returned the rest of the users row: the hashed email-verification
 * token and its expiry, the pending MFA code and backup codes, lockout
 * counters, NRC, income and other internal columns.
 *
 * Only the outgoing email boundary is mocked; the routes, service and
 * Postgres are real.
 */
import request from "supertest";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { Express } from "express";
import { eq, inArray } from "drizzle-orm";
import { db } from "../../../db";
import { users, households, householdMembers } from "@shared/schema";
import { getTestApp, createTestUser } from "../../../__tests__/fixtures";
import { hashPassword } from "../../../auth";

vi.mock("../../../services/emailService", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../../services/emailService")>();
  return {
    ...actual,
    sendVerificationEmail: vi.fn(async () => true),
    sendEmail: vi.fn(async () => true),
  };
});

const PASSWORD = "PublicUser123!";
const PRIVATE_FIELDS = [
  "passwordHash",
  "emailVerificationToken",
  "emailVerificationExpiry",
  "pendingEmail",
  "mfaCode",
  "mfaCodeExpiry",
  "mfaBackupCodes",
  "failedLoginAttempts",
  "lockedUntil",
  "lastFailedLoginAt",
  "nrc",
  "annualIncome",
];

function expectPublicUser(user: Record<string, unknown>, email: string) {
  expect(user.id).toEqual(expect.any(String));
  expect(user.email).toBe(email);
  expect(user.username).toEqual(expect.any(String));
  for (const field of PRIVATE_FIELDS) {
    expect(user, `response leaks ${field}`).not.toHaveProperty(field);
  }
}

describe("Auth responses return only public user fields (real DB)", () => {
  const stamp = Date.now();
  const createdUserIds: string[] = [];
  let app: Express;

  beforeAll(async () => {
    app = await getTestApp();
  });

  afterAll(async () => {
    if (createdUserIds.length === 0) return;
    const memberships = await db
      .select()
      .from(householdMembers)
      .where(inArray(householdMembers.userId, createdUserIds));
    const householdIds = memberships.flatMap((m) =>
      m.householdId ? [m.householdId] : [],
    );
    if (householdIds.length > 0) {
      await db
        .delete(householdMembers)
        .where(inArray(householdMembers.householdId, householdIds));
      await db.delete(households).where(inArray(households.id, householdIds));
    }
    await db.delete(users).where(inArray(users.id, createdUserIds));
  });

  it("register returns the new user without secret or internal columns", async () => {
    const email = `public-user-reg-${stamp}@example.com`;
    const res = await request(app)
      .post("/api/auth/register")
      .send({
        email,
        username: `public-user-reg-${stamp}`,
        password: PASSWORD,
        fullName: "Public User",
      })
      .expect(201);
    createdUserIds.push(res.body.data.user.id);

    // The row really holds a verification token; the response must not.
    const [row] = await db
      .select()
      .from(users)
      .where(eq(users.id, res.body.data.user.id));
    expect(row.emailVerificationToken).toBeTruthy();
    expectPublicUser(res.body.data.user, email);
  });

  it("login and GET /auth/me return the user without secret or internal columns", async () => {
    const seeded = createTestUser({
      email: `public-user-login-${stamp}@example.com`,
      username: `public-user-login-${stamp}`,
    });
    await db.insert(users).values({
      id: seeded.id,
      email: seeded.email,
      username: seeded.username,
      passwordHash: await hashPassword(PASSWORD),
      fullName: seeded.fullName,
      emailVerified: true,
      emailVerificationToken: "stale-hashed-token",
      mfaEnabled: false,
      mfaBackupCodes: ["hashed-backup-code"],
      nrc: "123456/10/1",
      failedLoginAttempts: 0,
      lockedUntil: null,
    });
    createdUserIds.push(seeded.id);

    const login = await request(app)
      .post("/api/auth/login")
      .send({ email: seeded.email, password: PASSWORD })
      .expect(200);
    expectPublicUser(login.body.data.user, seeded.email);

    const cookie = (login.headers["set-cookie"] as unknown as string[]).join(
      "; ",
    );
    const me = await request(app)
      .get("/api/auth/me")
      .set("Cookie", cookie)
      .expect(200);
    expectPublicUser(me.body.data.user, seeded.email);
  });
});
