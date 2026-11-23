/**
 * One e-mail address is one identity, whatever its case. `users.email` was
 * unique byte for byte and every lookup matched exactly, so "Ana@x" and "ana@x"
 * could be two accounts, and a member who typed a different case than they
 * registered with could not sign in, reset their password or get a new
 * verification link.
 *
 * Real HTTP (supertest against the mounted app) over real PostgreSQL. E-mail
 * egress is the only replaced boundary, so the recipients can be read.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { pool } from "../../../db";
import { getTestApp } from "../../../__tests__/fixtures";

const mail = vi.hoisted(() => ({ resets: [] as string[], general: [] as string[] }));
vi.mock("../../../services/emailService", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../services/emailService")>();
  return {
    ...actual,
    isEmailServiceConfigured: vi.fn(() => true),
    sendEmail: vi.fn(async (message: { to: string }) => { mail.general.push(message.to); return true; }),
    sendPasswordResetEmail: vi.fn(async (email: string) => { mail.resets.push(email); return true; }),
  };
});

const password = "SyntheticCasePassword123!";
// bcryptjs cost 12 is ~0.5s per hash or verify; every case registers or signs in.
const BCRYPT_HEAVY_TIMEOUT_MS = 120_000;
const createdIds: string[] = [];
let app: Awaited<ReturnType<typeof getTestApp>>;

interface Registered { id: string; email: string }

/** Registers through the API with a mixed-case address and returns the stored row. */
async function register(label: string): Promise<Registered> {
  const tag = randomUUID().slice(0, 8);
  const email = `Case.${label}-${tag}@Example.invalid`;
  await request(app).post("/api/auth/register").send({ email, username: `case_${label}_${tag}`, password }).expect(201);
  const { rows: [row] } = await pool.query("SELECT id, email FROM users WHERE lower(email) = lower($1)", [email]);
  createdIds.push(row.id);
  return { id: row.id, email: row.email };
}
async function accountsFor(email: string): Promise<number> {
  const { rows: [row] } = await pool.query("SELECT count(*)::int AS n FROM users WHERE lower(email) = lower($1)", [email]);
  return row.n;
}

describe("e-mail addresses are case-insensitive (real HTTP, real PostgreSQL)", { timeout: BCRYPT_HEAVY_TIMEOUT_MS }, () => {
  beforeAll(async () => { app = await getTestApp(); }, 30000);
  afterAll(async () => {
    vi.restoreAllMocks();
    for (const id of createdIds) {
      await pool.query("DELETE FROM audit_logs WHERE user_id = $1", [id]);
      await pool.query("DELETE FROM security_audit_logs WHERE user_id = $1", [id]);
      await pool.query("DELETE FROM password_reset_tokens WHERE user_id = $1", [id]);
      await pool.query('DELETE FROM "session" WHERE sess->>\'userId\' = $1 OR sess->>\'mfaPendingUserId\' = $1', [id]);
      await pool.query("DELETE FROM users WHERE id = $1", [id]);
    }
  });

  it("refuses a second account whose address differs only in case", async () => {
    const first = await register("dup");

    const second = await request(app).post("/api/auth/register")
      .send({ email: first.email.toLowerCase(), username: `case_dup2_${first.id.slice(0, 8)}`, password });

    expect(second.status).toBe(409);
    expect(await accountsFor(first.email)).toBe(1);
  });

  it("signs a member in whatever case they type", async () => {
    const member = await register("login");
    await pool.query("UPDATE users SET email_verified = true WHERE id = $1", [member.id]);

    await request(app).post("/api/auth/login").send({ email: member.email.toUpperCase(), password }).expect(200);
    await request(app).post("/api/auth/login").send({ email: member.email.toLowerCase(), password }).expect(200);
  });

  it("sends the reset link to the registered address whatever case is typed", async () => {
    const member = await register("reset");
    await pool.query("UPDATE users SET email_verified = true WHERE id = $1", [member.id]);

    await request(app).post("/api/auth/forgot-password").send({ email: member.email.toUpperCase() }).expect(200);

    expect(mail.resets).toContain(member.email);
    const { rows: [tokens] } = await pool.query(
      "SELECT count(*)::int AS n FROM password_reset_tokens WHERE user_id = $1 AND used_at IS NULL", [member.id]);
    expect(tokens.n).toBe(1);
  });

  it("refuses an e-mail change to another member's address in a different case", async () => {
    const taken = await register("taken");
    const mover = await register("mover");
    await pool.query("UPDATE users SET email_verified = true WHERE id = $1", [mover.id]);
    const signedIn = await request(app).post("/api/auth/login").send({ email: mover.email, password }).expect(200);
    const cookie = (signedIn.headers["set-cookie"] as unknown as string[]).join("; ");

    const change = await request(app).post("/api/settings/security/email/change").set("Cookie", cookie)
      .send({ newEmail: taken.email.toUpperCase(), password });

    expect(change.status).toBe(400);
    const { rows: [row] } = await pool.query("SELECT pending_email FROM users WHERE id = $1", [mover.id]);
    expect(row.pending_email).toBeNull();
  });

  it("sends a new verification link to the registered address whatever case is typed", async () => {
    const member = await register("resend");
    // Past the one-minute resend cooldown: the first link was issued an hour ago.
    await pool.query("UPDATE users SET email_verification_expiry = now() + interval '23 hours' WHERE id = $1", [member.id]);
    const before = mail.general.filter((to) => to === member.email).length;

    await request(app).post("/api/auth/resend-verification").send({ email: member.email.toLowerCase() }).expect(200);

    expect(mail.general.filter((to) => to === member.email).length).toBe(before + 1);
  });
});
