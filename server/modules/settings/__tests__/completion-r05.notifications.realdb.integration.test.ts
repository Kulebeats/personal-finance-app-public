import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { and, eq } from "drizzle-orm";
import { db, pool } from "../../../db";
import { auditLogs, users, userNotificationPreferences } from "@shared/schema";
import { NOTIFICATION_TYPES } from "@shared/notificationTypes";
import { getTestApp } from "../../../__tests__/fixtures";
import { hashPassword } from "../../../auth";

const subject = randomUUID(), neighbor = randomUUID();
const tag = randomUUID().slice(0, 8);
const type = NOTIFICATION_TYPES.LARGE_TRANSACTION;
const siblingType = NOTIFICATION_TYPES.BUDGET_WARNING;
let app: Awaited<ReturnType<typeof getTestApp>>;
let cookie: string;
const own = (notificationType = type) => and(
  eq(userNotificationPreferences.userId, subject),
  eq(userNotificationPreferences.notificationType, notificationType),
);

async function persisted() {
  const [value] = await db.select().from(userNotificationPreferences).where(own());
  return value;
}

async function put(preferences: object[]) {
  return request(app).put("/api/settings/notifications").set("Cookie", cookie).send({ preferences });
}

async function getPreference() {
  const result = await request(app).get("/api/settings/notifications").set("Cookie", cookie).expect(200);
  return result.body.data.preferences.find((value: { notificationType: string }) => value.notificationType === type);
}

