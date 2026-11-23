import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { createHash, randomUUID } from "node:crypto";
import { pool } from "../../db";
import { getTestApp } from "../../__tests__/fixtures";
import { sessionStore } from "../../config/session-store";

const deliveries = vi.hoisted(() => [] as { to: string; html: string; text?: string }[]);
const changeDeliveries = vi.hoisted(() => [] as { email: string; token: string; isEmailChange: boolean }[]);
vi.mock("../../services/emailService", async (original) => ({
  ...await original<typeof import("../../services/emailService")>(),
  sendEmail: vi.fn(async (message: { to: string; html: string; text?: string }) => { deliveries.push(message); return true; }),
  sendVerificationEmail: vi.fn(async (email: string, token: string, isEmailChange: boolean) => {
    changeDeliveries.push({ email, token, isEmailChange }); return true;
  }),
}));
const originalOrigin = process.env.APP_URL;
const password = "SyntheticR02Password123!";
const emails: string[] = [];
let app: Awaited<ReturnType<typeof getTestApp>>;
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const verificationPaths = ["/api/auth/verify-email", "/api/settings/security/email/verify"];
function emitted(email: string) {
  const message = deliveries.filter((item) => item.to === email).at(-1);
  expect(message).toBeDefined();
  const href = message!.html.match(/href="([^"]+)"/)?.[1];
  expect(href).toBeDefined();
  const url = new URL(href!);
  const token = url.searchParams.get("token");
  expect(token).toMatch(/^[a-f0-9]{64}$/);
  return { url, token: token! };
}
async function register() {
  const unique = randomUUID(), email = `r02-entry-${unique}@example.invalid`;
  emails.push(email);
  const response = await request(app).post("/api/auth/register")
    .send({ username: `r02-${unique}`, email, password }).expect(201);
  const { rows: [user] } = await pool.query<{ id: string }>("SELECT id FROM users WHERE email=$1", [email]);
  expect(user).toBeDefined();
  const cookie = (response.headers["set-cookie"] as unknown as string[]).join("; ");
  return { id: user.id, email, cookie, ...emitted(email) };
}
function consume(token: string) { return request(app).post("/api/settings/security/email/verify").send({ token }); }
async function identitySnapshot(id: string) {
  const sessions = await pool.query<{ sid: string; sess: Record<string, unknown> }>(
    'SELECT sid,sess FROM "session" WHERE sess->>\'userId\'=$1 OR sess->>\'mfaPendingUserId\'=$1 ORDER BY sid', [id]);
  return {
    sessions: sessions.rows.map(({ sid, sess }) => { const { cookie: _housekeeping, ...identity } = sess; return { sid, identity }; }),
    tracked: (await pool.query("SELECT id,user_id,session_token,is_trusted FROM user_sessions WHERE user_id=$1 ORDER BY id", [id])).rows,
    generation: (await pool.query("SELECT security_generation FROM users WHERE id=$1", [id])).rows,
    security: (await pool.query("SELECT email,mfa_enabled,mfa_method,mfa_code,mfa_code_expiry,erased_at FROM users WHERE id=$1", [id])).rows,
  };
}
async function targetSnapshot(id: string) {
  return {
    user: (await pool.query("SELECT to_jsonb(u) AS state FROM users u WHERE id=$1", [id])).rows,
    reset: (await pool.query("SELECT * FROM password_reset_tokens WHERE user_id=$1 ORDER BY id", [id])).rows,
    audit: (await pool.query("SELECT * FROM security_audit_logs WHERE user_id=$1 ORDER BY id", [id])).rows,
    notices: (await pool.query("SELECT * FROM outbox_events WHERE payload->>'userId'=$1 ORDER BY id", [id])).rows,
    identity: await identitySnapshot(id),
  };
}
async function verifiedVisitor(mfa: boolean) {
  const visitor = await register();
  await consume(visitor.token).expect(200);
  if (mfa) {
    await pool.query("UPDATE users SET mfa_enabled=true,mfa_method='email' WHERE id=$1", [visitor.id]);
    const login = await request(app).post("/api/auth/login").send({ email: visitor.email, password }).expect(200);
    expect(login.body.data.requiresMfa).toBe(true);
    visitor.cookie = (login.headers["set-cookie"] as unknown as string[]).join("; ");
  }
  return visitor;
}

