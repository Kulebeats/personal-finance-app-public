import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import pg from "pg";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { db, pool } from "../../db";
import { users, households, householdMembers } from "@shared/schema";
import { getTestApp } from "../../__tests__/fixtures";
import * as auth from "../../auth";
import { userRepository } from "../../repositories/UserRepository";
import { eraseAccount } from "../../modules/settings/settings.account-deletion.service";
import { revokeSessionByToken } from "../../services/session-revocation";
import { withTransaction } from "../../utils/withTransaction";
import * as mail from "../../services/emailService";

const sent = vi.hoisted(() => ({ reset: [] as { email: string; token: string }[], verify: [] as { email: string; token: string }[] }));
vi.mock("../../services/emailService", async (original) => ({ ...await original<typeof import("../../services/emailService")>(),
  sendPasswordResetEmail: vi.fn(async (email: string, token: string) => { sent.reset.push({ email, token }); return true; }),
  sendVerificationEmail: vi.fn(async (email: string, token: string) => { sent.verify.push({ email, token }); return true; }),
}));
const password = "SyntheticEmailPassword123!", recovered = "SyntheticEmailRecovered456!";
const ids: string[] = [], householdIds: string[] = [];
let app: Awaited<ReturnType<typeof getTestApp>>;
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
async function fixture() {
  const id = randomUUID(), householdId = randomUUID(), email = `r01-email-${id}@example.invalid`, next = `r01-next-${id}@example.invalid`;
  await db.insert(users).values({ id, username: `email-${id}`, email, emailVerified: true, passwordHash: await auth.hashPassword(password) });
  ids.push(id);
  await db.insert(households).values({ id: householdId, name: "Synthetic R01 email lifecycle" });
  await db.insert(householdMembers).values({ userId: id, householdId, role: "owner" });
  householdIds.push(householdId);
  const login = await request(app).post("/api/auth/login").send({ email, password }).expect(200);
  return { id, householdId, email, next, cookie: (login.headers["set-cookie"] as unknown as string[]).join("; ") };
}
async function pending(user: Awaited<ReturnType<typeof fixture>>) {
  const raw = randomBytes(32).toString("hex");
  await pool.query("UPDATE users SET pending_email=$2,email_verification_token=$3,email_verification_expiry=now()+interval '1 hour' WHERE id=$1", [user.id, user.next, hash(raw)]);
  return raw;
}
function verify(raw: string) { return request(app).post("/api/settings/security/email/verify").send({ token: raw }); }
function deadline<T>(promise: Promise<T>, label: string) {
  let timer!: ReturnType<typeof setTimeout>;
  return Promise.race([promise, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(label)), 8000); })]).finally(() => clearTimeout(timer));
}
async function raceTokenReaders(raw: string, paths = ["/api/settings/security/email/verify", "/api/settings/security/email/verify"]) {
  const original = pool.query.bind(pool);
  let count = 0, reached!: () => void, release!: () => void;
  const entered = new Promise<void>((resolve) => { reached = resolve; }), gate = new Promise<void>((resolve) => { release = resolve; });
  const spy = vi.spyOn(pool, "query").mockImplementation(function (...args: any[]) {
    const text = typeof args[0] === "string" ? args[0] : args[0]?.text, values = args[0]?.values ?? args[1];
    const result = (original as any)(...args);
    if (text?.startsWith("select") && text.includes('"email_verification_token" =') && values?.includes(hash(raw))) {
      return result.then(async (rows: unknown) => { if (++count === 2) reached(); await gate; return rows; });
    }
    return result;
  } as any);
  const responses = paths.map((path) => request(app).post(path).send({ token: raw }).then((response) => response));
  try { await deadline(entered, "Both actual token reads were not reached"); }
  finally { spy.mockRestore(); release(); }
  return Promise.all(responses);
}
describe("R01 one-time email transition and reset-recipient lifecycle", () => {
  beforeAll(async () => { app = await getTestApp(); });
  afterAll(async () => {
    vi.restoreAllMocks();
    for (const id of householdIds) await db.delete(households).where(eq(households.id, id));
    for (const id of ids) {
      await pool.query("DELETE FROM outbox_events WHERE payload->>'userId'=$1", [id]);
      await pool.query("DELETE FROM security_audit_logs WHERE user_id=$1", [id]);
      await pool.query('DELETE FROM "session" WHERE sess->>\'userId\'=$1', [id]);
      await db.delete(users).where(eq(users.id, id));
    }
  });
  it("two readers of one email-change token have one winner and exact verified recipients", async () => {
    const user = await fixture(), raw = await pending(user);
    expect((await raceTokenReaders(raw)).map((response) => response.status).sort()).toEqual([200, 400]);
    const { rows: audits } = await pool.query("SELECT id,details FROM security_audit_logs WHERE user_id=$1 AND event_type='EMAIL_CHANGED'", [user.id]);
    expect(audits).toHaveLength(1);
    expect(audits[0].details).toEqual({ action: "email_change" });
    const { rows: notices } = await pool.query("SELECT aggregate_id,payload,status FROM outbox_events WHERE payload->>'userId'=$1", [user.id]);
    expect(notices).toHaveLength(2);
    expect(notices.map((row) => row.payload.recipient).sort()).toEqual([user.email, user.next].sort());
    expect(notices.every((row) => row.aggregate_id === audits[0].id && row.status === "suppressed")).toBe(true);
    for (const notice of notices) expect(Object.keys(notice.payload).sort()).toEqual(["channel", "kind", "occurredAt", "recipient", "userId", "version"]);
    expect(JSON.stringify({ audits, notices })).not.toContain(raw);
    expect(JSON.stringify({ audits, notices })).not.toContain(hash(raw));
    await verify(raw).expect(400);
  });
  it("a reset lookup from the former address cannot issue after a confirmed email transition", async () => {
    const user = await fixture(), raw = await pending(user), original = userRepository.findByEmail.bind(userRepository);
    let reached!: () => void, release!: () => void;
    const entered = new Promise<void>((resolve) => { reached = resolve; }), gate = new Promise<void>((resolve) => { release = resolve; });
    const spy = vi.spyOn(userRepository, "findByEmail").mockImplementation(async (email) => {
      const snapshot = await original(email);
      if (email === user.email) { reached(); await gate; }
      return snapshot;
    });
    const response = request(app).post("/api/auth/forgot-password").send({ email: user.email }).then((value) => value);
    try { await deadline(entered, "Actual former-address lookup was not reached"); await verify(raw).expect(200); }
    finally { spy.mockRestore(); release(); }
    expect((await response).status).toBe(200);
    expect(sent.reset.filter((mail) => mail.email === user.email)).toHaveLength(0);
    expect((await pool.query("SELECT id FROM password_reset_tokens WHERE user_id=$1", [user.id])).rows).toHaveLength(0);
  });
  it("a confirmed email transition invalidates previously issued former-address reset links", async () => {
    const user = await fixture(), raw = await pending(user);
    await request(app).post("/api/auth/forgot-password").send({ email: user.email }).expect(200);
    const reset = sent.reset.find((mail) => mail.email === user.email)!;
    expect(reset).toBeDefined();
    await verify(raw).expect(200);
    await request(app).post("/api/auth/reset-password").send({ token: reset.token, newPassword: recovered }).expect(400);
    expect((await pool.query("SELECT used_at FROM password_reset_tokens WHERE user_id=$1", [user.id])).rows[0].used_at).not.toBeNull();
    await request(app).post("/api/auth/login").send({ email: user.next, password }).expect(200);
  });
  it("an actual notice insertion failure rolls back email/token/reset invalidation and audit", async () => {
    const user = await fixture(), raw = await pending(user);
    await request(app).post("/api/auth/forgot-password").send({ email: user.email }).expect(200);
    const original = pg.Client.prototype.query;
    const spy = vi.spyOn(pg.Client.prototype, "query").mockImplementation(function (this: pg.Client, ...args: any[]) {
      const text = typeof args[0] === "string" ? args[0] : args[0]?.text;
      if (text?.startsWith('insert into "outbox_events"')) return (original as any).apply(this, args).then(() => { throw new Error("Synthetic email notice rollback"); });
      return (original as any).apply(this, args);
    } as any);
    try { await verify(raw).expect(500); } finally { spy.mockRestore(); }
    expect((await pool.query("SELECT email,pending_email,email_verification_token FROM users WHERE id=$1", [user.id])).rows[0])
      .toEqual({ email: user.email, pending_email: user.next, email_verification_token: hash(raw) });
    expect((await pool.query("SELECT used_at FROM password_reset_tokens WHERE user_id=$1", [user.id])).rows[0].used_at).toBeNull();
    expect((await pool.query("SELECT id FROM security_audit_logs WHERE user_id=$1 AND event_type='EMAIL_CHANGED'", [user.id])).rows).toHaveLength(0);
    expect((await pool.query("SELECT id FROM outbox_events WHERE payload->>'userId'=$1", [user.id])).rows).toHaveLength(0);
    await verify(raw).expect(200);
  });
  it("the initial auth alias cannot consume a change token or switch the visiting session", async () => {
    const owner = await fixture(), visitor = await fixture(), raw = await pending(owner);
    await request(app).post("/api/auth/verify-email").set("Cookie", visitor.cookie).send({ token: raw }).expect(400);
    await request(app).post("/api/settings/security/email/verify").set("Cookie", visitor.cookie).send({ token: raw }).expect(200);
    expect((await request(app).get("/api/auth/me").set("Cookie", visitor.cookie).expect(200)).body.data.user.id).toBe(visitor.id);
    expect((await request(app).get("/api/auth/me").set("Cookie", owner.cookie).expect(200)).body.data.user.id).toBe(owner.id);
  });
  it("both initial-verification aliases share one consumption boundary", async () => {
    const user = await fixture(), raw = randomBytes(32).toString("hex");
    await pool.query("UPDATE users SET email_verified=false,email_verification_token=$2,email_verification_expiry=now()+interval '1 hour' WHERE id=$1", [user.id, hash(raw)]);
    expect((await raceTokenReaders(raw, ["/api/auth/verify-email", "/api/settings/security/email/verify"])).map((response) => response.status).sort()).toEqual([200, 400]);
    expect((await pool.query("SELECT details FROM security_audit_logs WHERE user_id=$1 AND event_type='EMAIL_VERIFIED'", [user.id])).rows).toEqual([{ details: { action: "email_verified" } }]);
    expect((await pool.query("SELECT id FROM outbox_events WHERE payload->>'userId'=$1", [user.id])).rows).toHaveLength(0);
  });
  it.each(["expired", "undated"])("rejects %s verification without consuming pending identity", async (expiry) => {
    const user = await fixture(), raw = await pending(user);
    await pool.query("UPDATE users SET email_verification_expiry=CASE WHEN $2='expired' THEN now()-interval '1 second' ELSE NULL END WHERE id=$1", [user.id, expiry]);
    await verify(raw).expect(400);
    expect((await pool.query("SELECT email,pending_email,email_verification_token FROM users WHERE id=$1", [user.id])).rows[0])
      .toEqual({ email: user.email, pending_email: user.next, email_verification_token: hash(raw) });
  });
  it("only notifies verified transition addresses and clears old-channel OTPs", async () => {
    const user = await fixture(), raw = await pending(user);
    await pool.query("UPDATE users SET email_verified=false,mfa_code=$2,mfa_code_expiry=now()+interval '1 hour' WHERE id=$1", [user.id, "synthetic-old-channel-hash"]);
    await verify(raw).expect(200);
    expect((await pool.query("SELECT payload->>'recipient' AS recipient FROM outbox_events WHERE payload->>'userId'=$1", [user.id])).rows).toEqual([{ recipient: user.next }]);
    expect((await pool.query("SELECT mfa_code,mfa_code_expiry FROM users WHERE id=$1", [user.id])).rows[0]).toEqual({ mfa_code: null, mfa_code_expiry: null });
  });
  it.each(["reset", "selected-session", "erasure"] as const)("stale password-verified email change cannot survive %s", async (action) => {
    const user = await fixture();
    const stored = (await pool.query("SELECT password_hash FROM users WHERE id=$1", [user.id])).rows[0].password_hash;
    const original = auth.verifyPassword;
    let reached!: () => void, release!: () => void;
    const entered = new Promise<void>((resolve) => { reached = resolve; }), gate = new Promise<void>((resolve) => { release = resolve; });
    const spy = vi.spyOn(auth, "verifyPassword").mockImplementation(async (value, storedHash) => {
      const valid = await original(value, storedHash);
      if (valid && value === password && storedHash === stored) { reached(); await gate; }
      return valid;
    });
    const response = request(app).post("/api/settings/security/email/change").set("Cookie", user.cookie).send({ password, newEmail: user.next }).then((value) => value);
    try {
      await deadline(entered, "Actual email-change password comparison was not reached");
      if (action === "reset") {
        await request(app).post("/api/auth/forgot-password").send({ email: user.email }).expect(200);
        await request(app).post("/api/auth/reset-password").send({ token: sent.reset.find((item) => item.email === user.email)!.token, newPassword: recovered }).expect(200);
      } else if (action === "erasure") await eraseAccount({ userId: user.id, userEmail: user.email, householdId: user.householdId });
      else {
        const sid = decodeURIComponent(user.cookie.split(";")[0].split("=").slice(1).join("=")).slice(2).split(".")[0];
        await withTransaction((tx) => revokeSessionByToken(tx, user.id, sid));
      }
    } finally { spy.mockRestore(); release(); }
    expect((await response).status).toBe(401);
    expect((await pool.query("SELECT pending_email,email_verification_token FROM users WHERE id=$1", [user.id])).rows[0]).toEqual({ pending_email: null, email_verification_token: null });
    expect(sent.verify.filter((mail) => mail.email === user.next)).toHaveLength(0);
  });
  it("public initial resend does not overwrite a pending change challenge", async () => {
    const user = await fixture(), raw = await pending(user);
    await pool.query("UPDATE users SET email_verified=false WHERE id=$1", [user.id]);
    await request(app).post("/api/auth/resend-verification").send({ email: user.email }).expect(200);
    expect((await pool.query("SELECT email_verification_token,pending_email FROM users WHERE id=$1", [user.id])).rows[0])
      .toEqual({ email_verification_token: hash(raw), pending_email: user.next });
  });
  it("change, resend and cancel preserve actor binding and never echo bearer material", async () => {
    const owner = await fixture(), visitor = await fixture(), visitorRaw = await pending(visitor);
    const changed = await request(app).post("/api/settings/security/email/change").set("Cookie", owner.cookie)
      .send({ password, newEmail: owner.next, userId: visitor.id }).expect(200);
    const first = sent.verify.filter((mail) => mail.email === owner.next).at(-1)!;
    expect(first).toBeDefined();
    expect(changed.body).toMatchObject({ success: true, data: { delivery: "accepted" } });
    expect(JSON.stringify(changed.body)).not.toContain(first.token);
    expect(JSON.stringify(changed.body)).not.toContain(hash(first.token));
    expect(changed.body.devVerifyUrl).toBeUndefined();
    await request(app).post("/api/settings/security/email/resend").set("Cookie", owner.cookie).send({ userId: visitor.id }).expect(429);
    expect(sent.verify.filter((mail) => mail.email === owner.next)).toHaveLength(1);
    await pool.query("UPDATE users SET email_verification_expiry=now()+interval '24 hours'-interval '61 seconds' WHERE id=$1", [owner.id]);
    await request(app).post("/api/settings/security/email/resend").set("Cookie", owner.cookie).send({ userId: visitor.id }).expect(200);
    const second = sent.verify.filter((mail) => mail.email === owner.next).at(-1)!;
    expect(second.token).not.toBe(first.token);
    await verify(first.token).expect(400);
    await request(app).post("/api/settings/security/email/cancel").set("Cookie", visitor.cookie).send({ userId: owner.id }).expect(200);
    expect((await pool.query("SELECT pending_email,email_verification_token FROM users WHERE id=$1", [owner.id])).rows[0])
      .toEqual({ pending_email: owner.next, email_verification_token: hash(second.token) });
    await verify(visitorRaw).expect(400);
    await request(app).post("/api/settings/security/email/cancel").set("Cookie", owner.cookie).send({}).expect(200);
    await verify(second.token).expect(400);
    for (const endpoint of ["change", "resend", "cancel"]) await request(app).post(`/api/settings/security/email/${endpoint}`).send({ password, newEmail: owner.next }).expect(401);
  });
  it.each(["resend", "cancel"])("a revoked SID cannot commit an in-flight %s", async (endpoint) => {
    const user = await fixture(), raw = await pending(user), original = userRepository.findById.bind(userRepository);
    let reached!: () => void, release!: () => void;
    const entered = new Promise<void>((resolve) => { reached = resolve; }), gate = new Promise<void>((resolve) => { release = resolve; });
    const spy = vi.spyOn(userRepository, "findById").mockImplementation(async (id) => {
      const snapshot = await original(id);
      if (id === user.id) { reached(); await gate; }
      return snapshot;
    });
    const response = request(app).post(`/api/settings/security/email/${endpoint}`).set("Cookie", user.cookie).send({}).then((value) => value);
    try {
      await deadline(entered, "Actual email-operation identity read was not reached");
      const sid = decodeURIComponent(user.cookie.split(";")[0].split("=").slice(1).join("=")).slice(2).split(".")[0];
      await withTransaction((tx) => revokeSessionByToken(tx, user.id, sid));
    } finally { spy.mockRestore(); release(); }
    expect((await response).status).toBe(401);
    expect((await pool.query("SELECT pending_email,email_verification_token FROM users WHERE id=$1", [user.id])).rows[0])
      .toEqual({ pending_email: user.next, email_verification_token: hash(raw) });
    expect(sent.verify.filter((mail) => mail.email === user.next)).toHaveLength(0);
  });
  it.each(["false", "throw"])("challenge delivery %s is truthful and never exposes its token", async (outcome) => {
    const user = await fixture();
    let bearer = "";
    vi.mocked(mail.sendVerificationEmail).mockImplementationOnce(async (_email, token) => {
      bearer = token;
      if (outcome === "throw") throw new Error("Synthetic ambiguous delivery");
      return false;
    });
    const response = await request(app).post("/api/settings/security/email/change").set("Cookie", user.cookie).send({ password, newEmail: user.next }).expect(200);
    expect(response.body.data.delivery).toBe(outcome === "throw" ? "unknown" : "unavailable");
    expect(response.body.message).not.toMatch(/sent|accepted/);
    expect(bearer).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(response.body)).not.toContain(bearer);
    expect(JSON.stringify(response.body)).not.toContain(hash(bearer));
    expect((await pool.query("SELECT email_verification_token FROM users WHERE id=$1", [user.id])).rows[0].email_verification_token).toBe(hash(bearer));
  });
  it.each(["reset", "change"] as const)("an email-change bearer issued before password %s cannot reclaim the account", async (replacement) => {
    const user = await fixture();
    await request(app).post("/api/settings/security/email/change").set("Cookie", user.cookie)
      .send({ password, newEmail: user.next }).expect(200);
    const issued = sent.verify.filter((item) => item.email === user.next).at(-1)!;
    expect(issued).toBeDefined();
    expect((await pool.query("SELECT pending_email,email_verification_token FROM users WHERE id=$1", [user.id])).rows[0])
      .toEqual({ pending_email: user.next, email_verification_token: hash(issued.token) });
    if (replacement === "reset") {
      await request(app).post("/api/auth/forgot-password").send({ email: user.email }).expect(200);
      await request(app).post("/api/auth/reset-password").send({ token: sent.reset.find((item) => item.email === user.email)!.token, newPassword: recovered }).expect(200);
    } else {
      await request(app).post("/api/settings/security/step-up").set("Cookie", user.cookie).send({ password }).expect(200);
      await request(app).put("/api/settings/security/password").set("Cookie", user.cookie)
        .send({ currentPassword: password, newPassword: recovered, confirmPassword: recovered }).expect(200);
    }
    const credential = (await pool.query("SELECT password_hash FROM users WHERE id=$1", [user.id])).rows[0].password_hash;
    const result = await verify(issued.token);
    // A copied bearer must not acquire an address that can receive a new reset.
    await request(app).post("/api/auth/forgot-password").send({ email: user.next }).expect(200);
    const state = (await pool.query("SELECT email,email_verified,pending_email,email_verification_token,email_verification_expiry,password_hash FROM users WHERE id=$1", [user.id])).rows[0];
    expect({ verifyStatus: result.status, ...state, attackerResetEmails: sent.reset.filter((item) => item.email === user.next).length })
      .toEqual({ verifyStatus: 400, email: user.email, email_verified: true, pending_email: null, email_verification_token: null,
        email_verification_expiry: null, password_hash: credential, attackerResetEmails: 0 });
    expect((await pool.query("SELECT id FROM security_audit_logs WHERE user_id=$1 AND event_type='EMAIL_CHANGED'", [user.id])).rows).toHaveLength(0);
    expect((await pool.query("SELECT id FROM outbox_events WHERE payload->>'userId'=$1 AND payload->>'kind'='email_changed'", [user.id])).rows).toHaveLength(0);
    expect((await pool.query("SELECT id FROM notifications WHERE user_id=$1 AND type='email_changed'", [user.id])).rows).toHaveLength(0);
    await request(app).post("/api/auth/login").send({ email: user.email, password: recovered }).expect(200);
  });
  it("password recovery does not activate or repurpose an initial-verification challenge", async () => {
    const user = await fixture(), raw = randomBytes(32).toString("hex");
    await pool.query("UPDATE users SET email_verified=false,email_verification_token=$2,email_verification_expiry=now()+interval '1 hour' WHERE id=$1", [user.id, hash(raw)]);
    await request(app).post("/api/auth/forgot-password").send({ email: user.email }).expect(200);
    await request(app).post("/api/auth/reset-password").send({ token: sent.reset.find((item) => item.email === user.email)!.token, newPassword: recovered }).expect(200);
    expect((await pool.query("SELECT email_verified,pending_email,email_verification_token FROM users WHERE id=$1", [user.id])).rows[0])
      .toEqual({ email_verified: false, pending_email: null, email_verification_token: hash(raw) });
    await request(app).post("/api/auth/login").send({ email: user.email, password: recovered }).expect(403);
    await request(app).post("/api/auth/verify-email").send({ token: raw }).expect(200);
    await request(app).post("/api/auth/login").send({ email: user.email, password: recovered }).expect(200);
  });
  it.each(["reset", "change"] as const)("failed password %s notice enqueue rolls pending capability invalidation back", async (replacement) => {
    const user = await fixture(), raw = await pending(user);
    await request(app).post("/api/auth/forgot-password").send({ email: user.email }).expect(200);
    const reset = sent.reset.find((item) => item.email === user.email)!;
    if (replacement === "change") await request(app).post("/api/settings/security/step-up").set("Cookie", user.cookie).send({ password }).expect(200);
    const original = pg.Client.prototype.query;
    const spy = vi.spyOn(pg.Client.prototype, "query").mockImplementation(function (this: pg.Client, ...args: any[]) {
      const text = typeof args[0] === "string" ? args[0] : args[0]?.text;
      if (text?.startsWith('insert into "outbox_events"')) return (original as any).apply(this, args).then(() => { throw new Error("Synthetic credential replacement notice rollback"); });
      return (original as any).apply(this, args);
    } as any);
    try {
      if (replacement === "reset") await request(app).post("/api/auth/reset-password").send({ token: reset.token, newPassword: recovered }).expect(500);
      else await request(app).put("/api/settings/security/password").set("Cookie", user.cookie)
        .send({ currentPassword: password, newPassword: recovered, confirmPassword: recovered }).expect(500);
    } finally { spy.mockRestore(); }
    expect((await pool.query("SELECT email,pending_email,email_verification_token,security_generation FROM users WHERE id=$1", [user.id])).rows[0])
      .toEqual({ email: user.email, pending_email: user.next, email_verification_token: hash(raw), security_generation: 0 });
    expect((await pool.query("SELECT used_at FROM password_reset_tokens WHERE token_hash=$1", [hash(reset.token)])).rows[0].used_at).toBeNull();
    await request(app).post("/api/auth/login").send({ email: user.email, password }).expect(200);
  });
});
