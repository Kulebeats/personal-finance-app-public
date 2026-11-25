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
import { userRepository } from "../../../repositories/UserRepository";
import { StorageUserModule } from "../../../storage/StorageUserModule";

const mail = vi.hoisted(() => ({
  resets: [] as string[],
  general: [] as string[],
  verification: new Map<string, string>(),
}));
vi.mock("../../../services/emailService", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../services/emailService")>();
  return {
    ...actual,
    isEmailServiceConfigured: vi.fn(() => true),
    sendEmail: vi.fn(async (message: { to: string }) => { mail.general.push(message.to); return true; }),
    sendPasswordResetEmail: vi.fn(async (email: string) => { mail.resets.push(email); return true; }),
    sendVerificationEmail: vi.fn(async (email: string, token: string) => {
      mail.verification.set(email, token);
      return true;
    }),
  };
});

const password = "SyntheticCasePassword123!";
// bcryptjs cost 12 is ~0.5s per hash or verify; every case registers or signs in.
const BCRYPT_HEAVY_TIMEOUT_MS = 120_000;
const createdIds: string[] = [];
let app: Awaited<ReturnType<typeof getTestApp>>;

interface Registered { id: string; email: string }

/** Registers through the API with a mixed-case address and returns the stored row. */
async function register(label: string, suppliedAddress?: string): Promise<Registered> {
  const tag = randomUUID().slice(0, 8);
  const email = suppliedAddress ?? `Case.${label}-${tag}@Example.test`;
  const username = `case_${label}_${tag}`;
  const response = await request(app).post("/api/auth/register").send({ email, username, password });
  const { rows: [row] } = await pool.query("SELECT id, email FROM users WHERE username = $1", [username]);
  if (row) createdIds.push(row.id);
  expect(response.status).toBe(201);
  expect(row).toBeDefined();
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
      await pool.query("DELETE FROM outbox_events WHERE payload->>'userId' = $1", [id]);
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

  it("lets only one of two simultaneous case-variant sign-ups through (users_email_lower_unique)", async () => {
    const tag = randomUUID().slice(0, 8);
    const email = `Case.race-${tag}@Example.invalid`;
    // Both requests pass the look-up before either inserts; the lower(email) index decides.
    const [upper, lower] = await Promise.all([email, email.toLowerCase()].map((address, index) =>
      request(app).post("/api/auth/register").send({ email: address, username: `case_race${index}_${tag}`, password })));
    const { rows } = await pool.query("SELECT id FROM users WHERE lower(email) = lower($1)", [email]);
    createdIds.push(...rows.map((row: { id: string }) => row.id));

    expect([upper.status, lower.status].sort()).toEqual([201, 409]);
    expect(rows).toHaveLength(1);
  });

  it("has the lower(email) unique index in the migrated schema", async () => {
    const { rows } = await pool.query(
      "SELECT indexdef FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'users' AND indexname = 'users_email_lower_unique'");
    expect(rows).toHaveLength(1);
    expect(rows[0].indexdef).toMatch(/UNIQUE INDEX .* \(lower\(\(email\)::text\)\)/);
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

  it("reports a late address claim at email confirmation as a conflict and rolls back", async () => {
    const mover = await register("lateclaim");
    const winner = await register("winner");
    const next = `New.${randomUUID()}@Example.test`;
    const claimed = next.toUpperCase();
    await pool.query("UPDATE users SET email_verified = true WHERE id = $1", [mover.id]);
    const signedIn = await request(app).post("/api/auth/login").send({ email: mover.email, password }).expect(200);
    const cookie = (signedIn.headers["set-cookie"] as unknown as string[]).join("; ");

    await request(app).post("/api/settings/security/email/change").set("Cookie", cookie)
      .send({ newEmail: next, password }).expect(200);
    const token = mail.verification.get(next);
    if (!token) throw new Error("The change request did not issue a verification link");

    const blocker = await pool.connect();
    let confirmation: Promise<request.Response> | undefined;
    let settled = false;
    let committed = false;
    try {
      await blocker.query("BEGIN");
      await blocker.query("SET LOCAL statement_timeout = '5s'");
      const { rows: [{ pid }] } = await blocker.query<{ pid: number }>("SELECT pg_backend_pid() AS pid");
      const claim = await blocker.query("UPDATE users SET email = $2 WHERE id = $1", [winner.id, claimed]);
      expect(claim.rowCount).toBe(1);

      confirmation = request(app).post("/api/settings/security/email/verify").send({ token })
        .timeout(10_000).then((response) => response).finally(() => { settled = true; });
      void confirmation.catch(() => undefined);

      // The two updates touch different user rows. The confirmation UPDATE
      // waits on the competing transaction when it reaches the shared index key.
      const lockWitness = {
        text: `SELECT EXISTS (
          SELECT 1 FROM pg_stat_activity
          WHERE datname = current_database() AND $1::integer = ANY(pg_blocking_pids(pid))
            AND wait_event_type = 'Lock' AND wait_event = 'transactionid'
            AND query ILIKE 'update "users" set %"email" = %'
        ) AS waiting`,
        values: [pid],
        query_timeout: 1_000,
      };
      let waiting = false;
      const deadline = Date.now() + 5_000;
      while (!waiting && !settled && Date.now() < deadline) {
        const { rows: [row] } = await pool.query<{ waiting: boolean }>(lockWitness);
        waiting = row.waiting;
        if (!waiting) await new Promise((resolve) => setTimeout(resolve, 25));
      }
      expect(waiting, "confirmation reached the unique email key while the claim was uncommitted").toBe(true);
      await blocker.query("COMMIT");
      committed = true;
    } finally {
      try {
        if (!committed) await blocker.query("ROLLBACK");
      } finally {
        blocker.release(true);
        if (confirmation) await Promise.allSettled([confirmation]);
      }
    }

    const verification = await confirmation;
    expect.soft(verification.status).toBe(409);
    expect.soft(verification.body?.success === false && verification.body.error?.code === "CONFLICT",
      "confirmation returns the conflict response envelope").toBe(true);
    const responseBody = (verification.text ?? "").toLowerCase();
    expect(responseBody.includes("users_email_lower_unique"), "conflict response hides the index name").toBe(false);
    expect([mover.email, next, token].some((value) => responseBody.includes(value.toLowerCase())),
      "conflict response hides addresses and the challenge").toBe(false);
    const { rows: [moverState] } = await pool.query(`
      SELECT email = $2 AS original_email, pending_email = $3 AS pending_address,
        email_verification_token IS NOT NULL AS has_challenge
      FROM users WHERE id = $1
    `, [mover.id, mover.email, next]);
    expect(moverState).toEqual({ original_email: true, pending_address: true, has_challenge: true });
    const { rows: owners } = await pool.query(`
      SELECT id, email = $1 AS exact_claim FROM users WHERE lower(email) = lower($1)
    `, [claimed]);
    expect(owners).toEqual([{ id: winner.id, exact_claim: true }]);
    const { rows: [events] } = await pool.query(`
      SELECT count(*)::int AS n FROM security_audit_logs WHERE user_id = $1 AND event_type = 'EMAIL_CHANGED'
    `, [mover.id]);
    expect(events.n).toBe(0);
  });

  it("trims a registration address before storing it and sending verification", async () => {
    const address = `Trimmed.${randomUUID()}@Example.test`;
    const member = await register("trim", `  ${address}  `);
    expect(member.email).toBe(address);
    expect(mail.general).toContain(address);
  });

  it("trims a new address at email change before storing, sending and confirming it", async () => {
    const mover = await register("trimchange");
    const next = `Trimmed.${randomUUID()}@Example.test`;
    await pool.query("UPDATE users SET email_verified = true WHERE id = $1", [mover.id]);
    const signedIn = await request(app).post("/api/auth/login").send({ email: mover.email, password }).expect(200);
    const cookie = (signedIn.headers["set-cookie"] as unknown as string[]).join("; ");

    await request(app).post("/api/settings/security/email/change").set("Cookie", cookie)
      .send({ newEmail: `  ${next}  `, password }).expect(200);
    const { rows: [pending] } = await pool.query("SELECT pending_email FROM users WHERE id = $1", [mover.id]);
    expect(pending.pending_email).toBe(next);
    const token = mail.verification.get(next);
    expect(token, "the verification link went to the trimmed address").toBeDefined();
    await request(app).post("/api/settings/security/email/verify").send({ token }).expect(200);
    const { rows: [updated] } = await pool.query("SELECT email, pending_email FROM users WHERE id = $1", [mover.id]);
    expect(updated).toEqual({ email: next, pending_email: null });
  });

  it("trims login and password recovery addresses without changing the registered recipient", async () => {
    const member = await register("trimlookup");
    await pool.query("UPDATE users SET email_verified = true WHERE id = $1", [member.id]);
    const supplied = `  ${member.email.toUpperCase()}  `;

    const login = await request(app).post("/api/auth/login").send({ email: supplied, password });
    expect.soft(login.status).toBe(200);
    const forgot = await request(app).post("/api/auth/forgot-password").send({ email: supplied });
    expect.soft(forgot.status).toBe(200);
    expect(mail.resets).toContain(member.email);
  });

  it("uses trimmed, case-insensitive addresses in both repository and storage lookups", async () => {
    const member = await register("lookup");
    const storage = new StorageUserModule();
    expect.soft((await storage.getUserByEmail(member.email.toLowerCase()))?.id).toBe(member.id);
    const supplied = `  ${member.email.toUpperCase()}  `;
    expect.soft((await userRepository.findByEmail(supplied))?.id).toBe(member.id);
    expect((await storage.getUserByEmail(supplied))?.id).toBe(member.id);
  });

  it("trims a resend lookup before mailing the original registered address", async () => {
    const member = await register("trimresend");
    await pool.query("UPDATE users SET email_verification_expiry = now() + interval '23 hours' WHERE id = $1", [member.id]);
    const before = mail.general.filter(to => to === member.email).length;
    const resend = await request(app).post("/api/auth/resend-verification")
      .send({ email: `  ${member.email.toLowerCase()}  ` });
    expect.soft(resend.status).toBe(200);
    expect(mail.general.filter(to => to === member.email)).toHaveLength(before + 1);
  });

  it("trims a legacy pending value when its valid email-change link is confirmed", async () => {
    const mover = await register("legacypending");
    const next = `Legacy.${randomUUID()}@Example.test`;
    await pool.query("UPDATE users SET email_verified = true WHERE id = $1", [mover.id]);
    const signedIn = await request(app).post("/api/auth/login").send({ email: mover.email, password }).expect(200);
    const cookie = (signedIn.headers["set-cookie"] as unknown as string[]).join("; ");

    await request(app).post("/api/settings/security/email/change").set("Cookie", cookie)
      .send({ newEmail: next, password }).expect(200);
    const token = mail.verification.get(next);
    expect(token).toBeDefined();
    await pool.query("UPDATE users SET pending_email = $2 WHERE id = $1", [mover.id, ` ${next} `]);

    const result = await request(app).post("/api/settings/security/email/verify").send({ token });
    expect.soft(result.status).toBe(200);
    const { rows: [updated] } = await pool.query("SELECT email, pending_email FROM users WHERE id = $1", [mover.id]);
    expect(updated).toEqual({ email: next, pending_email: null });
  });

  it.each(["repository", "storage"] as const)("trims both email fields on %s writes", async (writer) => {
    const id = randomUUID();
    const email = `Create.${id}@Example.test`;
    const updatedEmail = `Update.${id}@Example.test`;
    const pendingEmail = `Pending.${id}@Example.test`;
    const storage = new StorageUserModule();
    const create = writer === "repository" ? userRepository.create.bind(userRepository) : storage.createUser.bind(storage);
    const update = writer === "repository" ? userRepository.update.bind(userRepository) : storage.updateUser.bind(storage);

    const created = await create({ username: `case_write_${id}`, email: ` ${email} `, passwordHash: "synthetic-fixture" });
    createdIds.push(created.id);
    expect.soft(created.email).toBe(email);
    const updated = await update(created.id, { email: ` ${updatedEmail} `, pendingEmail: ` ${pendingEmail} ` });
    expect.soft(updated?.email).toBe(updatedEmail);
    expect(updated?.pendingEmail).toBe(pendingEmail);
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
