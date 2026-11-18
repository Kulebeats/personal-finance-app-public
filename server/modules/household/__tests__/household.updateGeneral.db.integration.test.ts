/**
 * SCP-333: updateGeneral authorization — REAL DB, REAL HTTP.
 *
 * updateGeneral (household rename / base-currency change) previously did NOT
 * check the caller's role, so a view_only (or plain member) could rename the
 * household or change its base currency. This test mounts the REAL household
 * controller against the REAL repository and a real Postgres DB (no repo mock)
 * and drives it over real HTTP requests:
 *
 *  - a view_only member is rejected with 403 (ForbiddenError) for both a rename
 *    and a currency change, and the household row is unchanged;
 *  - an owner and an admin succeed (200) and the change is persisted.
 *
 * Only BusinessAuditService and the rate limiter are stubbed (no DB writes /
 * timing concerns); the authorization + persistence path is fully real.
 */
import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
  vi,
} from "vitest";
import express from "express";
import request from "supertest";
import { randomUUID } from "crypto";
import { eq } from "drizzle-orm";

// Stub audit (no real audit_logs writes) + rate limiter; everything else real.
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
import { households, householdMembers, users } from "@shared/schema";
import { householdController } from "../household.controller";
import { createTestUser, createTestHousehold } from "../../../__tests__/fixtures";

type SeededUser = { id: string };

function buildApp(currentUserId: { value: string }) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    // Real session shape the controller reads: req.session.userId
    (req as unknown as { session: { userId: string } }).session = {
      userId: currentUserId.value,
    };
    next();
  });
  app.put("/api/household/general", householdController.updateGeneral);
  app.use(
    (
      err: Error & { statusCode?: number; status?: number },
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction
    ) => {
      const statusCode = err.statusCode || err.status || 500;
      res.status(statusCode).json({
        success: false,
        error: { code: err.name || "ERROR", message: err.message },
      });
    }
  );
  return app;
}

describe("updateGeneral authorization (SCP-333) — real DB", () => {
  let householdId: string;
  const userIds: string[] = [];
  const currentUserId = { value: "" };
  let app: ReturnType<typeof buildApp>;

  let ownerId: string;
  let adminId: string;
  let viewOnlyId: string;

  async function seedUser(label: string): Promise<SeededUser> {
    const u = createTestUser({
      email: `scp333gen-${label}-${randomUUID().slice(0, 8)}@example.com`,
      username: `scp333gen-${label}-${randomUUID().slice(0, 8)}`,
    });
    await db.insert(users).values({
      id: u.id,
      email: u.email,
      username: u.username,
      passwordHash: u.passwordHash,
      fullName: u.fullName,
      emailVerified: u.emailVerified,
      mfaEnabled: u.mfaEnabled,
      failedLoginAttempts: u.failedLoginAttempts,
      lockedUntil: u.lockedUntil,
    });
    userIds.push(u.id);
    return { id: u.id };
  }

  beforeAll(async () => {
    const hh = createTestHousehold(randomUUID(), {
      name: "Original Name",
      currency: "ZMW",
    });
    householdId = hh.id;
    await db.insert(households).values({
      id: hh.id,
      name: hh.name,
      currency: hh.currency,
    });

    ownerId = (await seedUser("owner")).id;
    adminId = (await seedUser("admin")).id;
    viewOnlyId = (await seedUser("viewonly")).id;

    await db.insert(householdMembers).values([
      { householdId, userId: ownerId, role: "owner" },
      { householdId, userId: adminId, role: "admin" },
      { householdId, userId: viewOnlyId, role: "view_only" },
    ]);

    app = buildApp(currentUserId);
  });

  afterAll(async () => {
    try {
      await db
        .delete(householdMembers)
        .where(eq(householdMembers.householdId, householdId));
      for (const id of userIds) {
        await db.delete(users).where(eq(users.id, id));
      }
      await db.delete(households).where(eq(households.id, householdId));
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error("SCP-333 updateGeneral cleanup error", error);
    }
  });

  beforeEach(async () => {
    // Reset the household to a known state before each case.
    await db
      .update(households)
      .set({ name: "Original Name", currency: "ZMW" })
      .where(eq(households.id, householdId));
  });

  const readHousehold = async () =>
    (
      await db
        .select()
        .from(households)
        .where(eq(households.id, householdId))
        .limit(1)
    )[0];

  it("rejects a view_only member renaming the household (403) and persists nothing", async () => {
    currentUserId.value = viewOnlyId;

    const res = await request(app)
      .put("/api/household/general")
      .send({ name: "Hacked Name" });

    expect(res.status).toBe(403);
    expect((await readHousehold()).name).toBe("Original Name");
  });

  it("rejects a view_only member changing base currency (403) and persists nothing", async () => {
    currentUserId.value = viewOnlyId;

    const res = await request(app)
      .put("/api/household/general")
      .send({ currency: "USD" });

    expect(res.status).toBe(403);
    expect((await readHousehold()).currency).toBe("ZMW");
  });

  it("allows the owner to rename the household (200) and persists it", async () => {
    currentUserId.value = ownerId;

    const res = await request(app)
      .put("/api/household/general")
      .send({ name: "Owner Renamed" });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect((await readHousehold()).name).toBe("Owner Renamed");
  });

  it("allows an admin to change the base currency (200) and persists it", async () => {
    currentUserId.value = adminId;

    const res = await request(app)
      .put("/api/household/general")
      .send({ currency: "USD" });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect((await readHousehold()).currency).toBe("USD");
  });
});
