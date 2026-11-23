import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { db, pool } from "../../../db";
import { users, households, householdMembers } from "@shared/schema";
import * as auth from "../../../auth";
import { getTestApp } from "../../../__tests__/fixtures";
import { eraseAccount } from "../../settings/settings.account-deletion.service";
import * as history from "../auth.password-history";

const password = "SyntheticCredential123!";
const changed = "SyntheticChanged456!";
const recovered = "SyntheticRecovered789!";
const fixtures: { id: string; householdId: string }[] = [];
let app: Awaited<ReturnType<typeof getTestApp>>;
const sidFrom = (cookie: string) => decodeURIComponent(cookie.split(";")[0].split("=").slice(1).join("=")).slice(2).split(".")[0];
async function login(email: string, value = password) {
  const response = await request(app).post("/api/auth/login").send({ email, password: value }).expect(200);
  return (response.headers["set-cookie"] as unknown as string[]).join("; ");
}
async function fixture() {
  const id = randomUUID(), householdId = randomUUID(), email = `r01-credential-${id}@example.invalid`;
  const hash = await auth.hashPassword(password);
  await db.insert(users).values({ id, email, username: `credential-${id}`, passwordHash: hash, emailVerified: true });
  await db.insert(households).values({ id: householdId, name: "Synthetic R01 credential" });
  await db.insert(householdMembers).values({ userId: id, householdId, role: "owner" });
  fixtures.push({ id, householdId });
  const cookie = await login(email);
  await request(app).post("/api/settings/security/step-up").set("Cookie", cookie).send({ password }).expect(200);
  return { id, householdId, email, hash, cookie };
}
async function resetToken(userId: string) {
  const token = randomBytes(32).toString("hex");
  const { rows: [row] } = await pool.query("INSERT INTO password_reset_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, now() + interval '1 hour') RETURNING id", [userId, createHash("sha256").update(token).digest("hex")]);
  return { token, id: row.id as string };
}

