/**
 * A-49 / R3-2: an address is not a subject. Erasing A rewrites only rows that
 * are about A, or that were written while A held the address.
 *
 * A registers with X and changes to Y. B then registers with X. A is erased,
 * then B is erased:
 *   - rows written while A held X (a failed login, an invitation to X) name A's
 *     tombstone after A's erasure;
 *   - B's rows, and rows naming X written after B took it, are byte-identical
 *     after A's erasure;
 *   - B's erasure gives them B's tombstone and leaves A's retained rows
 *     byte-identical.
 * An invitation A accepted is about A whenever it was written: the owner's
 * create and resend rows from before A registered lose A's address, while B's
 * later invitation to the same address is byte-identical.
 * Real HTTP registration, e-mail change and erasure against real Postgres;
 * only mail transport is stubbed.
 */
import { randomUUID } from "node:crypto";
import { eq, inArray, or, sql } from "drizzle-orm";
import request from "supertest";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { auditLogs, householdInvitations, householdMembers, households, outboxEvents, securityAuditLogs, users } from "@shared/schema";
import { db, pool } from "../../../db";
import { getTestApp } from "../../../__tests__/fixtures";
import { hashPassword } from "../../../auth";

const mail = vi.hoisted(() => ({ registration: new Map<string, string>(), change: new Map<string, string>() }));
vi.mock("../../../services/emailService", async (original) => ({
  ...await original<typeof import("../../../services/emailService")>(),
  sendEmail: vi.fn(async (message: { to: string; html: string }) => {
    const token = message.html.match(/token=([a-f0-9]{64})/)?.[1];
    if (token) mail.registration.set(message.to, token);
    return true;
  }),
  sendVerificationEmail: vi.fn(async (email: string, token: string) => {
    mail.change.set(email, token);
    return true;
  }),
}));

const password = "SyntheticAddressIntervals123!";
const run = randomUUID().slice(0, 8);
const reused = `a49-reused-${run}@example.invalid`;
const moved = `a49-moved-${run}@example.invalid`;
const householdId = randomUUID();
const userIds: string[] = [];
const securityIds: string[] = [];
const auditIds: string[] = [];
let app: Awaited<ReturnType<typeof getTestApp>>;

const securityBytes = async (ids: readonly string[]) => (await pool.query<{ bytes: string }>(
  "SELECT row_to_json(s)::text AS bytes FROM security_audit_logs s WHERE id = ANY($1::uuid[]) ORDER BY id", [ids])).rows;
const auditBytes = async (ids: readonly string[]) => (await pool.query<{ bytes: string }>(
  "SELECT row_to_json(a)::text AS bytes FROM audit_logs a WHERE id = ANY($1::uuid[]) ORDER BY id", [ids])).rows;
const ownSecurityIds = async (userId: string) => (await db.select({ id: securityAuditLogs.id }).from(securityAuditLogs)
  .where(eq(securityAuditLogs.userId, userId))).map(row => row.id);
const emailOf = async (userId: string) => (await db.select({ email: users.email }).from(users).where(eq(users.id, userId)))[0].email;
const securityDetails = async (id: string) =>
  (await db.select({ details: securityAuditLogs.details }).from(securityAuditLogs).where(eq(securityAuditLogs.id, id)))[0].details;
const auditDetails = async (id: string) =>
  (await db.select({ details: auditLogs.details }).from(auditLogs).where(eq(auditLogs.id, id)))[0].details;

async function login(email: string): Promise<string> {
  const response = await request(app).post("/api/auth/login").send({ email, password }).expect(200);
  return (response.headers["set-cookie"] as unknown as string[]).join("; ");
}

async function registerVerified(email: string, name: string): Promise<string> {
  const response = await request(app).post("/api/auth/register").send({ email, username: `a49-${name}-${run}`, password }).expect(201);
  const userId: string = response.body.data.user.id;
  userIds.push(userId);
  const token = mail.registration.get(email);
  expect(token, `registration link sent to ${email}`).toBeDefined();
  mail.registration.delete(email);
  await request(app).post("/api/auth/verify-email").send({ token }).expect(200);
  return userId;
}

