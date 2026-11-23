/**
 * A push subscription is the browser of one signed-in session. Signing out,
 * revoking that device, revoking all other sessions, a password change or
 * reset, leaving the last household and erasure all stop pushes to it; an
 * expired session gets none; and an endpoint another user registers is
 * never sent the first user's notices again.
 * Real HTTP and real Postgres; the web-push wire is a mock.
 */
import { createHash, randomBytes, randomUUID } from "node:crypto";
import request from "supertest";
import { eq, inArray } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
// @ts-expect-error - web-push has no type declarations in this project.
import webpush from "web-push";
import { householdMembers, households, userPushSubscriptions, users } from "@shared/schema";
import { db, pool } from "../../../db";
import { hashPassword } from "../../../auth";
import { getTestApp } from "../../../__tests__/fixtures";
import { pushNotificationService } from "../push";
import { NOTIFICATION_TYPES } from "@shared/notificationTypes";

vi.mock("web-push", () => ({ default: { setVapidDetails: vi.fn(), sendNotification: vi.fn().mockResolvedValue({}) } }));
const wire = vi.mocked(webpush.sendNotification as (subscription: { endpoint: string }, payload: string) => Promise<unknown>);

const password = "SyntheticPushPassword123!";
const newPassword = "SyntheticPushPassword456!";
let app: Awaited<ReturnType<typeof getTestApp>>;
const created: { users: string[]; households: string[] } = { users: [], households: [] };

const sidFrom = (cookie: string) => decodeURIComponent(cookie.split(";")[0].split("=").slice(1).join("=")).slice(2).split(".")[0];
const endpoint = () => `https://fcm.googleapis.com/fcm/send/synthetic-${randomUUID()}`;
const keys = () => ({ p256dh: `p256dh-${randomUUID()}`, auth: `auth-${randomUUID()}` });

async function household(): Promise<string> {
  const id = randomUUID();
  await db.insert(households).values({ id, name: "Synthetic push household" });
  created.households.push(id);
  return id;
}
async function user(householdId: string, role: "owner" | "member" = "owner") {
  const id = randomUUID(), email = `push-${id}@example.invalid`;
  await db.insert(users).values({ id, email, username: `push-${id}`, passwordHash: await hashPassword(password), emailVerified: true });
  await db.insert(householdMembers).values({ userId: id, householdId, role });
  created.users.push(id);
  return { id, email };
}
async function login(email: string, value = password) {
  const response = await request(app).post("/api/auth/login").send({ email, password: value }).expect(200);
  return (response.headers["set-cookie"] as unknown as string[]).join("; ");
}
const stepUp = (cookie: string) => request(app).post("/api/settings/security/step-up").set("Cookie", cookie).send({ password }).expect(200);
async function subscribe(cookie: string, at = endpoint(), withKeys = keys()) {
  await request(app).post("/api/notifications/push/subscribe").set("Cookie", cookie)
    .send({ subscription: { endpoint: at, keys: withKeys } }).expect(200);
  return at;
}
async function rows(userId: string): Promise<string[]> {
  const found = await db.select({ endpoint: userPushSubscriptions.endpoint }).from(userPushSubscriptions)
    .where(eq(userPushSubscriptions.userId, userId));
  return found.map((row) => row.endpoint).sort();
}
const sendTo = (userId: string, body: string) =>
  pushNotificationService.sendPushDetailed(userId, NOTIFICATION_TYPES.LARGE_TRANSACTION, "Synthetic", body);
const payloads = () => wire.mock.calls.map(([subscription, payload]) => ({ endpoint: subscription.endpoint, payload }));

