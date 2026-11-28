/**
 * PUT /api/investments/notifications/preferences reads its threshold as exact
 * money and keeps a deliberate refusal's status. The threshold follows the
 * general notification writer's rule (notificationThresholdSchema, NEW-26): a
 * non-negative amount that fits decimal(15,2), checked by its spelling, never
 * rounded through a float. Negative values, more than 2 decimals and 1e13 or
 * more are a 400 with nothing written (the last used to reach Postgres and
 * 500). An HttpError raised inside the route (409 session context changed,
 * 404) keeps its status instead of becoming a generic 500; the refusal is
 * injected at the household lookup, the rest is real HTTP against real Postgres.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db, pool } from "../../../db";
import { auditLogs, householdMembers, households, userNotificationPreferences, users } from "@shared/schema";
import { hashPassword } from "../../../auth";
import { getTestApp } from "../../../__tests__/fixtures";
import { householdRepository } from "../../../repositories/HouseholdRepository";
import { SessionContextChangedError } from "../../../core/authz/session-preconditions";
import { NotFoundError } from "../../../core/errors";

const password = "SyntheticInvestThreshold123!";
const householdId = randomUUID();
const userId = randomUUID();
const type = "price_alert";
let app: Awaited<ReturnType<typeof getTestApp>>;
let cookie: string;

const put = (body: object, headers: Record<string, string> = {}) =>
  request(app).put("/api/investments/notifications/preferences").set("Cookie", cookie).set(headers).send(body);
const rows = () => db.select().from(userNotificationPreferences)
  .where(and(eq(userNotificationPreferences.userId, userId), eq(userNotificationPreferences.notificationType, type)));

describe("investment notification threshold is exact money and refusals keep their status", () => {
  beforeAll(async () => {
    app = await getTestApp();
    const email = `invest-threshold-${userId}@example.test`;
    await db.insert(households).values({ id: householdId, name: "Synthetic investment threshold" });
    await db.insert(users).values({
      id: userId, email, username: `invest-threshold-${userId}`, passwordHash: await hashPassword(password), emailVerified: true,
    });
    await db.insert(householdMembers).values({ userId, householdId, role: "owner" });
    const login = await request(app).post("/api/auth/login").send({ email, password }).expect(200);
    cookie = (login.headers["set-cookie"] as unknown as string[]).join("; ");
  }, 30000);

  beforeEach(async () => {
    await db.delete(userNotificationPreferences).where(eq(userNotificationPreferences.userId, userId));
  });

  afterAll(async () => {
    await db.delete(auditLogs).where(eq(auditLogs.userId, userId));
    await db.delete(userNotificationPreferences).where(eq(userNotificationPreferences.userId, userId));
    await pool.query("DELETE FROM \"session\" WHERE sess->>'userId' = $1", [userId]);
    await db.delete(householdMembers).where(eq(householdMembers.householdId, householdId));
    await db.delete(users).where(eq(users.id, userId));
    await db.delete(households).where(eq(households.id, householdId));
  });

  it.each([
    ["a negative amount", -1],
    ["more than 2 decimals", 12.345],
    ["a float that is not an exact cent", 0.30000000000000004],
    ["1e13, past decimal(15,2)", 1e13],
    ["1e21, written in exponent form", 1e21],
    ["a string that is not an amount", "12,50"],
  ] as const)("refuses %s with 400 and writes nothing", async (_label, thresholdAmount) => {
    const response = await put({ notificationType: type, thresholdAmount });
    expect(response.status).toBe(400);
    expect(await rows()).toEqual([]);
  });

  it.each([
    [1234.5, "1234.50"],
    ["9999999999999.99", "9999999999999.99"],
    [0, "0.00"],
  ] as const)("stores %s exactly as %s", async (thresholdAmount, stored) => {
    const response = await put({ notificationType: type, thresholdAmount });
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ notificationType: type, thresholdAmount: stored });
    expect((await rows())[0]).toMatchObject({ thresholdAmount: stored });
  });

  it.each([
    ["a session-context refusal", () => new SessionContextChangedError(), 409, "SESSION_CONTEXT_CHANGED"],
    ["a not-found refusal", () => new NotFoundError("User not found"), 404, "NOT_FOUND"],
  ] as const)("keeps the status of %s instead of answering 500", async (_label, refusal, status, code) => {
    // The household lookup inside the route is where the route's own HttpErrors come from.
    const lookup = vi.spyOn(householdRepository, "findByUserId").mockRejectedValue(refusal());
    try {
      const response = await put({ notificationType: type, emailEnabled: false });
      expect(response.status).toBe(status);
      expect(response.body.error).toMatchObject({ code });
    } finally { lookup.mockRestore(); }
    expect(await rows()).toEqual([]);
  });

  it("still answers a generic 500 for an unexpected fault, without its text", async () => {
    const lookup = vi.spyOn(householdRepository, "findByUserId").mockRejectedValue(new Error("SYNTHETIC_FAULT_DETAIL"));
    try {
      const response = await put({ notificationType: type, emailEnabled: false });
      expect(response.status).toBe(500);
      expect(JSON.stringify(response.body)).not.toContain("SYNTHETIC_FAULT_DETAIL");
    } finally { lookup.mockRestore(); }
  });
});
