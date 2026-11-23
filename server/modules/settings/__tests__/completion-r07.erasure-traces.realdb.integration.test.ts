/**
 * R07.2 / AH-08 (DEL-02): after a member erases their account, no retained row
 * holds their e-mail or the IP and user agent of their own security events,
 * the tombstone holds no password hash or reset token, and their personal
 * exports are gone. The household's audit history stays, attributed to the
 * pseudonymous tombstone. Real HTTP against real Postgres.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { eq, inArray, or, sql } from "drizzle-orm";
import { db, pool } from "../../../db";
import {
  auditLogs, dataExports, householdMembers, households, passwordResetTokens, securityAuditLogs, users,
} from "@shared/schema";
import { hashPassword } from "../../../auth";
import { getTestApp } from "../../../__tests__/fixtures";
import { readPersonalExportFile, removePersonalExportFile } from "../settings.privacy-export.files";
import { wholeAddressPattern } from "../settings.account-deletion.traces";

const password = "SyntheticErasureTraces123!";
const householdId = randomUUID();
const ids: string[] = [];
let app: Awaited<ReturnType<typeof getTestApp>>;
type Actor = { id: string; email: string; cookie: string };
let owner: Actor;
let member: Actor;
let memberExportId: string;
let inviteAuditId: string;
const anonymousFailureId = randomUUID();
const ownerLoginId = randomUUID();
const ownerInviteId = randomUUID();
let prefixLookalike: string;
let suffixLookalike: string;

async function fixture(role: "owner" | "member"): Promise<Actor> {
  const id = randomUUID();
  // Mixed case: matching must not depend on how the address was typed.
  const email = `Erasure-Traces-${id}@Example.invalid`;
  await db.insert(users).values({
    id, email, username: `erasure-traces-${id}`, passwordHash: await hashPassword(password), emailVerified: true,
  });
  ids.push(id);
  await db.insert(householdMembers).values({ userId: id, householdId, role });
  const login = await request(app).post("/api/auth/login").set("User-Agent", `agent-${role}`)
    .send({ email, password }).expect(200);
  return { id, email, cookie: (login.headers["set-cookie"] as unknown as string[]).join("; ") };
}

/** Rows naming the address as a whole address (look-alikes are checked separately). */
async function rowsMentioning(email: string) {
  const pattern = wholeAddressPattern(email);
  const security = await db.select({ id: securityAuditLogs.id }).from(securityAuditLogs)
    .where(sql`${securityAuditLogs.details}::text ~* ${pattern}`);
  const audit = await db.select({ id: auditLogs.id }).from(auditLogs)
    .where(sql`${auditLogs.details}::text ~* ${pattern}`);
  return { security: security.length, audit: audit.length };
}

async function tombstoneEmail(): Promise<string> {
  const [row] = await db.select({ email: users.email }).from(users).where(eq(users.id, member.id));
  return row.email;
}

