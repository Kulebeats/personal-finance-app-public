/**
 * AH-11 — mandatory MFA with a 14-day grace (owner ruling, 23 Nov 2026).
 *
 * Every member must use MFA. `users.mfa_grace_ends_at` defaults to 14 days after
 * the row is written (existing rows: 14 days after the migration ran). Inside the
 * grace a member without MFA works normally and is told the deadline; after it,
 * the password sign-in still succeeds but every data route answers 403
 * MFA_ENROLMENT_REQUIRED until enrolment is confirmed. The gate is read on every
 * request, so a session that began in the grace is stopped when the grace ends.
 *
 * Real HTTP (supertest against the mounted app) over real PostgreSQL. Email
 * egress is the only replaced boundary, so the mailed one-time codes can be read.
 * The grace column is moved with raw SQL so the test does not depend on the
 * Drizzle schema field.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { db, pool } from "../../../db";
import { householdMembers, households, users } from "@shared/schema";
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
// bcryptjs cost 12 is ~0.5s per hash or verify; each case signs in and steps up.
const BCRYPT_HEAVY_TIMEOUT_MS = 120_000;
const DAY_MS = 86_400_000;
const mfa = "/api/settings/security/mfa";
const created: Array<{ userId: string; householdId: string }> = [];
let app: Awaited<ReturnType<typeof getTestApp>>;

interface Member { userId: string; householdId: string; email: string; cookie: string }

const cookieOf = (response: request.Response) => (response.headers["set-cookie"] as unknown as string[]).join("; ");
function lastCodeFor(email: string): string {
  const entry = [...mailbox].reverse().find((mail) => mail.email === email);
  if (!entry) throw new Error(`No code mailed to ${email}`);
  return entry.code;
}
const signed = (member: Member, call: request.Test) => call.set("Cookie", member.cookie)
  .set("X-Capital-Subject", member.userId).set("X-Capital-Household", member.householdId);
const get = (member: Member, path: string) => signed(member, request(app).get(path));
const post = (member: Member, path: string, body: object = {}) => signed(member, request(app).post(path)).send(body);

async function setGrace(userId: string, sqlInterval: string) {
  await pool.query(`UPDATE users SET mfa_grace_ends_at = now() + interval '${sqlInterval}' WHERE id = $1`, [userId]);
}
async function mfaEnabled(userId: string): Promise<boolean> {
  const { rows: [row] } = await pool.query("SELECT mfa_enabled FROM users WHERE id = $1", [userId]);
  return row.mfa_enabled === true;
}
async function login(email: string) {
  return request(app).post("/api/auth/login").send({ email, password }).expect(200);
}
/** A verified owner of a fresh household, signed in; `grace` moves the deadline first. */
async function newMember(grace?: string): Promise<Member & { loginBody: Record<string, unknown> }> {
  const userId = randomUUID(), householdId = randomUUID(), email = `ah11-mfa-${userId}@example.invalid`;
  await db.insert(households).values({ id: householdId, name: "Synthetic AH-11", currency: "USD" });
  await db.insert(users).values({ id: userId, email, username: `ah11-${userId}`,
    passwordHash: await auth.hashPassword(password), emailVerified: true });
  await db.insert(householdMembers).values({ householdId, userId, role: "owner" });
  created.push({ userId, householdId });
  if (grace) await setGrace(userId, grace);
  const response = await login(email);
  return { userId, householdId, email, cookie: cookieOf(response), loginBody: response.body.data };
}
async function enrol(member: Member) {
  await post(member, "/api/settings/security/step-up", { password }).expect(200);
  await post(member, `${mfa}/enable`).expect(200);
  await post(member, `${mfa}/enable/confirm`, { code: lastCodeFor(member.email) }).expect(200);
}
function expectEnrolmentRequired(response: request.Response) {
  expect(response.status).toBe(403);
  expect(response.body).toMatchObject({ success: false, error: { code: "MFA_ENROLMENT_REQUIRED" } });
  expect(Number.isNaN(Date.parse(response.body.error.details.graceEndedAt))).toBe(false);
}

