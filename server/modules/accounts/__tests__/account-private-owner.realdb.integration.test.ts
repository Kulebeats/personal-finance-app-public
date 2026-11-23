/**
 * C3-19: an account update must never leave an account that no member can see.
 *
 * A private account is visible only to its owner, so after any update a private
 * account must have an owner who is a current member of the household. Real
 * HTTP (PUT /api/accounts/:id) against real Postgres. A-59 cases pause the
 * admitted handler before forwarding to the real service.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { and, eq, inArray } from "drizzle-orm";
import { db, pool } from "../../../db";
import { accounts, auditLogs, householdMembers, households, users } from "@shared/schema";
import { getTestApp } from "../../../__tests__/fixtures";
import { hashPassword } from "../../../auth";
import { accountService } from "../../../services/AccountService";

type Actor = "admin" | "member" | "outsider";
const householdId = randomUUID();
const foreignHouseholdId = randomUUID();
const fixtureHouseholds = [householdId, foreignHouseholdId];
const actors = new Map<Actor, { id: string; cookie: string }>();
const password = "SyntheticPrivateOwner123!";
let app: Awaited<ReturnType<typeof getTestApp>>;

const cookieOf = (actor: Actor) => actors.get(actor)!.cookie;
const idOf = (actor: Actor) => actors.get(actor)!.id;
const signed = (test: request.Test, actor: Actor) => test.set("Cookie", cookieOf(actor))
  .set("X-Capital-Subject", idOf(actor))
  .set("X-Capital-Household", actor === "outsider" ? foreignHouseholdId : householdId);
const put = (actor: Actor, accountId: string, body: Record<string, unknown>) =>
  signed(request(app).put(`/api/accounts/${accountId}`), actor).send(body);
const leave = () => signed(request(app).post("/api/household/leave"), "member");
const remove = () => signed(request(app).delete(`/api/household/members/${idOf("member")}`), "admin");
const privateAccountName = "Synthetic private departure account";

async function createPrivateAccount(): Promise<string> {
  const response = await signed(request(app).post("/api/accounts"), "member").send({
    name: privateAccountName, type: "checking", currency: "ZMW", initialBalance: "42.50", isPrivate: true,
  }).expect(201);
  return response.body.data.id as string;
}

async function seedAccount(fields: { isPrivate: boolean; ownerUserId: string | null }) {
  const id = randomUUID();
  await db.insert(accounts).values({
    id, householdId, name: "Synthetic custody account", type: "checking", currency: "ZMW",
    initialBalance: "10.00", balance: "10.00", ...fields,
  });
  return id;
}

async function readCustody(id: string) {
  const result = await pool.query<{ isPrivate: boolean; ownerUserId: string | null }>(
    'SELECT is_private AS "isPrivate", owner_user_id AS "ownerUserId" FROM accounts WHERE id = $1', [id],
  );
  expect(result.rows).toHaveLength(1);
  return result.rows[0];
}

function expectValidationError(response: request.Response, field: string) {
  expect(response.status).toBe(400);
  expect(response.body.success).toBe(false);
  expect(response.body.error.code).toBe("VALIDATION_ERROR");
  expect(response.body.error.fields).toEqual(expect.arrayContaining([expect.objectContaining({ field })]));
}

async function updateWithConcurrentRevocation(
  accountId: string, body: Record<string, unknown>, revoke: () => Promise<void>,
) {
  const admission = Promise.withResolvers<void>();
  const resume = Promise.withResolvers<void>();
  const update = accountService.updateAccount.bind(accountService);
  const pause = vi.spyOn(accountService, "updateAccount").mockImplementation(async (...args) => {
    if (args[0] === accountId) {
      admission.resolve();
      await resume.promise;
    }
    return update(...args);
  });
  const pending = put("member", accountId, body).timeout({ deadline: 12_000 }).then(response => response);
  try {
    // The real route has admitted the member and read the account for its audit.
    await Promise.race([admission.promise, pending.then(() => { throw new Error("Account update skipped admission gate"); })]);
    await revoke();
  } finally {
    resume.resolve();
    try {
      await pending;
    } finally {
      pause.mockRestore();
    }
  }
  return pending;
}

describe("C3-19 account update keeps every account visible to some member", () => {
  beforeAll(async () => {
    app = await getTestApp();
    await db.insert(households).values([
      { id: householdId, name: "Synthetic private owner" },
      { id: foreignHouseholdId, name: "Synthetic foreign household" },
    ]);
    const passwordHash = await hashPassword(password);
    for (const actor of ["admin", "member", "outsider"] as const) {
      const id = randomUUID();
      const email = `c3-19-${id}@example.invalid`;
      await db.insert(users).values({ id, email, username: `c3-19-${id}`, passwordHash, emailVerified: true });
      await db.insert(householdMembers).values({
        householdId: actor === "outsider" ? foreignHouseholdId : householdId,
        userId: id,
        role: actor === "outsider" ? "owner" : actor,
      });
      const login = await request(app).post("/api/auth/login").send({ email, password }).expect(200);
      actors.set(actor, { id, cookie: (login.headers["set-cookie"] as unknown as string[]).join("; ") });
    }
  }, 30000);

  beforeEach(async () => {
    await db.delete(auditLogs).where(inArray(auditLogs.householdId, fixtureHouseholds));
    await db.delete(accounts).where(inArray(accounts.householdId, fixtureHouseholds));
  });

  afterAll(async () => {
    await db.delete(auditLogs).where(inArray(auditLogs.householdId, fixtureHouseholds));
    await db.delete(accounts).where(inArray(accounts.householdId, fixtureHouseholds));
    await db.delete(households).where(inArray(households.id, fixtureHouseholds));
    for (const { id } of actors.values()) {
      await db.delete(auditLogs).where(eq(auditLogs.userId, id));
      await pool.query('DELETE FROM "session" WHERE sess->>\'userId\' = $1', [id]);
      await db.delete(users).where(eq(users.id, id));
    }
  });

  describe("refused", () => {
    it.each(["admin", "member"] as const)("making a Shared account private without an owner (%s)", async actor => {
      const accountId = await seedAccount({ isPrivate: false, ownerUserId: null });
      expectValidationError(await put(actor, accountId, { isPrivate: true }), "isPrivate");
      expect(await readCustody(accountId)).toEqual({ isPrivate: false, ownerUserId: null });
      // The account is still reachable by every member.
      await request(app).get(`/api/accounts/${accountId}`).set("Cookie", cookieOf("admin")).expect(200);
    });

    it("making a Shared account private with an explicit null owner", async () => {
      const accountId = await seedAccount({ isPrivate: false, ownerUserId: null });
      expectValidationError(await put("member", accountId, { isPrivate: true, ownerUserId: null }), "isPrivate");
      expect(await readCustody(accountId)).toEqual({ isPrivate: false, ownerUserId: null });
    });

    it("clearing the owner of a private account that stays private", async () => {
      const accountId = await seedAccount({ isPrivate: true, ownerUserId: idOf("member") });
      expectValidationError(await put("member", accountId, { ownerUserId: null }), "isPrivate");
      expect(await readCustody(accountId)).toEqual({ isPrivate: true, ownerUserId: idOf("member") });
    });

    it("assigning a non-member as owner of a Shared account", async () => {
      const accountId = await seedAccount({ isPrivate: false, ownerUserId: null });
      expectValidationError(await put("admin", accountId, { ownerUserId: idOf("outsider") }), "ownerUserId");
      expect(await readCustody(accountId)).toEqual({ isPrivate: false, ownerUserId: null });
    });

    it("assigning a non-member as owner while making the account private", async () => {
      const accountId = await seedAccount({ isPrivate: false, ownerUserId: idOf("member") });
      expectValidationError(await put("member", accountId, { isPrivate: true, ownerUserId: idOf("outsider") }), "ownerUserId");
      expect(await readCustody(accountId)).toEqual({ isPrivate: false, ownerUserId: idOf("member") });
    });

    it("handing a private account to a non-member", async () => {
      const accountId = await seedAccount({ isPrivate: true, ownerUserId: idOf("member") });
      expectValidationError(await put("member", accountId, { ownerUserId: idOf("outsider") }), "ownerUserId");
      expect(await readCustody(accountId)).toEqual({ isPrivate: true, ownerUserId: idOf("member") });
    });
  });

  describe("still allowed", () => {
    it("an owner making their own account private", async () => {
      const accountId = await seedAccount({ isPrivate: false, ownerUserId: idOf("member") });
      const response = await put("member", accountId, { isPrivate: true }).expect(200);
      expect(response.body.data).toMatchObject({ id: accountId, isPrivate: true, ownerUserId: idOf("member") });
      expect(await readCustody(accountId)).toEqual({ isPrivate: true, ownerUserId: idOf("member") });
      await request(app).get(`/api/accounts/${accountId}`).set("Cookie", cookieOf("member")).expect(200);
    });

    it("a member taking a Shared account private for themself in one request", async () => {
      const accountId = await seedAccount({ isPrivate: false, ownerUserId: null });
      await put("member", accountId, { isPrivate: true, ownerUserId: idOf("member") }).expect(200);
      expect(await readCustody(accountId)).toEqual({ isPrivate: true, ownerUserId: idOf("member") });
    });

    it("making a private account shared, keeping its owner", async () => {
      const accountId = await seedAccount({ isPrivate: true, ownerUserId: idOf("member") });
      await put("member", accountId, { isPrivate: false }).expect(200);
      expect(await readCustody(accountId)).toEqual({ isPrivate: false, ownerUserId: idOf("member") });
      await request(app).get(`/api/accounts/${accountId}`).set("Cookie", cookieOf("admin")).expect(200);
    });

    it("making a private account Shared with no owner", async () => {
      const accountId = await seedAccount({ isPrivate: true, ownerUserId: idOf("member") });
      await put("member", accountId, { isPrivate: false, ownerUserId: null }).expect(200);
      expect(await readCustody(accountId)).toEqual({ isPrivate: false, ownerUserId: null });
    });

    it("handing a private account to another current member", async () => {
      const accountId = await seedAccount({ isPrivate: true, ownerUserId: idOf("member") });
      await put("member", accountId, { ownerUserId: idOf("admin") }).expect(200);
      expect(await readCustody(accountId)).toEqual({ isPrivate: true, ownerUserId: idOf("admin") });
    });

    it("an unrelated edit of a Shared account", async () => {
      const accountId = await seedAccount({ isPrivate: false, ownerUserId: null });
      const response = await put("member", accountId, { name: "Renamed custody account" }).expect(200);
      expect(response.body.data).toMatchObject({ name: "Renamed custody account", isPrivate: false, ownerUserId: null });
    });
  });

  describe("A-59 private account custody blocks household departure", () => {
    const scope = () => and(eq(householdMembers.householdId, householdId), eq(householdMembers.userId, idOf("member")));
    const membership = () => db.select().from(householdMembers).where(scope());
    const departureAudits = () => db.select().from(auditLogs).where(and(
      eq(auditLogs.householdId, householdId), eq(auditLogs.entityId, idOf("member")), eq(auditLogs.entityType, "user"),
    ));
    const accountState = (id: string) => db.select().from(accounts).where(eq(accounts.id, id));

    it("refuses voluntary departure without writes and permits it after a signed soft deletion", async () => {
      const id = await createPrivateAccount();
      const [member] = await membership();
      expect(member).toBeDefined();
      try {
        const stored = await accountState(id);
        expect(stored).toMatchObject([{ isPrivate: true, ownerUserId: idOf("member"), deletedAt: null, balance: "42.50" }]);
        const refused = await leave().expect(409);
        expect(refused.body).toMatchObject({ success: false, error: {
          code: "PRIVATE_ACCOUNTS_PREVENT_LEAVING", message: expect.stringMatching(/private accounts.+share.+transfer.+delete/i),
        } });
        expect(await membership()).toEqual([member]);
        expect(await accountState(id)).toEqual(stored);
        expect(await departureAudits()).toEqual([]);

        await signed(request(app).post("/api/settings/security/step-up"), "member").send({ password }).expect(200);
        await signed(request(app).delete(`/api/accounts/${id}`), "member").expect(200);
        await signed(request(app).get(`/api/accounts/${id}`), "member").expect(404);
        await leave().expect(200);
        expect(await membership()).toEqual([]);
        expect(await accountState(id)).toMatchObject([{ isPrivate: true, ownerUserId: idOf("member"), deletedAt: expect.any(Date) }]);
        expect(await departureAudits()).toEqual([expect.objectContaining({
          userId: idOf("member"), action: "DELETE", details: { action: "self_removal", role: "member" },
        })]);
      } finally {
        await db.insert(householdMembers).values(member).onConflictDoNothing();
      }
    });

    it("refuses forced removal without account details and permits it after the member shares the account", async () => {
      const id = await createPrivateAccount();
      const [member] = await membership();
      expect(member).toBeDefined();
      try {
        const stored = await accountState(id);
        await signed(request(app).get(`/api/accounts/${id}`), "admin").expect(404);
        const refused = await remove().expect(409);
        expect(refused.body).toEqual({ success: false, error: {
          code: "PRIVATE_ACCOUNTS_PREVENT_REMOVAL",
          message: "This member must resolve their private accounts before they can be removed.",
          timestamp: expect.any(String),
        } });
        for (const detail of [id, privateAccountName, "checking", "42.50", "ZMW"]) expect(refused.text).not.toContain(detail);
        expect(await membership()).toEqual([member]);
        expect(await accountState(id)).toEqual(stored);
        expect(await departureAudits()).toEqual([]);

        await put("member", id, { isPrivate: false, ownerUserId: null }).expect(200);
        const shared = await accountState(id);
        expect(shared).toMatchObject([{ isPrivate: false, ownerUserId: null, balance: "42.50" }]);
        await remove().expect(200);
        expect(await membership()).toEqual([]);
        expect(await accountState(id)).toEqual(shared);
        expect(await departureAudits()).toEqual([expect.objectContaining({
          userId: idOf("admin"), action: "DELETE", details: expect.objectContaining({ action: "member_removed" }),
        })]);
        await signed(request(app).get(`/api/accounts/${id}`), "admin").expect(200);
      } finally {
        await db.insert(householdMembers).values(member).onConflictDoNothing();
      }
    });
  });

  describe("A-59 checks the current signed grant before changing account custody", () => {
    const memberScope = () => and(eq(householdMembers.householdId, householdId), eq(householdMembers.userId, idOf("member")));
    const accountAudit = (accountId: string) => db.select().from(auditLogs).where(and(
      eq(auditLogs.entityId, accountId), eq(auditLogs.entityType, "account"),
    ));

    it("stops an admitted member from taking custody after a lawful forced removal", async () => {
      const accountId = await seedAccount({ isPrivate: false, ownerUserId: null });
      const otherPrivate = await seedAccount({ isPrivate: true, ownerUserId: idOf("admin") });
      const [membership] = await db.select().from(householdMembers).where(memberScope());
      try {
        const refused = await updateWithConcurrentRevocation(accountId, { isPrivate: true, ownerUserId: idOf("member") }, async () => {
          await remove().expect(200);
          expect(await db.select().from(householdMembers).where(memberScope())).toEqual([]);
        });
        expect(refused.status).toBe(403);
        expect(refused.body.error.code).toBe("FORBIDDEN");
        expect(await readCustody(accountId)).toEqual({ isPrivate: false, ownerUserId: null });
        expect(await readCustody(otherPrivate)).toEqual({ isPrivate: true, ownerUserId: idOf("admin") });
        expect(await accountAudit(accountId)).toEqual([]);
      } finally {
        await db.insert(householdMembers).values(membership).onConflictDoNothing();
      }
    });

    it("stops an admitted member from transferring custody after becoming read-only", async () => {
      const accountId = await seedAccount({ isPrivate: true, ownerUserId: idOf("member") });
      try {
        const refused = await updateWithConcurrentRevocation(accountId, { ownerUserId: idOf("admin") }, async () => {
          const downgraded = await signed(request(app).put(`/api/household/members/${idOf("member")}/role`), "admin")
            .send({ role: "view_only" }).expect(200);
          expect(downgraded.body.data.member.role).toBe("view_only");
        });
        expect(refused.status).toBe(403);
        expect(refused.body.error.code).toBe("FORBIDDEN");
        expect(await readCustody(accountId)).toEqual({ isPrivate: true, ownerUserId: idOf("member") });
        expect(await accountAudit(accountId)).toEqual([]);
      } finally {
        await db.update(householdMembers).set({ role: "member" }).where(memberScope());
      }

      const accepted = await put("member", accountId, { ownerUserId: idOf("admin") }).expect(200);
      expect(accepted.body.data).toMatchObject({ isPrivate: true, ownerUserId: idOf("admin"), balance: "10.00" });
      expect(await readCustody(accountId)).toEqual({ isPrivate: true, ownerUserId: idOf("admin") });
    });
  });
});
