/**
 * Settings Module - Integration Tests
 *
 * Focused integration coverage for active settings endpoints.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { and, eq } from "drizzle-orm";
import { db } from "../../../db";
import {
  users,
  households,
  householdMembers,
  auditLogs,
  userDisplaySettings,
  userNotificationPreferences,
  householdPreferences,
} from "@shared/schema";
import {
  createTestUser,
  createTestHousehold,
  getTestApp,
} from "../../../__tests__/fixtures";
import { hashPassword } from "../../../auth";
import { NOTIFICATION_TYPES } from "@shared/notificationTypes";

describe("Settings Integration Tests", () => {
  let app: Express;
  let authCookie: string;
  let householdId: string;
  let userId: string;
  let testUser: ReturnType<typeof createTestUser>;
  let testHousehold: ReturnType<typeof createTestHousehold>;

  beforeAll(async () => {
    app = await getTestApp();

    const ts = Date.now();
    testUser = createTestUser({
      email: `settings-int-${ts}@example.com`,
      username: `settings-int-${ts}`,
    });
    testHousehold = createTestHousehold(testUser.id, {
      name: "Settings Integration Household",
    });

    const passwordHash = await hashPassword("TestPassword123");
    testUser.passwordHash = passwordHash;

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
      emailVerified: true,
      mfaEnabled: false,
      failedLoginAttempts: 0,
      lockedUntil: null,
    });

    await db.insert(householdMembers).values({
      householdId: testHousehold.id,
      userId: testUser.id,
      role: "owner",
    });

    const loginRes = await request(app).post("/api/auth/login").send({
      email: testUser.email,
      password: "TestPassword123",
    });

    expect(loginRes.status).toBe(200);
    authCookie = loginRes.headers["set-cookie"][0];
    userId = testUser.id;
    householdId = testHousehold.id;
  });

  afterAll(async () => {
    await db.delete(auditLogs).where(eq(auditLogs.userId, userId));
    await db
      .delete(userNotificationPreferences)
      .where(eq(userNotificationPreferences.userId, userId));
    await db
      .delete(userDisplaySettings)
      .where(eq(userDisplaySettings.userId, userId));
    await db
      .delete(householdPreferences)
      .where(eq(householdPreferences.householdId, householdId));
    await db
      .delete(householdMembers)
      .where(
        and(
          eq(householdMembers.userId, userId),
          eq(householdMembers.householdId, householdId),
        ),
      );
    await db.delete(users).where(eq(users.id, userId));
    await db.delete(households).where(eq(households.id, householdId));
  });

  it("returns profile for authenticated user", async () => {
    const res = await request(app)
      .get("/api/settings/profile")
      .set("Cookie", authCookie);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.profile.id).toBe(userId);
    expect(res.body.data.profile.passwordHash).toBeUndefined();
  });

  it("updates profile and writes audit log", async () => {
    const res = await request(app)
      .put("/api/settings/profile")
      .set("Cookie", authCookie)
      .send({ fullName: "Updated Settings User", birthday: "1990-05-15" });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const logs = await db
      .select()
      .from(auditLogs)
      .where(
        and(
          eq(auditLogs.userId, userId),
          eq(auditLogs.entityType, "user"),
          eq(auditLogs.action, "UPDATE"),
        ),
      );

    expect(logs.length).toBeGreaterThan(0);
  });

  it("gets and updates display settings and writes audit log", async () => {
    const getRes = await request(app)
      .get("/api/settings/display")
      .set("Cookie", authCookie);

    expect(getRes.status).toBe(200);
    expect(getRes.body.success).toBe(true);

    const putRes = await request(app)
      .put("/api/settings/display")
      .set("Cookie", authCookie)
      .send({ theme: "light", currency: "USD", locale: "en-US" });

    expect(putRes.status).toBe(200);
    expect(putRes.body.success).toBe(true);

    const [settings] = await db
      .select()
      .from(userDisplaySettings)
      .where(eq(userDisplaySettings.userId, userId));

    expect(settings).toBeTruthy();
    expect(settings.theme).toBe("light");
    expect(settings.currency).toBe("USD");

    const logs = await db
      .select()
      .from(auditLogs)
      .where(
        and(
          eq(auditLogs.userId, userId),
          eq(auditLogs.entityType, "display_settings"),
          eq(auditLogs.action, "UPDATE"),
        ),
      );

    expect(logs.length).toBeGreaterThan(0);
  });

  it("gets and updates notification preferences and writes audit log", async () => {
    const getRes = await request(app)
      .get("/api/settings/notifications")
      .set("Cookie", authCookie);

    expect(getRes.status).toBe(200);
    expect(getRes.body.success).toBe(true);

    const putRes = await request(app)
      .put("/api/settings/notifications")
      .set("Cookie", authCookie)
      .send({
        preferences: [
          {
            notificationType: NOTIFICATION_TYPES.BUDGET_WARNING,
            inAppEnabled: true,
            emailEnabled: true,
            pushEnabled: false,
            thresholdAmount: "100.00",
          },
        ],
      });

    expect(putRes.status).toBe(200);
    expect(putRes.body.success).toBe(true);

    const rows = await db
      .select()
      .from(userNotificationPreferences)
      .where(
        and(
          eq(userNotificationPreferences.userId, userId),
          eq(userNotificationPreferences.notificationType, NOTIFICATION_TYPES.BUDGET_WARNING),
        ),
      );

    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0].emailEnabled).toBe(true);

    const logs = await db
      .select()
      .from(auditLogs)
      .where(
        and(
          eq(auditLogs.userId, userId),
          eq(auditLogs.entityType, "notification_preference"),
        ),
      );

    expect(logs.length).toBeGreaterThan(0);
    expect(logs.some((log) => log.action === "CREATE" || log.action === "UPDATE"))
      .toBe(true);
  });

  it("gets and updates household preferences and writes audit log", async () => {
    const getRes = await request(app)
      .get("/api/settings/preferences")
      .set("Cookie", authCookie);

    expect(getRes.status).toBe(200);
    expect(getRes.body.success).toBe(true);

    const putRes = await request(app)
      .put("/api/settings/preferences")
      .set("Cookie", authCookie)
      .send({
        showPendingTransactions: false,
        allowEditPending: false,
      });

    expect(putRes.status).toBe(200);
    expect(putRes.body.success).toBe(true);

    const [prefs] = await db
      .select()
      .from(householdPreferences)
      .where(eq(householdPreferences.householdId, householdId));

    expect(prefs).toBeTruthy();
    expect(prefs.showPendingTransactions).toBe(false);
    expect(prefs.allowEditPending).toBe(false);

    const logs = await db
      .select()
      .from(auditLogs)
      .where(
        and(
          eq(auditLogs.userId, userId),
          eq(auditLogs.householdId, householdId),
          eq(auditLogs.entityType, "household_preferences"),
          eq(auditLogs.action, "UPDATE"),
        ),
      );

    expect(logs.length).toBeGreaterThan(0);
  });

  it("returns 401 without authentication", async () => {
    const res = await request(app).get("/api/settings/profile");
    expect(res.status).toBe(401);
  });
});
