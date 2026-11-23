import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { eq, inArray } from "drizzle-orm";
import { db, pool } from "../../../db";
import { accounts, auditLogs, categories, householdMembers, households, outboxEvents, tags, transactions, transactionTags, users } from "@shared/schema";
import { getTestApp } from "../../../__tests__/fixtures";
import { hashPassword } from "../../../auth";

const roles = ["owner", "admin", "member", "view_only", "professional"] as const;
type Role = (typeof roles)[number];
const householdId = randomUUID(), foreignHouseholdId = randomUUID();
const fixtureHouseholds = [householdId, foreignHouseholdId];
const actors = new Map<Role | "outsider", { id: string; cookie: string }>();
const password = "SyntheticSharedOwner123!";
let app: Awaited<ReturnType<typeof getTestApp>>;
const input = { name: "Shared-owner HTTP proof", type: "checking", currency: "ZMW", initialBalance: "42.50", isPrivate: false };
const post = (role: Role, changes: Record<string, unknown> = {}) => request(app).post("/api/accounts")
  .set("Cookie", actors.get(role)!.cookie)
  .set("X-Capital-Subject", actors.get(role)!.id)
  .set("X-Capital-Household", householdId)
  .send({ ...input, ...changes });

async function snapshot() {
  return {
    accounts: await db.select().from(accounts).where(inArray(accounts.householdId, fixtureHouseholds)).orderBy(accounts.id),
    transactions: await db.select().from(transactions).where(inArray(transactions.householdId, fixtureHouseholds)).orderBy(transactions.id),
    audit: await db.select().from(auditLogs).where(inArray(auditLogs.householdId, fixtureHouseholds)).orderBy(auditLogs.id),
    outbox: await db.select().from(outboxEvents).where(inArray(outboxEvents.householdId, fixtureHouseholds)).orderBy(outboxEvents.id),
  };
}
async function readCreated(id: string) {
  const result = await pool.query<{ id: string; householdId: string; ownerUserId: string | null; isPrivate: boolean; balance: string; initialBalance: string }>(
    'SELECT id, household_id AS "householdId", owner_user_id AS "ownerUserId", is_private AS "isPrivate", balance, initial_balance AS "initialBalance" FROM accounts WHERE id = $1', [id],
  );
  expect(result.rows).toHaveLength(1);
  return result.rows[0];
}