describe("R07.2 erasure leaves no identity traces", () => {
  beforeAll(async () => {
    app = await getTestApp();
    await db.insert(households).values({ id: householdId, name: "Synthetic erasure traces", currency: "ZMW" });
    owner = await fixture("owner");
    member = await fixture("member");
    // Someone else's addresses that merely contain the erased one.
    prefixLookalike = `x${member.email.toLowerCase()}`;
    suffixLookalike = `${member.email}.org`;
    await db.insert(securityAuditLogs).values([
      { eventType: "REGISTER", userId: member.id, ipAddress: "198.51.100.23", userAgent: "agent-member",
        details: { email: member.email, ipAddress: "198.51.100.23", referrer: owner.email } },
      // The owner's own event that names the erased address.
      { id: ownerInviteId, eventType: "INVITE_SENT", userId: owner.id, ipAddress: "203.0.113.10", userAgent: "agent-owner-invite",
        details: { invitee: member.email, sender: owner.email, prefix: prefixLookalike, suffix: suffixLookalike } },
      // A failed login before the account was known carries only the address.
      { id: anonymousFailureId, eventType: "LOGIN_FAILED", userId: null, ipAddress: "198.51.100.24", userAgent: "agent-anon",
        details: { email: member.email.toUpperCase(), reason: "bad_password" } },
      { id: ownerLoginId, eventType: "LOGIN_SUCCESS", userId: owner.id, ipAddress: "203.0.113.9", userAgent: "agent-owner",
        details: { mfaEnabled: false } },
    ]);
    const [invite] = await db.insert(auditLogs).values({
      householdId, userId: owner.id, action: "CREATE", entityType: "household_invitation", entityId: randomUUID(),
      details: { email: member.email, role: "member", lookalike: prefixLookalike }, ipAddress: "203.0.113.9",
    }).returning({ id: auditLogs.id });
    inviteAuditId = invite.id;
    await db.insert(passwordResetTokens).values({
      userId: member.id, tokenHash: "synthetic-token-hash", expiresAt: new Date(Date.now() + 3_600_000), requestIp: "198.51.100.25",
    });
    await request(app).post("/api/settings/security/step-up").set("Cookie", member.cookie).send({ password }).expect(200);
    const exported = await request(app).post("/api/settings/privacy/export").set("Cookie", member.cookie).send({}).expect(201);
    memberExportId = exported.body.data.id;

    await request(app).post("/api/settings/account/delete").set("Cookie", member.cookie).send({ password }).expect(200);
  }, 60000);

  afterAll(async () => {
    for (const id of ids) await pool.query("DELETE FROM \"session\" WHERE sess->>'userId' = $1", [id]);
    await db.delete(securityAuditLogs).where(or(inArray(securityAuditLogs.userId, ids), eq(securityAuditLogs.id, anonymousFailureId)));
    if (memberExportId) await removePersonalExportFile(memberExportId);
    await db.delete(auditLogs).where(inArray(auditLogs.userId, ids));
    await db.delete(auditLogs).where(eq(auditLogs.householdId, householdId));
    await db.delete(dataExports).where(inArray(dataExports.userId, ids));
    await db.delete(passwordResetTokens).where(inArray(passwordResetTokens.userId, ids));
    await db.delete(householdMembers).where(eq(householdMembers.householdId, householdId));
    await db.delete(households).where(eq(households.id, householdId));
    for (const id of ids) await db.delete(users).where(eq(users.id, id));
  });

  it("no security-log or audit row still holds the erased e-mail", async () => {
    expect(await rowsMentioning(member.email)).toEqual({ security: 0, audit: 0 });
  });

  it("keeps the erased member's security events but drops their IP and user agent", async () => {
    const rows = await db.select().from(securityAuditLogs).where(eq(securityAuditLogs.userId, member.id));
    const registered = rows.find(row => row.eventType === "REGISTER");
    expect(registered).toBeDefined();
    for (const row of rows) {
      expect({ event: row.eventType, ip: row.ipAddress, agent: row.userAgent }).toEqual({ event: row.eventType, ip: null, agent: null });
      expect(JSON.stringify(row.details ?? {})).not.toMatch(/198\.51\.100\./);
    }
    // Their address becomes the tombstone; anyone else's is redacted, never re-attributed.
    expect(registered!.details).toEqual({ email: await tombstoneEmail(), referrer: "redacted@deleted.invalid" });
  });

  it("leaves another member's security events untouched", async () => {
    const [row] = await db.select().from(securityAuditLogs).where(eq(securityAuditLogs.id, ownerLoginId));
    expect(row).toMatchObject({ ipAddress: "203.0.113.9", userAgent: "agent-owner" });
  });

  it("another member's event naming the erased address loses only that address", async () => {
    const [row] = await db.select().from(securityAuditLogs).where(eq(securityAuditLogs.id, ownerInviteId));
    expect(row).toMatchObject({ ipAddress: "203.0.113.10", userAgent: "agent-owner-invite" });
    expect(row.details).toEqual({
      invitee: await tombstoneEmail(), sender: owner.email, prefix: prefixLookalike, suffix: suffixLookalike,
    });
  });

  it("an anonymous event naming the address keeps its IP and user agent but not the address", async () => {
    const [row] = await db.select().from(securityAuditLogs).where(eq(securityAuditLogs.id, anonymousFailureId));
    expect(row).toMatchObject({ eventType: "LOGIN_FAILED", ipAddress: "198.51.100.24", userAgent: "agent-anon" });
    expect(row.details).toEqual({ email: await tombstoneEmail(), reason: "bad_password" });
  });

  it("keeps the household audit history, naming the erased member only by the tombstone", async () => {
    const [invite] = await db.select().from(auditLogs).where(eq(auditLogs.id, inviteAuditId));
    const [tombstone] = await db.select({ email: users.email }).from(users).where(eq(users.id, member.id));
    expect(invite).toMatchObject({ householdId, userId: owner.id, entityType: "household_invitation" });
    expect(invite.details).toEqual({ email: tombstone.email, role: "member", lookalike: prefixLookalike });
  });

  it("the tombstone holds no password hash or reset token and the old password no longer signs in", async () => {
    const [tombstone] = await db.select().from(users).where(eq(users.id, member.id));
    expect(tombstone.passwordHash.startsWith("$2")).toBe(false);
    expect(tombstone.erasedAt).not.toBeNull();
    const tokens = await db.select().from(passwordResetTokens).where(eq(passwordResetTokens.userId, member.id));
    expect(tokens).toHaveLength(0);
    await request(app).post("/api/auth/login").send({ email: member.email, password }).expect(401);
  });

  it("removes the erased member's personal exports, row and file", async () => {
    const rows = await db.select().from(dataExports).where(eq(dataExports.id, memberExportId));
    expect(rows).toHaveLength(0);
    await expect(readPersonalExportFile(memberExportId, "zip")).rejects.toMatchObject({ code: "ENOENT" });
  });
});
