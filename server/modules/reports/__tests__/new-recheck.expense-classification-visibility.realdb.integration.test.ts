// NEW re-check (privacy): the expense classification labels each category
// fixed / variable / discretionary from a monthly series. That series had no
// visibility filter, so rows the viewer cannot see (another member's private
// expense, an expense on another member's private account, an expense on a
// hidden account) still moved the viewer's labels even though the amounts
// came from the filtered breakdown. Real HTTP + PG.
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

const householdId = randomUUID(), aliceId = randomUUID(), bobId = randomUUID(), groupId = randomUUID();
const aliceShared = randomUUID(), aliceHidden = randomUUID(), bobShared = randomUUID(), bobPrivate = randomUUID();
const privateTxnCategory = randomUUID(), privateAccountCategory = randomUUID(), hiddenAccountCategory = randomUUID();
const tag = randomUUID().replaceAll("-", "").slice(0, 12), password = "SyntheticClassify123!";
const range = { from: "2026-01-01", to: "2026-02-28", scope: "household" };
const zmw = (amount: string) => ({ amount, currency: "ZMW" });
const headers: Record<"alice" | "bob", Record<string, string>> = { alice: {}, bob: {} };
let app: Awaited<ReturnType<typeof getTestApp>>;

type Member = keyof typeof headers;
type ClassifiedCategory = { id: string; amount: { amount: string } };
type Label = "fixed" | "variable" | "discretionary";

async function spend(member: Member, accountId: string, categoryId: string, date: string, amount: string, isPrivate = false) {
  await request(app).post("/api/transactions").set(headers[member])
    .send({ type: "expense", date, accountId, categoryId, name: `Classify ${tag}`, amount: zmw(amount), isPrivate, idempotencyKey: randomUUID() })
    .expect(201);
}

/** Category id -> [label, amount] in Alice's household classification. */
async function aliceLabels() {
  await analyticsCache.invalidateHousehold(householdId);
  const data = (await request(app).get("/api/reports/expenses/classification").set(headers.alice).query(range).expect(200)).body.data;
  const labels: Record<string, [Label, string]> = {};
  for (const label of ["fixed", "variable", "discretionary"] as const) {
    for (const category of data.classification[label].categories as ClassifiedCategory[]) {
      labels[category.id] = [label, category.amount.amount];
    }
  }
  return labels;
}

describe("expense classification ignores rows the viewer cannot see", () => {
  beforeAll(async () => {
    app = await getTestApp();
    setGlobalFXService(createFXRateService(createFXRateRepository(db, fxRates), { cacheTtlSeconds: 300, baseCurrency: "ZMW", fallbackDays: 30 }));
    const passwordHash = await hashPassword(password);
    await db.insert(users).values([
      { id: aliceId, email: `clsa-${tag}@example.invalid`, username: `clsa-${tag}`, passwordHash, emailVerified: true },
      { id: bobId, email: `clsb-${tag}@example.invalid`, username: `clsb-${tag}`, passwordHash, emailVerified: true },
    ]);
    await pool.query("INSERT INTO households (id, name, currency) VALUES ($1, 'Synthetic classification privacy', 'ZMW')", [householdId]);
    await pool.query("INSERT INTO household_members (household_id, user_id, role) VALUES ($1, $2, 'owner'), ($1, $3, 'member')", [householdId, aliceId, bobId]);
    const account = (id: string, ownerUserId: string, name: string, extra: { isPrivate?: boolean; hideTransactions?: boolean } = {}): typeof accounts.$inferInsert => ({
      id, householdId, ownerUserId, name, type: "checking", currency: "ZMW", isAsset: true, initialBalance: "5000.00", balance: "5000.00", ...extra,
    });
    await db.insert(accounts).values([
      account(aliceShared, aliceId, "Classify alice shared"),
      account(aliceHidden, aliceId, "Classify alice hidden", { hideTransactions: true }),
      account(bobShared, bobId, "Classify bob shared"),
      account(bobPrivate, bobId, "Classify bob private", { isPrivate: true }),
    ]);
    await db.insert(categoryGroups).values({ id: groupId, householdId, name: "Classify bills", type: "expenses", budgetMode: "by_category", displayOrder: 0 });
    await db.insert(categories).values([
      { id: privateTxnCategory, householdId, groupId, name: "Classify rent", includeInBudget: true, displayOrder: 0 },
      { id: privateAccountCategory, householdId, groupId, name: "Classify power", includeInBudget: true, displayOrder: 1 },
      { id: hiddenAccountCategory, householdId, groupId, name: "Classify water", includeInBudget: true, displayOrder: 2 },
    ]);
    for (const [member, userId] of [["alice", aliceId], ["bob", bobId]] as const) {
      const login = await request(app).post("/api/auth/login").send({ email: `cls${member[0]}-${tag}@example.invalid`, password }).expect(200);
      headers[member] = { Cookie: (login.headers["set-cookie"] as unknown as string[]).join("; "), "X-Capital-Subject": userId, "X-Capital-Household": householdId };
    }
    // Alice's own visible spending: the same 100.00 in January and February in each category, so "fixed".
    for (const categoryId of [privateTxnCategory, privateAccountCategory, hiddenAccountCategory]) {
      await spend("alice", aliceShared, categoryId, "2026-01-15", "100.00");
      await spend("alice", aliceShared, categoryId, "2026-02-15", "100.00");
    }
    // One February row per category that Alice must not see: 100 / 400 would make it "discretionary".
    await spend("bob", bobShared, privateTxnCategory, "2026-02-20", "300.00", true);
    await spend("bob", bobPrivate, privateAccountCategory, "2026-02-20", "300.00");
    await spend("alice", aliceHidden, hiddenAccountCategory, "2026-02-20", "300.00");
  }, 60000);

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

  it("labels each category from Alice's visible months only: a private expense, a private account and a hidden account change nothing", async () => {
    expect(await aliceLabels()).toEqual({
      [privateTxnCategory]: ["fixed", "200.00"],
      [privateAccountCategory]: ["fixed", "200.00"],
      [hiddenAccountCategory]: ["fixed", "200.00"],
    });
  });
});