async function changeEmail(from: string, to: string): Promise<void> {
  await request(app).post("/api/settings/security/email/change").set("Cookie", await login(from))
    .send({ newEmail: to, password }).expect(200);
  const token = mail.change.get(to);
  expect(token, `change link sent to ${to}`).toBeDefined();
  await request(app).post("/api/settings/security/email/verify").send({ token }).expect(200);
}

async function erase(email: string): Promise<void> {
  const cookie = await login(email);
  await request(app).post("/api/settings/security/step-up").set("Cookie", cookie).send({ password }).expect(200);
  await request(app).post("/api/settings/account/delete").set("Cookie", cookie).send({ password }).expect(200);
}

/** A failed sign-in for an address, before any account is resolved. */
async function failedLogin(email: string): Promise<string> {
  const [row] = await db.insert(securityAuditLogs).values({ eventType: "LOGIN_FAILED", userId: null,
    ipAddress: "198.51.100.49", userAgent: "agent-anonymous", details: { email, reason: "bad_password" } }).returning();
  securityIds.push(row.id);
  return row.id;
}

/** The household's record of an invitation to an address. */
async function invitationAudit(email: string): Promise<string> {
  const [row] = await db.insert(auditLogs).values({ householdId, userId: null, action: "CREATE",
    entityType: "household_invitation", entityId: randomUUID(), details: { email, role: "member" } }).returning();
  auditIds.push(row.id);
  return row.id;
}

beforeAll(async () => {
  app = await getTestApp();
  await db.insert(households).values({ id: householdId, name: "Synthetic A-49 address intervals", currency: "ZMW" });
}, 60_000);

afterAll(async () => {
  for (const id of userIds) await pool.query("DELETE FROM \"session\" WHERE sess->>'userId' = $1", [id]);
  if (userIds.length) {
    await db.delete(outboxEvents).where(inArray(sql<string>`${outboxEvents.payload}->>'userId'`, userIds));
    await db.delete(securityAuditLogs).where(or(inArray(securityAuditLogs.userId, userIds), inArray(securityAuditLogs.id, securityIds)));
    await db.delete(auditLogs).where(or(inArray(auditLogs.userId, userIds), eq(auditLogs.householdId, householdId)));
  }
  await db.delete(households).where(eq(households.id, householdId));
  if (userIds.length) await db.delete(users).where(inArray(users.id, userIds));
});

const invitationRows = async (invitationId: string) => (await db.select({ id: auditLogs.id }).from(auditLogs)
  .where(eq(auditLogs.entityId, invitationId))).map(row => row.id);
const storedInvitationId = async (email: string) => (await db.select({ id: householdInvitations.id })
  .from(householdInvitations).where(eq(householdInvitations.email, email))).map(row => row.id);

/** The household owner, signed in, who invites through the real endpoints. */
async function householdOwner(): Promise<string> {
  const id = randomUUID();
  const email = `a49-owner-${run}@example.invalid`;
  await db.insert(users).values({ id, email, username: `a49-owner-${run}`, passwordHash: await hashPassword(password), emailVerified: true });
  userIds.push(id);
  await db.insert(householdMembers).values({ householdId, userId: id, role: "owner" });
  return login(email);
}

async function invite(ownerCookie: string, email: string): Promise<string> {
  const before = new Set(await storedInvitationId(email));
  await request(app).post("/api/household/invite").set("Cookie", ownerCookie).send({ email, role: "member" }).expect(201);
  const created = (await storedInvitationId(email)).filter(id => !before.has(id));
  expect(created).toHaveLength(1);
  return created[0];
}

