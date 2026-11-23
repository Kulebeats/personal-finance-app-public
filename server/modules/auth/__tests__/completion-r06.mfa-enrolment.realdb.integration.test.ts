/**
 * R06.1 — email-code MFA enrolment, disable and backup-code regeneration.
 *
 * Real HTTP (supertest against the mounted app) over real PostgreSQL. Email
 * egress is the only replaced boundary: the emailService module is mocked so
 * the one-time codes the server sends can be read from the "mailbox".
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import pg from "pg";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db, pool } from "../../../db";
import { users } from "@shared/schema";
import * as auth from "../../../auth";
import { getTestApp } from "../../../__tests__/fixtures";

const mailbox = vi.hoisted(() => [] as Array<{ email: string; code: string }>);
vi.mock("../../../services/emailService", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../services/emailService")>();
  return {
    ...actual,
    isEmailServiceConfigured: vi.fn(() => true),
    sendEmail: vi.fn(async () => true),
    sendMfaCodeEmail: vi.fn(async (email: string, code: string) => { mailbox.push({ email, code }); return true; }),
  };
});

const password = "SyntheticR06Password123!";
// hashPassword/verifyPassword are bcryptjs (pure JS) at cost 12: ~0.5s each on
// one core, serial even under Promise.all. The login and regeneration cases need
// ~35-45 of them, so under the parallel verify run the 15s default is too short.
const BCRYPT_HEAVY_TIMEOUT_MS = 120_000;
const base = "/api/settings/security/mfa";
const ids: string[] = [];
let app: Awaited<ReturnType<typeof getTestApp>>;

const cookieOf = (response: request.Response) => (response.headers["set-cookie"] as unknown as string[]).join("; ");
function lastCodeFor(email: string): string {
  const entry = [...mailbox].reverse().find((mail) => mail.email === email);
  if (!entry) throw new Error(`No code mailed to ${email}`);
  return entry.code;
}
async function stored(id: string) {
  const { rows: [row] } = await pool.query(
    "SELECT mfa_enabled, mfa_code, mfa_backup_codes, mfa_backup_codes_generated_at FROM users WHERE id = $1", [id]);
  return row as { mfa_enabled: boolean; mfa_code: string | null; mfa_backup_codes: string[] | null; mfa_backup_codes_generated_at: Date | null };
}
async function auditCount(id: string, eventType: string): Promise<number> {
  const { rows: [row] } = await pool.query(
    "SELECT count(*)::int AS n FROM security_audit_logs WHERE user_id = $1 AND event_type = $2", [id, eventType]);
  return row.n;
}
async function newUser() {
  const id = randomUUID(), email = `r06-mfa-${id}@example.invalid`;
  await db.insert(users).values({ id, email, username: `r06-${id}`, passwordHash: await auth.hashPassword(password), emailVerified: true });
  ids.push(id);
  const login = await request(app).post("/api/auth/login").send({ email, password }).expect(200);
  const cookie = cookieOf(login);
  // AH-11: enable and disable need a recent step-up; this suite tests what comes after it.
  await request(app).post("/api/settings/security/step-up").set("Cookie", cookie).send({ password }).expect(200);
  return { id, email, cookie };
}
async function enable(user: { email: string; cookie: string }): Promise<string[]> {
  await request(app).post(`${base}/enable`).set("Cookie", user.cookie).expect(200);
  const response = await request(app).post(`${base}/enable/confirm`).set("Cookie", user.cookie)
    .send({ code: lastCodeFor(user.email) }).expect(200);
  return response.body.data.backupCodes as string[];
}
/** A password login that stops at the MFA challenge; returns the pending cookie. */
async function pendingLogin(email: string): Promise<string> {
  const response = await request(app).post("/api/auth/login").send({ email, password }).expect(200);
  expect(response.body.data.requiresMfa).toBe(true);
  return cookieOf(response);
}
const verifyLogin = (cookie: string, code: string) =>
  request(app).post("/api/auth/mfa/verify").set("Cookie", cookie).send({ code });
/** Email a code for one specific action while MFA is on. */
async function managementCode(user: { email: string; cookie: string }, purpose: "disable" | "regenerate"): Promise<string> {
  await request(app).post(`${base}/code`).set("Cookie", user.cookie).send({ purpose }).expect(200);
  return lastCodeFor(user.email);
}

