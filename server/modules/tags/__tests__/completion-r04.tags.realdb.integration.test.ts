import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import pg from "pg";
import request from "supertest";
import { and, eq } from "drizzle-orm";
import { db, pool } from "../../../db";
import { accounts, householdMembers, tags, transactionTags, transactions } from "@shared/schema";
import { householdRepository } from "../../../repositories/HouseholdRepository";
import { tagService } from "../tags.service";
import { tagReadRepository } from "../../../repositories/TagReadRepository";
import { a, actors, app, get, ids, reset, roles, snapshot, start, stop } from "./completion-r04.tags.fixture";

describe("R04 A5 tag visibility with real signed cookies", () => {
  beforeAll(start, 20000);
  beforeEach(reset);
  afterEach(() => vi.restoreAllMocks());
  afterAll(stop);

  it("direct read seam requires an actor and admits a known current member", async () => {
    await expect(tagReadRepository.list(undefined as never)).rejects.toMatchObject({ statusCode: 403 });
    await expect(tagReadRepository.list({ householdId: a, userId: actors.get("owner")!.id, role: "operator" } as never)).rejects.toMatchObject({ statusCode: 403 });
    const rows = await tagReadRepository.list({ householdId: a, userId: actors.get("owner")!.id, role: "owner" });
    expect(rows).toMatchObject([{ id: ids.tag, usageCount: 2 }]);
  });

  it.each(roles)("%s sees the same shared catalogue with only authorized usage and rows", async (role) => {
    const before = await snapshot(), visible = role === "owner" ? 2 : 1;
    const list = await get("/", role).expect(200), detail = await get(`/${ids.tag}`, role).expect(200);
    const page = await get(`/${ids.tag}/transactions?limit=1`, role).expect(200);
    const beyond = await get(`/${ids.tag}/transactions?limit=1&offset=20`, role).expect(200);
    const analytics = await get("/analytics", role).expect(200);
    const suggestions = await get("/suggest?transactionName=A5Tag", role).expect(200);
    const txTags = await get(`/transaction/${ids.sharedTx}`, role).expect(200);
    const after = await snapshot();
    expect.soft(list.body.data).toMatchObject([{ id: ids.tag, name: "A5Tag", usageCount: visible }]);
    expect.soft(detail.body.data.usageCount).toBe(visible);
    expect.soft(page.body.data.count).toBe(visible);
    expect.soft(page.body.data.tag.usageCount).toBe(visible);
    expect.soft(beyond.body.data).toMatchObject({ transactions: [], count: visible, tag: { usageCount: visible } });
    expect.soft(analytics.body.data.summary).toEqual({ totalTags: 1, totalUsage: visible, averageUsage: visible });
    expect.soft(suggestions.body.data[0].confidence).toBe(role === "owner" ? 0.97 : 0.96);
    expect(txTags.body.data).toEqual([{ id: ids.tag, name: "A5Tag", color: "#112233", icon: null }]);
    const full = await get(`/${ids.tag}/transactions?limit=100`, role).expect(200);
    expect.soft(full.body.data.transactions.map((row: { id: string }) => row.id).sort()).toEqual(
      (role === "owner" ? [ids.privateTx, ids.sharedTx] : [ids.sharedTx]).sort(),
    );
    expect.soft(full.body.data.transactions.map((row: { amount: string }) => row.amount).sort()).toEqual(
      role === "owner" ? ["11.11", "777.77"] : ["11.11"],
    );
    if (role !== "owner") expect.soft(JSON.stringify(full.body)).not.toContain("PRIVSECRET");
    await get(`/transaction/${ids.privateTx}`, role).expect(role === "owner" ? 200 : 404);
    expect(after).toEqual(before);
  });

  it("outsider receives only B's catalogue and no A tag or transaction", async () => {
    const before = await snapshot();
    for (const path of ["/", "/analytics", "/suggest"]) {
      const response = await get(path, "outsider").expect(200);
      expect(JSON.stringify(response.body)).not.toContain(ids.tag);
    }
    for (const path of [`/${ids.tag}`, `/${ids.tag}/transactions`, `/transaction/${ids.sharedTx}`]) await get(path, "outsider").expect(404);
    expect(await snapshot()).toEqual(before);
  });

  it("keeps a private-only household tag visible with zero visible links", async () => {
    await db.delete(transactionTags).where(and(eq(transactionTags.tagId, ids.tag), eq(transactionTags.transactionId, ids.sharedTx)));
    const before = await snapshot();
    expect((await get("/").expect(200)).body.data).toMatchObject([{ id: ids.tag, usageCount: 0 }]);
    expect((await get(`/${ids.tag}`).expect(200)).body.data.usageCount).toBe(0);
    for (const offset of [0, 100]) expect((await get(`/${ids.tag}/transactions?offset=${offset}`).expect(200)).body.data)
      .toMatchObject({ transactions: [], count: 0, tag: { id: ids.tag, usageCount: 0 } });
    expect((await get(`/${ids.tag}/transactions`, "owner").expect(200)).body.data.count).toBe(1);
    expect(await snapshot()).toEqual(before);
  });

  it.each(["deleted account", "deleted transaction", "foreign account"] as const)("hides %s even from transaction owner", async (variant) => {
    if (variant === "deleted account") await db.update(accounts).set({ deletedAt: new Date() }).where(eq(accounts.id, ids.privateAccount));
    if (variant === "deleted transaction") await db.update(transactions).set({ deletedAt: new Date() }).where(eq(transactions.id, ids.privateTx));
    if (variant === "foreign account") await db.update(transactions).set({ accountId: ids.foreignAccount }).where(eq(transactions.id, ids.privateTx));
    const before = await snapshot();
    const response = await get(`/${ids.tag}/transactions`, "owner").expect(200);
    expect.soft(response.body.data.count).toBe(1);
    expect.soft(response.body.data.tag.usageCount).toBe(1);
    expect.soft(response.body.data.transactions.map((row: { id: string }) => row.id)).toEqual([ids.sharedTx]);
    await get(`/transaction/${ids.privateTx}`, "owner").expect(404);
    expect(await snapshot()).toEqual(before);
  });

  it("requires account AND transaction privacy with mismatched owners", async () => {
    await db.update(transactions).set({ isPrivate: true, ownerUserId: actors.get("member")!.id }).where(eq(transactions.id, ids.privateTx));
    for (const role of roles) {
      const page = await get(`/${ids.tag}/transactions`, role).expect(200);
      expect(page.body.data.transactions.map((row: { id: string }) => row.id)).toEqual([ids.sharedTx]);
      await get(`/transaction/${ids.privateTx}`, role).expect(404);
    }
  });

  it("a shared account does not override transaction privacy and an owner/admin cannot override it", async () => {
    await db.update(transactions).set({ isPrivate: true, ownerUserId: actors.get("member")!.id }).where(eq(transactions.id, ids.sharedTx));
    for (const role of roles) {
      await get(`/transaction/${ids.sharedTx}`, role).expect(role === "member" ? 200 : 404);
      const page = await get(`/${ids.tag}/transactions`, role).expect(200);
      expect(page.body.data.count).toBe(role === "owner" || role === "member" ? 1 : 0);
    }
  });

  it("filters foreign-household junctions on reads and refuses corrupt-reference writes unchanged", async () => {
    await db.insert(transactionTags).values([
      { tagId: ids.foreignTag, transactionId: ids.sharedTx },
      { tagId: ids.tag, transactionId: ids.foreignTx },
    ]);
    const before = await snapshot();
    const read = await get(`/transaction/${ids.sharedTx}`).expect(200);
    expect.soft(read.body.data.map((tag: { id: string }) => tag.id)).toEqual([ids.tag]);
    expect(await snapshot()).toEqual(before);
    await request(app).post(`/api/tags/transaction/${ids.sharedTx}`).set("Cookie", actors.get("member")!.cookie).send({ tagIds: [ids.tag] }).expect(404);
    await request(app).put(`/api/tags/transaction/${ids.sharedTx}`).set("Cookie", actors.get("member")!.cookie).send({ tagIds: [ids.tag] }).expect(404);
    await request(app).delete(`/api/tags/transaction/${ids.sharedTx}/${ids.tag}`).set("Cookie", actors.get("member")!.cookie).expect(404);
    expect(await snapshot()).toEqual(before);
  });

  it("distinguishes visible tagless transactions from invisible transactions", async () => {
    await db.delete(transactionTags).where(eq(transactionTags.transactionId, ids.sharedTx));
    expect((await get(`/transaction/${ids.sharedTx}`).expect(200)).body.data).toEqual([]);
    await get(`/transaction/${ids.privateTx}`).expect(404);
  });

  it("analytics and suggestions depend only on visible links, never stored counters or hidden activity", async () => {
    const sharedTag = randomUUID(), privateTag = randomUUID();
    await db.insert(tags).values([
      { id: sharedTag, householdId: a, name: "A5 SharedOnly", usageCount: 1 },
      { id: privateTag, householdId: a, name: "A5 PrivateOnly", usageCount: 1 },
    ]);
    await db.insert(transactionTags).values([{ tagId: sharedTag, transactionId: ids.sharedTx }, { tagId: privateTag, transactionId: ids.privateTx }]);
    async function views() {
      return Promise.all(["/", "/analytics?limit=10", "/suggest?limit=10", "/suggest?transactionName=A5Tag&limit=10"].map(async (path) => (await get(path).expect(200)).body));
    }
    const before = await views();
    expect.soft(before[1].data.summary).toEqual({ totalTags: 3, totalUsage: 2, averageUsage: 0.67 });
    expect.soft(before[1].data.topTags.find((tag: { id: string }) => tag.id === privateTag)).toMatchObject({ usageCount: 0, percentage: 0 });
    await db.update(tags).set({ usageCount: 987 }).where(eq(tags.id, ids.tag));
    await db.delete(transactionTags).where(and(eq(transactionTags.tagId, ids.tag), eq(transactionTags.transactionId, ids.privateTx)));
    const stored = await snapshot();
    expect(await views()).toEqual(before);
    expect(await snapshot()).toEqual(stored);
  });

  it.each(["view_only", "professional"] as const)("%s cannot use any tag write to obtain metadata or change state", async (role) => {
    const before = await snapshot(), cookie = actors.get(role)!.cookie;
    const cases = [
      ["post", "/", { name: "Denied" }], ["put", `/${ids.tag}`, { name: "Denied" }], ["delete", `/${ids.tag}`, {}],
      ["post", `/${ids.tag}/archive`, {}], ["post", "/merge", { targetTagId: ids.tag, sourceTagIds: [ids.foreignTag] }], ["post", "/defaults", {}],
      ["post", `/transaction/${ids.sharedTx}`, { tagIds: [ids.tag] }], ["put", `/transaction/${ids.sharedTx}`, { tagIds: [ids.tag] }], ["delete", `/transaction/${ids.sharedTx}/${ids.tag}`, {}],
    ] as const;
    for (const [method, path, body] of cases) await request(app)[method](`/api/tags${path}`).set("Cookie", cookie).send(body).expect(403);
    expect(await snapshot()).toEqual(before);
  });

  it.each(["owner", "admin", "member"] as const)("%s update response uses projected usage", async (role) => {
    const response = await request(app).put(`/api/tags/${ids.tag}`).set("Cookie", actors.get(role)!.cookie).send({ name: "A5 renamed" }).expect(200);
    expect(response.body.data).toMatchObject({ id: ids.tag, name: "A5 renamed", usageCount: role === "owner" ? 2 : 1 });
  });

  it("archive retains200 and includes archived projected tag; merge projects its target", async () => {
    const cookie = actors.get("member")!.cookie;
    const archived = await request(app).post(`/api/tags/${ids.tag}/archive`).set("Cookie", cookie).send({}).expect(200);
    expect.soft(archived.body.data.tag).toMatchObject({ id: ids.tag, isArchived: true, usageCount: 1 });
    expect((await get("/").expect(200)).body.data).toEqual([]);
    expect((await get(`/${ids.tag}`).expect(200)).body.data).toMatchObject({ id: ids.tag, isArchived: true, usageCount: 1 });
    const sourceId = randomUUID();
    await db.insert(tags).values({ id: sourceId, householdId: a, name: "Merge source", usageCount: 1 });
    await db.insert(transactionTags).values({ tagId: sourceId, transactionId: ids.sharedTx });
    const merged = await request(app).post("/api/tags/merge").set("Cookie", cookie).send({ targetTagId: ids.tag, sourceTagIds: [sourceId] }).expect(200);
    expect(merged.body.data.targetTag).toMatchObject({ id: ids.tag, usageCount: 1, isArchived: true });
    expect(await db.select().from(tags).where(eq(tags.id, sourceId))).toEqual([]);
    expect((await db.select().from(tags).where(eq(tags.id, ids.tag)))[0].usageCount).toBe(2);
  });

  it("create/default responses have explicit projected counts and preserve catalogue semantics", async () => {
    const cookie = actors.get("member")!.cookie;
    const created = await request(app).post("/api/tags").set("Cookie", cookie).send({ name: "New shared tag" }).expect(201);
    expect(created.body.data.usageCount).toBe(0);
    const defaults = await request(app).post("/api/tags/defaults").set("Cookie", cookie).send({}).expect(200);
    expect(defaults.body.data.tags.length).toBeGreaterThan(0);
    expect(defaults.body.data.tags.every((tag: { usageCount: number }) => tag.usageCount === 0)).toBe(true);
  });

  it.each(["/not-a-uuid", "/not-a-uuid/transactions", "/transaction/not-a-uuid"])("malformed path %s is400 before any query mutation", async (path) => {
    const before = await snapshot();
    await get(path).expect(400);
    expect(await snapshot()).toEqual(before);
  });
  it.each(["/", "/analytics", "/suggest", `/${ids.tag}/transactions`])("rejects invalid numeric query on %s", async (path) => {
    for (const limit of ["NaN", "1.5", "0", "-1", "1&limit=2", "1&limit[]=1"]) await get(`${path}?limit=${limit}`).expect(400);
    if (path.endsWith("/transactions")) for (const offset of ["NaN", "-1", "1.5", "1&offset=2"]) await get(`${path}?offset=${offset}`).expect(400);
  });
  it("well-formed absent IDs are404 and unknown roles are403 at the controlled seam", async () => {
    await get(`/${randomUUID()}`).expect(404);
    await get(`/transaction/${randomUUID()}`).expect(404);
    const original = householdRepository.findMember.bind(householdRepository);
    vi.spyOn(householdRepository, "findMember").mockImplementation(async (...args) => ({ ...await original(...args), role: "operator" }) as never);
    const before = await snapshot();
    for (const path of ["/", "/analytics", "/suggest", `/${ids.tag}`, `/${ids.tag}/transactions`, `/transaction/${ids.sharedTx}`]) await get(path).expect(403);
    expect(await snapshot()).toEqual(before);
  });

  it("does not add a post-commit auth rejection to an archived mutation response", async () => {
    const original = tagService.archiveTag.bind(tagService);
    vi.spyOn(tagService, "archiveTag").mockImplementationOnce(async (...args) => {
      const result = await original(...args);
      await db.delete(householdMembers).where(and(eq(householdMembers.householdId, a), eq(householdMembers.userId, actors.get("owner")!.id)));
      return result;
    });
    const response = await request(app).post(`/api/tags/${ids.tag}/archive`).set("Cookie", actors.get("owner")!.cookie).send({}).expect(200);
    expect(response.body.data.tag).toMatchObject({ id: ids.tag, isArchived: true, usageCount: 0 });
    expect((await db.select().from(tags).where(eq(tags.id, ids.tag)))[0].isArchived).toBe(true);
  });

  it("page rows, total and nested usage use an actual read-only repeatable-read snapshot", async () => {
    let reached!: () => void, release!: () => void;
    const atTag = new Promise<void>((resolve) => { reached = resolve; });
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let settings: { isolation: string; read_only: string } | undefined, intercepted = false;
    const original = pg.Client.prototype.query;
    const spy = vi.spyOn(pg.Client.prototype, "query").mockImplementation(function (this: pg.Client, ...args: Parameters<typeof original>) {
      const result: unknown = Reflect.apply(original, this, args);
      const [query, values] = args as unknown as [unknown, unknown];
      const text = typeof query === "object" && query !== null && "text" in query ? query.text : query;
      if (!intercepted && typeof text === "string" && /from "tags"/i.test(text) && Array.isArray(values) && values.includes(ids.tag)) {
        intercepted = true;
        return Promise.resolve(result).then(async (value) => {
          const state = await Reflect.apply(original, this, ["SELECT current_setting('transaction_isolation') AS isolation, current_setting('transaction_read_only') AS read_only"]);
          settings = state.rows[0]; reached(); await gate; return value;
        }) as unknown as ReturnType<typeof original>;
      }
      return result as ReturnType<typeof original>;
    });
    let timer!: ReturnType<typeof setTimeout>;
    const deadline = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("Tag snapshot barrier not reached")), 8000); });
    const pending = get(`/${ids.tag}/transactions`, "owner").then((response) => response);
    try {
      await Promise.race([atTag, deadline]);
      await db.delete(transactionTags).where(and(eq(transactionTags.tagId, ids.tag), eq(transactionTags.transactionId, ids.sharedTx)));
      release();
      const response = await pending;
      expect.soft(response.status).toBe(200);
      expect.soft(response.body.data).toMatchObject({ count: 2, tag: { usageCount: 2 } });
      expect.soft(response.body.data.transactions).toHaveLength(2);
      expect(settings).toEqual({ isolation: "repeatable read", read_only: "on" });
    } finally { clearTimeout(timer); release(); spy.mockRestore(); await Promise.allSettled([pending]); }
  });
});
