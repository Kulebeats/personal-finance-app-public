/**
 * NEW-26: a notification-preference save and a display-settings save commit
 * together with their audit row. Each write is audited, and when the audit row
 * cannot be written the write rolls back. Real HTTP against real Postgres.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db, pool } from "../../../db";
import {
  auditLogs, householdMembers, households, userDisplaySettings, userNotificationPreferences, users,
} from "@shared/schema";
import { NOTIFICATION_TYPES } from "@shared/notificationTypes";
import { hashPassword } from "../../../auth";
import { getTestApp } from "../../../__tests__/fixtures";
import { businessAuditService } from "../../../services/BusinessAuditService";

const password = "SyntheticPrefAuditTx123!";
const householdId = randomUUID();
const userId = randomUUID();
const existingType = NOTIFICATION_TYPES.LARGE_TRANSACTION;
const freshType = NOTIFICATION_TYPES.BUDGET_WARNING;
const createdType = NOTIFICATION_TYPES.GOAL_PROGRESS;
let app: Awaited<ReturnType<typeof getTestApp>>;
let cookie: string;

const preference = async (notificationType: string) => {
  const [row] = await db.select().from(userNotificationPreferences).where(and(
    eq(userNotificationPreferences.userId, userId),
    eq(userNotificationPreferences.notificationType, notificationType),
  ));
  return row;
};
const display = async () => {
  const [row] = await db.select().from(userDisplaySettings).where(eq(userDisplaySettings.userId, userId));
  return row;
};
const auditRows = (entityType: string) => db.select().from(auditLogs)
  .where(and(eq(auditLogs.userId, userId), eq(auditLogs.entityType, entityType)));
const putNotifications = (preferences: object[]) =>
  request(app).put("/api/settings/notifications").set("Cookie", cookie).send({ preferences });
const putDisplay = (settings: object) =>
  request(app).put("/api/settings/display").set("Cookie", cookie).send(settings);

async function withFailingAudit(action: () => Promise<unknown>) {
  const auditWrite = vi.spyOn(businessAuditService, "log").mockRejectedValueOnce(new Error("synthetic audit failure"));
  try {
    await action();
  } finally {
    auditWrite.mockRestore();
  }
}

describe("NEW-26 preference and display saves are audited in the same transaction", () => {
  beforeAll(async () => {
    app = await getTestApp();
    const email = `pref-audit-tx-${userId}@example.test`;
    await db.insert(households).values({ id: householdId, name: "Synthetic preference audit" });
    await db.insert(users).values({
      id: userId, email, username: `pref-audit-tx-${userId}`, passwordHash: await hashPassword(password),
      emailVerified: true, fullName: "Synthetic Preference Owner",
    });
    await db.insert(householdMembers).values({ userId, householdId, role: "owner" });
    await db.insert(userNotificationPreferences).values({
      userId, notificationType: existingType, emailEnabled: true, inAppEnabled: true, pushEnabled: false,
    });
    const login = await request(app).post("/api/auth/login").send({ email, password }).expect(200);
    cookie = (login.headers["set-cookie"] as unknown as string[]).join("; ");
  }, 30000);

  afterAll(async () => {
    await db.delete(auditLogs).where(eq(auditLogs.userId, userId));
    await db.delete(userNotificationPreferences).where(eq(userNotificationPreferences.userId, userId));
    await db.delete(userDisplaySettings).where(eq(userDisplaySettings.userId, userId));
    await pool.query("DELETE FROM \"session\" WHERE sess->>'userId' = $1", [userId]);
    await db.delete(householdMembers).where(eq(householdMembers.householdId, householdId));
    await db.delete(users).where(eq(users.id, userId));
    await db.delete(households).where(eq(households.id, householdId));
  });

  it("rolls a notification preference update back when its audit row cannot be written", async () => {
    await withFailingAudit(() => putNotifications([{ notificationType: existingType, emailEnabled: false }]).expect(500));

    expect(await preference(existingType)).toMatchObject({ emailEnabled: true, inAppEnabled: true });
  });

  it("rolls a new notification preference back when its audit row cannot be written", async () => {
    await withFailingAudit(() => putNotifications([{ notificationType: freshType, emailEnabled: true }]).expect(500));

    expect(await preference(freshType)).toBeUndefined();
  });

  it("rolls a display settings update back when its audit row cannot be written", async () => {
    await putDisplay({ theme: "light" }).expect(200);
    await withFailingAudit(() => putDisplay({ theme: "dark" }).expect(500));

    expect((await display())?.theme).toBe("light");
  });

  it("writes a notification_preference audit row for a create and for an update", async () => {
    // A type no other case writes, so the CREATE does not depend on test order.
    await putNotifications([{ notificationType: createdType, emailEnabled: true }]).expect(200);
    await putNotifications([{ notificationType: existingType, emailEnabled: false }]).expect(200);

    const rows = await auditRows("notification_preference");
    const auditFor = (action: string, notificationType: string) => rows.find(row => row.action === action
      && (row.details as { notificationType?: string }).notificationType === notificationType);
    // User-level settings: these routes carry no household context, so the audit row has none.
    expect(auditFor("CREATE", createdType)).toMatchObject({ householdId: null, entityId: userId });
    expect(auditFor("UPDATE", existingType)).toMatchObject({
      householdId: null, entityId: userId,
      details: expect.objectContaining({ newValue: { notificationType: existingType, emailEnabled: false } }),
    });
    expect(await preference(existingType)).toMatchObject({ emailEnabled: false });
  });

  it("writes a display_settings audit row for an update", async () => {
    await putDisplay({ theme: "dark" }).expect(200);

    expect(await auditRows("display_settings")).toEqual(expect.arrayContaining([expect.objectContaining({
      action: "UPDATE", householdId: null, entityId: userId, details: expect.objectContaining({ newValue: { theme: "dark" } }),
    })]));
    expect((await display())?.theme).toBe("dark");
  });
});
