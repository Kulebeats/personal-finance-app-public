import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq, inArray, sql } from "drizzle-orm";
import { budgets, categories, categoryGroups, transactions, transactionSplits } from "@shared/schema";
import { db } from "../../../db";
import { budgetRepository } from "../../../repositories/BudgetRepository";
import { getPostgresError } from "../../../utils/postgresError";
import { a, actors, app, ids, reset, start, stop } from "../../tags/__tests__/completion-r04.tags.fixture";

const groupId = randomUUID(), categoryA = randomUUID(), categoryB = randomUUID();
const categoryBudget = randomUUID(), groupBudget = randomUUID(), flexBudget = randomUUID();
const date = "2026-02-15", from = "2026-02-01", to = "2026-02-28";
const pendingId = randomUUID(), pendingSplitId = randomUUID(), defaultPostedId = randomUUID();
type ProgressRow = { id: string; spent: { amount: string; currency: string }; remaining: { amount: string; currency: string } };
type PostingOptions = { id?: string; pending?: boolean; status?: "pending" | "cleared" | "reconciled" | null;
  excluded?: boolean; deleted?: boolean; split?: readonly [string, string] };

async function clearBudgets() {
  await db.delete(budgets).where(eq(budgets.householdId, a));
  await db.delete(categories).where(eq(categories.householdId, a));
  await db.delete(categoryGroups).where(eq(categoryGroups.householdId, a));
}
async function expense(amount: string, options: PostingOptions = {}) {
  const id = options.id ?? randomUUID();
  await db.insert(transactions).values({ id, householdId: a, accountId: ids.sharedAccount, categoryId: categoryA,
    date, name: "Synthetic R10 budget posting", amount, type: "expense", currency: "ZMW",
    ...(options.pending === undefined ? {} : { isPending: options.pending }),
    ...(options.status === undefined ? {} : { status: options.status }),
    isExcludedFromBudget: options.excluded ?? false, deletedAt: options.deleted ? new Date(`${date}T12:00:00Z`) : null });
  if (options.split) await db.insert(transactionSplits).values([
    { transactionId: id, categoryId: categoryA, amount: options.split[0], displayOrder: 0 },
    { transactionId: id, categoryId: categoryB, amount: options.split[1], displayOrder: 1 },
  ]);
}
async function progress() {
  const read = async (): Promise<ProgressRow[]> => {
    const response = await request(app).get("/api/budgets/progress?year=2026&month=2")
      .set("Cookie", actors.get("member")!.cookie).expect(200);
    return response.body.data;
  };
  // Existing budget modes deliberately expose category OR group budgets. Read
  // each supported mode rather than expecting both against the same group.
  await db.update(categoryGroups).set({ budgetMode: "by_category" }).where(eq(categoryGroups.id, groupId));
  const categoryRows = await read();
  expect(categoryRows.map(row => row.id).sort()).toEqual([categoryBudget, flexBudget].sort());
  await db.update(categoryGroups).set({ budgetMode: "by_group" }).where(eq(categoryGroups.id, groupId));
  const groupRows = await read();
  expect(groupRows.map(row => row.id).sort()).toEqual([groupBudget, flexBudget].sort());
  const category = categoryRows.find(row => row.id === categoryBudget)!;
  const group = groupRows.find(row => row.id === groupBudget)!;
  const flex = groupRows.find(row => row.id === flexBudget)!;
  expect(categoryRows.find(row => row.id === flexBudget)).toMatchObject({ spent: flex.spent, remaining: flex.remaining });
  return [category, group, flex].map(({ id, spent, remaining }) => ({ id, spent, remaining }));
}
function expectedProgress(category: string, categoryRemaining: string, total: string, totalRemaining: string) {
  return [
    { id: categoryBudget, spent: { amount: category, currency: "ZMW" }, remaining: { amount: categoryRemaining, currency: "ZMW" } },
    ...[groupBudget, flexBudget].map(id => ({ id, spent: { amount: total, currency: "ZMW" }, remaining: { amount: totalRemaining, currency: "ZMW" } })),
  ];
}

