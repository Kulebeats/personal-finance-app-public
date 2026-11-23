// OPS-008 / R16.1: the push subscribe route stores only endpoints on a known
// push service, over real HTTP against real PostgreSQL.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { eq } from "drizzle-orm";
import { db, pool } from "../../../db";
import { auditLogs, userPushSubscriptions, users } from "@shared/schema";
import { getTestApp } from "../../../__tests__/fixtures";
import { hashPassword } from "../../../auth";

const subject = randomUUID();
const householdId = randomUUID();
const tag = randomUUID().replaceAll("-", "").slice(0, 12);
const email = `r16push-${tag}@example.invalid`;
const password = "SyntheticR16Push123!";
const keys = { p256dh: "synthetic-p256dh", auth: "synthetic-auth" };
let app: Awaited<ReturnType<typeof getTestApp>>;
let cookie: string;

const storedRows = () => db.select().from(userPushSubscriptions).where(eq(userPushSubscriptions.userId, subject));

describe("R16 push subscription endpoint allow-list (OPS-008)", () => {
  beforeAll(async () => {
    app = await getTestApp();
    await db.insert(users).values({ id: subject, email, username: `r16push-${tag}`, passwordHash: await hashPassword(password), emailVerified: true });
    await pool.query("INSERT INTO households (id, name) VALUES ($1, 'Synthetic R16 push')", [householdId]);
    await pool.query("INSERT INTO household_members (household_id, user_id, role) VALUES ($1, $2, 'owner')", [householdId, subject]);
    const login = await request(app).post("/api/auth/login").send({ email, password });
    expect(login.status).toBe(200);
    cookie = (login.headers["set-cookie"] as unknown as string[]).join("; ");
  }, 30000);

  afterAll(async () => {
    await db.delete(userPushSubscriptions).where(eq(userPushSubscriptions.userId, subject));
    await db.delete(auditLogs).where(eq(auditLogs.userId, subject));
    await pool.query("DELETE FROM household_members WHERE household_id = $1", [householdId]);
    await pool.query("DELETE FROM households WHERE id = $1", [householdId]);
    await pool.query('DELETE FROM "session" WHERE sess->>\'userId\'=$1', [subject]);
    await db.delete(users).where(eq(users.id, subject));
  });

  it.each([
    "http://169.254.169.254/x",
    "https://10.0.0.5/x",
    "https://localhost/x",
    "https://evil.example/x",
    "https://[::1]/x",
    "https://fcm.googleapis.com:8443/fcm/send/x",
    "https://user:pass@fcm.googleapis.com/fcm/send/x",
    "https://fcm.googleapis.com.evil.example/fcm/send/x",
  ])("rejects %s with a 400 validation envelope and stores nothing", async (endpoint) => {
    const response = await request(app).post("/api/notifications/push/subscribe").set("Cookie", cookie)
      .send({ subscription: { endpoint, keys } });
    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ success: false, error: { code: "VALIDATION_ERROR" } });
    expect(await storedRows()).toEqual([]);
  });

  it("stores a valid FCM endpoint", async () => {
    const endpoint = `https://fcm.googleapis.com/fcm/send/${randomUUID()}`;
    await request(app).post("/api/notifications/push/subscribe").set("Cookie", cookie)
      .send({ subscription: { endpoint, expirationTime: null, keys } }).expect(200);
    const rows = await storedRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ endpoint, keys });
  });
});
