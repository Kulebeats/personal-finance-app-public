/**
 * AH-05 / AH-06 (R03.1, R03.2): members screen contract and invitation acceptance.
 *
 * Real HTTP against real Postgres. Before the fix: the members list carried
 * internal ids and a null name for anyone without a full name (the screen showed
 * "Unknown User"); a Professional could not be invited; invite create and resend
 * echoed the invitation token in the API response; the one-household check ran
 * outside the accept transaction, so one user could accept two households'
 * invitations at once; and the join audit row was written after the commit.
 */
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { and, eq, inArray } from "drizzle-orm";
import { db, pool } from "../../../db";
import { auditLogs, householdInvitations, householdMembers, households, users } from "@shared/schema";
import { getTestApp } from "../../../__tests__/fixtures";
import { hashPassword } from "../../../auth";
import { businessAuditService } from "../../../services/BusinessAuditService";
import { raceBehindHouseholdLocks } from "./householdLockBarrier";

// "joiner" belongs to no household; "otherOwner" owns the second household.
const ACTORS = ["owner", "admin", "member", "otherOwner", "joiner"] as const;
type Actor = (typeof ACTORS)[number];
const MEMBER_DTO_KEYS = ["email", "joinedAt", "name", "role", "userId"];
const SECRET_FIELDS = /passwordHash|password_hash|mfa|recovery|token|inviteCode|invite_code/i;

const householdId = randomUUID();
const otherHouseholdId = randomUUID();
const fixtureHouseholds = [householdId, otherHouseholdId];
const actors = new Map<Actor, { id: string; email: string; username: string; cookie: string }>();
const password = "SyntheticMembership123!";
let app: Awaited<ReturnType<typeof getTestApp>>;

const actor = (name: Actor) => actors.get(name)!;
const listMembers = (as: Actor) =>
  request(app).get("/api/household/members").set("Cookie", actor(as).cookie);
const invite = (as: Actor, email: string, role: string) =>
  request(app).post("/api/household/invite").set("Cookie", actor(as).cookie).send({ email, role });
const resend = (as: Actor, inviteId: string) =>
  request(app).post(`/api/household/invitations/${inviteId}/resend`).set("Cookie", actor(as).cookie);
const accept = (as: Actor, inviteCode: string) =>
  request(app).post("/api/household/invite/accept").set("Cookie", actor(as).cookie).send({ inviteCode });

async function storedInvitation(inHousehold: string, email: string) {
  const [row] = await db.select().from(householdInvitations)
    .where(and(eq(householdInvitations.householdId, inHousehold), eq(householdInvitations.email, email)));
  return row;
}

async function membershipsOf(userId: string): Promise<string[]> {
  const rows = await db.select({ householdId: householdMembers.householdId })
    .from(householdMembers).where(eq(householdMembers.userId, userId));
  return rows.map((row) => row.householdId!);
}

const joinAudit = () =>
  db.select().from(auditLogs).where(and(
    inArray(auditLogs.householdId, fixtureHouseholds),
    eq(auditLogs.entityType, "household_member"),
  ));

/** Both households invite the joiner; returns the two stored codes. */
async function inviteJoinerToBoth(): Promise<[string, string]> {
  const email = actor("joiner").email;
  await invite("owner", email, "member").expect(201);
  await invite("otherOwner", email, "member").expect(201);
  const first = await storedInvitation(householdId, email);
  const second = await storedInvitation(otherHouseholdId, email);
  return [first.inviteCode, second.inviteCode];
}

