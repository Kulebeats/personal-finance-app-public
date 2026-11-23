/**
 * R07.2 / AH-08 (DEL-02): erasure pseudonymises every address the member has
 * had, not only the current one. The member registers as A, changes to B,
 * then to C (real HTTP change + verify), and other members' records name A
 * and B. After erasure no security event, audit row or outbox notice holds A,
 * B or C; the owner's rows name the member only by the tombstone address.
 * Real HTTP against real Postgres.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { eq, inArray, or, sql } from "drizzle-orm";
import { db, pool } from "../../../db";
import { auditLogs, householdMembers, households, outboxEvents, securityAuditLogs, users } from "@shared/schema";
import { hashPassword } from "../../../auth";
import { getTestApp } from "../../../__tests__/fixtures";
import { wholeAddressPattern } from "../settings.account-deletion.traces";

const sentChallenges: { email: string; token: string }[] = [];
vi.mock("../../../services/emailService", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../services/emailService")>();
  return {
    ...actual,
    sendVerificationEmail: vi.fn(async (email: string, token: string) => { sentChallenges.push({ email, token }); return true; }),
    sendEmail: vi.fn(async () => true),
  };
});

const password = "SyntheticPreviousEmails123!";
const householdId = randomUUID();
const ownerId = randomUUID();
const memberId = randomUUID();
const run = randomUUID().slice(0, 8);
const addressA = `erasure-prev-a-${run}@example.invalid`;
const addressB = `erasure-prev-b-${run}@example.invalid`;
const addressC = `erasure-prev-c-${run}@example.invalid`;
const ownerEmail = `erasure-prev-owner-${run}@example.invalid`;
const inviteAuditIds: string[] = [];
const ownerInviteEventId = randomUUID();
let app: Awaited<ReturnType<typeof getTestApp>>;

async function login(email: string): Promise<string> {
  const response = await request(app).post("/api/auth/login").send({ email, password }).expect(200);
  return (response.headers["set-cookie"] as unknown as string[]).join("; ");
}

async function changeEmail(cookie: string, newEmail: string): Promise<void> {
  await request(app).post("/api/settings/security/email/change").set("Cookie", cookie)
    .send({ newEmail, password }).expect(200);
  const challenge = sentChallenges.find((sent) => sent.email === newEmail);
  expect(challenge, `verification sent to ${newEmail}`).toBeDefined();
  await request(app).post("/api/settings/security/email/verify").send({ token: challenge!.token }).expect(200);
}

async function ownerInviteAudit(email: string): Promise<void> {
  const [row] = await db.insert(auditLogs).values({
    householdId, userId: ownerId, action: "CREATE", entityType: "household_invitation", entityId: randomUUID(),
    details: { email, role: "member" }, ipAddress: "203.0.113.30",
  }).returning({ id: auditLogs.id });
  inviteAuditIds.push(row.id);
}

/** Rows anywhere in the retained logs that still name `email` as a whole address. */
async function mentions(email: string) {
  const pattern = wholeAddressPattern(email);
  const count = async (rows: Promise<unknown[]>) => (await rows).length;
  return {
    security: await count(db.select({ id: securityAuditLogs.id }).from(securityAuditLogs)
      .where(sql`${securityAuditLogs.details}::text ~* ${pattern}`)),
    audit: await count(db.select({ id: auditLogs.id }).from(auditLogs).where(sql`${auditLogs.details}::text ~* ${pattern}`)),
    outbox: await count(db.select({ id: outboxEvents.id }).from(outboxEvents).where(sql`${outboxEvents.payload}::text ~* ${pattern}`)),
  };
}

describe("R07.2 erasure pseudonymises previous e-mail addresses", () => {
  beforeAll(async () => {
    app = await getTestApp();
    await db.insert(households).values({ id: householdId, name: "Synthetic previous e-mails", currency: "ZMW" });
    const passwordHash = await hashPassword(password);
    await db.insert(users).values([
      { id: ownerId, email: ownerEmail, username: `erasure-prev-owner-${run}`, passwordHash, emailVerified: true },
      { id: memberId, email: addressA, username: `erasure-prev-member-${run}`, passwordHash, emailVerified: true },
    ]);
    await db.insert(householdMembers).values([
      { userId: ownerId, householdId, role: "owner" },
      { userId: memberId, householdId, role: "member" },
    ]);
    // What registration writes for the member, and the owner's invitation to A.
    await db.insert(securityAuditLogs).values([
      { eventType: "REGISTER", userId: memberId, ipAddress: "198.51.100.40", details: { email: addressA } },
      { id: ownerInviteEventId, eventType: "INVITE_SENT", userId: ownerId, ipAddress: "203.0.113.31", userAgent: "agent-owner",
        details: { invitee: addressA, sender: ownerEmail } },
    ]);
    await ownerInviteAudit(addressA);

    await changeEmail(await login(addressA), addressB);
    await ownerInviteAudit(addressB);
    await changeEmail(await login(addressB), addressC);

    // Before erasure the earlier addresses really are on record.
    expect((await mentions(addressA)).outbox + (await mentions(addressB)).outbox).toBeGreaterThan(0);

    const cookie = await login(addressC);
    await request(app).post("/api/settings/security/step-up").set("Cookie", cookie).send({ password }).expect(200);
    await request(app).post("/api/settings/account/delete").set("Cookie", cookie).send({ password }).expect(200);
  }, 90000);

  afterAll(async () => {
    const ids = [ownerId, memberId];
    for (const id of ids) await pool.query("DELETE FROM \"session\" WHERE sess->>'userId' = $1", [id]);
    await db.delete(outboxEvents).where(sql`${outboxEvents.payload}->>'userId' = ${memberId}`);
    await db.delete(securityAuditLogs).where(or(inArray(securityAuditLogs.userId, ids), eq(securityAuditLogs.id, ownerInviteEventId)));
    await db.delete(auditLogs).where(or(inArray(auditLogs.userId, ids), eq(auditLogs.householdId, householdId)));
    await db.delete(householdMembers).where(eq(householdMembers.householdId, householdId));
    await db.delete(households).where(eq(households.id, householdId));
    await db.delete(users).where(inArray(users.id, ids));
  });

  it("leaves neither previous address, nor the last one, in security events, audit rows or outbox notices", async () => {
    const none = { security: 0, audit: 0, outbox: 0 };
    expect({ a: await mentions(addressA), b: await mentions(addressB), c: await mentions(addressC) })
      .toEqual({ a: none, b: none, c: none });
  });

  it("the owner's records name the member only by the tombstone and keep everything else", async () => {
    const [tombstone] = await db.select({ email: users.email }).from(users).where(eq(users.id, memberId));
    expect(tombstone.email).toMatch(/@deleted\.invalid$/);
    const invites = await db.select().from(auditLogs).where(inArray(auditLogs.id, inviteAuditIds));
    expect(invites.map((row) => row.details)).toEqual([
      { email: tombstone.email, role: "member" }, { email: tombstone.email, role: "member" },
    ]);
    const [event] = await db.select().from(securityAuditLogs).where(eq(securityAuditLogs.id, ownerInviteEventId));
    expect(event).toMatchObject({ ipAddress: "203.0.113.31", userAgent: "agent-owner",
      details: { invitee: tombstone.email, sender: ownerEmail } });
  });
});
