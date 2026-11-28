/**
 * NEW-38 / R01: erasure ends every live session of the erased user, not only
 * the one that asked for it, on each of the three erasure paths: a member of a
 * shared household, the sole owner (household deleted with them), and a user
 * with no household. The user signs in twice (two cookies, two devices),
 * erases from one of them over real HTTP, and afterwards neither cookie
 * authenticates, no row of the connect-pg-simple `session` table (user id at
 * sess->>'userId') names them, and no `user_sessions` tracking row is left.
 * A co-member's session keeps working. Real HTTP against real Postgres.
 *
 * The store refuses an erased user's payload on read, so the 401s alone would
 * pass even if revocation left rows behind; the row counts are what prove
 * revokeUserSessions deleted them.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { db, pool } from "../../../db";
import { auditLogs, householdMembers, households, securityAuditLogs, users } from "@shared/schema";
import { hashPassword } from "../../../auth";
import { getTestApp } from "../../../__tests__/fixtures";

const password = "SyntheticErasureSessions123!";
let app: Awaited<ReturnType<typeof getTestApp>>;
type Actor = { id: string; email: string; cookie: string };
type Shape = "member of a shared household" | "sole owner" | "household-free user";
const SHAPES: readonly Shape[] = ["member of a shared household", "sole owner", "household-free user"];

async function login(email: string): Promise<string> {
  const res = await request(app).post("/api/auth/login").send({ email, password }).expect(200);
  return (res.headers["set-cookie"] as unknown as string[]).join("; ");
}

/** Rows of the session store that belong to this user, signed in or half-way through MFA. */
async function sessionRows(userId: string): Promise<number> {
  const { rows } = await pool.query<{ n: number }>(
    "SELECT count(*)::int AS n FROM \"session\" WHERE sess->>'userId' = $1 OR sess->>'mfaPendingUserId' = $1", [userId]);
  return rows[0].n;
}

/** The "active devices" tracking rows for this user. */
async function trackingRows(userId: string): Promise<number> {
  const { rows } = await pool.query<{ n: number }>("SELECT count(*)::int AS n FROM user_sessions WHERE user_id = $1", [userId]);
  return rows[0].n;
}

describe.each(SHAPES)("NEW-38 erasure ends every session of the erased %s", (shape) => {
  const householdId = randomUUID();
  const ids: string[] = [];
  let subject: Actor;
  let coMember: Actor | undefined;
  let subjectSecondCookie: string;
  let before: { subject: number; subjectTracking: number; coMember: number };
  let deleteStatus: number;

  async function fixture(role: "owner" | "member" | null): Promise<Actor> {
    const id = randomUUID();
    const email = `erasure-sessions-${id}@example.test`;
    await db.insert(users).values({
      id, email, username: `erasure-sessions-${id}`, passwordHash: await hashPassword(password), emailVerified: true,
    });
    ids.push(id);
    if (role) await db.insert(householdMembers).values({ userId: id, householdId, role });
    return { id, email, cookie: await login(email) };
  }

  beforeAll(async () => {
    app = await getTestApp();
    if (shape !== "household-free user") {
      await db.insert(households).values({ id: householdId, name: "Synthetic erasure sessions", currency: "ZMW" });
    }
    if (shape === "member of a shared household") coMember = await fixture("owner");
    subject = await fixture(shape === "member of a shared household" ? "member" : shape === "sole owner" ? "owner" : null);
    // A second, separate sign-in: another device holding its own cookie.
    subjectSecondCookie = await login(subject.email);
    before = {
      subject: await sessionRows(subject.id),
      subjectTracking: await trackingRows(subject.id),
      coMember: coMember ? await sessionRows(coMember.id) : 0,
    };

    await request(app).post("/api/settings/security/step-up").set("Cookie", subject.cookie).send({ password }).expect(200);
    const res = await request(app).post("/api/settings/account/delete").set("Cookie", subject.cookie).send({ password });
    deleteStatus = res.status;
  }, 90000);

  afterAll(async () => {
    for (const id of ids) await pool.query("DELETE FROM \"session\" WHERE sess->>'userId' = $1", [id]);
    await db.delete(securityAuditLogs).where(inArray(securityAuditLogs.userId, ids));
    await db.delete(auditLogs).where(inArray(auditLogs.userId, ids));
    await db.delete(auditLogs).where(eq(auditLogs.householdId, householdId));
    await db.delete(householdMembers).where(eq(householdMembers.householdId, householdId));
    await db.delete(households).where(eq(households.id, householdId));
    for (const id of ids) await db.delete(users).where(eq(users.id, id));
  });

  it("starts from two distinct live sessions and two tracking rows for the subject", () => {
    expect(subjectSecondCookie).not.toBe(subject.cookie);
    expect(before.subject).toBe(2);
    expect(before.subjectTracking).toBe(2);
    if (coMember) expect(before.coMember).toBe(1);
  });

  it("erases the subject", async () => {
    expect(deleteStatus).toBe(200);
    const [tombstone] = await db.select({ erasedAt: users.erasedAt }).from(users).where(eq(users.id, subject.id));
    expect(tombstone?.erasedAt).not.toBeNull();
    const remaining = await db.select({ id: households.id }).from(households).where(eq(households.id, householdId));
    expect(remaining).toHaveLength(shape === "member of a shared household" ? 1 : 0);
  });

  it("leaves no session-store row and no tracking row for the subject", async () => {
    expect(await sessionRows(subject.id)).toBe(0);
    expect(await trackingRows(subject.id)).toBe(0);
  });

  it("rejects both of the subject's cookies", async () => {
    await request(app).get("/api/auth/me").set("Cookie", subject.cookie).expect(401);
    await request(app).get("/api/auth/me").set("Cookie", subjectSecondCookie).expect(401);
  });

  it.runIf(shape === "member of a shared household")("keeps the co-member signed in", async () => {
    await request(app).get("/api/auth/me").set("Cookie", coMember!.cookie).expect(200);
    expect(await sessionRows(coMember!.id)).toBe(1);
  });
});
