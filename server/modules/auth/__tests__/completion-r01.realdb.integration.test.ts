import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import pg from "pg";
import type { SessionData, Store } from "express-session";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { db, pool } from "../../../db";
import { users, households, householdMembers } from "@shared/schema";
import { eq } from "drizzle-orm";
import { hashPassword, requireAuth } from "../../../auth";
import { app } from "../../../app";
import { getTestApp } from "../../../__tests__/fixtures";
import { authSessionService } from "../auth.session.service";
import { authMfaService } from "../auth.mfa.service";
import { eraseAccount } from "../../settings/settings.account-deletion.service";

const password = "SyntheticR01Password123!";
const fixtures: { id: string; householdId: string }[] = [];
let store: Store;
app.get("/__r01/session-store", requireAuth, (req, res) => { store = req.sessionStore; res.json({ success: true }); });
const sidFrom = (cookie: string) => decodeURIComponent(cookie.split(";")[0].split("=").slice(1).join("=")).slice(2).split(".")[0];
async function readSession(sid: string) {
  return new Promise<SessionData>((resolve, reject) => store.get(sid, (error, data) => error ? reject(error) : resolve(structuredClone(data!))));
}
async function fixture() {
  const id = randomUUID(), householdId = randomUUID();
  const email = `r01-${id}@example.invalid`;
  await db.insert(users).values({ id, email, username: `r01-${id}`, passwordHash: await hashPassword(password), emailVerified: true });
  await db.insert(households).values({ id: householdId, name: "Synthetic R01" });
  await db.insert(householdMembers).values({ userId: id, householdId, role: "owner" });
  fixtures.push({ id, householdId });
  return { id, email };
}
async function login(email: string, value = password) {
  const response = await request(app).post("/api/auth/login").send({ email, password: value }).expect(200);
  return (response.headers["set-cookie"] as unknown as string[]).join("; ");
}
async function stepUp(cookie: string) {
  await request(app).post("/api/settings/security/step-up").set("Cookie", cookie).send({ password }).expect(200);
}
const newPassword = "SyntheticNewR01Password456!";
async function resetPassword(userId: string) {
  const token = randomBytes(32).toString("hex");
  const hash = createHash("sha256").update(token).digest("hex");
  await pool.query("INSERT INTO password_reset_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, now() + interval '1 hour')", [userId, hash]);
  await request(app).post("/api/auth/reset-password").send({ token, newPassword }).expect(200);
}
async function delayedSave(sid: string, data: SessionData) {
  const original = store.set;
  let release!: () => void;
  let reached!: () => void;
  const blocked = new Promise<void>((resolve) => { reached = resolve; });
  store.set = function (key, value, callback) {
    if (key !== sid) return original.call(this, key, value, callback);
    reached();
    release = () => { original.call(this, key, value, callback); };
  };
  const saved = new Promise<void>((resolve, reject) => store.set(sid, data, (error) => error ? reject(error) : resolve()));
  await blocked;
  return { finish: async () => { store.set = original; release(); await saved; } };
}

