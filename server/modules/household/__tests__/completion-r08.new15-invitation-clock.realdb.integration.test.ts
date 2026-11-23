/**
 * NEW-15: naive timestamps use one clock — REAL DB, REAL HTTP.
 *
 * `timestamp without time zone` columns were written by two clocks: DB
 * `defaultNow()` writes the wall time of the session TimeZone, while drizzle
 * and node-postgres write JS dates as UTC. On a database whose default zone
 * is not UTC (Lusaka, UTC+2), an invitation's `created_at` landed two hours
 * after its `accepted_at`, and its seven-day window measured from
 * `created_at` came out two hours short. The database default is forced to
 * Africa/Lusaka here so the test means the same thing on a UTC CI server.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import express from "express";
import request from "supertest";
import { randomUUID } from "crypto";
import { eq, inArray, sql } from "drizzle-orm";

vi.mock("../../../services/BusinessAuditService", () => ({
  businessAuditService: {
    logCreate: vi.fn().mockResolvedValue(undefined),
    logUpdate: vi.fn().mockResolvedValue(undefined),
    logDelete: vi.fn().mockResolvedValue(undefined),
    log: vi.fn().mockResolvedValue(undefined),
    getIpAddress: vi.fn().mockReturnValue("127.0.0.1"),
  },
}));
vi.mock("../../../services/emailService", () => ({
  sendEmail: vi.fn().mockResolvedValue(true),
}));
vi.mock("../../../middleware/rateLimit", () => {
  const passthrough = (_req: unknown, _res: unknown, next: () => void) => next();
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

import { db, pool } from "../../../db";
import { households, householdMembers, householdInvitations, users } from "@shared/schema";
import { householdController } from "../household.controller";
import { createTestUser } from "../../../__tests__/fixtures";

const MINUTE_MS = 60_000;
const SEVEN_DAYS_MS = 7 * 24 * 60 * MINUTE_MS;
const MAX_DRIFT_SECONDS = 120;

/** Drops idle pooled connections so the next query opens a fresh session. */
async function recyclePool(): Promise<void> {
  while (pool.idleCount > 0) {
    const client = await pool.connect();
    client.release(true);
  }
}

/** Sets (or resets, with null) the database's default session zone. */
async function setDatabaseZone(zone: "Africa/Lusaka" | null): Promise<void> {
  await db.execute(zone === null
    ? sql`DO $$ BEGIN EXECUTE format('ALTER DATABASE %I RESET timezone', current_database()); END $$`
    : sql`DO $$ BEGIN EXECUTE format('ALTER DATABASE %I SET timezone TO ''Africa/Lusaka''', current_database()); END $$`);
  await recyclePool();
}

function buildApp(currentUserId: { value: string }) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as unknown as { session: { userId: string } }).session = { userId: currentUserId.value };
    next();
  });
  app.post("/api/household/invite", householdController.inviteMember);
  app.post("/api/household/invite/accept", householdController.acceptInvite);
  app.use((err: Error & { statusCode?: number }, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(err.statusCode || 500).json({ success: false, error: { code: err.name, message: err.message } });
  });
  return app;
}

describe("NEW-15 one clock for naive timestamps — real DB", () => {
  const stamp = randomUUID().slice(0, 8);
  const householdId = randomUUID();
  const userIds: string[] = [];
  const currentUserId = { value: "" };
  const app = buildApp(currentUserId);
  const inviteeEmail = `new15-invitee-${stamp}@example.com`;
  let ownerId: string;
  let inviteeId: string;

  async function seedUser(email: string): Promise<string> {
    const u = createTestUser({ email, username: `n15-${randomUUID().slice(0, 12)}` });
    await db.insert(users).values({
      id: u.id, email: u.email, username: u.username, passwordHash: u.passwordHash, fullName: u.fullName, emailVerified: true,
    });
    userIds.push(u.id);
    return u.id;
  }

  beforeAll(async () => {
    await db.insert(households).values({ id: householdId, name: "Clock HH", currency: "ZMW" });
    ownerId = await seedUser(`new15-owner-${stamp}@example.com`);
    inviteeId = await seedUser(inviteeEmail);
    await db.insert(householdMembers).values({ householdId, userId: ownerId, role: "owner" });
    // Last, so a failed seed never leaves the database default on Lusaka.
    await setDatabaseZone("Africa/Lusaka");
  });

  afterAll(async () => {
    // The zone reset runs first and in `finally`, so failed row cleanup can
    // never leave the test database on Lusaka for later files.
    try {
      await setDatabaseZone(null);
    } finally {
      await db.delete(householdInvitations).where(eq(householdInvitations.householdId, householdId));
      await db.delete(householdMembers).where(eq(householdMembers.householdId, householdId));
      await db.delete(households).where(eq(households.id, householdId));
      await db.delete(users).where(inArray(users.id, userIds));
    }
  });

  it("an invitation is created now, lasts seven days, and is accepted after it was created", async () => {
    currentUserId.value = ownerId;
    const sentAt = Date.now();
    const invited = await request(app).post("/api/household/invite").send({ email: inviteeEmail });
    expect(invited.status).toBe(201);

    const [invitation] = await db.select().from(householdInvitations)
      .where(eq(householdInvitations.householdId, householdId));
    expect(invitation.createdAt).not.toBeNull();
    const createdAt = invitation.createdAt!.getTime();
    expect(Math.abs(createdAt - sentAt)).toBeLessThan(2 * MINUTE_MS);
    expect(Math.abs(invitation.expiresAt.getTime() - createdAt - SEVEN_DAYS_MS)).toBeLessThan(2 * MINUTE_MS);

    currentUserId.value = inviteeId;
    const accepted = await request(app).post("/api/household/invite/accept").send({ inviteCode: invitation.inviteCode });
    expect(accepted.status).toBe(200);

    const [after] = await db.select().from(householdInvitations).where(eq(householdInvitations.id, invitation.id));
    expect(after.acceptedAt).not.toBeNull();
    expect(after.acceptedAt!.getTime()).toBeGreaterThanOrEqual(createdAt);
  });

  it("an expiry window checked in SQL against now() keeps its full length", async () => {
    const expiresAt = new Date(Date.now() + 60 * MINUTE_MS);
    const [row] = (await db.execute<{ open: boolean }>(sql`
      SELECT (${expiresAt.toISOString()}::timestamp > now()::timestamp + interval '59 minutes') AS open
    `)).rows;
    expect(row.open).toBe(true);
  });

  it("raw node-postgres date parameters land on the same clock as now()", async () => {
    const { rows } = await pool.query<{ drift_seconds: string }>(
      "SELECT abs(extract(epoch FROM ($1::timestamp - now()::timestamp)))::text AS drift_seconds",
      [new Date()],
    );
    expect(Number(rows[0].drift_seconds)).toBeLessThan(MAX_DRIFT_SECONDS);
  });
});
