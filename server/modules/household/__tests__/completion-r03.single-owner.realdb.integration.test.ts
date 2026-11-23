/**
 * NEW-12 (P0): a household always has exactly one owner.
 *
 * Real HTTP against real Postgres, no mocks of the write path. Before the fix:
 * an owner could transfer ownership to themselves (200, household left with no
 * owner), an owner could promote a second owner through the role route, and that
 * second owner could then demote the first. The database did not stop either.
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
import { getPostgresError } from "../../../utils/postgresError";
import { raceBehindHouseholdLocks } from "./householdLockBarrier";

// "invitee" belongs to no household; "outsider" owns another one.
const ACTORS = ["owner", "admin", "deputy", "member", "viewer", "outsider", "invitee"] as const;
type Actor = (typeof ACTORS)[number];
type Role = "owner" | "admin" | "member" | "view_only";
const START_ROLES: Record<Exclude<Actor, "outsider" | "invitee">, Role> = {
  owner: "owner",
  admin: "admin",
  deputy: "admin",
  member: "member",
  viewer: "view_only",
};

const householdId = randomUUID();
const foreignHouseholdId = randomUUID();
const fixtureHouseholds = [householdId, foreignHouseholdId];
const actors = new Map<Actor, { id: string; email: string; cookie: string }>();
const password = "SyntheticSingleOwner123!";
let app: Awaited<ReturnType<typeof getTestApp>>;

const idOf = (actor: Actor) => actors.get(actor)!.id;
const cookieOf = (actor: Actor) => actors.get(actor)!.cookie;
const transfer = (actor: Actor, newOwnerId: string) =>
  request(app).post("/api/household/transfer-ownership").set("Cookie", cookieOf(actor)).send({ newOwnerId });
const changeRole = (actor: Actor, target: Actor, role: string) =>
  request(app).put(`/api/household/members/${idOf(target)}/role`).set("Cookie", cookieOf(actor)).send({ role });
const remove = (actor: Actor, target: Actor) =>
  request(app).delete(`/api/household/members/${idOf(target)}`).set("Cookie", cookieOf(actor));
const leave = (actor: Actor) =>
  request(app).post("/api/household/leave").set("Cookie", cookieOf(actor));

/** userId → role for household H, read straight from the table. */
async function rolesInHousehold(): Promise<Record<string, string>> {
  const rows = await db
    .select({ userId: householdMembers.userId, role: householdMembers.role })
    .from(householdMembers)
    .where(eq(householdMembers.householdId, householdId));
  return Object.fromEntries(rows.map((r) => [r.userId, r.role]));
}

const startingRoles = () =>
  Object.fromEntries(
    Object.entries(START_ROLES).map(([actor, role]) => [idOf(actor as Actor), role]),
  );

async function ownersOf(id: string): Promise<string[]> {
  const rows = await db
    .select({ userId: householdMembers.userId })
    .from(householdMembers)
    .where(and(eq(householdMembers.householdId, id), eq(householdMembers.role, "owner")));
  return rows.map((r) => r.userId!);
}

const memberAudit = () =>
  db.select().from(auditLogs)
    .where(and(eq(auditLogs.householdId, householdId), eq(auditLogs.entityType, "user")));

function expectError(response: request.Response, status: number, code: string) {
  expect(response.status).toBe(status);
  expect(response.body.success).toBe(false);
  expect(response.body.error.code).toBe(code);
}

/** The refusal changed nothing: same roles, one owner, no member audit row. */
async function expectUnchanged() {
  expect(await rolesInHousehold()).toEqual(startingRoles());
  expect(await ownersOf(householdId)).toEqual([idOf("owner")]);
  expect(await memberAudit()).toHaveLength(0);
}

/**
 * Start every request, prove they are all queued on household H's row lock,
 * then release them together, so the race genuinely overlaps.
 */
function raceBehindHouseholdLock(requests: request.Test[]): Promise<request.Response[]> {
  return raceBehindHouseholdLocks<request.Response>([householdId], requests);
}