describe("R05 notification partial updates on disposable PostgreSQL", () => {
  beforeAll(async () => {
    app = await getTestApp();
    const password = "SyntheticR05Notifications123!";
    const passwordHash = await hashPassword(password);
    await db.insert(users).values([
      { id: subject, email: `r05n-${tag}@example.invalid`, username: `r05n-${tag}`, passwordHash, emailVerified: true },
      { id: neighbor, email: `r05n-other-${tag}@example.invalid`, username: `r05n-other-${tag}`, passwordHash, emailVerified: true },
    ]);
    await db.insert(userNotificationPreferences).values([
      { userId: subject, notificationType: siblingType, thresholdAmount: "99.75", emailEnabled: true },
      { userId: neighbor, notificationType: type, thresholdAmount: "901.25", emailEnabled: true },
    ]);
    const login = await request(app).post("/api/auth/login").send({ email: `r05n-${tag}@example.invalid`, password });
    expect(login.status).toBe(200);
    cookie = (login.headers["set-cookie"] as unknown as string[]).join("; ");
  }, 30000);

  beforeEach(async () => {
    await db.delete(userNotificationPreferences).where(own());
    await db.insert(userNotificationPreferences).values({
      userId: subject, notificationType: type, thresholdAmount: "250.50",
      emailEnabled: true, inAppEnabled: true, pushEnabled: true,
    });
  });

  afterAll(async () => {
    for (const id of [subject, neighbor]) {
      await db.delete(auditLogs).where(eq(auditLogs.userId, id));
      await db.delete(userNotificationPreferences).where(eq(userNotificationPreferences.userId, id));
      await pool.query('DELETE FROM "session" WHERE sess->>\'userId\'=$1', [id]);
      await db.delete(users).where(eq(users.id, id));
    }
  });

  it("preserves the omitted 250.50 threshold, other flags, sibling type and another user's row", async () => {
    const siblingBefore = await db.select().from(userNotificationPreferences).where(
      and(eq(userNotificationPreferences.userId, subject), eq(userNotificationPreferences.notificationType, siblingType)));
    const neighborBefore = await db.select().from(userNotificationPreferences).where(eq(userNotificationPreferences.userId, neighbor));
    const response = await put([{ notificationType: type, emailEnabled: false }]);
    expect(response.status).toBe(200);
    expect(await persisted()).toMatchObject({ thresholdAmount: "250.50", emailEnabled: false, inAppEnabled: true, pushEnabled: true });
    expect(await getPreference()).toMatchObject({ thresholdAmount: "250.50", emailEnabled: false });
    expect(await db.select().from(userNotificationPreferences).where(
      and(eq(userNotificationPreferences.userId, subject), eq(userNotificationPreferences.notificationType, siblingType))))
      .toEqual(siblingBefore);
    expect(await db.select().from(userNotificationPreferences).where(eq(userNotificationPreferences.userId, neighbor)))
      .toEqual(neighborBefore);
  });

  it("clears an explicitly null threshold and preserves omitted flags", async () => {
    expect((await put([{ notificationType: type, thresholdAmount: null }])).status).toBe(200);
    expect(await persisted()).toMatchObject({ thresholdAmount: null, emailEnabled: true, inAppEnabled: true, pushEnabled: true });
    expect((await getPreference()).thresholdAmount).toBeNull();
  });

  it.each([0, "0.00"])("persists explicit zero %j on creation with existing flag defaults", async thresholdAmount => {
    await db.delete(userNotificationPreferences).where(own());
    expect((await put([{ notificationType: type, thresholdAmount }])).status).toBe(200);
    expect(await persisted()).toMatchObject({ thresholdAmount: "0.00", inAppEnabled: true, emailEnabled: false, pushEnabled: false });
    expect((await getPreference()).thresholdAmount).toBe("0.00");
  });

  // NEW-26: the threshold is a money amount (decimal(15,2)), so anything else is a 400 and nothing is stored.
  it.each(["-5", "abc", "12.345", "1e3", "", "99999999999999.00", -5, 12.345, 0.1 + 0.2])(
    "rejects threshold %j with 400 and keeps the stored row", async thresholdAmount => {
      const rowsBefore = await db.select().from(userNotificationPreferences).where(eq(userNotificationPreferences.userId, subject));
      const response = await put([{ notificationType: type, thresholdAmount, emailEnabled: false }]);
      expect(response.status).toBe(400);
      expect(await db.select().from(userNotificationPreferences).where(eq(userNotificationPreferences.userId, subject))).toEqual(rowsBefore);
    },
  );

  it("rejects an unknown type before changing any row or writing an audit in the batch", async () => {
    const rowsBefore = await db.select().from(userNotificationPreferences).where(eq(userNotificationPreferences.userId, subject));
    const auditsBefore = await db.select().from(auditLogs).where(eq(auditLogs.userId, subject));
    expect((await put([
      { notificationType: type, emailEnabled: false },
      { notificationType: "invented-notification", emailEnabled: false },
    ])).status).toBe(400);
    expect(await db.select().from(userNotificationPreferences).where(eq(userNotificationPreferences.userId, subject))).toEqual(rowsBefore);
    expect(await db.select().from(auditLogs).where(eq(auditLogs.userId, subject))).toEqual(auditsBefore);
  });

  it.each(["maturity_reminder", "coupon_payment", "auction_results"])(
    "saves the general settings readback after the investment route creates %s", async investmentType => {
      await request(app).put("/api/investments/notifications/preferences").set("Cookie", cookie)
        .send({ notificationType: investmentType, thresholdAmount: 52.25, emailEnabled: true }).expect(200);
      const response = await request(app).get("/api/settings/notifications").set("Cookie", cookie).expect(200);
      const submitted = response.body.data.preferences.map((pref: {
        notificationType: string; thresholdAmount: string | null;
        inAppEnabled: boolean; emailEnabled: boolean; pushEnabled: boolean;
      }) => ({
        notificationType: pref.notificationType, thresholdAmount: pref.thresholdAmount,
        inAppEnabled: pref.inAppEnabled, emailEnabled: pref.notificationType === type ? false : pref.emailEnabled,
        pushEnabled: pref.pushEnabled,
      }));
      expect((await put(submitted)).status).toBe(200);
      expect(await persisted()).toMatchObject({ thresholdAmount: "250.50", emailEnabled: false });
      const [investment] = await db.select().from(userNotificationPreferences).where(and(
        eq(userNotificationPreferences.userId, subject),
        eq(userNotificationPreferences.notificationType, investmentType),
      ));
      expect(investment).toMatchObject({ thresholdAmount: "52.25", emailEnabled: true });
    },
  );
});