describe("R04 Shared account owner over signed HTTP and disposable SQL", () => {
  beforeAll(async () => {
    app = await getTestApp();
    await db.insert(households).values([{ id: householdId, name: "Synthetic Shared owner" }, { id: foreignHouseholdId, name: "Synthetic foreign owner" }]);
    const passwordHash = await hashPassword(password);
    for (const role of [...roles, "outsider"] as const) {
      const id = randomUUID(), email = `r04-shared-${id}@example.invalid`;
      actors.set(role, { id, cookie: "" });
      await db.insert(users).values({ id, email, username: `r04-shared-${id}`, passwordHash, emailVerified: true });
      await db.insert(householdMembers).values({ householdId: role === "outsider" ? foreignHouseholdId : householdId, userId: id, role: role === "outsider" ? "owner" : role });
      const login = await request(app).post("/api/auth/login").send({ email, password }).expect(200);
      actors.get(role)!.cookie = (login.headers["set-cookie"] as unknown as string[]).join("; ");
    }
    await db.insert(accounts).values({ householdId: foreignHouseholdId, name: "Foreign account unchanged", type: "checking", currency: "ZMW", initialBalance: "13.00", balance: "13.00", ownerUserId: actors.get("outsider")!.id });
  }, 30000);

  beforeEach(async () => {
    await db.delete(auditLogs).where(eq(auditLogs.householdId, householdId));
    await db.delete(accounts).where(eq(accounts.householdId, householdId));
  });

  afterAll(async () => {
    await db.delete(transactions).where(inArray(transactions.householdId, fixtureHouseholds));
    await db.delete(auditLogs).where(inArray(auditLogs.householdId, fixtureHouseholds));
    await db.delete(households).where(inArray(households.id, fixtureHouseholds));
    for (const { id } of actors.values()) {
      await db.delete(auditLogs).where(eq(auditLogs.userId, id));
      await pool.query('DELETE FROM "session" WHERE sess->>\'userId\' = $1', [id]);
      await db.delete(users).where(eq(users.id, id));
    }
  });

  it.each(["owner", "admin", "member"] as const)("persists explicit null as Shared for %s, with API and independent SQL readback", async role => {
    const response = await post(role, { ownerUserId: null }).expect(201);
    expect(response.body.data).toMatchObject({ householdId, ownerUserId: null, isPrivate: false });
    expect(await readCreated(response.body.data.id)).toMatchObject({ householdId, ownerUserId: null, isPrivate: false, initialBalance: "42.50", balance: "42.50" });
    const audit = await pool.query<{ details: { newValue?: { ownerUserId?: string | null; assignedToOther?: boolean } } }>(
      'SELECT details FROM audit_logs WHERE entity_id = $1 AND entity_type = \'account\' AND action = \'CREATE\'', [response.body.data.id],
    );
    expect(audit.rows.find(row => Object.hasOwn(row.details.newValue ?? {}, "ownerUserId"))?.details.newValue)
      .toMatchObject({ ownerUserId: null, assignedToOther: false });
    const shared = await request(app).get("/api/accounts?ownerUserId=shared").set("Cookie", actors.get("member")!.cookie).expect(200);
    expect(shared.body.data.map((row: { id: string }) => row.id)).toContain(response.body.data.id);
  });

  it.each(["omitted", "explicit self"] as const)("defaults to the actor only for %s ownership", async mode => {
    const ownerUserId = actors.get("member")!.id;
    const response = await post("member", mode === "omitted" ? {} : { ownerUserId }).expect(201);
    expect(response.body.data.ownerUserId).toBe(ownerUserId);
    expect(await readCreated(response.body.data.id)).toMatchObject({ householdId, ownerUserId, isPrivate: false });
    const shared = await request(app).get("/api/accounts?ownerUserId=shared").set("Cookie", actors.get("member")!.cookie).expect(200);
    expect(shared.body.data.map((row: { id: string }) => row.id)).not.toContain(response.body.data.id);
  });

  it.each(["owner", "admin"] as const)("preserves %s assignment to a current household member", async role => {
    const ownerUserId = actors.get("member")!.id;
    const response = await post(role, { ownerUserId }).expect(201);
    expect(response.body.data.ownerUserId).toBe(ownerUserId);
    expect(await readCreated(response.body.data.id)).toMatchObject({ householdId, ownerUserId });
  });

  it("exports only visible transactions on a shared account, including the caller's own private rows", async () => {
    const accountId = randomUUID();
    await db.insert(accounts).values({ id: accountId, householdId, name: "Shared account", type: "checking", currency: "ZMW" });
    const shared = { householdId, accountId, type: "expense" as const, currency: "ZMW", date: "2026-10-01", amount: "12.34" };
    const publicId = randomUUID(), categoryId = randomUUID(), foreignTag = randomUUID(), localTag = randomUUID();
    await db.insert(categories).values({ id: categoryId, householdId: foreignHouseholdId, name: "Foreign category", displayOrder: 1 });
    await db.insert(tags).values([{ id: foreignTag, householdId: foreignHouseholdId, name: "Foreign tag" }, { id: localTag, householdId, name: "Visible tag" }]);
    await db.insert(transactions).values([
      { ...shared, id: publicId, categoryId, name: "Public purchase", isPrivate: false },
      { ...shared, name: "Owner-only purchase", ownerUserId: actors.get("owner")!.id, isPrivate: true },
      { ...shared, name: "Member-only purchase", ownerUserId: actors.get("member")!.id, isPrivate: true },
      { ...shared, name: "Outside the requested dates", date: "2026-09-30" },
    ]);
    await db.insert(transactionTags).values([foreignTag, localTag].map(tagId => ({ tagId, transactionId: publicId })));
    for (const role of ["owner", "admin", "member"] as const) {
      const response = await request(app).get(`/api/accounts/${accountId}/transactions/export?startDate=2026-10-01&endDate=2026-10-01`)
        .set("Cookie", actors.get(role)!.cookie).expect(200);
      expect(response.text).toContain("Public purchase");
      expect(response.text).toContain("Visible tag");
      expect(response.text).not.toMatch(/Foreign (category|tag)/);
      expect(response.text).not.toContain("Outside the requested dates");
      expect(response.text.includes("Owner-only purchase")).toBe(role === "owner");
      expect(response.text.includes("Member-only purchase")).toBe(role === "member");
    }
  });

  it.each(["view_only", "professional"] as const)("keeps household financial downloads outside the %s read grant", async role => {
    const accountId = randomUUID();
    await db.insert(accounts).values({ id: accountId, householdId, name: "Visible account", type: "checking", currency: "ZMW" });
    const cookie = actors.get(role)!.cookie;
    await request(app).get(`/api/accounts/${accountId}`).set("Cookie", cookie).expect(200);
    await request(app).get("/api/accounts/summary/export").set("Cookie", cookie).expect(403);
    for (const suffix of ["transactions/export", "balance-history/export"]) {
      await request(app).get(`/api/accounts/${accountId}/${suffix}`).set("Cookie", cookie).expect(403);
    }
  });

  it("rejects a member assigning another owner without any business-state change", async () => {
    const before = await snapshot();
    await post("member", { ownerUserId: actors.get("owner")!.id }).expect(403);
    expect(await snapshot()).toEqual(before);
  });

  it("rejects an administrator assigning a nonmember without any business-state change", async () => {
    const before = await snapshot();
    await post("admin", { ownerUserId: actors.get("outsider")!.id }).expect(400);
    expect(await snapshot()).toEqual(before);
  });

  it("rejects private plus explicit Shared without creating an account or audit", async () => {
    const before = await snapshot();
    await post("member", { ownerUserId: null, isPrivate: true }).expect(400);
    expect(await snapshot()).toEqual(before);
  });

  it("preserves private ownership when omitted and keeps it invisible to other members", async () => {
    const ownerUserId = actors.get("member")!.id;
    const response = await post("member", { isPrivate: true }).expect(201);
    expect(await readCreated(response.body.data.id)).toMatchObject({ householdId, ownerUserId, isPrivate: true });
    await request(app).get(`/api/accounts/${response.body.data.id}`).set("Cookie", actors.get("admin")!.cookie).expect(404);
    const own = await request(app).get(`/api/accounts/${response.body.data.id}`).set("Cookie", actors.get("member")!.cookie).expect(200);
    expect(own.body.data.ownerUserId).toBe(ownerUserId);
  });

  it.each(["view_only", "professional"] as const)("retains the %s financial-write guard for Shared creation", async role => {
    const before = await snapshot();
    await post(role, { ownerUserId: null }).expect(403);
    expect(await snapshot()).toEqual(before);
  });

  it("rejects malformed owner IDs without business-state changes", async () => {
    const before = await snapshot();
    await post("admin", { ownerUserId: "not-a-uuid" }).expect(400);
    expect(await snapshot()).toEqual(before);
  });

  it("retains authentication and household-precondition guards before account creation", async () => {
    const before = await snapshot();
    await request(app).post("/api/accounts").send({ ...input, ownerUserId: null }).expect(401);
    await request(app).post("/api/accounts").set("Cookie", actors.get("member")!.cookie)
      .set("X-Capital-Subject", actors.get("member")!.id).set("X-Capital-Household", foreignHouseholdId)
      .send({ ...input, ownerUserId: null }).expect(409);
    expect(await snapshot()).toEqual(before);
  });
});