describe("R01 password mutation boundaries", () => {
  beforeAll(async () => { app = await getTestApp(); });
  afterAll(async () => {
    vi.restoreAllMocks();
    for (const fixture of fixtures) {
      await pool.query('DELETE FROM "session" WHERE sess->>\'userId\' = $1', [fixture.id]);
      await db.delete(households).where(eq(households.id, fixture.householdId));
      await db.delete(users).where(eq(users.id, fixture.id));
    }
  });
  it.each(["reset", "erasure", "selected-session"] as const)("stale password change cannot overwrite %s committed after password verification", async (action) => {
    const user = await fixture();
    const other = action === "selected-session" ? await login(user.email) : undefined;
    if (other) await request(app).post("/api/settings/security/step-up").set("Cookie", other).send({ password }).expect(200);
    const original = auth.verifyPassword;
    let reached!: () => void, release!: () => void, block = true;
    const entered = new Promise<void>((resolve) => { reached = resolve; });
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const spy = vi.spyOn(auth, "verifyPassword").mockImplementation(async (value, hash) => {
      const valid = await original(value, hash);
      if (block && valid && value === password && hash === user.hash) { block = false; reached(); await gate; }
      return valid;
    });
    const pending = request(app).put("/api/settings/security/password").set("Cookie", user.cookie)
      .send({ currentPassword: password, newPassword: changed, confirmPassword: changed }).then((response) => response);
    let timeout!: ReturnType<typeof setTimeout>;
    const deadline = new Promise<never>((_, reject) => { timeout = setTimeout(() => reject(new Error("Verified-password barrier was not reached")), 8000); });
    let hashAfterAction: string | undefined;
    try {
      await Promise.race([entered, deadline]);
      if (action === "reset") {
        const { token } = await resetToken(user.id);
        await request(app).post("/api/auth/reset-password").send({ token, newPassword: recovered }).expect(200);
      } else if (action === "erasure") {
        await eraseAccount({ userId: user.id, userEmail: user.email, householdId: user.householdId });
      } else {
        const { rows: [target] } = await pool.query("SELECT id FROM user_sessions WHERE session_token = $1", [sidFrom(user.cookie)]);
        await request(app).delete(`/api/settings/security/sessions/${target.id}`).set("Cookie", other!).expect(200);
      }
      const { rows: [persisted] } = await pool.query("SELECT password_hash FROM users WHERE id = $1", [user.id]);
      hashAfterAction = persisted.password_hash;
    } finally { clearTimeout(timeout); release(); spy.mockRestore(); }
    expect((await pending).status).toBe(401);
    expect((await pool.query("SELECT password_hash FROM users WHERE id = $1", [user.id])).rows[0].password_hash === hashAfterAction).toBe(true);
    await request(app).get("/api/auth/me").set("Cookie", user.cookie).expect(401);
    if (action === "reset") await login(user.email, recovered);
    if (other) await request(app).get("/api/auth/me").set("Cookie", other).expect(200);
  });
  it.each(["lowercase123!", "UPPERCASE123!", "NoDigitsHere!", "NoSpecial123", "Aa1!", `Aa1!${"x".repeat(125)}`])("register, reset and change reject the same policy downgrade (%#)", async (invalid) => {
    const user = await fixture();
    const { token, id } = await resetToken(user.id);
    const unique = randomUUID();
    await request(app).post("/api/auth/register").send({ email: `r01-weak-${unique}@example.invalid`, username: `weak-${unique}`, password: invalid }).expect(400);
    await request(app).post("/api/auth/reset-password").send({ token, newPassword: invalid }).expect(400);
    await request(app).put("/api/settings/security/password").set("Cookie", user.cookie)
      .send({ currentPassword: password, newPassword: invalid, confirmPassword: invalid }).expect(400);
    expect((await pool.query("SELECT used_at FROM password_reset_tokens WHERE id = $1", [id])).rows[0].used_at).toBeNull();
    expect((await pool.query("SELECT password_hash FROM users WHERE id = $1", [user.id])).rows[0].password_hash === user.hash).toBe(true);
  });
  it("reset rejects the current password without consuming its token", async () => {
    const user = await fixture();
    const { token, id } = await resetToken(user.id);
    await request(app).post("/api/auth/reset-password").send({ token, newPassword: password }).expect(400);
    expect((await pool.query("SELECT used_at FROM password_reset_tokens WHERE id = $1", [id])).rows[0].used_at).toBeNull();
    await request(app).get("/api/auth/me").set("Cookie", user.cookie).expect(200);
  });
  it("both change and reset reject a historical password after a successful rotation", async () => {
    const user = await fixture();
    await request(app).put("/api/settings/security/password").set("Cookie", user.cookie)
      .send({ currentPassword: password, newPassword: changed, confirmPassword: changed }).expect(200);
    await request(app).put("/api/settings/security/password").set("Cookie", user.cookie)
      .send({ currentPassword: changed, newPassword: password, confirmPassword: password }).expect(400);
    const { token, id } = await resetToken(user.id);
    await request(app).post("/api/auth/reset-password").send({ token, newPassword: password }).expect(400);
    expect((await pool.query("SELECT used_at FROM password_reset_tokens WHERE id = $1", [id])).rows[0].used_at).toBeNull();
    expect(await auth.verifyPassword(changed, (await pool.query("SELECT password_hash FROM users WHERE id = $1", [user.id])).rows[0].password_hash)).toBe(true);
  });
  it.each(["change", "reset"] as const)("a history write failure rolls back %s and keeps sessions/token intact", async (action) => {
    const user = await fixture();
    const token = await resetToken(user.id);
    const original = history.recordPasswordInHistory;
    const fail = vi.spyOn(history, "recordPasswordInHistory").mockImplementation(async (...args) => {
      await original(...args);
      throw new Error("Synthetic failure after history INSERT");
    });
    try {
      if (action === "change") await request(app).put("/api/settings/security/password").set("Cookie", user.cookie)
        .send({ currentPassword: password, newPassword: changed, confirmPassword: changed }).expect(500);
      else await request(app).post("/api/auth/reset-password").send({ token: token.token, newPassword: recovered }).expect(500);
    } finally { fail.mockRestore(); }
    expect((await pool.query("SELECT password_hash = $2 AS unchanged, security_generation FROM users WHERE id = $1", [user.id, user.hash])).rows[0]).toEqual({ unchanged: true, security_generation: 0 });
    expect((await pool.query("SELECT id FROM password_history WHERE user_id = $1", [user.id])).rows).toHaveLength(0);
    expect((await pool.query("SELECT used_at FROM password_reset_tokens WHERE id = $1", [token.id])).rows[0].used_at).toBeNull();
    await request(app).get("/api/auth/me").set("Cookie", user.cookie).expect(200);
  });
  it("two changes verified against one old password have one winner", async () => {
    const user = await fixture();
    const original = auth.verifyPassword;
    let verified = 0, reached!: () => void, release!: () => void;
    const entered = new Promise<void>((resolve) => { reached = resolve; });
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const spy = vi.spyOn(auth, "verifyPassword").mockImplementation(async (value, hash) => {
      const valid = await original(value, hash);
      if (valid && value === password && hash === user.hash) { if (++verified === 2) reached(); await gate; }
      return valid;
    });
    const choices = [changed, recovered];
    const pending = choices.map((newPassword) => request(app).put("/api/settings/security/password").set("Cookie", user.cookie)
      .send({ currentPassword: password, newPassword, confirmPassword: newPassword }).then((response) => response));
    let timeout!: ReturnType<typeof setTimeout>;
    const deadline = new Promise<never>((_, reject) => { timeout = setTimeout(() => reject(new Error("Concurrent credential barrier was not reached")), 8000); });
    try { await Promise.race([entered, deadline]); }
    finally { clearTimeout(timeout); release(); spy.mockRestore(); }
    const results = await Promise.all(pending);
    expect(results.map((response) => response.status).sort()).toEqual([200, 401]);
    const { rows: [persisted] } = await pool.query("SELECT security_generation FROM users WHERE id = $1", [user.id]);
    expect(persisted.security_generation).toBe(1);
    expect((await pool.query("SELECT id FROM password_history WHERE user_id = $1", [user.id])).rows).toHaveLength(1);
    await login(user.email, choices[results.findIndex((response) => response.status === 200)]);
  });
});
