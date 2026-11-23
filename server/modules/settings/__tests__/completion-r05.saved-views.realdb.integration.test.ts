/**
 * R05.2 (AH-13 shared views): named household saved views.
 *
 * Owner and admin create, edit and delete; every role lists and applies;
 * edits carry an optimistic-lock version. A view is only a narrowing filter:
 * applying it goes through the same visibility-enforced transaction list, it
 * can name only shared accounts, and a viewer never sees an account id they
 * could not see anyway. Real HTTP against real Postgres; nothing is mocked.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { and, eq, inArray } from "drizzle-orm";
import {
  accounts, auditLogs, categories, householdMembers, households, householdSavedViews, transactions, users,
} from "@shared/schema";
import { db, pool } from "../../../db";
import { hashPassword } from "../../../auth";
import { getTestApp } from "../../../__tests__/fixtures";

type Json = Record<string, unknown>;
type Role = "owner" | "admin" | "member" | "view_only" | "professional";
type Login = { id: string; cookie: string };

const password = "SyntheticSavedViews123!";
const PATH = "/api/settings/saved-views";
const home = randomUUID();
const away = randomUUID();
const ids = {
  shared: randomUUID(), laterPrivate: randomUUID(), alicePrivate: randomUUID(), category: randomUUID(),
  sharedTxn: randomUUID(), privateTxnOnShared: randomUUID(), privateAccountTxn: randomUUID(), bobTxn: randomUUID(),
};
const logins = new Map<string, Login>();
let app: Awaited<ReturnType<typeof getTestApp>>;

const as = (who: string) => {
  const cookie = logins.get(who)!.cookie;
  return {
    get: (path: string) => request(app).get(path).set("Cookie", cookie),
    post: (path: string, body: object) => request(app).post(path).set("Cookie", cookie).send(body),
    put: (path: string, body: object) => request(app).put(path).set("Cookie", cookie).send(body),
    delete: (path: string) => request(app).delete(path).set("Cookie", cookie),
  };
};

async function addUser(who: string, householdId: string, role: Role, passwordHash: string) {
  const id = randomUUID();
  const email = `saved-views-${id}@example.invalid`;
  await db.insert(users).values({ id, email, username: `saved-views-${id}`, passwordHash, emailVerified: true });
  await db.insert(householdMembers).values({ householdId, userId: id, role });
  const login = await request(app).post("/api/auth/login").send({ email, password }).expect(200);
  logins.set(who, { id, cookie: (login.headers["set-cookie"] as unknown as string[]).join("; ") });
}

async function seed() {
  await db.insert(households).values([
    { id: home, name: "Synthetic saved-view household", currency: "ZMW" },
    { id: away, name: "Synthetic other household", currency: "ZMW" },
  ]);
  const passwordHash = await hashPassword(password);
  const roles: Array<[string, Role]> = [
    ["alice", "owner"], ["ada", "admin"], ["bob", "member"], ["vic", "view_only"], ["pat", "professional"],
  ];
  for (const [who, role] of roles) await addUser(who, home, role, passwordHash);
  await addUser("olga", away, "owner", passwordHash);
  const alice = logins.get("alice")!.id;
  const bob = logins.get("bob")!.id;
  await db.insert(accounts).values([
    { id: ids.shared, householdId: home, name: "Synthetic shared current", type: "checking", currency: "ZMW",
      initialBalance: "1000.00", balance: "1000.00", isPrivate: false, ownerUserId: null },
    { id: ids.laterPrivate, householdId: home, name: "Synthetic soon-private", type: "savings", currency: "ZMW",
      initialBalance: "100.00", balance: "100.00", isPrivate: false, ownerUserId: alice },
    { id: ids.alicePrivate, householdId: home, name: "Synthetic Alice private", type: "savings", currency: "ZMW",
      initialBalance: "500.00", balance: "500.00", isPrivate: true, ownerUserId: alice },
  ]);
  await db.insert(categories).values({ id: ids.category, householdId: home, name: "Synthetic groceries", displayOrder: 0 });
  const txn = (id: string, accountId: string, owner: string, isPrivate: boolean, amount: string) => ({
    id, householdId: home, accountId, categoryId: ids.category, type: "expense" as const, currency: "ZMW",
    date: "2026-10-15", amount, name: `Synthetic groceries ${amount}`, isPrivate, ownerUserId: owner,
  });
  await db.insert(transactions).values([
    txn(ids.sharedTxn, ids.shared, alice, false, "20.00"),
    txn(ids.privateTxnOnShared, ids.shared, alice, true, "31.00"),
    txn(ids.privateAccountTxn, ids.alicePrivate, alice, false, "42.00"),
    txn(ids.bobTxn, ids.shared, bob, false, "53.00"),
  ]);
}

async function teardown() {
  const userIds = [...logins.values()].map(({ id }) => id);
  for (const householdId of [home, away]) {
    await db.delete(auditLogs).where(eq(auditLogs.householdId, householdId));
    await db.delete(householdSavedViews).where(eq(householdSavedViews.householdId, householdId));
    await db.delete(transactions).where(eq(transactions.householdId, householdId));
    await db.delete(categories).where(eq(categories.householdId, householdId));
    await db.delete(accounts).where(eq(accounts.householdId, householdId));
    await db.delete(householdMembers).where(eq(householdMembers.householdId, householdId));
    await db.delete(households).where(eq(households.id, householdId));
  }
  if (userIds.length) {
    await db.delete(auditLogs).where(inArray(auditLogs.userId, userIds));
    for (const id of userIds) await pool.query('DELETE FROM "session" WHERE sess->>\'userId\' = $1', [id]);
    await db.delete(users).where(inArray(users.id, userIds));
  }
}

async function createView(name: string, filter: Json = {}, who = "alice") {
  const response = await as(who).post(PATH, { name, filter }).expect(201);
  return response.body.data as { id: string; version: number; filter: Json };
}

async function listed(who: string): Promise<Array<Json & { id: string }>> {
  const response = await as(who).get(PATH).expect(200);
  return response.body.data;
}

/** Apply a view the way the client does: its filter becomes the transaction list query. */
async function applyView(who: string, viewId: string): Promise<string[]> {
  const view = (await listed(who)).find((entry) => entry.id === viewId)!;
  const filter = view.filter as Record<string, string | undefined>;
  const query: Record<string, string> = {};
  for (const key of ["accountId", "categoryId", "type", "startDate", "endDate", "search", "reviewed"] as const) {
    if (filter[key]) query[key] = filter[key]!;
  }
  if (filter.owner) query.ownerUserId = filter.owner === "mine" ? logins.get(who)!.id : "shared";
  const response = await as(who).get("/api/transactions").query(query).expect(200);
  return (response.body.data as Array<{ id: string }>).map(({ id }) => id);
}