describe.each(["isPending", "status"] as const)("R10.1 actual budget spend respects the %s pending marker", marker => {
  beforeAll(start, 20_000);
  beforeEach(async () => {
    await reset(); await clearBudgets();
    await db.insert(categoryGroups).values({ id: groupId, householdId: a, name: "R10 expense group", type: "expenses", budgetMode: "by_category", isArchived: false, displayOrder: 0 });
    await db.insert(categories).values([
      { id: categoryA, householdId: a, groupId, name: "R10 category A", includeInBudget: true, isArchived: false, displayOrder: 0 },
      { id: categoryB, householdId: a, groupId, name: "R10 category B", includeInBudget: true, isArchived: false, displayOrder: 1 },
    ]);
    await db.insert(budgets).values([
      { id: categoryBudget, householdId: a, name: "R10 category budget", categoryId: categoryA, amount: "1000", period: "monthly" },
      { id: groupBudget, householdId: a, name: "R10 group budget", categoryGroupId: groupId, amount: "1000", period: "monthly" },
      { id: flexBudget, householdId: a, name: "R10 flex budget", isFlexBucket: true, amount: "1000", period: "monthly" },
    ]);
    // Omitted isPending is the existing direct caller's valid DEFAULT false.
    await expense("100", { id: defaultPostedId });
    await expense("60", { pending: false, split: ["40", "20"] });
    const pending = { pending: marker === "isPending", status: marker === "status" ? "pending" as const : "cleared" as const };
    await expense("25", { id: pendingId, ...pending });
    await expense("40", { id: pendingSplitId, ...pending, split: ["30", "10"] });
    await expense("50", { pending: false, excluded: true });
    await expense("60", { pending: false, excluded: true, split: ["40", "20"] });
    await expense("70", { pending: false, deleted: true });
    await expense("80", { pending: false, deleted: true, split: ["50", "30"] });
  });
  afterEach(clearBudgets);
  afterAll(async () => { await clearBudgets(); await stop(); });

  it("excludes ordinary and split pending parents in signed category, group and flex progress", async () => {
    expect(await progress()).toEqual(expectedProgress("140.00", "860.00", "160.00", "840.00"));
  });
  it("reflects posting and withdrawal on repeated signed reads without duplicating split parents", async () => {
    await db.update(transactions).set({ isPending: false, status: "cleared" }).where(inArray(transactions.id, [pendingId, pendingSplitId]));
    const posted = expectedProgress("195.00", "805.00", "225.00", "775.00");
    expect(await progress()).toEqual(posted);
    expect(await progress()).toEqual(posted);
    await db.update(transactions).set({ isPending: marker === "isPending", status: marker === "status" ? "pending" : "cleared" })
      .where(inArray(transactions.id, [pendingId, pendingSplitId]));
    expect(await progress()).toEqual(expectedProgress("140.00", "860.00", "160.00", "840.00"));
  });

  const readers = [
    { name: "non-split category", expected: "100.00", read: () => budgetRepository.calculateSpent(a, categoryA, from, to, "expense", "ZMW") },
    { name: "non-split group", expected: "100.00", read: () => budgetRepository.calculateGroupSpent(a, groupId, from, to, "expense", "ZMW") },
    { name: "non-split flex", expected: "100.00", read: () => budgetRepository.calculateFlexSpent(a, from, to, "ZMW") },
    { name: "split-aware category", expected: "140.00", read: () => budgetRepository.calculateSpentWithSplits(a, categoryA, from, to, "expense", "ZMW") },
    { name: "split-aware group", expected: "160.00", read: () => budgetRepository.calculateGroupSpentWithSplits(a, groupId, from, to, "expense", "ZMW") },
    { name: "split-aware flex", expected: "160.00", read: () => budgetRepository.calculateFlexSpentWithSplits(a, from, to, "ZMW") },
  ];
  it.each(readers)("preserves the existing $name repository caller with pending records present", async ({ read, expected }) => {
    expect((await read()).toString()).toBe(expected);
  });
  it("uses posted state in all batched category/group/flex totals", async () => {
    const result = await budgetRepository.batchCalculateSpent(a, [categoryA, categoryB], [groupId], from, to, "ZMW",
      new Map([[categoryA, "expense"], [categoryB, "expense"]]), new Map([[groupId, "expense"]]), { kind: "system", purpose: "posted-spend-repository-regression" });
    expect(result.byCategoryId.get(categoryA)?.toString()).toBe("140.00");
    expect(result.byCategoryId.get(categoryB)?.toString()).toBe("20.00");
    expect(result.byCategoryGroupId.get(groupId)?.toString()).toBe("160.00");
    expect(result.flexTotal.toString()).toBe("160.00");
  });
  it("retains omitted-state posted purchases and posted splits while excluding deleted and excluded records", async () => {
    await db.delete(transactions).where(inArray(transactions.id, [pendingId, pendingSplitId]));
    const [row] = await db.select({ pending: transactions.isPending, status: transactions.status }).from(transactions).where(eq(transactions.id, defaultPostedId));
    expect(row).toEqual({ pending: false, status: "cleared" });
    expect(await progress()).toEqual(expectedProgress("140.00", "860.00", "160.00", "840.00"));
  });
  it("preserves explicit nullable legacy status when the boolean marker is false", async () => {
    await db.delete(transactions).where(inArray(transactions.id, [pendingId, pendingSplitId]));
    await expense("10", { pending: false, status: null });
    await expense("20", { pending: false, status: null, split: ["15", "5"] });
    expect(await progress()).toEqual(expectedProgress("165.00", "835.00", "190.00", "810.00"));
    for (const reader of readers) {
      const expected = reader.name.startsWith("non-split") ? "110.00" : reader.name === "split-aware category" ? "165.00" : "190.00";
      expect((await reader.read()).toString(), reader.name).toBe(expected);
    }
    const batch = await budgetRepository.batchCalculateSpent(a, [categoryA, categoryB], [groupId], from, to, "ZMW",
      new Map([[categoryA, "expense"], [categoryB, "expense"]]), new Map([[groupId, "expense"]]), { kind: "system", purpose: "posted-spend-repository-regression" });
    expect(batch.byCategoryId.get(categoryA)?.toString()).toBe("165.00");
    expect(batch.byCategoryId.get(categoryB)?.toString()).toBe("25.00");
    expect(batch.byCategoryGroupId.get(groupId)?.toString()).toBe("190.00");
    expect(batch.flexTotal.toString()).toBe("190.00");
  });
  it("rejects a null posting state at the existing database boundary rather than treating it as posted", async () => {
    const invalidId = randomUUID();
    let failure: unknown;
    try {
      await db.insert(transactions).values({ id: invalidId, householdId: a, accountId: ids.sharedAccount, categoryId: categoryA,
        date, name: "Invalid unknown posting state", amount: "1", type: "expense", currency: "ZMW", isPending: sql`NULL` });
    } catch (error) { failure = error; }
    expect(getPostgresError(failure)?.code).toBe("23502");
    expect(await db.select({ id: transactions.id }).from(transactions).where(and(eq(transactions.householdId, a), eq(transactions.id, invalidId)))).toEqual([]);
  });
});