describe("R02 public mail entry source regressions (transport mocked, test-mode app)", () => {
  beforeAll(async () => { process.env.APP_URL = "https://capital.example.invalid/"; app = await getTestApp(); });
  afterAll(async () => {
    vi.restoreAllMocks();
    for (const email of emails) {
      const { rows } = await pool.query<{ id: string }>("SELECT id FROM users WHERE email=$1", [email]);
      for (const { id } of rows) {
        await pool.query("DELETE FROM outbox_events WHERE payload->>'userId'=$1", [id]);
        await pool.query("DELETE FROM security_audit_logs WHERE user_id=$1", [id]);
        await pool.query('DELETE FROM "session" WHERE sess->>\'userId\'=$1 OR sess->>\'mfaPendingUserId\'=$1', [id]);
        await pool.query("DELETE FROM users WHERE id=$1", [id]);
      }
    }
    if (originalOrigin === undefined) delete process.env.APP_URL;
    else process.env.APP_URL = originalOrigin;
  });

  it("registration emits the exact canonical public link and persists only the token hash", async () => {
    const owner = await register();
    expect(owner.url.origin).toBe("https://capital.example.invalid");
    expect(owner.url.pathname).toBe("/verify-email");
    const { rows: [stored] } = await pool.query("SELECT email_verified,email_verification_token FROM users WHERE id=$1", [owner.id]);
    expect(stored).toEqual({ email_verified: false, email_verification_token: hash(owner.token) });
    expect(stored.email_verification_token).not.toBe(owner.token);
  });

  it.each(verificationPaths)("a fresh anonymous visitor consumes A's emitted token through %s without becoming A", async (path) => {
    const owner = await register(), visitor = request.agent(app);
    const before = await identitySnapshot(owner.id);
    await visitor.post(path).send({ token: owner.token }).expect(200);
    await visitor.get("/api/auth/me").expect(401);
    await consume(owner.token).expect(400);
    expect(await identitySnapshot(owner.id)).toEqual(before);
    expect((await pool.query("SELECT email_verified,email_verification_token FROM users WHERE id=$1", [owner.id])).rows[0])
      .toEqual({ email_verified: true, email_verification_token: null });
    expect((await pool.query("SELECT id FROM security_audit_logs WHERE user_id=$1 AND event_type='EMAIL_VERIFIED'", [owner.id])).rows).toHaveLength(1);
  });

  it.each(verificationPaths)("a signed-in C remains C while consuming A's emitted token through %s", async (path) => {
    const owner = await register(), visitor = await register();
    await consume(visitor.token).expect(200);
    const before = await identitySnapshot(visitor.id);
    await request(app).post(path).set("Cookie", visitor.cookie).send({ token: owner.token }).expect(200);
    expect((await request(app).get("/api/auth/me").set("Cookie", visitor.cookie).expect(200)).body.data.user.id).toBe(visitor.id);
    expect(await identitySnapshot(visitor.id)).toEqual(before);
  });

  it.each(verificationPaths)("an unrelated MFA-only visitor stays pending while %s verifies the token owner", async (path) => {
    const owner = await register(), visitor = await verifiedVisitor(true);
    const before = await identitySnapshot(visitor.id);
    await request(app).post(path).set("Cookie", visitor.cookie).send({ token: owner.token }).expect(200);
    expect(await identitySnapshot(visitor.id)).toEqual(before);
    expect((await request(app).get("/api/auth/session").set("Cookie", visitor.cookie).expect(200)).body.data)
      .toEqual({ state: "mfa_pending" });
    await request(app).get("/api/auth/me").set("Cookie", visitor.cookie).expect(401);
    expect((await pool.query("SELECT email_verified,email_verification_token FROM users WHERE id=$1", [owner.id])).rows[0])
      .toEqual({ email_verified: true, email_verification_token: null });
  });

  it.each(verificationPaths.flatMap((path) => ["wrong", "stored-hash", "expired"]
    .map((kind) => ({ path, kind }))))("$path rejects a $kind token without effects", async ({ path, kind }) => {
    const owner = await register();
    if (kind === "expired") await pool.query("UPDATE users SET email_verification_expiry=now()-interval '1 second' WHERE id=$1", [owner.id]);
    const before = await targetSnapshot(owner.id);
    const token = kind === "wrong" ? "not-an-issued-token" : kind === "stored-hash" ? hash(owner.token) : owner.token;
    await request(app).post(path).send({ token }).expect(400);
    expect(await targetSnapshot(owner.id)).toEqual(before);
  });

  it.each([false, true])("email-change token effects stay on its owner with an unrelated visitor (MFA=%s)", async (mfa) => {
    const owner = await register(), visitor = await verifiedVisitor(mfa);
    await consume(owner.token).expect(200);
    await request(app).post("/api/auth/forgot-password").send({ email: owner.email }).expect(200);
    const next = `r02-change-${randomUUID()}@example.invalid`;
    emails.push(next);
    await request(app).post("/api/settings/security/email/change").set("Cookie", owner.cookie)
      .send({ newEmail: next, password }).expect(200);
    const issued = changeDeliveries.find((delivery) => delivery.email === next);
    expect(issued?.isEmailChange).toBe(true);
    await pool.query("UPDATE users SET mfa_code=$2,mfa_code_expiry=now()+interval '1 hour' WHERE id=$1", [owner.id, "synthetic-old-channel-hash"]);
    const beforeOwner = await targetSnapshot(owner.id), beforeVisitor = await identitySnapshot(visitor.id);
    await request(app).post("/api/auth/verify-email").set("Cookie", visitor.cookie)
      .send({ token: issued!.token }).expect(400);
    expect(await targetSnapshot(owner.id)).toEqual(beforeOwner);
    expect(await identitySnapshot(visitor.id)).toEqual(beforeVisitor);
    await request(app).post("/api/settings/security/email/verify").set("Cookie", visitor.cookie)
      .send({ token: issued!.token }).expect(200);
    expect(await identitySnapshot(visitor.id)).toEqual(beforeVisitor);
    expect((await pool.query("SELECT email,email_verified,pending_email,email_verification_token,email_verification_expiry,mfa_code,mfa_code_expiry FROM users WHERE id=$1", [owner.id])).rows[0])
      .toEqual({ email: next, email_verified: true, pending_email: null, email_verification_token: null,
        email_verification_expiry: null, mfa_code: null, mfa_code_expiry: null });
    const reset = (await pool.query("SELECT used_at FROM password_reset_tokens WHERE user_id=$1", [owner.id])).rows;
    expect(reset).toHaveLength(1); expect(reset[0].used_at).not.toBeNull();
    const audits = (await pool.query("SELECT id,details FROM security_audit_logs WHERE user_id=$1 AND event_type='EMAIL_CHANGED'", [owner.id])).rows;
    expect(audits).toHaveLength(1); expect(audits[0].details).toEqual({ action: "email_change" });
    const notices = (await pool.query("SELECT aggregate_id,payload FROM outbox_events WHERE payload->>'userId'=$1 AND payload->>'kind'='email_changed'", [owner.id])).rows;
    expect(notices.map((notice) => notice.payload.recipient).sort()).toEqual([owner.email, next].sort());
    expect(notices.every((notice) => notice.aggregate_id === audits[0].id && notice.payload.userId === owner.id)).toBe(true);
    const after = await targetSnapshot(owner.id);
    await request(app).post("/api/settings/security/email/verify").set("Cookie", visitor.cookie)
      .send({ token: issued!.token }).expect(400);
    expect(await targetSnapshot(owner.id)).toEqual(after);
    expect(await identitySnapshot(visitor.id)).toEqual(beforeVisitor);
  });

  it("legacy GET redirects without consuming a token or reading the supplied visitor session", async () => {
    const owner = await register();
    const before = await identitySnapshot(owner.id);
    const read = vi.spyOn(sessionStore, "get");
    try {
      const response = await request(app).get(`/auth/verify-email?token=${owner.token}&next=https://outside.example.invalid`)
        .set("Cookie", owner.cookie).expect(302);
      expect(response.headers.location).toBe(`/verify-email?token=${owner.token}`);
      expect(response.headers["cache-control"]).toBe("no-store");
      expect(response.headers["referrer-policy"]).toBe("no-referrer");
      expect(response.headers["set-cookie"]).toBeUndefined();
      expect(read).not.toHaveBeenCalled();
    } finally { read.mockRestore(); }
    expect(await identitySnapshot(owner.id)).toEqual(before);
    expect((await pool.query("SELECT email_verified,email_verification_token FROM users WHERE id=$1", [owner.id])).rows[0])
      .toEqual({ email_verified: false, email_verification_token: hash(owner.token) });
  });

  it("legacy redirects retain an opaque token and reject duplicate or oversized input", async () => {
    const token = "opaque+/?&= #fragment";
    const response = await request(app).get("/auth/verify-email").query({ token }).expect(302);
    expect(new URL(response.headers.location, "https://capital.example.invalid").searchParams.get("token")).toBe(token);
    await request(app).get("/auth/verify-email?token=one&token=two").expect(400);
    await request(app).get("/auth/verify-email").query({ token: "x".repeat(257) }).expect(400);
    expect((await request(app).get("/auth/verify-email").expect(302)).headers.location).toBe("/verify-email");
  });

  it("public resend preserves a cooling initial token, then rotates it without exposing account state", async () => {
    const owner = await register(), verified = await register();
    await consume(verified.token).expect(200);
    const credential = async (id: string) => (await pool.query(
      "SELECT email_verified,pending_email,email_verification_token,email_verification_expiry,updated_at FROM users WHERE id=$1", [id]
    )).rows[0];
    const original = await credential(owner.id), verifiedBefore = await credential(verified.id);
    const initialDeliveryCount = deliveries.filter((item) => item.to === owner.email).length;
    const pending = await request(app).post("/api/auth/resend-verification").send({ email: owner.email }).expect(200);
    const known = await request(app).post("/api/auth/resend-verification").send({ email: verified.email }).expect(200);
    const unknown = await request(app).post("/api/auth/resend-verification").send({ email: "r02-unknown@example.invalid" }).expect(200);
    expect(pending.body).toEqual(known.body);
    expect(pending.body).toEqual(unknown.body);
    expect(pending.body.meta.message).toBe("If verification is needed, a new link has been requested.");
    expect(deliveries.filter((item) => item.to === owner.email)).toHaveLength(initialDeliveryCount);
    expect(await credential(owner.id)).toEqual(original);
    expect(await credential(verified.id)).toEqual(verifiedBefore);
    expect(deliveries.filter((item) => item.to === verified.email)).toHaveLength(1);
    expect(deliveries.filter((item) => item.to === "r02-unknown@example.invalid")).toHaveLength(0);

    // Advance only this still-pending credential beyond the persisted 60-second cooldown.
    const aged = await pool.query(
      "UPDATE users SET email_verification_expiry=email_verification_expiry-interval '2 minutes' " +
      "WHERE id=$1 AND email_verification_token=$2 AND email_verified=false AND pending_email IS NULL " +
      "AND email_verification_expiry>now()+interval '2 minutes'",
      [owner.id, hash(owner.token)]
    );
    expect(aged.rowCount).toBe(1);
    const eligible = await request(app).post("/api/auth/resend-verification").send({ email: owner.email }).expect(200);
    expect(eligible.body).toEqual(pending.body);
    expect(deliveries.filter((item) => item.to === owner.email)).toHaveLength(initialDeliveryCount + 1);
    const replacement = emitted(owner.email);
    expect(replacement.url.pathname).toBe("/verify-email");
    expect(replacement.token).not.toBe(owner.token);
    expect((await credential(owner.id)).email_verification_token).toBe(hash(replacement.token));
    await consume(owner.token).expect(400);
    await consume(replacement.token).expect(200);
  });
});
