import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import pg from "pg";
import { randomUUID, randomBytes, createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { db, pool } from "../../../db";
import { users } from "@shared/schema";
import * as auth from "../../../auth";
import { getTestApp } from "../../../__tests__/fixtures";

const password = "SyntheticMfaPassword123!", otp = "123456", firstBackup = "AAAABBBB", secondBackup = "CCCCDDDD";
const ids: string[] = [];
let app: Awaited<ReturnType<typeof getTestApp>>;
async function login(email: string) {
  const response = await request(app).post("/api/auth/login").send({ email, password }).expect(200);
  return (response.headers["set-cookie"] as unknown as string[]).join("; ");
}
async function fixture(pendingCount = 2) {
  const id = randomUUID(), email = `r01-mfa-${id}@example.invalid`;
  await db.insert(users).values({ id, email, username: `mfa-${id}`, passwordHash: await auth.hashPassword(password), emailVerified: true });
  ids.push(id);
  const active = await login(email);
  await db.update(users).set({ mfaEnabled: true, mfaMethod: "email" }).where(eq(users.id, id));
  const pending: string[] = [];
  for (let i = 0; i < pendingCount; i++) pending.push(await login(email));
  const hash = await auth.hashPassword(otp);
  const backups = await Promise.all([firstBackup, secondBackup].map((value) => auth.hashPassword(value)));
  await db.update(users).set({ mfaCode: hash, mfaCodeExpiry: new Date(Date.now() + 3600000), mfaBackupCodes: backups, mfaBackupCodesGeneratedAt: new Date() }).where(eq(users.id, id));
  return { id, email, active, pending, hash, backups };
}
async function verify(cookie: string, code: string) {
  return request(app).post("/api/auth/mfa/verify").set("Cookie", cookie).send({ code });
}
async function race(cookies: string[], codes: string[]) {
  const original = auth.verifyPassword;
  let compared = 0, entered!: () => void, release!: () => void;
  const reached = new Promise<void>((resolve) => { entered = resolve; });
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const spy = vi.spyOn(auth, "verifyPassword").mockImplementation(async (value, hash) => {
    const valid = await original(value, hash);
    if (valid && codes.includes(value)) { if (++compared === 2) entered(); await gate; }
    return valid;
  });
  const pending = cookies.map((cookie, index) => verify(cookie, codes[index]).then((response) => response));
  let timer!: ReturnType<typeof setTimeout>;
  const deadline = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("Concurrent MFA comparisons not reached")), 8000); });
  try { await Promise.race([reached, deadline]); }
  finally { clearTimeout(timer); spy.mockRestore(); release(); }
  return Promise.all(pending);
}
async function verifiedBarrier(value: string, hash: string) {
  const original = auth.verifyPassword;
  let entered!: () => void, release!: () => void;
  const reached = new Promise<void>((resolve) => { entered = resolve; });
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const spy = vi.spyOn(auth, "verifyPassword").mockImplementation(async (candidate, stored) => {
    const valid = await original(candidate, stored);
    if (valid && candidate === value && stored === hash) { entered(); await gate; }
    return valid;
  });
  let timer!: ReturnType<typeof setTimeout>;
  const deadline = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("MFA comparison barrier not reached")), 8000); });
  return { reached: Promise.race([reached, deadline]), finish: () => { clearTimeout(timer); spy.mockRestore(); release(); } };
}

