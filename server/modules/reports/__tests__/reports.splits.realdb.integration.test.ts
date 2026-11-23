// NEW-14: the Sankey and the transaction report count a split purchase by its
// split rows (each split's category and amount), totals still equal the parent
// amounts, and another member's private split purchase stays hidden. Real HTTP + PG.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { inArray } from "drizzle-orm";
import { db, pool } from "../../../db";
import { accounts, categories, categoryGroups, fxRates, users } from "@shared/schema";
import { getTestApp } from "../../../__tests__/fixtures";
import { hashPassword } from "../../../auth";
import { createFXRateRepository, createFXRateService, setGlobalFXService } from "../../../core/calculations";
import { analyticsCache } from "../../../services/AnalyticsCache";

const householdId = randomUUID(), aliceId = randomUUID(), bobId = randomUUID();
const aliceAccount = randomUUID(), bobAccount = randomUUID(), groupId = randomUUID();
const groceries = randomUUID(), household = randomUUID(), dining = randomUUID();
const tag = randomUUID().replaceAll("-", "").slice(0, 12), password = "SyntheticNew14Splits123!";
const today = new Date().toISOString().slice(0, 10);
const range = { from: `${today.slice(0, 4)}-01-01`, to: today };
const zmw = (amount: string) => ({ amount, currency: "ZMW" });
let app: Awaited<ReturnType<typeof getTestApp>>;
const headers: Record<"alice" | "bob", Record<string, string>> = { alice: {}, bob: {} };
let splitParent = "", unsplit = "", bobPrivate = "";

type Member = keyof typeof headers;
type SankeyLink = { value: { amount: string }; meta?: { entityType?: string; entityId?: string } };
type ReportItem = { id: string; splitId?: string | null; amount: { amount: string }; amountBase: { amount: string }; category?: { id: string } | null };

async function get(member: Member, path: string, query: Record<string, string> = range) {
  await analyticsCache.invalidateHousehold(householdId);
  return (await request(app).get(path).set(headers[member]).query(query).expect(200)).body.data;
}

async function purchase(member: Member, body: Record<string, unknown>) {
  const response = await request(app).post("/api/transactions").set(headers[member])
    .send({ type: "expense", date: today, idempotencyKey: randomUUID(), ...body }).expect(201);
  return response.body.data.id as string;
}

/** Category id -> amount for the Sankey's category links. */
async function sankeyByCategory(member: Member) {
  const sankey = await get(member, "/api/reports/sankey", { ...range, mode: "expense_groups_to_categories" });
  const links = (sankey.sankey.links as SankeyLink[]).filter(link => link.meta?.entityType === "category");
  return { totals: sankey.totals, byCategory: Object.fromEntries(links.map(link => [link.meta!.entityId, link.value.amount])) };
}

async function reportRows(member: Member, query: Record<string, string> = {}) {
  const report = await get(member, "/api/reports/transactions", { ...range, type: "expense", limit: "50", ...query });
  return (report.items as ReportItem[])
    .map(item => ({ id: item.id, splitId: item.splitId ?? null, category: item.category?.id ?? null, amount: item.amount.amount, amountBase: item.amountBase.amount }))
    .sort((a, b) => Number(b.amount) - Number(a.amount));
}

