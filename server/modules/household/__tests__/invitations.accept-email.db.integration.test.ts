/**
 * Accepting a household invitation requires the invited email — REAL DB,
 * REAL HTTP.
 *
 * acceptInvite looked the invitation up by its code and never compared
 * invitation.email with the signed-in user, so any account holding the code
 * could join the household. Mounts the real controller and repository
 * against Postgres; only the audit service and rate limiter are stubbed.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import express from "express";
import request from "supertest";
import { randomUUID } from "crypto";
import { eq, inArray } from "drizzle-orm";

vi.mock("../../../services/BusinessAuditService", () => ({
  businessAuditService: {
    logCreate: vi.fn().mockResolvedValue(undefined),
    logUpdate: vi.fn().mockResolvedValue(undefined),
    logDelete: vi.fn().mockResolvedValue(undefined),
    log: vi.fn().mockResolvedValue(undefined),
    getIpAddress: vi.fn().mockReturnValue("127.0.0.1"),
  },
}));
vi.mock("../../../middleware/rateLimit", () => {
  const passthrough = (_req: unknown, _res: unknown, next: () => void) =>
    next();
  return {
    generalLimiter: passthrough,
    analyticsLimiter: passthrough,
    authLimiter: passthrough,
    ipAuthLimiter: passthrough,
    strictLimiter: passthrough,
    expensiveAnalyticsLimiter: passthrough,
    uploadLimiter: passthrough,
  };
});

import { db } from "../../../db";
import {
  households,
  householdMembers,
  householdInvitations,
  users,
} from "@shared/schema";
import { householdController } from "../household.controller";
import { createTestUser } from "../../../__tests__/fixtures";

function buildApp(currentUserId: { value: string }) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as unknown as { session: { userId: string } }).session = {
      userId: currentUserId.value,
    };
    next();
  });
  app.post("/api/household/invite/accept", householdController.acceptInvite);
  app.use(
    (
      err: Error & { statusCode?: number; status?: number },
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction
    ) => {
      res.status(err.statusCode || err.status || 500).json({
        success: false,
        error: { code: err.name || "ERROR", message: err.message },
      });
    }
  );
  return app;
}

describe("acceptInvite only for the invited email — real DB", () => {
  const stamp = randomUUID().slice(0, 8);
  const householdId = randomUUID();
  const userIds: string[] = [];
  const currentUserId = { value: "" };
  const app = buildApp(currentUserId);

  const exactEmail = `invitee-exact-${stamp}@example.com`;
  const casedEmail = `invitee-cased-${stamp}@example.com`;
  const exactCode = `exact-${stamp}`;
  const casedCode = `cased-${stamp}`;
  let ownerId: string;
  let strangerId: string;
  let exactId: string;
  let casedId: string;

  async function seedUser(email: string): Promise<string> {
    const u = createTestUser({ email, username: `inv-${randomUUID().slice(0, 12)}` });
    await db.insert(users).values({
      id: u.id,
      email: u.email,
      username: u.username,
      passwordHash: u.passwordHash,
      fullName: u.fullName,
      emailVerified: true,
    });
    userIds.push(u.id);
    return u.id;
  }

  const findMembership = async (userId: string) =>
    (
      await db
        .select()
        .from(householdMembers)
        .where(eq(householdMembers.userId, userId))
    )[0];

  const findInvitation = async (inviteCode: string) =>
    (
      await db
        .select()
        .from(householdInvitations)
        .where(eq(householdInvitations.inviteCode, inviteCode))
    )[0];

  beforeAll(async () => {
    await db
      .insert(households)
      .values({ id: householdId, name: "Invite HH", currency: "ZMW" });
    ownerId = await seedUser(`owner-${stamp}@example.com`);
    strangerId = await seedUser(`stranger-${stamp}@example.com`);
    exactId = await seedUser(exactEmail);
    // Stored with different letter case than the (lowercased) invitation.
    casedId = await seedUser(casedEmail.toUpperCase());
    await db
      .insert(householdMembers)
      .values({ householdId, userId: ownerId, role: "owner" });

    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    await db.insert(householdInvitations).values([
      { householdId, email: exactEmail, role: "member", inviteCode: exactCode, invitedBy: ownerId, expiresAt },
      { householdId, email: casedEmail, role: "member", inviteCode: casedCode, invitedBy: ownerId, expiresAt },
    ]);
  });

  afterAll(async () => {
    await db
      .delete(householdInvitations)
      .where(eq(householdInvitations.householdId, householdId));
    await db
      .delete(householdMembers)
      .where(eq(householdMembers.householdId, householdId));
    await db.delete(households).where(eq(households.id, householdId));
    await db.delete(users).where(inArray(users.id, userIds));
  });

  it("rejects a different account with 403, adds no member and leaves the invite unused", async () => {
    currentUserId.value = strangerId;

    const res = await request(app)
      .post("/api/household/invite/accept")
      .send({ inviteCode: exactCode });

    expect(res.status).toBe(403);
    expect(res.body.error.message).toMatch(/different email address/i);
    expect(JSON.stringify(res.body)).not.toContain(exactEmail);
    expect(await findMembership(strangerId)).toBeUndefined();
    const invitation = await findInvitation(exactCode);
    expect(invitation.acceptedAt).toBeNull();
    expect(invitation.acceptedBy).toBeNull();
  });

  it("lets the invited account accept", async () => {
    currentUserId.value = exactId;

    const res = await request(app)
      .post("/api/household/invite/accept")
      .send({ inviteCode: exactCode });

    expect(res.status).toBe(200);
    expect((await findMembership(exactId))?.householdId).toBe(householdId);
    expect((await findInvitation(exactCode)).acceptedBy).toBe(exactId);
  });

  it("matches the invited email regardless of letter case", async () => {
    currentUserId.value = casedId;

    const res = await request(app)
      .post("/api/household/invite/accept")
      .send({ inviteCode: casedCode });

    expect(res.status).toBe(200);
    expect((await findMembership(casedId))?.householdId).toBe(householdId);
  });
});