describe("R06.1 MFA enrolment, backup codes and disable (real HTTP, real PostgreSQL)", { timeout: BCRYPT_HEAVY_TIMEOUT_MS }, () => {
  beforeAll(async () => { app = await getTestApp(); }, 30000);
  afterAll(async () => {
    vi.restoreAllMocks();
    for (const id of ids) {
      await pool.query("DELETE FROM security_audit_logs WHERE user_id = $1", [id]);
      await pool.query('DELETE FROM "session" WHERE sess->>\'userId\' = $1 OR sess->>\'mfaPendingUserId\' = $1', [id]);
      await db.delete(users).where(eq(users.id, id));
    }
  });

  it("starting enrolment emails a code but leaves MFA off and issues no backup codes", async () => {
    const user = await newUser();
    const response = await request(app).post(`${base}/enable`).set("Cookie", user.cookie).expect(200);
    expect(response.body.data).not.toHaveProperty("backupCodes");
    expect(lastCodeFor(user.email)).toMatch(/^\d{6}$/);
    const row = await stored(user.id);
    expect(row.mfa_enabled).toBe(false);
    expect(row.mfa_backup_codes).toBeNull();
    await request(app).post(`${base}/enable/confirm`).set("Cookie", user.cookie).send({}).expect(400);
    expect((await stored(user.id)).mfa_enabled).toBe(false);
    expect(await auditCount(user.id, "MFA_ENABLED")).toBe(0);
  });

  it("a wrong or expired code is refused and changes nothing", async () => {
    const user = await newUser();
    await request(app).post(`${base}/enable`).set("Cookie", user.cookie).expect(200);
    const code = lastCodeFor(user.email), wrong = code === "000000" ? "111111" : "000000";
    const before = await stored(user.id);
    const hashing = vi.spyOn(auth, "hashPassword");
    let refused: request.Response;
    try { refused = await request(app).post(`${base}/enable/confirm`).set("Cookie", user.cookie).send({ code: wrong }); }
    finally { hashing.mockRestore(); }
    expect(refused.status).toBe(401);
    // A wrong code is refused before any backup code is generated or hashed.
    expect(hashing).not.toHaveBeenCalled();
    expect(refused.body.error.code).toBe("INVALID_CREDENTIALS");
    expect(await stored(user.id)).toEqual(before);
    await pool.query("UPDATE users SET mfa_code_expiry = now() - interval '1 second' WHERE id = $1", [user.id]);
    await request(app).post(`${base}/enable/confirm`).set("Cookie", user.cookie).send({ code }).expect(401);
    expect((await stored(user.id)).mfa_enabled).toBe(false);
    expect(await auditCount(user.id, "MFA_ENABLED")).toBe(0);
  });

  it("the right code enables MFA, returns hashed-at-rest codes once, and cannot be replayed", async () => {
    const user = await newUser();
    await request(app).post(`${base}/enable`).set("Cookie", user.cookie).expect(200);
    const code = lastCodeFor(user.email);
    const response = await request(app).post(`${base}/enable/confirm`).set("Cookie", user.cookie).send({ code }).expect(200);
    expect(response.headers["cache-control"]).toContain("no-store");
    const backupCodes = response.body.data.backupCodes as string[];
    expect(backupCodes).toHaveLength(8);
    const row = await stored(user.id);
    expect(row.mfa_enabled).toBe(true);
    expect(row.mfa_code).toBeNull();
    expect(row.mfa_backup_codes).toHaveLength(8);
    for (const plain of backupCodes) expect(row.mfa_backup_codes).not.toContain(plain);
    expect(await auditCount(user.id, "MFA_ENABLED")).toBe(1);

    const replay = await request(app).post(`${base}/enable/confirm`).set("Cookie", user.cookie).send({ code });
    expect(replay.status).toBe(401);
    expect(replay.body.data).toBeUndefined();
    expect((await stored(user.id)).mfa_backup_codes).toEqual(row.mfa_backup_codes);
    await request(app).get(`${base}/status`).set("Cookie", user.cookie).expect(200)
      .expect((status) => { expect(status.body.data).toMatchObject({ mfaEnabled: true, backupCodesRemaining: 8 }); });
    expect(await auditCount(user.id, "MFA_ENABLED")).toBe(1);
  });

  it("after enrolment login needs the emailed code, and a backup code works exactly once", async () => {
    const user = await newUser();
    const backupCodes = await enable(user);
    const pending = await pendingLogin(user.email);
    await request(app).get("/api/auth/me").set("Cookie", pending).expect(401);
    await verifyLogin(pending, lastCodeFor(user.email)).expect(200);

    const first = await pendingLogin(user.email);
    await verifyLogin(first, backupCodes[0]).expect(200);
    const second = await pendingLogin(user.email);
    await verifyLogin(second, backupCodes[0]).expect(401);
    expect((await stored(user.id)).mfa_backup_codes).toHaveLength(7);
  });

  it("regeneration needs a fresh code, invalidates every old backup code, and shows the new ones once", async () => {
    const user = await newUser();
    const oldCodes = await enable(user);
    await request(app).post(`${base}/backup-codes/regenerate`).set("Cookie", user.cookie).send({}).expect(400);
    await request(app).post(`${base}/backup-codes/regenerate`).set("Cookie", user.cookie).send({ code: "000000" }).expect(401);
    expect(await auditCount(user.id, "MFA_BACKUP_CODES_REGENERATED")).toBe(0);

    const code = await managementCode(user, "regenerate");
    const response = await request(app).post(`${base}/backup-codes/regenerate`).set("Cookie", user.cookie).send({ code }).expect(200);
    expect(response.headers["cache-control"]).toContain("no-store");
    const newCodes = response.body.data.backupCodes as string[];
    expect(newCodes).toHaveLength(8);
    expect(newCodes.some((value) => oldCodes.includes(value))).toBe(false);
    expect(await auditCount(user.id, "MFA_BACKUP_CODES_REGENERATED")).toBe(1);
    await request(app).post(`${base}/backup-codes/regenerate`).set("Cookie", user.cookie).send({ code }).expect(401);

    await verifyLogin(await pendingLogin(user.email), oldCodes[1]).expect(401);
    await verifyLogin(await pendingLogin(user.email), newCodes[0]).expect(200);
  });

  it("disable refuses the password alone and a wrong code, then succeeds with password plus code", async () => {
    const user = await newUser();
    await enable(user);
    await request(app).post(`${base}/disable`).set("Cookie", user.cookie).send({ password }).expect(400);
    const code = await managementCode(user, "disable");
    const wrongPassword = await request(app).post(`${base}/disable`).set("Cookie", user.cookie).send({ password: "NotThePassword1!", code });
    expect(wrongPassword.status).toBe(401);
    await request(app).post(`${base}/disable`).set("Cookie", user.cookie).send({ password, code: code === "000000" ? "111111" : "000000" }).expect(401);
    expect((await stored(user.id)).mfa_enabled).toBe(true);
    expect(await auditCount(user.id, "MFA_DISABLED")).toBe(0);

    await request(app).post(`${base}/disable`).set("Cookie", user.cookie).send({ password, code }).expect(200);
    const row = await stored(user.id);
    expect(row).toMatchObject({ mfa_enabled: false, mfa_code: null, mfa_backup_codes: null, mfa_backup_codes_generated_at: null });
    expect(await auditCount(user.id, "MFA_DISABLED")).toBe(1);
    const login = await request(app).post("/api/auth/login").send({ email: user.email, password }).expect(200);
    expect(login.body.data.requiresMfa).toBeFalsy();
  });

  it("an audit insert failure rolls the enrolment back and the same code then succeeds", async () => {
    const user = await newUser();
    await request(app).post(`${base}/enable`).set("Cookie", user.cookie).expect(200);
    const code = lastCodeFor(user.email), original = pg.Client.prototype.query;
    const fail = vi.spyOn(pg.Client.prototype, "query").mockImplementation(function (this: pg.Client, ...args: Parameters<typeof original>) {
      const result: unknown = Reflect.apply(original, this, args);
      const [query, values] = args as unknown as [unknown, unknown];
      const text = typeof query === "object" && query !== null && "text" in query ? query.text : query;
      if (typeof text === "string" && /insert into "security_audit_logs"/i.test(text) && Array.isArray(values) && values.includes("MFA_ENABLED")) {
        return Promise.resolve(result).then(() => { throw new Error("Synthetic audit failure"); }) as unknown as ReturnType<typeof original>;
      }
      return result as ReturnType<typeof original>;
    });
    try { expect((await request(app).post(`${base}/enable/confirm`).set("Cookie", user.cookie).send({ code })).status).toBe(500); }
    finally { fail.mockRestore(); }
    const row = await stored(user.id);
    expect(row.mfa_enabled).toBe(false);
    expect(row.mfa_backup_codes).toBeNull();
    await request(app).post(`${base}/enable/confirm`).set("Cookie", user.cookie).send({ code }).expect(200);
    expect(await auditCount(user.id, "MFA_ENABLED")).toBe(1);
  });

  it("starting enrolment while MFA is on, or asking for a management code while it is off, is a 409", async () => {
    const user = await newUser();
    await request(app).post(`${base}/code`).set("Cookie", user.cookie).send({ purpose: "disable" }).expect(409);
    await enable(user);
    await request(app).post(`${base}/enable`).set("Cookie", user.cookie).expect(409);
  });

  // Astra P1 on fb98f09e0: settings and login codes share users.mfa_code, so
  // each must be bound to its purpose (and a settings code to its session).
  it("a live login code cannot regenerate backup codes or disable MFA, and nothing changes", async () => {
    const user = await newUser();
    await enable(user);
    const pending = await pendingLogin(user.email);
    const loginCode = lastCodeFor(user.email);
    const before = await stored(user.id);
    await request(app).post(`${base}/backup-codes/regenerate`).set("Cookie", user.cookie).send({ code: loginCode }).expect(401);
    await request(app).post(`${base}/disable`).set("Cookie", user.cookie).send({ password, code: loginCode }).expect(401);
    expect(await stored(user.id)).toEqual(before);
    expect(await auditCount(user.id, "MFA_BACKUP_CODES_REGENERATED")).toBe(0);
    expect(await auditCount(user.id, "MFA_DISABLED")).toBe(0);
    // The code was genuinely live: it still completes the login it was issued for.
    await verifyLogin(pending, loginCode).expect(200);
  });

  it("a settings code requested in one session is refused in another session of the same user", async () => {
    const user = await newUser();
    const login = await request(app).post("/api/auth/login").send({ email: user.email, password }).expect(200);
    const otherSession = cookieOf(login);
    await request(app).post(`${base}/enable`).set("Cookie", user.cookie).expect(200);
    const code = lastCodeFor(user.email);
    await request(app).post(`${base}/enable/confirm`).set("Cookie", otherSession).send({ code }).expect(401);
    expect((await stored(user.id)).mfa_enabled).toBe(false);
    await request(app).post(`${base}/enable/confirm`).set("Cookie", user.cookie).send({ code }).expect(200);
  });

  // Astra round 2 on 64c19be36: settings codes were interchangeable between actions.
  it("a code issued for one action is refused by the other two, and still works for its own", async () => {
    const enrolling = await newUser();
    await request(app).post(`${base}/enable`).set("Cookie", enrolling.cookie).expect(200);
    const enrolCode = lastCodeFor(enrolling.email);
    await request(app).post(`${base}/backup-codes/regenerate`).set("Cookie", enrolling.cookie).send({ code: enrolCode }).expect(401);
    await request(app).post(`${base}/disable`).set("Cookie", enrolling.cookie).send({ password, code: enrolCode }).expect(401);
    await request(app).post(`${base}/enable/confirm`).set("Cookie", enrolling.cookie).send({ code: enrolCode }).expect(200);

    const user = await newUser();
    await enable(user);
    const regenerateCode = await managementCode(user, "regenerate");
    const before = await stored(user.id);
    await request(app).post(`${base}/disable`).set("Cookie", user.cookie).send({ password, code: regenerateCode }).expect(401);
    await request(app).post(`${base}/enable/confirm`).set("Cookie", user.cookie).send({ code: regenerateCode }).expect(401);
    expect(await stored(user.id)).toEqual(before);
    await request(app).post(`${base}/backup-codes/regenerate`).set("Cookie", user.cookie).send({ code: regenerateCode }).expect(200);

    const disableCode = await managementCode(user, "disable");
    const afterRegenerate = await stored(user.id);
    await request(app).post(`${base}/backup-codes/regenerate`).set("Cookie", user.cookie).send({ code: disableCode }).expect(401);
    await request(app).post(`${base}/enable/confirm`).set("Cookie", user.cookie).send({ code: disableCode }).expect(401);
    expect(await stored(user.id)).toEqual(afterRegenerate);
    expect(await auditCount(user.id, "MFA_BACKUP_CODES_REGENERATED")).toBe(1);
    await request(app).post(`${base}/disable`).set("Cookie", user.cookie).send({ password, code: disableCode }).expect(200);
    expect(await auditCount(user.id, "MFA_DISABLED")).toBe(1);
  });

  it("a settings code is refused at the login MFA step", async () => {
    const user = await newUser();
    await enable(user);
    const pending = await pendingLogin(user.email);
    const settingsCode = await managementCode(user, "regenerate");
    await verifyLogin(pending, settingsCode).expect(401);
    await request(app).get("/api/auth/me").set("Cookie", pending).expect(401);
  });
});