describe("NEW-14 report splits: Sankey and transaction report use split rows", () => {
  beforeAll(async () => {
    app = await getTestApp();
    setGlobalFXService(createFXRateService(createFXRateRepository(db, fxRates), { cacheTtlSeconds: 300, baseCurrency: "ZMW", fallbackDays: 30 }));
    const passwordHash = await hashPassword(password);
    await db.insert(users).values([
      { id: aliceId, email: `n14a-${tag}@example.invalid`, username: `n14a-${tag}`, passwordHash, emailVerified: true },
      { id: bobId, email: `n14b-${tag}@example.invalid`, username: `n14b-${tag}`, passwordHash, emailVerified: true },
    ]);
    await pool.query("INSERT INTO households (id, name, currency) VALUES ($1, 'Synthetic NEW-14 splits', 'ZMW')", [householdId]);
    await pool.query("INSERT INTO household_members (household_id, user_id, role) VALUES ($1, $2, 'owner'), ($1, $3, 'member')", [householdId, aliceId, bobId]);
    await db.insert(accounts).values([
      { id: aliceAccount, householdId, ownerUserId: aliceId, name: "N14 alice checking", type: "checking", currency: "ZMW", isAsset: true, initialBalance: "1000.00", balance: "1000.00" },
      { id: bobAccount, householdId, ownerUserId: bobId, name: "N14 bob checking", type: "checking", currency: "ZMW", isAsset: true, initialBalance: "1000.00", balance: "1000.00" },
    ]);
    await db.insert(categoryGroups).values({ id: groupId, householdId, name: "N14 living", type: "expenses", budgetMode: "by_category", displayOrder: 0 });
    await db.insert(categories).values([
      { id: groceries, householdId, groupId, name: "N14 groceries", includeInBudget: true, displayOrder: 0 },
      { id: household, householdId, groupId, name: "N14 household", includeInBudget: true, displayOrder: 1 },
      { id: dining, householdId, groupId, name: "N14 dining", includeInBudget: true, displayOrder: 2 },
    ]);
    for (const [member, userId] of [["alice", aliceId], ["bob", bobId]] as const) {
      const login = await request(app).post("/api/auth/login").send({ email: `n14${member[0]}-${tag}@example.invalid`, password }).expect(200);
      headers[member] = { Cookie: (login.headers["set-cookie"] as unknown as string[]).join("; "), "X-Capital-Subject": userId, "X-Capital-Household": householdId };
    }
    splitParent = await purchase("alice", { accountId: aliceAccount, name: "N14 supermarket", amount: zmw("100.00"),
      splits: [{ amount: zmw("60.00"), categoryId: groceries }, { amount: zmw("40.00"), categoryId: household }] });
    unsplit = await purchase("alice", { accountId: aliceAccount, name: "N14 cafe", amount: zmw("25.00"), categoryId: dining });
    bobPrivate = await purchase("bob", { accountId: bobAccount, name: "N14 bob private shop", amount: zmw("70.00"), isPrivate: true,
      splits: [{ amount: zmw("50.00"), categoryId: groceries }, { amount: zmw("20.00"), categoryId: household }] });
  }, 30000);

  afterAll(async () => {
    await pool.query("DELETE FROM transactions WHERE household_id = $1", [householdId]);
    for (const table of ["categories", "category_groups", "accounts", "audit_logs", "outbox_events", "household_members"]) {
      await pool.query(`DELETE FROM ${table} WHERE household_id = $1`, [householdId]);
    }
    await pool.query("DELETE FROM households WHERE id = $1", [householdId]);
    for (const id of [aliceId, bobId]) {
      await pool.query('DELETE FROM "session" WHERE sess->>\'userId\'=$1', [id]);
      await pool.query("DELETE FROM security_audit_logs WHERE user_id = $1 OR target_user_id = $1", [id]);
      await pool.query("DELETE FROM outbox_events WHERE payload->>'userId' = $1", [id]);
    }
    await db.delete(users).where(inArray(users.id, [aliceId, bobId]));
  });

  it("the Sankey counts each split under its own category; the total equals the parent amounts", async () => {
    const alice = await sankeyByCategory("alice");
    expect(alice.byCategory).toEqual({ [groceries]: "60.00", [household]: "40.00", [dining]: "25.00" });
    expect(alice.totals.expenses).toEqual(zmw("125.00"));
  });

  it("the Sankey shows a member's private split purchase, split by category, to that member", async () => {
    // A member's reports default to scope "mine"; the owner's household view
    // above already proves the private purchase stays out of other views.
    const bob = await sankeyByCategory("bob");
    expect(bob.byCategory).toEqual({ [groceries]: "50.00", [household]: "20.00" });
    expect(bob.totals.expenses).toEqual(zmw("70.00"));
  });

  it("the transaction report lists one row per split with its category and amount", async () => {
    const rows = await reportRows("alice");
    expect(rows).toEqual([
      { id: splitParent, splitId: expect.any(String), category: groceries, amount: "60.00", amountBase: "60.00" },
      { id: splitParent, splitId: expect.any(String), category: household, amount: "40.00", amountBase: "40.00" },
      { id: unsplit, splitId: null, category: dining, amount: "25.00", amountBase: "25.00" },
    ]);
    expect(new Set(rows.map(row => row.splitId)).size).toBe(3);
    expect(rows.some(row => row.id === bobPrivate)).toBe(false);
  });

  it("the transaction report filters by a split's category and pages through split rows without repeats", async () => {
    expect(await reportRows("alice", { categoryId: groceries })).toEqual([
      { id: splitParent, splitId: expect.any(String), category: groceries, amount: "60.00", amountBase: "60.00" }]);
    const seen: string[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 5; page++) {
      const data = await get("alice", "/api/reports/transactions", { ...range, type: "expense", limit: "1", ...(cursor ? { cursor } : {}) });
      seen.push(...(data.items as ReportItem[]).map(item => item.splitId ?? item.id));
      cursor = data.page.nextCursor ?? undefined;
      if (!cursor) break;
    }
    expect(seen).toHaveLength(3);
    expect(new Set(seen).size).toBe(3);
  });

  it("the private split purchase reaches only its owner's transaction report", async () => {
    const rows = await reportRows("bob");
    expect(rows.filter(row => row.id === bobPrivate).map(row => [row.category, row.amount])).toEqual([[groceries, "50.00"], [household, "20.00"]]);
  });
});
