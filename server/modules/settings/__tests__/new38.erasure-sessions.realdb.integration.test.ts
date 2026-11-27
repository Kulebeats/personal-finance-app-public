/**
 * NEW-38: erasure ends every live session of the erased member, not only the
 * one that asked for it. A member of a shared household signs in twice (two
 * cookies), erases from one of them over real HTTP, and afterwards neither
 * cookie authenticates and no row of the connect-pg-simple `session` table
 * (config/session-store.ts, user id at sess->>'userId') names them. The
 * co-member's session keeps working. Real HTTP against real Postgres.
 *
 * The store refuses an erased user's payload on read, so the 401s alone would
 * pass even if revocation left rows behind; the row count is what proves
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
const householdId = randomUUID();
const ids: string[] = [];
let app: Awaited<ReturnType<typeof getTestApp>>;
type Actor = { id: string; email: string; cookie: string };
let owner: Actor;
let member: Actor;
let memberSecondCookie: string;
let memberSessionRowsBefore: number;
let ownerSessionRowsBefore: number;
let deleteStatus: number;

async function login(email: string): Promise<string> {
  const res = await request(app).post("/api/auth/login").send({ email, password }).expect(200);
  return (res.headers["set-cookie"] as unknown as string[]).join("; ");
}

async function fixture(role: "owner" | "member"): Promise<Actor> {
  const id = randomUUID();
  const email = `erasure-sessions-${id}@example.test`;
  await db.insert(users).values({
    id, email, username: `erasure-sessions-${id}`, passwordHash: await hashPassword(password), emailVerified: true,
  });
  ids.push(id);
  await db.insert(householdMembers).values({ userId: id, householdId, role });
  return { id, email, cookie: await login(email) };
}

/** Rows of the session store that belong to this user, signed in or half-way through MFA. */
async function sessionRows(userId: string): Promise<number> {
  const { rows } = await pool.query<{ n: number }>(
    "SELECT count(*)::int AS n FROM \"session\" WHERE sess->>'userId' = $1 OR sess->>'mfaPendingUserId' = $1", [userId]);
  return rows[0].n;
}

describe("NEW-38 erasure ends every session of the erased member", () => {
  beforeAll(async () => {
    app = await getTestApp();
    await db.insert(households).values({ id: householdId, name: "Synthetic erasure sessions", currency: "ZMW" });
    owner = await fixture("owner");
    member = await fixture("member");
    // A second, separate sign-in: another device holding its own cookie.
    memberSecondCookie = await login(member.email);
    memberSessionRowsBefore = await sessionRows(member.id);
    ownerSessionRowsBefore = await sessionRows(owner.id);

    await request(app).post("/api/settings/security/step-up").set("Cookie", member.cookie).send({ password }).expect(200);
    const res = await request(app).post("/api/settings/account/delete").set("Cookie", member.cookie).send({ password });
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

  it("starts from two distinct live sessions for the member and one for the co-member", () => {
    expect(memberSecondCookie).not.toBe(member.cookie);
    expect(memberSessionRowsBefore).toBe(2);
    expect(ownerSessionRowsBefore).toBe(1);
  });

  it("erases the member and keeps the shared household", async () => {
    expect(deleteStatus).toBe(200);
    const [tombstone] = await db.select({ erasedAt: users.erasedAt }).from(users).where(eq(users.id, member.id));
    expect(tombstone?.erasedAt).not.toBeNull();
    const [household] = await db.select({ id: households.id }).from(households).where(eq(households.id, householdId));
    expect(household).toBeDefined();
  });

  it("leaves no session-store row for the erased member", async () => {
    expect(await sessionRows(member.id)).toBe(0);
  });

  it("rejects both of the member's cookies", async () => {
    await request(app).get("/api/auth/me").set("Cookie", member.cookie).expect(401);
    await request(app).get("/api/auth/me").set("Cookie", memberSecondCookie).expect(401);
  });

  it("keeps the co-member signed in", async () => {
    await request(app).get("/api/auth/me").set("Cookie", owner.cookie).expect(200);
    expect(await sessionRows(owner.id)).toBe(1);
  });
});