describe("AH-11 mandatory MFA after a 14-day grace (real HTTP, real PostgreSQL)", { timeout: BCRYPT_HEAVY_TIMEOUT_MS }, () => {
  beforeAll(async () => { app = await getTestApp(); }, 30000);
  afterAll(async () => {
    vi.restoreAllMocks();
    for (const { userId, householdId } of created) {
      await pool.query("DELETE FROM audit_logs WHERE user_id = $1 OR household_id = $2", [userId, householdId]);
      await pool.query("DELETE FROM security_audit_logs WHERE user_id = $1", [userId]);
      await pool.query('DELETE FROM "session" WHERE sess->>\'userId\' = $1 OR sess->>\'mfaPendingUserId\' = $1', [userId]);
      await pool.query("DELETE FROM household_members WHERE household_id = $1", [householdId]);
      await pool.query("DELETE FROM households WHERE id = $1", [householdId]);
      await pool.query("DELETE FROM users WHERE id = $1", [userId]);
    }
  });

  it("a new account's grace ends 14 days after it was created", async () => {
    const member = await newMember();
    const { rows: [row] } = await pool.query(
      "SELECT extract(epoch FROM mfa_grace_ends_at - created_at) AS seconds FROM users WHERE id = $1", [member.userId]);
    expect(Math.abs(Number(row.seconds) - 14 * 86_400)).toBeLessThan(60);
    const { rows: [column] } = await pool.query(
      "SELECT is_nullable FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'mfa_grace_ends_at'");
    expect(column.is_nullable).toBe("NO");
  });

  it("inside the grace a member without MFA works and is told the deadline", async () => {
    const member = await newMember();
    expect(member.loginBody).toMatchObject({ mfa: { state: "grace" } });
    expect(member.loginBody).not.toHaveProperty("suggestMfa");
    await get(member, "/api/accounts").expect(200);
    const status = await get(member, "/api/auth/session").expect(200);
    expect(status.body.data).toMatchObject({ state: "ready", mfa: { state: "grace", daysRemaining: 14 } });
    const graceEndsAt = Date.parse(status.body.data.mfa.graceEndsAt);
    expect(Math.abs(graceEndsAt - Date.now() - 14 * DAY_MS)).toBeLessThan(60_000);
    const policy = await get(member, `${mfa}/status`).expect(200);
    expect(policy.body.data.policy).toMatchObject({ required: true, state: "grace", daysRemaining: 14 });
  });

  it("after the grace sign-in succeeds but data routes answer 403 until enrolment", async () => {
    const member = await newMember("-1 minute");
    expect(member.loginBody).toMatchObject({ mfa: { state: "enrolment_required" } });
    expectEnrolmentRequired(await get(member, "/api/accounts"));
    expectEnrolmentRequired(await get(member, "/api/household/members"));
    expectEnrolmentRequired(await get(member, "/api/settings/security/sessions"));
    const status = await get(member, "/api/auth/session").expect(200);
    expect(status.body.data).toMatchObject({ state: "mfa_enrolment_required", subject: { id: member.userId } });
    const policy = await get(member, `${mfa}/status`).expect(200);
    expect(policy.body.data.policy).toMatchObject({ required: true, state: "enrolment_required", daysRemaining: 0 });
    // Not session-gated: the CSRF token and route health still answer for this cookie.
    await get(member, "/api/csrf-token").expect(200);
    await get(member, "/api/health/routes").expect(200);
  });

  it("after the grace only the exact enrolment routes skip the gate, not their sub-paths", async () => {
    const member = await newMember("-1 minute");
    const security = "/api/settings/security";
    expectEnrolmentRequired(await get(member, security));
    expectEnrolmentRequired(await post(member, `${mfa}/code`, { purpose: "disable" }));
    expectEnrolmentRequired(await post(member, `${security}/email/change`, {}));
    expectEnrolmentRequired(await signed(member, request(app).put(`${security}/password`)).send({}));
    // Paths under an allowed route are not themselves allowed.
    expectEnrolmentRequired(await post(member, `${mfa}/enable/x`));
    expectEnrolmentRequired(await get(member, `${mfa}/enable/x`));
    expectEnrolmentRequired(await get(member, `${mfa}/status/x`));
    expectEnrolmentRequired(await post(member, `${security}/step-up/x`, { password }));
    expectEnrolmentRequired(await post(member, `${mfa}/step-up`, { password }));
  });

  it("enrolling after the grace restores access in the same session", async () => {
    const member = await newMember("-1 minute");
    await enrol(member);
    expect(await mfaEnabled(member.userId)).toBe(true);
    await get(member, "/api/accounts").expect(200);
    const status = await get(member, "/api/auth/session").expect(200);
    expect(status.body.data.state).toBe("ready");
    expect(status.body.data).not.toHaveProperty("mfa");
  });

  it("a session that began in the grace is stopped once the grace ends", async () => {
    const member = await newMember();
    await get(member, "/api/accounts").expect(200);
    await setGrace(member.userId, "-1 second");
    expectEnrolmentRequired(await get(member, "/api/accounts"));
  });

  it("a member who already uses MFA is unaffected after the grace", async () => {
    const member = await newMember();
    await enrol(member);
    await setGrace(member.userId, "-1 day");
    const pending = await login(member.email);
    expect(pending.body.data.requiresMfa).toBe(true);
    const verified = await request(app).post("/api/auth/mfa/verify").set("Cookie", cookieOf(pending))
      .send({ code: lastCodeFor(member.email) }).expect(200);
    // The verified sign-in is a new (regenerated) session.
    await get({ ...member, cookie: cookieOf(verified) }, "/api/accounts").expect(200);
  });

  it("after the grace MFA cannot be turned off (409) and stays on", async () => {
    const member = await newMember();
    await enrol(member);
    await setGrace(member.userId, "-1 day");
    await post(member, "/api/settings/security/step-up", { password }).expect(200);
    await post(member, `${mfa}/code`, { purpose: "disable" }).expect(200);
    const refused = await post(member, `${mfa}/disable`, { password, code: lastCodeFor(member.email) });
    expect(refused.status).toBe(409);
    expect(refused.body.error.code).toBe("MFA_REQUIRED");
    expect(await mfaEnabled(member.userId)).toBe(true);
  });

  it("an unverified member past the grace is asked to verify email first", async () => {
    const member = await newMember();
    await pool.query("UPDATE users SET email_verified = false, mfa_grace_ends_at = now() - interval '1 day' WHERE id = $1",
      [member.userId]);
    const refused = await get(member, "/api/accounts");
    expect(refused.status).toBe(403);
    expect(refused.body.error.code).toBe("EMAIL_VERIFICATION_REQUIRED");
    const status = await get(member, "/api/auth/session").expect(200);
    expect(status.body.data.state).toBe("verification_pending");
  });
});