describe("AH-05 / AH-06 household membership contract", () => {
  beforeAll(async () => {
    app = await getTestApp();
    await db.insert(households).values([
      { id: householdId, name: "Synthetic membership" },
      { id: otherHouseholdId, name: "Synthetic second household" },
    ]);
    const passwordHash = await hashPassword(password);
    for (const name of ACTORS) {
      const id = randomUUID();
      const email = `ah-05-${id}@example.invalid`;
      const username = `ah05-${name}-${id.slice(0, 8)}`;
      // Only the owner has a full name; everyone else must fall back to a username.
      const fullName = name === "owner" ? "Synthetic Owner" : null;
      await db.insert(users).values({ id, email, username, fullName, passwordHash, emailVerified: true });
      const login = await request(app).post("/api/auth/login").send({ email, password }).expect(200);
      actors.set(name, { id, email, username, cookie: (login.headers["set-cookie"] as unknown as string[]).join("; ") });
    }
  }, 30000);

  beforeEach(async () => {
    await db.delete(auditLogs).where(inArray(auditLogs.householdId, fixtureHouseholds));
    await db.delete(householdInvitations).where(inArray(householdInvitations.householdId, fixtureHouseholds));
    await db.delete(householdMembers).where(inArray(householdMembers.householdId, fixtureHouseholds));
    await db.insert(householdMembers).values([
      { householdId, userId: actor("owner").id, role: "owner" },
      { householdId, userId: actor("admin").id, role: "admin" },
      { householdId, userId: actor("member").id, role: "member" },
      { householdId: otherHouseholdId, userId: actor("otherOwner").id, role: "owner" },
    ]);
  });

  afterEach(() => vi.restoreAllMocks());

  afterAll(async () => {
    await db.delete(auditLogs).where(inArray(auditLogs.householdId, fixtureHouseholds));
    await db.delete(households).where(inArray(households.id, fixtureHouseholds));
    for (const { id } of actors.values()) {
      await db.delete(auditLogs).where(eq(auditLogs.userId, id));
      await pool.query('DELETE FROM "session" WHERE sess->>\'userId\' = $1', [id]);
      await db.delete(users).where(eq(users.id, id));
    }
  });

  describe("AH-05 members list", () => {
    it("returns a flat member DTO with a display name and no account secrets", async () => {
      const response = await listMembers("owner").expect(200);
      const members: Array<Record<string, unknown>> = response.body.data.members;

      expect(members).toHaveLength(3);
      for (const member of members) {
        expect(Object.keys(member).sort()).toEqual(MEMBER_DTO_KEYS);
      }
      expect(JSON.stringify(response.body)).not.toMatch(SECRET_FIELDS);
      const byUser = Object.fromEntries(members.map((m) => [m.userId, m]));
      expect(byUser[actor("owner").id]).toMatchObject({ name: "Synthetic Owner", role: "owner" });
      expect(byUser[actor("member").id]).toMatchObject({
        name: actor("member").username,
        email: actor("member").email,
        role: "member",
      });
    });

    it("hides other members' email addresses from a plain member", async () => {
      const response = await listMembers("member").expect(200);
      for (const member of response.body.data.members) {
        expect(member).not.toHaveProperty("email");
        expect(typeof member.name).toBe("string");
      }
    });
  });

  describe("AH-05 invitations from the members screen", () => {
    it("lets the owner invite a Professional", async () => {
      const response = await invite("owner", "ah05-professional@example.invalid", "professional");
      expect(response.status).toBe(201);
      expect(response.body.data.invitation).toMatchObject({ role: "professional" });
    });

    it("refuses an invitation that would create a second owner", async () => {
      const response = await invite("owner", "ah05-owner@example.invalid", "owner");
      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe("VALIDATION_ERROR");
      expect(await storedInvitation(householdId, "ah05-owner@example.invalid")).toBeUndefined();
    });

    it("returns the invitation id but never the token when inviting", async () => {
      const email = "ah05-token@example.invalid";
      const response = await invite("owner", email, "member").expect(201);
      const stored = await storedInvitation(householdId, email);

      expect(response.body.data).toEqual({
        invitation: {
          id: stored.id,
          email,
          role: "member",
          expiresAt: expect.any(String),
          createdAt: expect.any(String),
        },
      });
      expect(JSON.stringify(response.body)).not.toContain(stored.inviteCode);
    });

    it("never returns the token when resending", async () => {
      const email = "ah05-resend@example.invalid";
      await invite("owner", email, "member").expect(201);
      const stored = await storedInvitation(householdId, email);

      const response = await resend("owner", stored.id).expect(200);
      const after = await storedInvitation(householdId, email);
      expect(response.body.data.invitation).toMatchObject({ id: stored.id });
      expect(response.body.data).not.toHaveProperty("inviteUrl");
      expect(JSON.stringify(response.body)).not.toContain(after.inviteCode);
    });

    it("keeps an expired admin grant unchanged when an admin tries to resend it", async () => {
      const email = actor("joiner").email;
      await invite("owner", email, "admin").expect(201);
      const { id } = await storedInvitation(householdId, email);
      const expiredAt = new Date(Date.now() - 60_000);
      await db.update(householdInvitations).set({ expiresAt: expiredAt }).where(eq(householdInvitations.id, id));
      const before = await storedInvitation(householdId, email);

      await resend("admin", id).expect(403);
      expect(await storedInvitation(householdId, email)).toEqual(before);
      const audits = () => db.select().from(auditLogs).where(and(
        eq(auditLogs.entityId, id), eq(auditLogs.entityType, "household_invitation"), eq(auditLogs.action, "UPDATE"),
      ));
      expect(await audits()).toEqual([]);
      await accept("joiner", before.inviteCode).expect(409);
      expect(await membershipsOf(actor("joiner").id)).toEqual([]);

      const response = await resend("owner", id).expect(200);
      const renewed = await storedInvitation(householdId, email);
      expect(renewed.expiresAt.getTime()).toBeGreaterThan(Date.now());
      expect(renewed.inviteCode).not.toBe(before.inviteCode);
      expect(JSON.stringify(response.body)).not.toContain(renewed.inviteCode);
      expect(await audits()).toHaveLength(1);
      const accepted = await accept("joiner", renewed.inviteCode).expect(200);
      expect(accepted.body.data.role).toBe("admin");
    });

    it("rotates the code on resend: the old link fails like an unknown code, the new one joins, the audit has no code", async () => {
      const email = actor("joiner").email;
      await invite("owner", email, "member").expect(201);
      const before = await storedInvitation(householdId, email);
      // An almost-expired invitation: the resend must give it creation's full window again.
      await db.update(householdInvitations)
        .set({ expiresAt: new Date(Date.now() + 60 * 60 * 1000) })
        .where(eq(householdInvitations.id, before.id));

      await resend("owner", before.id).expect(200);
      const after = await storedInvitation(householdId, email);
      expect(after.id).toBe(before.id);
      expect(after.inviteCode).toMatch(/^[0-9a-f]{64}$/);
      expect(after.inviteCode).not.toBe(before.inviteCode);
      expect(after.expiresAt.getTime()).toBeGreaterThan(Date.now() + 6 * 24 * 60 * 60 * 1000);

      const unknown = await accept("joiner", "no-such-code");
      const stale = await accept("joiner", before.inviteCode);
      const withoutTimestamp = ({ timestamp: _, ...error }: Record<string, unknown>) => error;
      expect(stale.status).toBe(unknown.status);
      expect(unknown.status).toBe(404);
      expect(withoutTimestamp(stale.body.error)).toEqual(withoutTimestamp(unknown.body.error));
      expect(await membershipsOf(actor("joiner").id)).toEqual([]);

      await accept("joiner", after.inviteCode).expect(200);
      expect(await membershipsOf(actor("joiner").id)).toEqual([householdId]);

      const resendAudit = await db.select().from(auditLogs).where(and(
        eq(auditLogs.entityType, "household_invitation"),
        eq(auditLogs.entityId, before.id),
        eq(auditLogs.action, "UPDATE"),
      ));
      expect(resendAudit).toHaveLength(1);
      expect(resendAudit[0].details).toMatchObject({ action: "resend_invitation" });
      const auditText = JSON.stringify(resendAudit[0]);
      expect(auditText).not.toContain(before.inviteCode);
      expect(auditText).not.toContain(after.inviteCode);
      expect(auditText).not.toMatch(/inviteCode|invite_code/i);
    });
  });

  describe("AH-06 accepting an invitation", () => {
    it("lets one user join only one household when two accepts race", async () => {
      const [firstCode, secondCode] = await inviteJoinerToBoth();
      const results = await raceBehindHouseholdLocks<request.Response>(fixtureHouseholds, [
        accept("joiner", firstCode),
        accept("joiner", secondCode),
      ]);

      expect(results.map((res) => res.status).sort()).toEqual([200, 409]);
      const refused = results.find((res) => res.status === 409)!;
      expect(refused.body.error.code).toBe("CONFLICT");
      expect(await membershipsOf(actor("joiner").id)).toHaveLength(1);
      expect(await joinAudit()).toHaveLength(1);
    });

    it("refuses a second household once the user already belongs to one", async () => {
      const [firstCode, secondCode] = await inviteJoinerToBoth();
      await accept("joiner", firstCode).expect(200);

      const response = await accept("joiner", secondCode);
      expect(response.status).toBe(409);
      expect(await membershipsOf(actor("joiner").id)).toEqual([householdId]);
      expect((await storedInvitation(otherHouseholdId, actor("joiner").email)).acceptedAt).toBeNull();
    });

    it("refuses an expired or already used invitation and writes nothing", async () => {
      const [code, otherCode] = await inviteJoinerToBoth();
      await db.update(householdInvitations).set({ expiresAt: new Date(Date.now() - 60_000) })
        .where(eq(householdInvitations.inviteCode, code));
      const expired = await accept("joiner", code);
      expect(expired.status).toBe(409);
      expect(expired.body.error.message).toMatch(/expired/i);

      await accept("joiner", otherCode).expect(200);
      await db.delete(householdMembers).where(eq(householdMembers.userId, actor("joiner").id));
      const reused = await accept("joiner", otherCode);
      expect(reused.status).toBe(409);
      expect(reused.body.error.message).toMatch(/already been used/i);
      expect(await membershipsOf(actor("joiner").id)).toEqual([]);
    });

    it("refuses an invitation addressed to another email with 409 INVITE_RECIPIENT_MISMATCH and writes nothing", async () => {
      const invitedEmail = `ah-06-recipient-${randomUUID()}@example.invalid`;
      await invite("owner", invitedEmail, "member").expect(201);
      const invitation = await storedInvitation(householdId, invitedEmail);

      const response = await accept("joiner", invitation.inviteCode);
      expect(response.status).toBe(409);
      expect(response.body.error.code).toBe("INVITE_RECIPIENT_MISMATCH");
      expect(JSON.stringify(response.body)).not.toContain(invitedEmail);
      expect(await membershipsOf(actor("joiner").id)).toEqual([]);
      const after = await storedInvitation(householdId, invitedEmail);
      expect(after.acceptedAt).toBeNull();
      expect(after.acceptedBy).toBeNull();
      expect(await joinAudit()).toHaveLength(0);
    });

    it("answers 404 for an unknown code", async () => {
      const response = await accept("joiner", "no-such-code");
      expect(response.status).toBe(404);
      expect(response.body.error.code).toBe("NOT_FOUND");
    });

    it("writes the join audit row in the accept transaction and rolls back without it", async () => {
      const [code] = await inviteJoinerToBoth();
      const original = businessAuditService.log.bind(businessAuditService);
      vi.spyOn(businessAuditService, "log").mockImplementationOnce(async (entry) => {
        expect(entry.tx).toBeDefined();
        await original(entry);
        throw new Error("Synthetic AH-06 audit failure");
      });

      expect((await accept("joiner", code)).status).toBe(500);
      expect(await membershipsOf(actor("joiner").id)).toEqual([]);
      expect((await storedInvitation(householdId, actor("joiner").email)).acceptedAt).toBeNull();
      expect(await joinAudit()).toHaveLength(0);
    });

    it("audits a successful join with the invitation, never the token", async () => {
      const [code] = await inviteJoinerToBoth();
      await accept("joiner", code).expect(200);

      const audit = await joinAudit();
      expect(audit).toHaveLength(1);
      expect(audit[0]).toMatchObject({ action: "CREATE", userId: actor("joiner").id, entityId: actor("joiner").id });
      expect(JSON.stringify(audit[0].details)).not.toContain(code);
    });
  });
});