async function audits(viewId: string) {
  return db.select({ action: auditLogs.action, userId: auditLogs.userId }).from(auditLogs)
    .where(and(eq(auditLogs.householdId, home), eq(auditLogs.entityType, "saved_view"), eq(auditLogs.entityId, viewId)));
}

describe("R05.2 named household saved views", () => {
  beforeAll(async () => {
    app = await getTestApp();
    await seed();
  }, 60_000);
  afterAll(teardown, 60_000);

  describe("capabilities", () => {
    it("owner and admin create, edit and delete; every role lists; writes are audited", async () => {
      const view = await createView("Groceries", { categoryId: ids.category, type: "expense" });
      const adminView = await createView("Admin view", { search: "groceries" }, "ada");
      expect(view).toMatchObject({ version: 1, filter: { categoryId: ids.category, type: "expense" } });

      for (const who of ["alice", "ada", "bob", "vic", "pat"]) {
        expect((await listed(who)).map(({ id }) => id)).toEqual(expect.arrayContaining([view.id, adminView.id]));
      }

      const edited = await as("ada").put(`${PATH}/${view.id}`, { name: "Weekly groceries", version: 1 }).expect(200);
      expect(edited.body.data).toMatchObject({ name: "Weekly groceries", version: 2 });
      await as("alice").delete(`${PATH}/${adminView.id}?version=1`).expect(204);
      expect((await listed("bob")).map(({ id }) => id)).not.toContain(adminView.id);

      const actions = (await audits(view.id)).map(({ action }) => action).sort();
      expect(actions).toEqual(["CREATE", "UPDATE"]);
      expect((await audits(adminView.id)).map(({ action }) => action).sort()).toEqual(["CREATE", "DELETE"]);
    });

    it("member, view-only and professional get 403 on every write and change nothing", async () => {
      const view = await createView("Read only target");
      for (const who of ["bob", "vic", "pat"]) {
        await as(who).post(PATH, { name: `By ${who}`, filter: {} }).expect(403);
        await as(who).put(`${PATH}/${view.id}`, { name: `Renamed by ${who}`, version: 1 }).expect(403);
        await as(who).delete(`${PATH}/${view.id}?version=1`).expect(403);
      }
      const [row] = await db.select().from(householdSavedViews).where(eq(householdSavedViews.id, view.id));
      expect(row).toMatchObject({ name: "Read only target", version: 1 });
      const names = (await db.select({ name: householdSavedViews.name }).from(householdSavedViews)
        .where(eq(householdSavedViews.householdId, home))).map(({ name }) => name);
      expect(names.filter((name) => name.startsWith("By "))).toEqual([]);
    });
  });

  describe("conflicts and validation", () => {
    it("refuses a duplicate name, ignoring case, on create and on rename", async () => {
      await createView("Monthly bills");
      const other = await createView("Something else");
      await as("alice").post(PATH, { name: "monthly BILLS", filter: {} }).expect(409);
      await as("ada").put(`${PATH}/${other.id}`, { name: "Monthly Bills", version: 1 }).expect(409);
    });

    it("refuses a stale version on edit and delete and keeps the row", async () => {
      const view = await createView("Versioned");
      await as("alice").put(`${PATH}/${view.id}`, { filter: { type: "income" }, version: 1 }).expect(200);
      const stale = await as("ada").put(`${PATH}/${view.id}`, { name: "Lost update", version: 1 }).expect(409);
      expect(stale.body.error.message).toMatch(/changed/i);
      await as("ada").delete(`${PATH}/${view.id}?version=1`).expect(409);
      const [row] = await db.select().from(householdSavedViews).where(eq(householdSavedViews.id, view.id));
      expect(row).toMatchObject({ name: "Versioned", version: 2, filter: { type: "income" } });
    });

    it("validates the filter as a strict, narrowing schema", async () => {
      const bad: Json[] = [
        { householdId: away }, { includePrivate: true }, { amountMin: "1.005" }, { amountMin: "50.00", amountMax: "10.00" },
        { startDate: "2026-02-30" }, { startDate: "2026-10-31", endDate: "2026-10-01" }, { accountId: "not-a-uuid" },
        // Malformed amounts are validation issues, never a thrown BigInt SyntaxError (500).
        { amountMin: "1e3" }, { amountMax: "abc" }, { amountMin: "1e3", amountMax: "10.00" },
      ];
      for (const filter of bad) await as("alice").post(PATH, { name: `Bad ${JSON.stringify(filter)}`, filter }).expect(400);
      await as("alice").post(PATH, { name: "   ", filter: {} }).expect(400);
      await as("alice").put(`${PATH}/not-a-uuid`, { name: "x", version: 1 }).expect(400);
    });
  });

  describe("visibility", () => {
    it("applying a view never returns a row the viewer cannot already see", async () => {
      const view = await createView("Shared account spend", { accountId: ids.shared, type: "expense" });
      const bobSees = await applyView("bob", view.id);
      expect(bobSees).toEqual(expect.arrayContaining([ids.sharedTxn, ids.bobTxn]));
      expect(bobSees).not.toContain(ids.privateTxnOnShared);
      expect(bobSees).not.toContain(ids.privateAccountTxn);

      const everything = await createView("All groceries", { categoryId: ids.category });
      for (const who of ["bob", "vic", "pat", "ada"]) {
        const seen = await applyView(who, everything.id);
        expect(seen).not.toContain(ids.privateTxnOnShared);
        expect(seen).not.toContain(ids.privateAccountTxn);
      }
      const mine = await createView("Mine only", { owner: "mine", categoryId: ids.category });
      expect(await applyView("bob", mine.id)).toEqual([ids.bobTxn]);
    });

    it("a view may name only shared accounts in its own household", async () => {
      await as("alice").post(PATH, { name: "Private account view", filter: { accountId: ids.alicePrivate } }).expect(400);
      await as("ada").post(PATH, { name: "Invisible account view", filter: { accountId: ids.alicePrivate } }).expect(404);
      await as("olga").post(PATH, { name: "Foreign account view", filter: { accountId: ids.shared } }).expect(404);
    });

    it("hides an account that became private from viewers who cannot see it", async () => {
      const view = await createView("Soon private", { accountId: ids.laterPrivate });
      await db.update(accounts).set({ isPrivate: true }).where(eq(accounts.id, ids.laterPrivate));
      const bobView = (await listed("bob")).find(({ id }) => id === view.id)!;
      expect(bobView).toMatchObject({ restricted: true });
      expect(bobView.filter).not.toHaveProperty("accountId");
      expect(JSON.stringify(await listed("bob"))).not.toContain(ids.laterPrivate);
      const aliceView = (await listed("alice")).find(({ id }) => id === view.id)!;
      expect(aliceView).toMatchObject({ restricted: false, filter: { accountId: ids.laterPrivate } });
    });

    it("lists the other views when one stored filter is unreadable, and restricts only that one", async () => {
      const good = await createView("Readable view", { type: "expense" });
      const badId = randomUUID();
      await db.insert(householdSavedViews).values({
        id: badId, householdId: home, name: "Legacy unreadable", createdBy: logins.get("alice")!.id,
        filter: { amountMax: "1e3", accountId: ids.alicePrivate },
      });
      for (const who of ["alice", "bob"]) {
        const views = await listed(who);
        expect(views.find(({ id }) => id === good.id)).toMatchObject({ restricted: false, filter: { type: "expense" } });
        expect(views.find(({ id }) => id === badId)).toMatchObject({ restricted: true, filter: {} });
      }
      expect(JSON.stringify(await listed("bob"))).not.toContain(ids.alicePrivate);
    });
  });

  it("another household cannot list, edit or delete the view (404)", async () => {
    const view = await createView("Home only");
    expect((await listed("olga")).map(({ id }) => id)).not.toContain(view.id);
    await as("olga").put(`${PATH}/${view.id}`, { name: "Taken over", version: 1 }).expect(404);
    await as("olga").delete(`${PATH}/${view.id}?version=1`).expect(404);
    const [row] = await db.select().from(householdSavedViews).where(eq(householdSavedViews.id, view.id));
    expect(row).toMatchObject({ name: "Home only", version: 1 });
  });
});
