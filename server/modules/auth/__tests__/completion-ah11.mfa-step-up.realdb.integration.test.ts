/**
 * AH-11: turning two-step verification on or off needs a recent step-up
 * (sudo mode), like the other sensitive security routes.
 *
 * Real HTTP (supertest against the mounted app) over real PostgreSQL. Email
 * egress is the only replaced boundary, so the one-time codes can be read.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
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

const password = "SyntheticAh11Password123!";
// bcryptjs cost 12 is ~0.5s per hash or verify; each case does several.
const BCRYPT_HEAVY_TIMEOUT_MS = 120_000;
const base = "/api/settings/security/mfa";
const ids: string[] = [];
let app: Awaited<ReturnType<typeof getTestApp>>;

const cookieOf = (response: request.Response) => (response.headers["set-cookie"] as unknown as string[]).join("; ");
const mailedTo = (email: string) => mailbox.filter((mail) => mail.email === email);
function lastCodeFor(email: string): string {
  const entry = mailedTo(email).at(-1);
  if (!entry) throw new Error(`No code mailed to ${email}`);
  return entry.code;
}
async function stored(id: string) {
  const { rows: [row] } = await pool.query(
    "SELECT mfa_enabled, mfa_code, mfa_code_expiry, mfa_backup_codes FROM users WHERE id = $1", [id]);
  return row as { mfa_enabled: boolean; mfa_code: string | null; mfa_code_expiry: Date | null; mfa_backup_codes: string[] | null };
}
async function newUser() {
  const id = randomUUID(), email = `ah11-mfa-${id}@example.invalid`;
  await db.insert(users).values({ id, email, username: `ah11-${id}`, passwordHash: await auth.hashPassword(password), emailVerified: true });
  ids.push(id);
  const login = await request(app).post("/api/auth/login").send({ email, password }).expect(200);
  return { id, email, cookie: cookieOf(login) };
}
const stepUp = (cookie: string) =>
  request(app).post("/api/settings/security/step-up").set("Cookie", cookie).send({ password }).expect(200);
/** A new signed-in session (password + login code) for an MFA user, not stepped up. */
async function mfaSession(email: string): Promise<string> {
  const pending = await request(app).post("/api/auth/login").send({ email, password }).expect(200);
  expect(pending.body.data.requiresMfa).toBe(true);
  const verified = await request(app).post("/api/auth/mfa/verify").set("Cookie", cookieOf(pending))
    .send({ code: lastCodeFor(email) }).expect(200);
  return verified.headers["set-cookie"] ? cookieOf(verified) : cookieOf(pending);
}
const expectStepUpChallenge =(response: request.Response) => {
  expect(response.status).toBe(401);
  expect(response.body).toMatchObject({ requiresStepUp: true, error: { code: "STEP_UP_REQUIRED" } });
};

describe("AH-11 MFA enable/disable need a recent step-up (real HTTP, real PostgreSQL)", { timeout: BCRYPT_HEAVY_TIMEOUT_MS }, () => {
  beforeAll(async () => { app = await getTestApp(); }, 30000);
  afterAll(async () => {
    vi.restoreAllMocks();
    for (const id of ids) {
      await pool.query("DELETE FROM security_audit_logs WHERE user_id = $1", [id]);
      await pool.query('DELETE FROM "session" WHERE sess->>\'userId\' = $1 OR sess->>\'mfaPendingUserId\' = $1', [id]);
      await db.delete(users).where(eq(users.id, id));
    }
  });

  it("enable without a fresh step-up is challenged, emails nothing and changes nothing; after step-up it works", async () => {
    const user = await newUser();
    const before = await stored(user.id);

    expectStepUpChallenge(await request(app).post(`${base}/enable`).set("Cookie", user.cookie));
    expect(mailedTo(user.email)).toHaveLength(0);
    expect(await stored(user.id)).toEqual(before);

    await stepUp(user.cookie);
    await request(app).post(`${base}/enable`).set("Cookie", user.cookie).expect(200);
    await request(app).post(`${base}/enable/confirm`).set("Cookie", user.cookie)
      .send({ code: lastCodeFor(user.email) }).expect(200);
    expect((await stored(user.id)).mfa_enabled).toBe(true);
  });

  it("disable without a fresh step-up is challenged and MFA stays on; after step-up the same password and code work", async () => {
    const user = await newUser();
    await stepUp(user.cookie);
    await request(app).post(`${base}/enable`).set("Cookie", user.cookie).expect(200);
    await request(app).post(`${base}/enable/confirm`).set("Cookie", user.cookie)
      .send({ code: lastCodeFor(user.email) }).expect(200);

    const session = await mfaSession(user.email);

    await request(app).post(`${base}/code`).set("Cookie", session).send({ purpose: "disable" }).expect(200);
    const code = lastCodeFor(user.email);
    const before = await stored(user.id);

    expectStepUpChallenge(await request(app).post(`${base}/disable`).set("Cookie", session).send({ password, code }));
    expect(await stored(user.id)).toEqual(before);
    expect(before.mfa_enabled).toBe(true);

    await stepUp(session);
    await request(app).post(`${base}/disable`).set("Cookie", session).send({ password, code }).expect(200);
    expect((await stored(user.id)).mfa_enabled).toBe(false);
  });

  it("regenerating backup codes without a fresh step-up is challenged and keeps the old codes; after step-up it works", async () => {
    const user = await newUser();
    await stepUp(user.cookie);
    await request(app).post(`${base}/enable`).set("Cookie", user.cookie).expect(200);
    await request(app).post(`${base}/enable/confirm`).set("Cookie", user.cookie)
      .send({ code: lastCodeFor(user.email) }).expect(200);
    const session = await mfaSession(user.email);

    await request(app).post(`${base}/code`).set("Cookie", session).send({ purpose: "regenerate" }).expect(200);
    const code = lastCodeFor(user.email);
    const before = await stored(user.id);

    expectStepUpChallenge(await request(app).post(`${base}/backup-codes/regenerate`).set("Cookie", session).send({ code }));
    expect(await stored(user.id)).toEqual(before);

    await stepUp(session);
    const response = await request(app).post(`${base}/backup-codes/regenerate`).set("Cookie", session).send({ code }).expect(200);
    expect(response.body.data.backupCodes).toHaveLength(8);
    expect((await stored(user.id)).mfa_backup_codes).not.toEqual(before.mfa_backup_codes);
  });
});