describe("R01 atomic MFA consumption", () => {
  beforeAll(async () => { app = await getTestApp(); });
  afterAll(async () => {
    vi.restoreAllMocks();
    for (const id of ids) {
      await pool.query('DELETE FROM "session" WHERE sess->>\'userId\' = $1 OR sess->>\'mfaPendingUserId\' = $1', [id]);
      await db.delete(users).where(eq(users.id, id));
    }
  });
  it.each(["otp", "backup"] as const)("concurrent same %s has one winner and cannot replay", async (kind) => {
    const user = await fixture(3), code = kind === "otp" ? otp : firstBackup;
    const results = await race(user.pending.slice(0, 2), [code, code]);
    expect(results.map((response) => response.status).sort()).toEqual([200, 401]);
    expect((await verify(user.pending[2], code)).status).toBe(401);
    const winner = results.find((response) => response.status === 200)!;
    const cookie = (winner.headers["set-cookie"] as unknown as string[]).join("; ");
    await request(app).get("/api/auth/me").set("Cookie", cookie).expect(200);
  });
  it("concurrent distinct backups both stay consumed", async () => {
    const user = await fixture(3);
    expect((await race(user.pending.slice(0, 2), [firstBackup, secondBackup])).map((response) => response.status)).toEqual([200, 200]);
    expect((await pool.query("SELECT mfa_backup_codes FROM users WHERE id = $1", [user.id])).rows[0].mfa_backup_codes).toEqual([]);
    expect((await verify(user.pending[2], firstBackup)).status).toBe(401);
    expect((await verify(user.pending[2], secondBackup)).status).toBe(401);
  });
  it.each(["otp", "backup-expired", "backup-undated"] as const)("%s cannot be consumed", async (kind) => {
    const user = await fixture(1);
    await db.update(users).set(kind === "otp" ? { mfaCodeExpiry: new Date(Date.now() - 1) } : {
      mfaBackupCodesGeneratedAt: kind === "backup-undated" ? null : new Date(Date.now() - 91 * 86400000),
    }).where(eq(users.id, user.id));
    expect((await verify(user.pending[0], kind === "otp" ? otp : firstBackup)).status).toBe(401);
    const { rows: [stored] } = await pool.query("SELECT mfa_code, mfa_backup_codes FROM users WHERE id = $1", [user.id]);
    expect(stored.mfa_code === user.hash).toBe(true);
    expect(stored.mfa_backup_codes).toHaveLength(2);
  });
  it.each(["replacement", "reset"] as const)("a verified old code cannot cross %s", async (action) => {
    const user = await fixture(1), barrier = await verifiedBarrier(otp, user.hash);
    const pending = verify(user.pending[0], otp).then((response) => response);
    let replacementHash: string | undefined;
    try {
      await barrier.reached;
      if (action === "replacement") {
        replacementHash = await auth.hashPassword("654321");
        await db.update(users).set({ mfaCode: replacementHash }).where(eq(users.id, user.id));
      } else {
        const token = randomBytes(32).toString("hex");
        await pool.query("INSERT INTO password_reset_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, now() + interval '1 hour')", [user.id, createHash("sha256").update(token).digest("hex")]);
        await request(app).post("/api/auth/reset-password").send({ token, newPassword: "SyntheticResetMfa456!" }).expect(200);
      }
    } finally { barrier.finish(); }
    expect((await pending).status).toBe(401);
    if (replacementHash) {
      expect((await pool.query("SELECT mfa_code FROM users WHERE id = $1", [user.id])).rows[0].mfa_code === replacementHash).toBe(true);
      expect((await verify(user.pending[0], "654321")).status).toBe(200);
    }
  });
  it("step-up and login compete for the same one-time code", async () => {
    const user = await fixture(1);
    const results = await Promise.all([
      verify(user.pending[0], otp),
      request(app).post("/api/settings/security/step-up").set("Cookie", user.active).send({ code: otp }),
    ]);
    expect(results.map((response) => response.status).sort()).toEqual([200, 401]);
    expect((await pool.query("SELECT mfa_code FROM users WHERE id = $1", [user.id])).rows[0].mfa_code).toBeNull();
  });
  it("an audit insert failure rolls back OTP consumption and permits a clean retry", async () => {
    const user = await fixture(1), original = pg.Client.prototype.query;
    const fail = vi.spyOn(pg.Client.prototype, "query").mockImplementation(function (this: pg.Client, ...args: Parameters<typeof original>) {
      const result: unknown = Reflect.apply(original, this, args);
      const [query, values] = args as unknown as [unknown, unknown];
      const text = typeof query === "object" && query !== null && "text" in query ? query.text : query;
      if (typeof text === "string" && /insert into "security_audit_logs"/i.test(text) && Array.isArray(values) && values.includes("MFA_VERIFIED")) {
        return Promise.resolve(result).then(() => { throw new Error("Synthetic audit failure"); }) as unknown as ReturnType<typeof original>;
      }
      return result as ReturnType<typeof original>;
    });
    try { expect((await verify(user.pending[0], otp)).status).toBe(500); }
    finally { fail.mockRestore(); }
    expect((await pool.query("SELECT mfa_code FROM users WHERE id = $1", [user.id])).rows[0].mfa_code === user.hash).toBe(true);
    expect((await verify(user.pending[0], otp)).status).toBe(200);
  });
  it.each(["send-code", "verify-code", "verify-backup"])("deprecated %s cannot consume another person's credential or switch identity", async (path) => {
    const target = await fixture(0), actor = await fixture(0);
    await request(app).post(`/api/settings/security/mfa/${path}`).set("Cookie", actor.active)
      .send({ email: target.email, code: otp, backupCode: firstBackup }).expect(410);
    expect((await pool.query("SELECT mfa_code FROM users WHERE id = $1", [target.id])).rows[0].mfa_code === target.hash).toBe(true);
    const response = await request(app).get("/api/auth/me").set("Cookie", actor.active).expect(200);
    expect(response.body.data.user.id).toBe(actor.id);
  });
  it("canonical verification requires the password-established pending subject and ignores body email", async () => {
    const actor = await fixture(1), target = await fixture(0);
    await request(app).post("/api/auth/mfa/verify").send({ email: target.email, code: otp }).expect(401);
    const response = await request(app).post("/api/auth/mfa/verify").set("Cookie", actor.pending[0]).send({ email: target.email, code: otp }).expect(200);
    expect(response.body.data.user.id).toBe(actor.id);
    expect((await pool.query("SELECT mfa_code FROM users WHERE id = $1", [target.id])).rows[0].mfa_code === target.hash).toBe(true);
  });
  it("duplicate hashes of the same backup secret are consumed together", async () => {
    const user = await fixture(2), duplicate = await auth.hashPassword(firstBackup);
    await db.update(users).set({ mfaBackupCodes: [user.backups[0], duplicate, user.backups[1]] }).where(eq(users.id, user.id));
    expect((await verify(user.pending[0], firstBackup)).status).toBe(200);
    expect((await verify(user.pending[1], firstBackup)).status).toBe(401);
    expect((await pool.query("SELECT mfa_backup_codes FROM users WHERE id = $1", [user.id])).rows[0].mfa_backup_codes).toEqual([user.backups[1]]);
  });
  it("a password reset crossing challenge hashing prevents stale challenge issuance", async () => {
    const user = await fixture(0), original = auth.hashPassword;
    let entered!: () => void, release!: () => void;
    const reached = new Promise<void>((resolve) => { entered = resolve; });
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const spy = vi.spyOn(auth, "hashPassword").mockImplementation(async (value) => {
      const hash = await original(value);
      if (/^\d{6}$/.test(value)) { entered(); await gate; }
      return hash;
    });
    const pending = request(app).post("/api/auth/login").send({ email: user.email, password }).then((response) => response);
    let timer!: ReturnType<typeof setTimeout>;
    const deadline = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("Challenge hashing barrier not reached")), 8000); });
    try {
      await Promise.race([reached, deadline]);
      const token = randomBytes(32).toString("hex");
      await pool.query("INSERT INTO password_reset_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, now() + interval '1 hour')", [user.id, createHash("sha256").update(token).digest("hex")]);
      await request(app).post("/api/auth/reset-password").send({ token, newPassword: "SyntheticIssueReset456!" }).expect(200);
    } finally { clearTimeout(timer); spy.mockRestore(); release(); }
    expect((await pending).status).toBe(401);
    expect((await pool.query("SELECT mfa_code FROM users WHERE id = $1", [user.id])).rows[0].mfa_code === user.hash).toBe(true);
  });
});
