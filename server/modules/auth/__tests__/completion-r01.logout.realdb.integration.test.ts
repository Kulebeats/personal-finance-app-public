import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { randomUUID, createHash } from "node:crypto";
import type { SessionData } from "express-session";
import { eq } from "drizzle-orm";
import { db, pool } from "../../../db";
import { users } from "@shared/schema";
import { hashPassword } from "../../../auth";
import { getTestApp } from "../../../__tests__/fixtures";
import { sessionStore } from "../../../config/session-store";

const password = "SyntheticLogout123!", otp = "123456";
const ids: string[] = [];
let app: Awaited<ReturnType<typeof getTestApp>>;
const sidFrom = (cookie: string) => decodeURIComponent(cookie.split(";")[0].split("=").slice(1).join("=")).slice(2).split(".")[0];
async function login(email: string) {
  const response = await request(app).post("/api/auth/login").send({ email, password }).expect(200);
  return (response.headers["set-cookie"] as unknown as string[]).join("; ");
}
async function fixture() {
  const id = randomUUID(), email = `r01-logout-${id}@example.invalid`;
  await db.insert(users).values({ id, email, username: `logout-${id}`, emailVerified: true, passwordHash: await hashPassword(password) });
  ids.push(id);
  return { id, email, active: await login(email) };
}
async function setOtp(id: string) {
  await db.update(users).set({ mfaCode: await hashPassword(otp), mfaCodeExpiry: new Date(Date.now() + 3600000) }).where(eq(users.id, id));
}
describe("R01 pending-MFA logout route", () => {
  beforeAll(async () => { app = await getTestApp(); });
  afterAll(async () => {
    for (const id of ids) {
      await pool.query('DELETE FROM "session" WHERE sess->>\'userId\'=$1 OR sess->>\'mfaPendingUserId\'=$1', [id]);
      await db.delete(users).where(eq(users.id, id));
    }
  });
  it("retires the actual pending SID despite a delayed save and preserves another device", async () => {
    const user = await fixture();
    await db.update(users).set({ mfaEnabled: true, mfaMethod: "email" }).where(eq(users.id, user.id));
    const pendingCookie = await login(user.email), sid = sidFrom(pendingCookie);
    await setOtp(user.id);
    const snapshot = await new Promise<SessionData>((resolve, reject) => sessionStore.get(sid, (error, data) => error ? reject(error) : resolve(structuredClone(data!))));
    expect(snapshot).toMatchObject({ mfaPendingUserId: user.id });
    expect(snapshot.userId).toBeUndefined();
    const original = sessionStore.set;
    let release!: () => void;
    sessionStore.set = function (key, data, callback) {
      if (key !== sid) return original.call(this, key, data, callback);
      release = () => { original.call(this, key, data, callback); };
    };
    const saved = new Promise<void>((resolve, reject) => sessionStore.set(sid, snapshot, (error) => error ? reject(error) : resolve()));
    let logoutStatus: number;
    try { logoutStatus = (await request(app).post("/api/auth/logout").set("Cookie", pendingCookie)).status; }
    finally { sessionStore.set = original; release(); await saved; }
    const verifyStatus = (await request(app).post("/api/auth/mfa/verify").set("Cookie", pendingCookie).send({ code: otp })).status;
    expect({ logoutStatus, verifyStatus }).toEqual({ logoutStatus: 200, verifyStatus: 401 });
    expect((await pool.query('SELECT sid FROM "session" WHERE sid=$1', [sid])).rows).toHaveLength(0);
    expect((await pool.query("SELECT id FROM user_sessions WHERE session_token=$1", [sid])).rows).toHaveLength(0);
    expect((await pool.query("SELECT session_id_hash FROM session_revocations WHERE user_id=$1", [user.id])).rows)
      .toContainEqual({ session_id_hash: createHash("sha256").update(sid).digest("hex") });
    expect((await pool.query("SELECT security_generation FROM users WHERE id=$1", [user.id])).rows[0].security_generation).toBe(0);
    await request(app).get("/api/auth/me").set("Cookie", user.active).expect(200);
    const fresh = await login(user.email);
    await setOtp(user.id);
    const completed = await request(app).post("/api/auth/mfa/verify").set("Cookie", fresh).send({ code: otp }).expect(200);
    await request(app).get("/api/auth/me").set("Cookie", (completed.headers["set-cookie"] as unknown as string[]).join("; ")).expect(200);
  });
  it("retains authenticated logout and anonymous rejection", async () => {
    const user = await fixture();
    await request(app).post("/api/auth/logout").set("Cookie", user.active).expect(200);
    await request(app).get("/api/auth/me").set("Cookie", user.active).expect(401);
    await request(app).post("/api/auth/logout").expect(401);
  });
  it("preserves the existing logout CSRF exemption without exempting another security mutation", async () => {
    const user = await fixture();
    await db.update(users).set({ mfaEnabled: true, mfaMethod: "email" }).where(eq(users.id, user.id));
    const pendingCookie = await login(user.email);
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = "development"; // real existing middleware branch, not browser/production proof
    try {
      const denied = await request(app).post("/api/settings/security/email/cancel").set("Cookie", user.active).send({}).expect(403);
      expect(denied.body.error.code).toBe("CSRF_INVALID");
      await request(app).post("/api/auth/logout").set("Cookie", pendingCookie).expect(200);
      await request(app).get("/api/auth/me").set("Cookie", user.active).expect(200);
      await request(app).post("/api/auth/logout").expect(401);
    } finally { process.env.NODE_ENV = previous; }
  });
});