describe("R01 persisted selected-device revocation", () => {
  beforeAll(async () => { await getTestApp(); });
  afterAll(async () => {
    for (const fixture of fixtures) {
      await pool.query('DELETE FROM "session" WHERE sess->>\'userId\' = $1', [fixture.id]);
      await db.delete(households).where(eq(households.id, fixture.householdId));
      await db.delete(users).where(eq(users.id, fixture.id));
    }
  });
  it.each([false, true])("revokes only selected B; delayed save=%s cannot restore its cookie", async (late) => {
    const user = await fixture();
    const a = await login(user.email), b = await login(user.email);
    await request(app).get("/__r01/session-store").set("Cookie", a).expect(200);
    const sidB = sidFrom(b);
    const snapshot = await readSession(sidB);
    const pending = late ? await delayedSave(sidB, snapshot) : undefined;
    try {
      const { rows: [tracking] } = await pool.query("SELECT id FROM user_sessions WHERE session_token = $1", [sidB]);
      await stepUp(a);
      await request(app).delete(`/api/settings/security/sessions/${tracking.id}`).set("Cookie", a).expect(200);
    } finally { await pending?.finish(); }
    await request(app).get("/api/auth/me").set("Cookie", b).expect(401);
    await request(app).get("/api/auth/me").set("Cookie", a).expect(200);
    expect((await pool.query("SELECT security_generation FROM users WHERE id = $1", [user.id])).rows[0].security_generation).toBe(0);
    expect((await pool.query("SELECT 1 FROM session_revocations WHERE user_id = $1", [user.id])).rows).toHaveLength(1);
    expect((await pool.query('SELECT sid FROM "session" WHERE sid = $1', [sidB])).rows).toHaveLength(0);
    expect((await pool.query("SELECT id FROM user_sessions WHERE session_token = $1", [sidB])).rows).toHaveLength(0);
    const c = await login(user.email);
    await request(app).get("/api/auth/me").set("Cookie", c).expect(200);
  });
  it("revokes all other cookies despite a delayed save while preserving current A", async () => {
    const user = await fixture();
    const a = await login(user.email), b = await login(user.email);
    await request(app).get("/__r01/session-store").set("Cookie", a).expect(200);
    const sidB = sidFrom(b);
    const pending = await delayedSave(sidB, await readSession(sidB));
    try {
      await stepUp(a);
      await request(app).delete("/api/settings/security/sessions").set("Cookie", a).expect(200);
    } finally { await pending.finish(); }
    await request(app).get("/api/auth/me").set("Cookie", b).expect(401);
    await request(app).get("/api/auth/me").set("Cookie", a).expect(200);
  });
  it("cannot revoke another actor's tracked session", async () => {
    const owner = await fixture(), other = await fixture();
    const a = await login(owner.email), b = await login(other.email);
    const { rows: [tracking] } = await pool.query("SELECT id FROM user_sessions WHERE session_token = $1", [sidFrom(b)]);
    await stepUp(a);
    await request(app).delete(`/api/settings/security/sessions/${tracking.id}`).set("Cookie", a).expect(404);
    await request(app).get("/api/auth/me").set("Cookie", b).expect(200);
  });
  it.each(["password-change", "reset", "erasure"])("%s refuses a real delayed store save", async (mode) => {
    const user = await fixture();
    const a = await login(user.email), b = await login(user.email);
    await request(app).get("/__r01/session-store").set("Cookie", a).expect(200);
    const sidB = sidFrom(b);
    const pending = await delayedSave(sidB, await readSession(sidB));
    try {
      if (mode === "password-change") {
        await stepUp(a);
        await request(app).put("/api/settings/security/password").set("Cookie", a)
          .send({ currentPassword: password, newPassword, confirmPassword: newPassword }).expect(200);
      } else if (mode === "reset") await resetPassword(user.id);
      else {
        const { householdId } = fixtures.find((row) => row.id === user.id)!;
        await eraseAccount({ userId: user.id, householdId, userEmail: user.email, ipAddress: "127.0.0.1" });
      }
    } finally { await pending.finish(); }
    expect((await pool.query('SELECT sid FROM "session" WHERE sid = $1', [sidB])).rows).toHaveLength(0);
    await request(app).get("/api/auth/me").set("Cookie", b).expect(401);
    await request(app).get("/api/auth/me").set("Cookie", a).expect(mode === "password-change" ? 200 : 401);
    if (mode !== "erasure") await request(app).get("/api/auth/me").set("Cookie", await login(user.email, newPassword)).expect(200);
  });
  it("a reset cannot bless an old-password login already awaiting finalization", async () => {
    const user = await fixture();
    let entered!: () => void, release!: () => void;
    const atBarrier = new Promise<void>((resolve) => { entered = resolve; });
    const barrier = new Promise<void>((resolve) => { release = resolve; });
    const finalize = authSessionService.finalizeLogin;
    const spy = vi.spyOn(authSessionService, "finalizeLogin").mockImplementationOnce(async function (...args) {
      entered(); await barrier;
      return finalize.apply(authSessionService, args);
    });
    const pending = request(app).post("/api/auth/login").send({ email: user.email, password }).then((response) => response);
    try {
      await atBarrier;
      await resetPassword(user.id);
    } finally { release(); }
    try { expect((await pending).status).toBe(401); }
    finally { spy.mockRestore(); }
    await request(app).get("/api/auth/me").set("Cookie", await login(user.email, newPassword)).expect(200);
  });
  it("a pending MFA payload cannot survive reset through a delayed save", async () => {
    const user = await fixture();
    const a = await login(user.email);
    await request(app).get("/__r01/session-store").set("Cookie", a).expect(200);
    await db.update(users).set({ mfaEnabled: true }).where(eq(users.id, user.id));
    const code = vi.spyOn(authMfaService, "generateMfaCode").mockReturnValue("123456");
    let b: string;
    try { b = await login(user.email); } finally { code.mockRestore(); }
    const sid = sidFrom(b);
    const pending = await delayedSave(sid, await readSession(sid));
    try { await resetPassword(user.id); } finally { await pending.finish(); }
    await request(app).post("/api/auth/mfa/verify").set("Cookie", b).send({ code: "123456" }).expect(401);
    expect((await pool.query('SELECT sid FROM "session" WHERE sid = $1', [sid])).rows).toHaveLength(0);
  });
  it("legacy generation-less payload is valid only until a generation changes", async () => {
    const user = await fixture();
    const a = await login(user.email);
    await request(app).get("/__r01/session-store").set("Cookie", a).expect(200);
    const sid = sidFrom(a), legacy = await readSession(sid);
    delete legacy.securityGeneration;
    await new Promise<void>((resolve, reject) => store.set(sid, legacy, (error) => error ? reject(error) : resolve()));
    await request(app).get("/api/auth/me").set("Cookie", a).expect(200);
    await resetPassword(user.id);
    await new Promise<void>((resolve, reject) => store.set(sid, legacy, (error) => error ? reject(error) : resolve()));
    await request(app).get("/api/auth/me").set("Cookie", a).expect(401);
    expect((await pool.query('SELECT sid FROM "session" WHERE sid = $1', [sid])).rows).toHaveLength(0);
  });
  it("logout leaves a durable denial against a delayed save", async () => {
    const user = await fixture();
    const a = await login(user.email), b = await login(user.email);
    await request(app).get("/__r01/session-store").set("Cookie", a).expect(200);
    const sid = sidFrom(b), pending = await delayedSave(sid, await readSession(sid));
    try { await request(app).post("/api/auth/logout").set("Cookie", b).expect(200); }
    finally { await pending.finish(); }
    await request(app).get("/api/auth/me").set("Cookie", b).expect(401);
    await request(app).get("/api/auth/me").set("Cookie", a).expect(200);
  });
  it("legacy erased credential marker cannot authenticate with an old cookie", async () => {
    const user = await fixture();
    const a = await login(user.email);
    const marker = randomUUID();
    await db.update(users).set({ username: `deleted_${marker}`, email: `deleted_${marker}@deleted.invalid`, passwordHash: `!erased!${marker}` })
      .where(eq(users.id, user.id));
    await request(app).get("/api/auth/me").set("Cookie", a).expect(401);
  });
  it("a current-device read crossing all-other revocation cannot delete upgraded A", async () => {
    const user = await fixture();
    const a = await login(user.email);
    await login(user.email);
    await request(app).get("/__r01/session-store").set("Cookie", a).expect(200);
    await stepUp(a);
    const sid = sidFrom(a);
    const baseStore = Object.getPrototypeOf(Object.getPrototypeOf(store)) as Store;
    const original = baseStore.get;
    let entered!: () => void, release!: () => void;
    const blocked = new Promise<void>((resolve) => { entered = resolve; });
    const spy = vi.spyOn(baseStore, "get").mockImplementationOnce(function (this: Store, key, callback) {
      original.call(this, key, (error, value) => { entered(); release = () => callback(error, value); });
    });
    const pending = new Promise<SessionData | null | undefined>((resolve, reject) => store.get(sid, (error, value) => error ? reject(error) : resolve(value)));
    try {
      await blocked;
      await request(app).delete("/api/settings/security/sessions").set("Cookie", a).expect(200);
    } finally { release(); }
    try {
      expect((await pending)?.userId).toBe(user.id);
      await request(app).get("/api/auth/me").set("Cookie", a).expect(200);
    } finally { spy.mockRestore(); }
  });
  it("a delayed current-device save cannot overwrite its upgraded payload", async () => {
    const user = await fixture();
    const a = await login(user.email);
    await login(user.email);
    await request(app).get("/__r01/session-store").set("Cookie", a).expect(200);
    await stepUp(a);
    const sid = sidFrom(a), pending = await delayedSave(sid, await readSession(sid));
    try { await request(app).delete("/api/settings/security/sessions").set("Cookie", a).expect(200); }
    finally { await pending.finish(); }
    expect((await readSession(sid)).securityGeneration).toBe(1);
    await request(app).get("/api/auth/me").set("Cookie", a).expect(200);
  });
  it("revocation waits for an already persisted store write, then removes B", async () => {
    const user = await fixture();
    const a = await login(user.email), b = await login(user.email);
    await request(app).get("/__r01/session-store").set("Cookie", a).expect(200);
    await stepUp(a);
    const sidB = sidFrom(b), snapshot = await readSession(sidB);
    const { rows: [tracking] } = await pool.query("SELECT id FROM user_sessions WHERE session_token = $1", [sidB]);
    let persisted = false, completed = false, savingPid = 0, revokingPid = 0;
    let release!: () => void, inserted!: () => void, revoking!: () => void;
    const atInsert = new Promise<void>((resolve) => { inserted = resolve; });
    const atRevoke = new Promise<void>((resolve) => { revoking = resolve; });
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const original = pg.Client.prototype.query;
    const spy = vi.spyOn(pg.Client.prototype, "query").mockImplementation(function (this: pg.Client, ...args: Parameters<typeof original>) {
      const result: unknown = Reflect.apply(original, this, args);
      const [query, values] = args as unknown as [unknown, unknown];
      const text = typeof query === "object" && query !== null && "text" in query ? query.text : query;
      if (typeof text === "string" && Array.isArray(values)) {
        if (text.startsWith('INSERT INTO "session"') && values[0] === sidB) {
          savingPid = Reflect.get(this, "processID") as number;
          return Promise.resolve(result).then(async (value) => { persisted = true; inserted(); await gate; return value; }) as unknown as ReturnType<typeof original>;
        }
        if (persisted && /from "users"/i.test(text) && /for update/i.test(text) && values.includes(user.id)) {
          revokingPid = Reflect.get(this, "processID") as number;
          revoking();
        }
      }
      return result as ReturnType<typeof original>;
    });
    const saved = new Promise<void>((resolve, reject) => store.set(sidB, snapshot, (error) => error ? reject(error) : resolve()));
    let timeout!: ReturnType<typeof setTimeout>;
    const deadline = new Promise<never>((_, reject) => { timeout = setTimeout(() => reject(new Error("Session lock barrier was not reached")), 8000); });
    let revoke: Promise<request.Response> | undefined;
    try {
      await Promise.race([atInsert, deadline]);
      revoke = request(app).delete(`/api/settings/security/sessions/${tracking.id}`).set("Cookie", a)
        .then((response) => { completed = true; return response; });
      await Promise.race([atRevoke, deadline]);
      while (true) {
        const { rows: [lock] } = await Promise.race([
          pool.query<{ blocked: boolean }>("SELECT $1::integer = ANY(pg_blocking_pids($2::integer)) AS blocked", [savingPid, revokingPid]), deadline,
        ]);
        if (lock.blocked) break;
      }
      expect(completed).toBe(false);
      release();
      await saved;
      expect((await revoke).status).toBe(200);
    } finally {
      clearTimeout(timeout);
      release();
      spy.mockRestore();
      await Promise.allSettled([saved, ...(revoke ? [revoke] : [])]);
    }
    expect((await pool.query('SELECT sid FROM "session" WHERE sid = $1', [sidB])).rows).toHaveLength(0);
    expect((await pool.query("SELECT id FROM user_sessions WHERE session_token = $1", [sidB])).rows).toHaveLength(0);
    await request(app).get("/api/auth/me").set("Cookie", b).expect(401);
    await request(app).get("/api/auth/me").set("Cookie", a).expect(200);
  });
  it.each(["password", "mfa"] as const)("%s login rotation permanently revokes the old SID despite a delayed save", async (mode) => {
    const user = await fixture(), other = await login(user.email);
    await request(app).get("/__r01/session-store").set("Cookie", other).expect(200);
    const code = vi.spyOn(authMfaService, "generateMfaCode").mockReturnValue("123456");
    if (mode === "mfa") await db.update(users).set({ mfaEnabled: true, mfaMethod: "email" }).where(eq(users.id, user.id));
    const old = await login(user.email), oldSid = sidFrom(old), snapshot = await readSession(oldSid);
    const pending = await delayedSave(oldSid, snapshot);
    let rotated: request.Response;
    try {
      rotated = mode === "mfa"
        ? await request(app).post("/api/auth/mfa/verify").set("Cookie", old).send({ code: "123456" }).expect(200)
        : await request(app).post("/api/auth/login").set("Cookie", old).send({ email: user.email, password }).expect(200);
    } finally { await pending.finish(); code.mockRestore(); }
    const current = (rotated!.headers["set-cookie"] as unknown as string[]).join("; ");
    expect(sidFrom(current) === oldSid).toBe(false);
    expect((await pool.query('SELECT sid FROM "session" WHERE sid = $1', [oldSid])).rows).toHaveLength(0);
    expect((await pool.query("SELECT id FROM user_sessions WHERE session_token = $1", [oldSid])).rows).toHaveLength(0);
    expect((await pool.query("SELECT 1 FROM session_revocations WHERE session_id_hash = $1", [createHash("sha256").update(oldSid).digest("hex")])).rows).toHaveLength(1);
    await request(app).get("/api/auth/me").set("Cookie", old).expect(401);
    await request(app).get("/api/auth/me").set("Cookie", current).expect(200);
    await request(app).get("/api/auth/me").set("Cookie", other).expect(200);
    expect((await pool.query("SELECT security_generation FROM users WHERE id = $1", [user.id])).rows[0].security_generation).toBe(0);
    if (mode === "mfa") {
      await db.update(users).set({ mfaCode: await hashPassword("654321"), mfaCodeExpiry: new Date(Date.now() + 3600000) }).where(eq(users.id, user.id));
      await request(app).post("/api/auth/mfa/verify").set("Cookie", old).send({ code: "654321" }).expect(401);
    }
  });
  it("switching an authenticated cookie to another pending MFA identity retires its old SID", async () => {
    const actor = await fixture(), target = await fixture();
    const other = await login(actor.email), old = await login(actor.email);
    await request(app).get("/__r01/session-store").set("Cookie", old).expect(200);
    await db.update(users).set({ mfaEnabled: true, mfaMethod: "email" }).where(eq(users.id, target.id));
    const oldSid = sidFrom(old), snapshot = await readSession(oldSid);
    const code = vi.spyOn(authMfaService, "generateMfaCode").mockReturnValue("123456");
    let response: request.Response;
    try { response = await request(app).post("/api/auth/login").set("Cookie", old).send({ email: target.email, password }).expect(200); }
    finally { code.mockRestore(); }
    await new Promise<void>((resolve, reject) => store.set(oldSid, snapshot, (error) => error ? reject(error) : resolve()));
    const pending = (response!.headers["set-cookie"] as unknown as string[]).join("; ");
    expect(response!.body.data.requiresMfa).toBe(true);
    expect(sidFrom(pending) === oldSid).toBe(false);
    await request(app).get("/api/auth/me").set("Cookie", old).expect(401);
    await request(app).get("/api/auth/me").set("Cookie", other).expect(200);
    const completed = await request(app).post("/api/auth/mfa/verify").set("Cookie", pending).send({ code: "123456" }).expect(200);
    expect(completed.body.data.user.id).toBe(target.id);
    expect((await pool.query("SELECT id FROM user_sessions WHERE session_token = $1", [oldSid])).rows).toHaveLength(0);
  });
});