it("erasing A leaves B's rows on the reused address byte-identical, and B's erasure leaves A's", async () => {
  const first = await registerVerified(reused, "first");
  const firstFailed = await failedLogin(reused);
  const firstInvite = await invitationAudit(reused);
  await changeEmail(reused, moved);

  const second = await registerVerified(reused, "second");
  const secondFailed = await failedLogin(reused);
  const secondInvite = await invitationAudit(reused);
  const secondSecurity = [...await ownSecurityIds(second), secondFailed];
  expect(secondSecurity.length).toBeGreaterThan(2);
  const secondBefore = { security: await securityBytes(secondSecurity), audit: await auditBytes([secondInvite]) };

  await erase(moved);

  const firstTombstone = await emailOf(first);
  expect(firstTombstone).toMatch(/^deleted_.+@deleted\.invalid$/);
  expect({ security: await securityBytes(secondSecurity), audit: await auditBytes([secondInvite]) }).toEqual(secondBefore);
  expect(await securityDetails(firstFailed)).toEqual({ email: firstTombstone, reason: "bad_password" });
  expect(await auditDetails(firstInvite)).toEqual({ email: firstTombstone, role: "member" });
  const firstSecurity = await ownSecurityIds(first);
  const firstRegister = await db.select({ details: securityAuditLogs.details }).from(securityAuditLogs)
    .where(inArray(securityAuditLogs.id, firstSecurity));
  expect(firstRegister).toContainEqual({ details: { email: firstTombstone } });
  const firstRetained = [...firstSecurity, firstFailed];
  const firstBefore = { security: await securityBytes(firstRetained), audit: await auditBytes([firstInvite]) };

  await erase(reused);

  const secondTombstone = await emailOf(second);
  expect(secondTombstone).toMatch(/^deleted_.+@deleted\.invalid$/);
  expect(secondTombstone).not.toBe(firstTombstone);
  expect({ security: await securityBytes(firstRetained), audit: await auditBytes([firstInvite]) }).toEqual(firstBefore);
  expect(await securityDetails(secondFailed)).toEqual({ email: secondTombstone, reason: "bad_password" });
  expect(await auditDetails(secondInvite)).toEqual({ email: secondTombstone, role: "member" });
  const secondRegister = await db.select({ details: securityAuditLogs.details }).from(securityAuditLogs)
    .where(inArray(securityAuditLogs.id, await ownSecurityIds(second)));
  expect(secondRegister).toContainEqual({ details: { email: secondTombstone } });
}, 120_000);

it("erasing A removes A's address from an invitation sent and resent before A registered, and leaves B's invitation", async () => {
  const invited = `a49-invited-${run}@example.invalid`;
  const invitedMoved = `a49-invited-moved-${run}@example.invalid`;
  const owner = await householdOwner();
  // The owner invites the address while no account holds it, and resends.
  const firstInvitation = await invite(owner, invited);
  await request(app).post(`/api/household/invitations/${firstInvitation}/resend`).set("Cookie", owner).expect(200);
  const [{ code }] = await db.select({ code: householdInvitations.inviteCode }).from(householdInvitations)
    .where(eq(householdInvitations.id, firstInvitation));

  const member = await registerVerified(invited, "invited");
  await request(app).post("/api/household/invite/accept").set("Cookie", await login(invited)).send({ inviteCode: code }).expect(200);
  const firstRows = await invitationRows(firstInvitation);
  expect(firstRows.length).toBeGreaterThan(1);
  expect(JSON.stringify(await auditBytes(firstRows))).toContain(invited);
  await changeEmail(invited, invitedMoved);

  // B takes the address and is invited to the same household while holding it.
  await registerVerified(invited, "invited-next");
  const secondRows = await invitationRows(await invite(owner, invited));
  expect(JSON.stringify(await auditBytes(secondRows))).toContain(invited);
  const secondBefore = await auditBytes(secondRows);

  await erase(invitedMoved);

  const tombstone = await emailOf(member);
  expect(tombstone).toMatch(/^deleted_.+@deleted\.invalid$/);
  const firstAfter = JSON.stringify(await auditBytes(firstRows));
  expect(firstAfter).not.toContain(invited);
  expect(firstAfter).toContain(tombstone);
  expect(await auditBytes(secondRows)).toEqual(secondBefore);
}, 120_000);