describe("push subscriptions follow the session that registered them (real HTTP/DB)", () => {
  beforeAll(async () => {
    app = await getTestApp();
    vi.stubEnv("VAPID_PUBLIC_KEY", "synthetic-mocked-key");
    vi.stubEnv("VAPID_PRIVATE_KEY", "synthetic-mocked-key");
  }, 30_000);
  afterEach(() => { wire.mockClear(); });
  afterAll(async () => {
    vi.unstubAllEnvs();
    if (created.users.length) {
      await pool.query(`DELETE FROM "session" WHERE sess->>'userId' = ANY($1::text[])`, [created.users]);
      await db.delete(users).where(inArray(users.id, created.users));
    }
    if (created.households.length) await db.delete(households).where(inArray(households.id, created.households));
  });

  it("signing out removes that browser's subscription and keeps the other device's", async () => {
    const owner = await user(await household());
    const a = await login(owner.email), b = await login(owner.email);
    const kept = await subscribe(a), signedOut = await subscribe(b);

    await request(app).post("/api/auth/logout").set("Cookie", b).expect(200);

    expect(await rows(owner.id)).toEqual([kept]);
    expect(signedOut).not.toBe(kept);
  });

  it("revoking a device from Security removes the subscription registered from it", async () => {
    const owner = await user(await household());
    const a = await login(owner.email), b = await login(owner.email);
    const kept = await subscribe(a);
    await subscribe(b);
    const { rows: [tracking] } = await pool.query("SELECT id FROM user_sessions WHERE session_token = $1", [sidFrom(b)]);

    await stepUp(a);
    await request(app).delete(`/api/settings/security/sessions/${tracking.id}`).set("Cookie", a).expect(200);

    expect(await rows(owner.id)).toEqual([kept]);
  });

  it.each(["revoke all", "password change"] as const)("%s keeps only the subscription of the session that stays signed in", async (action) => {
    const owner = await user(await household());
    const a = await login(owner.email), b = await login(owner.email);
    const kept = await subscribe(a);
    await subscribe(b);
    // A row saved before subscriptions recorded their session.
    await db.insert(userPushSubscriptions).values({ userId: owner.id, endpoint: endpoint(), keys: keys() });

    await stepUp(a);
    if (action === "revoke all") await request(app).delete("/api/settings/security/sessions").set("Cookie", a).expect(200);
    else await request(app).put("/api/settings/security/password").set("Cookie", a)
      .send({ currentPassword: password, newPassword, confirmPassword: newPassword }).expect(200);

    expect(await rows(owner.id)).toEqual([kept]);
  });

  it("a password reset removes every subscription", async () => {
    const owner = await user(await household());
    await subscribe(await login(owner.email));
    const token = randomBytes(32).toString("hex");
    await pool.query("INSERT INTO password_reset_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, now() + interval '1 hour')",
      [owner.id, createHash("sha256").update(token).digest("hex")]);

    await request(app).post("/api/auth/reset-password").send({ token, newPassword }).expect(200);

    expect(await rows(owner.id)).toEqual([]);
  });

  it("removal from the last household removes every subscription of the removed member", async () => {
    const shared = await household();
    const owner = await user(shared), member = await user(shared, "member");
    const ownerCookie = await login(owner.email);
    const ownerEndpoint = await subscribe(ownerCookie);
    await subscribe(await login(member.email));

    await request(app).delete(`/api/household/members/${member.id}`).set("Cookie", ownerCookie).expect(200);

    expect(await rows(member.id)).toEqual([]);
    expect(await rows(owner.id)).toEqual([ownerEndpoint]);
  });

  it("account erasure removes every subscription", async () => {
    const owner = await user(await household());
    const cookie = await login(owner.email);
    await subscribe(cookie);

    await stepUp(cookie);
    await request(app).post("/api/settings/account/delete").set("Cookie", cookie).send({ password }).expect(200);

    expect(await rows(owner.id)).toEqual([]);
  });

  it("a session that expired gets no push, and its subscription is removed", async () => {
    const owner = await user(await household());
    const cookie = await login(owner.email);
    const stale = await subscribe(cookie);
    await pool.query(`UPDATE "session" SET expire = now() - interval '1 minute' WHERE sid = $1`, [sidFrom(cookie)]);

    await sendTo(owner.id, "EXPIRED_SESSION_PAYLOAD");

    expect(payloads().filter((sent) => sent.endpoint === stale)).toEqual([]);
    expect(await rows(owner.id)).toEqual([]);
  });

  it("a row saved before sessions were recorded gets no push, and is removed", async () => {
    const owner = await user(await household());
    const legacy = endpoint();
    await db.insert(userPushSubscriptions).values({ userId: owner.id, endpoint: legacy, keys: keys() });

    await sendTo(owner.id, "LEGACY_ROW_PAYLOAD");

    expect(payloads().filter((sent) => sent.endpoint === legacy)).toEqual([]);
    expect(await rows(owner.id)).toEqual([]);
  });

  it("a row saved before sessions were recorded is bound to the session that registers it again", async () => {
    const owner = await user(await household());
    const legacy = endpoint(), legacyKeys = keys();
    await db.insert(userPushSubscriptions).values({ userId: owner.id, endpoint: legacy, keys: legacyKeys });
    const cookie = await login(owner.email);
    await subscribe(cookie, legacy, legacyKeys);

    await request(app).post("/api/auth/logout").set("Cookie", cookie).expect(200);

    expect(await rows(owner.id)).toEqual([]);
  });

  it("an endpoint another household's user registers is removed from the first user and never sent their notices", async () => {
    const first = await user(await household()), second = await user(await household());
    const firstCookie = await login(first.email), secondCookie = await login(second.email);
    const shared = await subscribe(firstCookie);
    const [before] = await db.select({ id: userPushSubscriptions.id }).from(userPushSubscriptions)
      .where(eq(userPushSubscriptions.endpoint, shared));

    // The first user's send has read its subscriptions when the second user registers the endpoint.
    const read = pushNotificationService.getUserSubscriptions.bind(pushNotificationService);
    const spy = vi.spyOn(pushNotificationService, "getUserSubscriptions").mockImplementationOnce(async (id) => {
      const list = await read(id);
      await subscribe(secondCookie, shared);
      return list;
    });
    try {
      await sendTo(first.id, "FIRST_USER_PAYLOAD");
    } finally {
      spy.mockRestore();
    }
    await sendTo(first.id, "FIRST_USER_PAYLOAD_LATER");
    await sendTo(second.id, "SECOND_USER_PAYLOAD");

    const [after] = await db.select({ id: userPushSubscriptions.id, userId: userPushSubscriptions.userId })
      .from(userPushSubscriptions).where(eq(userPushSubscriptions.endpoint, shared));
    expect(after.userId).toBe(second.id);
    expect(after.id).not.toBe(before.id);
    expect(await rows(first.id)).toEqual([]);
    const sent = payloads();
    expect(sent.filter((call) => call.payload.includes("FIRST_USER_PAYLOAD"))).toEqual([]);
    expect(sent.filter((call) => call.endpoint === shared && call.payload.includes("SECOND_USER_PAYLOAD"))).toHaveLength(1);
  });
});
