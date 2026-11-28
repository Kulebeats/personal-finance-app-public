/**
 * NEW-26 follow-up: PUT /api/investments/notifications/preferences commits the
 * preference write together with its audit row. The write and its audit run in
 * one transaction, so a failed audit rolls the write back and the route answers
 * 500 (Rules 9 and 10). Real HTTP against real Postgres.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db, pool } from "../../../db";
import { auditLogs, householdMembers, households, userNotificationPreferences, users } from "@shared/schema";
import { hashPassword } from "../../../auth";
import { getTestApp } from "../../../__tests__/fixtures";
import { businessAuditService } from "../../../services/BusinessAuditService";

const password = "SyntheticInvestPrefAuditTx123!";
const householdId = randomUUID();
const userId = randomUUID();
const existingType = "price_alert";
const freshType = "coupon_payment";
const createdType = "maturity_reminder";
let app: Awaited<ReturnType<typeof getTestApp>>;
let cookie: string;

const preference = async (notificationType: string) => {
  const [row] = await db.select().from(userNotificationPreferences).where(and(
    eq(userNotificationPreferences.userId, userId),
    eq(userNotificationPreferences.notificationType, notificationType),
  ));
  return row;
};
const auditRows = () => db.select().from(auditLogs)
  .where(and(eq(auditLogs.userId, userId), eq(auditLogs.entityType, "user")));
const put = (body: object) =>
  request(app).put("/api/investments/notifications/preferences").set("Cookie", cookie).send(body);

async function withFailingAudit(action: () => Promise<unknown>) {
  const auditWrite = vi.spyOn(businessAuditService, "log").mockRejectedValueOnce(new Error("synthetic audit failure"));
  try {
    await action();
  } finally {
    auditWrite.mockRestore();
  }
}

describe("NEW-26 investment notification preference saves are audited in the same transaction", () => {
  beforeAll(async () => {
    app = await getTestApp();
    const email = `invest-pref-audit-tx-${userId}@example.test`;
    await db.insert(households).values({ id: householdId, name: "Synthetic investment preference audit" });
    await db.insert(users).values({
      id: userId, email, username: `invest-pref-audit-tx-${userId}`, passwordHash: await hashPassword(password),
      emailVerified: true, fullName: "Synthetic Investment Preference Owner",
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
    await pool.query("DELETE FROM \"session\" WHERE sess->>'userId' = $1", [userId]);
    await db.delete(householdMembers).where(eq(householdMembers.householdId, householdId));
    await db.delete(users).where(eq(users.id, userId));
    await db.delete(households).where(eq(households.id, householdId));
  });

  it("rolls an existing preference update back when its audit row cannot be written", async () => {
    await withFailingAudit(() => put({ notificationType: existingType, emailEnabled: false }).expect(500));

    expect(await preference(existingType)).toMatchObject({ emailEnabled: true, inAppEnabled: true });
  });

  it("rolls a new preference back when its audit row cannot be written", async () => {
    await withFailingAudit(() => put({ notificationType: freshType, emailEnabled: true }).expect(500));

    expect(await preference(freshType)).toBeUndefined();
  });

  it("writes the audit row with the real household id for a create and for an update", async () => {
    // A type no other case writes, so the CREATE does not depend on test order.
    const created = await put({ notificationType: createdType, emailEnabled: false }).expect(200);
    const existing = await preference(existingType);
    await put({ notificationType: existingType, emailEnabled: false }).expect(200);

    const rows = await auditRows();
    const auditFor = (action: string, metadataAction: string) => rows.find(row => row.action === action
      && (row.details as { action?: string }).action === metadataAction);
    expect(auditFor("CREATE", "investment_notification_preference_create")).toMatchObject({
      householdId, entityId: created.body.id,
      details: expect.objectContaining({ newValue: {
        notificationType: createdType, inAppEnabled: true, emailEnabled: false, pushEnabled: false,
      } }),
    });
    expect(auditFor("UPDATE", "investment_notification_preference_update")).toMatchObject({
      householdId, entityId: existing.id,
      details: expect.objectContaining({
        oldValue: { inAppEnabled: true, emailEnabled: true, pushEnabled: false },
      }),
    });
    expect(await preference(existingType)).toMatchObject({ emailEnabled: false });
  });
});