describe("NEW-12 a household always has exactly one owner", () => {
  beforeAll(async () => {
    app = await getTestApp();
    await db.insert(households).values([
      { id: householdId, name: "Synthetic single owner" },
      { id: foreignHouseholdId, name: "Synthetic foreign household" },
    ]);
    const passwordHash = await hashPassword(password);
    for (const actor of ACTORS) {
      const id = randomUUID();
      const email = `new-12-${id}@example.invalid`;
      await db.insert(users).values({ id, email, username: `new-12-${id}`, passwordHash, emailVerified: true });
      if (actor !== "invitee") {
        await db.insert(householdMembers).values({
          householdId: actor === "outsider" ? foreignHouseholdId : householdId,
          userId: id,
          role: actor === "outsider" ? "owner" : START_ROLES[actor],
        });
      }
      const login = await request(app).post("/api/auth/login").send({ email, password }).expect(200);
      actors.set(actor, { id, email, cookie: (login.headers["set-cookie"] as unknown as string[]).join("; ") });
    }
  }, 30000);

  beforeEach(async () => {
    await db.delete(auditLogs).where(inArray(auditLogs.householdId, fixtureHouseholds));
    await db.delete(householdInvitations).where(eq(householdInvitations.householdId, householdId));
    await db.delete(householdMembers).where(eq(householdMembers.householdId, householdId));
    await db.insert(householdMembers).values(
      Object.entries(START_ROLES).map(([actor, role]) => ({ householdId, userId: idOf(actor as Actor), role })),
    );
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

  describe("ownership transfer", () => {
    it("refuses a transfer to yourself and changes nothing", async () => {
      const response = await transfer("owner", idOf("owner"));
      expectError(response, 400, "VALIDATION_ERROR");
      expect(response.body.error.fields).toEqual([expect.objectContaining({ field: "newOwnerId" })]);
      await expectUnchanged();
    });

    it("refuses a transfer to a user of another household", async () => {
      expectError(await transfer("owner", idOf("outsider")), 400, "VALIDATION_ERROR");
      await expectUnchanged();
      expect(await ownersOf(foreignHouseholdId)).toEqual([idOf("outsider")]);
    });

    it("refuses a transfer to an id that is not a user", async () => {
      expectError(await transfer("owner", randomUUID()), 400, "VALIDATION_ERROR");
      await expectUnchanged();
    });

    it("refuses a transfer started by an admin", async () => {
      expectError(await transfer("admin", idOf("member")), 403, "FORBIDDEN");
      await expectUnchanged();
    });

    it("hands ownership to a member, demotes the old owner to admin, and audits it", async () => {
      const response = await transfer("owner", idOf("member")).expect(200);
      expect(response.body).toEqual({ success: true, data: { transferred: true } });

      expect(await rolesInHousehold()).toEqual({
        ...startingRoles(),
        [idOf("owner")]: "admin",
        [idOf("member")]: "owner",
      });
      const audit = await memberAudit();
      expect(audit).toHaveLength(1);
      expect(audit[0]).toMatchObject({ action: "TRANSFER", userId: idOf("owner"), entityId: idOf("member") });
      expect(audit[0].details).toMatchObject({
        action: "ownership_transfer",
        fromUserId: idOf("owner"),
        toUserId: idOf("member"),
        previousRoleOfNewOwner: "member",
      });

      // The new owner now holds the owner-only action; the old one does not.
      expectError(await transfer("owner", idOf("admin")), 403, "FORBIDDEN");
      await transfer("member", idOf("owner")).expect(200);
      expect(await ownersOf(householdId)).toEqual([idOf("owner")]);
    });

    it("ends with exactly one owner when two transfers race", async () => {
      const [first, second] = await raceBehindHouseholdLock([
        transfer("owner", idOf("admin")),
        transfer("owner", idOf("member")),
      ]);
      const statuses = [first.status, second.status].sort();
      expect(statuses).toEqual([200, 403]);

      const owners = await ownersOf(householdId);
      expect(owners).toHaveLength(1);
      expect([idOf("admin"), idOf("member")]).toContain(owners[0]);
      expect((await rolesInHousehold())[idOf("owner")]).toBe("admin");
      expect((await memberAudit()).filter((row) => row.action === "TRANSFER")).toHaveLength(1);
    });

    it("never leaves the household ownerless when a transfer races the new owner leaving", async () => {
      const [transferred, left] = await raceBehindHouseholdLock([
        transfer("owner", idOf("admin")),
        leave("admin"),
      ]);
      const outcome = [transferred.status, left.status];
      // Transfer first: the admin is now owner and may not leave (403).
      // Leave first: the admin is gone, so the transfer target is not a member (400).
      expect([[200, 403], [400, 200]]).toContainEqual(outcome);

      const roles = await rolesInHousehold();
      const owners = await ownersOf(householdId);
      expect(owners).toHaveLength(1);
      expect(roles[owners[0]]).toBe("owner");
      expect(owners[0]).toBe(outcome[0] === 200 ? idOf("admin") : idOf("owner"));
    });

    it("rolls the transfer back when its audit row cannot be written", async () => {
      const original = businessAuditService.log.bind(businessAuditService);
      vi.spyOn(businessAuditService, "log").mockImplementationOnce(async (entry) => {
        expect(entry.tx).toBeDefined();
        await original(entry);
        throw new Error("Synthetic NEW-12 audit failure");
      });
      expect((await transfer("owner", idOf("member"))).status).toBe(500);
      await expectUnchanged();
    });
  });

  describe("role changes never add or remove an owner", () => {
    it("refuses to promote a second owner", async () => {
      expectError(await changeRole("owner", "member", "owner"), 409, "CONFLICT");
      await expectUnchanged();
    });

    it("refuses to let an admin promote an owner", async () => {
      expectError(await changeRole("admin", "member", "owner"), 409, "CONFLICT");
      await expectUnchanged();
    });

    it("refuses to demote the owner", async () => {
      expectError(await changeRole("admin", "owner", "member"), 403, "FORBIDDEN");
      await expectUnchanged();
    });

    it("refuses to change your own role", async () => {
      expectError(await changeRole("owner", "owner", "admin"), 400, "VALIDATION_ERROR");
      await expectUnchanged();
    });

    it("refuses a role change by a member or a view-only user", async () => {
      expectError(await changeRole("member", "viewer", "member"), 403, "FORBIDDEN");
      expectError(await changeRole("viewer", "member", "view_only"), 403, "FORBIDDEN");
      await expectUnchanged();
    });

    it("returns 404 for someone who is not in the household", async () => {
      expectError(await changeRole("owner", "outsider", "member"), 404, "NOT_FOUND");
      await expectUnchanged();
      expect(await ownersOf(foreignHouseholdId)).toEqual([idOf("outsider")]);
    });

    it("still lets an owner or admin change a non-owner's role, with an audit row", async () => {
      const response = await changeRole("owner", "member", "admin").expect(200);
      expect(response.body.data.member).toMatchObject({ userId: idOf("member"), role: "admin" });
      await changeRole("admin", "viewer", "member").expect(200);

      expect(await rolesInHousehold()).toEqual({
        ...startingRoles(),
        [idOf("member")]: "admin",
        [idOf("viewer")]: "member",
      });
      const audit = await memberAudit();
      expect(audit).toHaveLength(2);
      expect(audit.map((row) => row.action)).toEqual(["UPDATE", "UPDATE"]);
      expect(audit.find((row) => row.entityId === idOf("member"))?.details).toMatchObject({
        oldValue: { role: "member" },
        newValue: { role: "admin" },
        action: "role_change",
      });
    });
  });

  describe("only the owner grants or removes admin (spec §A3)", () => {
    it("refuses an admin granting admin, demoting an admin or removing an admin", async () => {
      expectError(await changeRole("admin", "member", "admin"), 403, "FORBIDDEN");
      expectError(await changeRole("admin", "deputy", "member"), 403, "FORBIDDEN");
      expectError(await changeRole("admin", "deputy", "professional"), 403, "FORBIDDEN");
      expectError(await remove("admin", "deputy"), 403, "FORBIDDEN");
      await expectUnchanged();
    });

    it("lets the owner grant admin, demote an admin and remove an admin", async () => {
      await changeRole("owner", "member", "admin").expect(200);
      await changeRole("owner", "admin", "member").expect(200);
      await remove("owner", "deputy").expect(200);

      expect(await rolesInHousehold()).toEqual({
        [idOf("owner")]: "owner",
        [idOf("admin")]: "member",
        [idOf("member")]: "admin",
        [idOf("viewer")]: "view_only",
      });
      expect((await memberAudit()).map((row) => row.action).sort()).toEqual(["DELETE", "UPDATE", "UPDATE"]);
    });

    it("lets an admin manage member, view-only and Professional", async () => {
      const professional = await changeRole("admin", "member", "professional").expect(200);
      expect(professional.body.data.member).toMatchObject({ userId: idOf("member"), role: "professional" });
      await changeRole("admin", "member", "view_only").expect(200);
      await remove("admin", "viewer").expect(200);

      expect(await rolesInHousehold()).toEqual({
        [idOf("owner")]: "owner",
        [idOf("admin")]: "admin",
        [idOf("deputy")]: "admin",
        [idOf("member")]: "view_only",
      });
      expect((await memberAudit()).map((row) => row.action).sort()).toEqual(["DELETE", "UPDATE", "UPDATE"]);
    });
  });

  describe("admin invitations are owner-only too (spec §A3)", () => {
    const invite = (actor: Actor, role: string) =>
      request(app).post("/api/household/invite").set("Cookie", cookieOf(actor))
        .send({ email: actors.get("invitee")!.email, role });
    const invitations = () =>
      db.select().from(householdInvitations).where(eq(householdInvitations.householdId, householdId));
    const accept = async () => {
      const [invitation] = await invitations();
      return request(app).post("/api/household/invite/accept").set("Cookie", cookieOf("invitee"))
        .send({ inviteCode: invitation.inviteCode });
    };
    const joinAudit = () => db.select().from(auditLogs)
      .where(and(eq(auditLogs.householdId, householdId), eq(auditLogs.entityType, "household_member")));

    it("refuses an admin inviting an admin and writes no invitation", async () => {
      expectError(await invite("admin", "admin"), 403, "FORBIDDEN");
      expect(await invitations()).toHaveLength(0);
      await expectUnchanged();
    });

    it("still lets an admin invite a member", async () => {
      await invite("admin", "member").expect(201);
      expect(await invitations()).toEqual([expect.objectContaining({ role: "member", invitedBy: idOf("admin") })]);
    });

    it("lets the owner invite an admin who joins as admin, with an audit row", async () => {
      await invite("owner", "admin").expect(201);
      const accepted = await accept();
      expect(accepted.status).toBe(200);
      expect(accepted.body.success).toBe(true);

      expect(await rolesInHousehold()).toEqual({ ...startingRoles(), [idOf("invitee")]: "admin" });
      expect(await ownersOf(householdId)).toEqual([idOf("owner")]);
      const audit = await joinAudit();
      expect(audit).toHaveLength(1);
      expect(audit[0]).toMatchObject({ action: "CREATE", userId: idOf("invitee"), entityId: idOf("invitee") });
      expect(audit[0].details).toMatchObject({ role: "admin", invitedBy: idOf("owner") });
    });

    it("refuses an admin invitation whose sender lost ownership before it was accepted", async () => {
      await invite("owner", "admin").expect(201);
      await transfer("owner", idOf("member")).expect(200);

      expectError(await accept(), 409, "CONFLICT");
      expect(await rolesInHousehold()).not.toHaveProperty(idOf("invitee"));
      expect(await ownersOf(householdId)).toEqual([idOf("member")]);
      const [invitation] = await invitations();
      expect(invitation).toMatchObject({ acceptedAt: null, acceptedBy: null });
      expect(await joinAudit()).toHaveLength(0);
    });
  });

  describe("removal and leaving never leave the household without its owner", () => {
    it("refuses to remove the owner", async () => {
      expectError(await remove("admin", "owner"), 403, "FORBIDDEN");
      await expectUnchanged();
    });

    it("refuses to let the owner remove themselves", async () => {
      expectError(await remove("owner", "owner"), 400, "VALIDATION_ERROR");
      await expectUnchanged();
    });

    it("refuses to let the owner leave before transferring", async () => {
      expectError(await leave("owner"), 403, "FORBIDDEN");
      await expectUnchanged();
    });

    it("removes a member and lets a member leave, each with an audit row", async () => {
      await remove("admin", "viewer").expect(200);
      await leave("member").expect(200);

      expect(await rolesInHousehold()).toEqual({
        [idOf("owner")]: "owner",
        [idOf("admin")]: "admin",
        [idOf("deputy")]: "admin",
      });
      const audit = await memberAudit();
      expect(audit.map((row) => [row.action, row.entityId]).sort()).toEqual(
        [["DELETE", idOf("member")], ["DELETE", idOf("viewer")]].sort(),
      );
    });
  });

  describe("a household whose only member is its owner", () => {
    // "outsider" is the sole member of the foreign household.
    it("keeps its owner through every self-directed exit or demotion", async () => {
      expectError(await leave("outsider"), 403, "FORBIDDEN");
      expectError(await transfer("outsider", idOf("outsider")), 400, "VALIDATION_ERROR");
      expectError(await remove("outsider", "outsider"), 400, "VALIDATION_ERROR");
      expectError(await changeRole("outsider", "outsider", "admin"), 400, "VALIDATION_ERROR");

      const members = await db.select({ userId: householdMembers.userId, role: householdMembers.role })
        .from(householdMembers).where(eq(householdMembers.householdId, foreignHouseholdId));
      expect(members).toEqual([{ userId: idOf("outsider"), role: "owner" }]);
      const audit = await db.select().from(auditLogs).where(eq(auditLogs.householdId, foreignHouseholdId));
      expect(audit).toHaveLength(0);
    });
  });

  describe("database backstop", () => {
    it("rejects a second owner row written directly", async () => {
      const failure: unknown = await db.update(householdMembers).set({ role: "owner" })
        .where(and(eq(householdMembers.householdId, householdId), eq(householdMembers.userId, idOf("admin"))))
        .then(() => null, (error: unknown) => error);
      expect(getPostgresError(failure)).toMatchObject({ code: "23505", constraint: "household_members_one_owner" });
      await expectUnchanged();
    });
  });
});
