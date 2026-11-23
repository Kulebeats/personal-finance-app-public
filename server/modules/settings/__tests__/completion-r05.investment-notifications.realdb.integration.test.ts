import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { and, eq } from "drizzle-orm";
import { db, pool } from "../../../db";
import { auditLogs, users, userNotificationPreferences } from "@shared/schema";
import { getTestApp } from "../../../__tests__/fixtures";
import { hashPassword } from "../../../auth";

const subject = randomUUID();
const neighbor = randomUUID();
const tag = randomUUID().slice(0, 8);
const type = "price_alert";
const siblingType = "coupon_payment";
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

async function put(preference: object) {
  return request(app).put("/api/investments/notifications/preferences")
    .set("Cookie", cookie).send(preference);
}

async function readBack() {
  const response = await request(app).get("/api/investments/notifications/preferences")
    .set("Cookie", cookie).expect(200);
  return response.body.find((value: { notificationType: string }) => value.notificationType === type);
}

describe("R05 investment notification partial updates on disposable PostgreSQL", () => {
  beforeAll(async () => {
    app = await getTestApp();
    const password = "SyntheticR05InvestmentNotifications123!";
    const passwordHash = await hashPassword(password);
    await db.insert(users).values([
      { id: subject, email: `r05i-${tag}@example.invalid`, username: `r05i-${tag}`, passwordHash, emailVerified: true },
      { id: neighbor, email: `r05i-other-${tag}@example.invalid`, username: `r05i-other-${tag}`, passwordHash, emailVerified: true },
    ]);
    await db.insert(userNotificationPreferences).values([
      { userId: subject, notificationType: siblingType, thresholdAmount: "99.75", emailEnabled: true },
      { userId: neighbor, notificationType: type, thresholdAmount: "901.25", emailEnabled: true },
    ]);
    const login = await request(app).post("/api/auth/login")
      .send({ email: `r05i-${tag}@example.invalid`, password });
    expect(login.status).toBe(200);
    cookie = (login.headers["set-cookie"] as unknown as string[]).join("; ");
  }, 30000);

  beforeEach(async () => {
    await db.delete(userNotificationPreferences).where(own());
    await db.insert(userNotificationPreferences).values({
      userId: subject, notificationType: type, thresholdAmount: "250.50",
      inAppEnabled: true, emailEnabled: true, pushEnabled: true,
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

  it("keeps 250.50 and unrelated rows when only email is toggled", async () => {
    const siblingBefore = await db.select().from(userNotificationPreferences).where(own(siblingType));
    const neighborBefore = await db.select().from(userNotificationPreferences)
      .where(eq(userNotificationPreferences.userId, neighbor));

    const response = await put({ notificationType: type, emailEnabled: false });
    expect(response.status).toBe(200);
    expect(await persisted()).toMatchObject({
      thresholdAmount: "250.50", inAppEnabled: true, emailEnabled: false, pushEnabled: true,
    });
    expect(await readBack()).toMatchObject({
      thresholdAmount: "250.50", inAppEnabled: true, emailEnabled: false, pushEnabled: true,
    });
    expect(await db.select().from(userNotificationPreferences).where(own(siblingType)))
      .toEqual(siblingBefore);
    expect(await db.select().from(userNotificationPreferences)
      .where(eq(userNotificationPreferences.userId, neighbor))).toEqual(neighborBefore);
  });

  it("clears an explicit null while preserving omitted flags", async () => {
    expect((await put({ notificationType: type, thresholdAmount: null })).status).toBe(200);
    expect(await persisted()).toMatchObject({
      thresholdAmount: null, inAppEnabled: true, emailEnabled: true, pushEnabled: true,
    });
    expect(await readBack()).toMatchObject({ thresholdAmount: null, emailEnabled: true });
  });

  it("persists numeric zero when a preference is created", async () => {
    await db.delete(userNotificationPreferences).where(own());
    expect((await put({ notificationType: type, thresholdAmount: 0 })).status).toBe(200);
    expect(await persisted()).toMatchObject({
      thresholdAmount: "0.00", inAppEnabled: true, emailEnabled: true, pushEnabled: false,
    });
    expect(await readBack()).toMatchObject({ thresholdAmount: "0.00" });
  });

  it("persists numeric zero when a preference is updated", async () => {
    expect((await put({ notificationType: type, thresholdAmount: 0 })).status).toBe(200);
    expect(await persisted()).toMatchObject({
      thresholdAmount: "0.00", inAppEnabled: true, emailEnabled: true, pushEnabled: true,
    });
    expect(await readBack()).toMatchObject({ thresholdAmount: "0.00" });
  });
});
