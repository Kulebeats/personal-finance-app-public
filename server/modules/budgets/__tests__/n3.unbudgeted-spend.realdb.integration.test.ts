import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { budgets, categories, categoryGroups, transactions } from "@shared/schema";
import { db } from "../../../db";
import { Money } from "../../../core/money";
import { a, actors, app, ids, reset, start, stop, type Role } from "../../tags/__tests__/completion-r04.tags.fixture";

/**
 * N3 (owner ruling, 20 Nov): on a new household the expense section read 0.00
 * spent with a 42.50 expense posted in a category without a limit. Only a
 * budget row carried what was spent. Progress now reports that spending apart,
 * per section, so the page shows it as an "Unbudgeted" line in the total.
 */
const groupId = randomUUID(), budgeted = randomUUID(), unbudgeted = randomUUID(), budgetId = randomUUID();
const date = "2026-02-15";
type MoneyDto = { amount: string; currency: string };
type Progress = { data: Array<{ id: string; categoryId: string | null; categoryGroupId: string | null; spent: MoneyDto }>;
  meta: { unbudgetedSpent: { expense: MoneyDto | null; income: MoneyDto | null } } };

async function clear() {
  await db.delete(budgets).where(eq(budgets.householdId, a));
  await db.delete(categories).where(eq(categories.householdId, a));
  await db.delete(categoryGroups).where(eq(categoryGroups.householdId, a));
}
async function expense(categoryId: string, amount: string, accountId = ids.sharedAccount) {
  await db.insert(transactions).values({ id: randomUUID(), householdId: a, accountId, ownerUserId: actors.get("owner")!.id,
    categoryId, date, name: "Synthetic N3 expense", amount, type: "expense", currency: "ZMW", isPending: false });
}
async function progress(role: Role = "member"): Promise<Progress> {
  const response = await request(app).get("/api/budgets/progress?year=2026&month=2")
    .set("Cookie", actors.get(role)!.cookie).expect(200);
  return response.body;
}
/** What the expense section shows: its budget rows plus the unbudgeted line. */
function sectionTotal(body: Progress): string {
  return body.data.reduce((sum, row) => sum.add(new Money(row.spent.amount, "ZMW")),
    new Money(body.meta.unbudgetedSpent.expense?.amount ?? "0", "ZMW")).toString();
}

describe("N3: a section's spent total includes spending in categories without a limit", () => {
  beforeAll(start, 20_000);
  beforeEach(async () => {
    await reset(); await clear();
    await db.insert(categoryGroups).values({ id: groupId, householdId: a, name: "N3 expenses", type: "expenses", budgetMode: "by_category", isArchived: false, displayOrder: 0 });
    await db.insert(categories).values([
      { id: budgeted, householdId: a, groupId, name: "N3 budgeted", includeInBudget: true, isArchived: false, displayOrder: 0 },
      { id: unbudgeted, householdId: a, groupId, name: "N3 no limit", includeInBudget: true, isArchived: false, displayOrder: 1 },
    ]);
  });
  afterAll(async () => { await clear(); await stop(); });

  it("reports a new household's only expense, in a category without a limit, as unbudgeted spending", async () => {
    await expense(unbudgeted, "42.50");
    const body = await progress();
    expect(body.data).toEqual([]);
    expect(body.meta.unbudgetedSpent).toEqual({ expense: { amount: "42.50", currency: "ZMW" }, income: { amount: "0.00", currency: "ZMW" } });
    expect(sectionTotal(body)).toBe("42.50");
  });

  it("keeps the budget row as it was and adds the unbudgeted expense to the section total", async () => {
    await db.insert(budgets).values({ id: budgetId, householdId: a, name: "N3 limit", categoryId: budgeted, amount: "1000", period: "monthly" });
    await expense(budgeted, "100.00");
    await expense(unbudgeted, "42.50");
    const body = await progress();
    expect(body.data.map((row) => ({ id: row.id, spent: row.spent }))).toEqual([{ id: budgetId, spent: { amount: "100.00", currency: "ZMW" } }]);
    expect(body.meta.unbudgetedSpent.expense).toEqual({ amount: "42.50", currency: "ZMW" });
    expect(sectionTotal(body)).toBe("142.50");
  });

  it("counts only what the reader can see: another member's private expense stays out", async () => {
    await expense(unbudgeted, "42.50");
    await expense(unbudgeted, "900.00", ids.privateAccount);
    expect((await progress("member")).meta.unbudgetedSpent.expense).toEqual({ amount: "42.50", currency: "ZMW" });
    expect((await progress("owner")).meta.unbudgetedSpent.expense).toEqual({ amount: "942.50", currency: "ZMW" });
  });

  it.each([["Fixed", "expense"], ["Workshop and parts", "expenses"]])(
    "reports the group budget for stored %s membership separately from unbudgeted categories", async (name, type) => {
    const lockedGroup = randomUUID(), covered = randomUUID(), alsoCovered = randomUUID();
    await db.insert(categoryGroups).values({ id: lockedGroup, householdId: a, name,
      type, budgetMode: "by_group", displayOrder: 1 });
    await db.insert(categories).values([
      { id: covered, groupId: lockedGroup, householdId: a, name: "First covered category", displayOrder: 0 },
      { id: alsoCovered, groupId: lockedGroup, householdId: a, name: "Second covered category", displayOrder: 1 },
    ]);
    await db.insert(budgets).values({ id: budgetId, householdId: a, name, categoryGroupId: lockedGroup,
      amount: "500.00", currency: "ZMW", period: "monthly" });
    await expense(covered, "80.00");
    await expense(alsoCovered, "40.00");
    await expense(unbudgeted, "42.50");
    await expense(covered, "900.00", ids.privateAccount);

    const categoriesResponse = await request(app).get("/api/categories").set("Cookie", actors.get("member")!.cookie).expect(200);
    expect(categoriesResponse.body.data.groups).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: lockedGroup, name, budgetMode: "by_group", type }),
    ]));
    expect(categoriesResponse.body.data.categories).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: covered, groupId: lockedGroup }),
      expect.objectContaining({ id: alsoCovered, groupId: lockedGroup }),
      expect.objectContaining({ id: unbudgeted, groupId }),
    ]));
    const body = await progress();
    expect(body.data).toEqual([expect.objectContaining({ id: budgetId, categoryGroupId: lockedGroup, categoryId: null,
      amount: { amount: "500.00", currency: "ZMW" }, spent: { amount: "120.00", currency: "ZMW" },
      remaining: { amount: "380.00", currency: "ZMW" } })]);
    expect(body.meta.unbudgetedSpent.expense).toEqual({ amount: "42.50", currency: "ZMW" });
    expect(sectionTotal(body)).toBe("162.50");
  });

  it("exposes flex and detailed spending as overlapping scopes to the signed dashboard caller", async () => {
    const legacyGroup = randomUUID(), legacyCategory = randomUUID(), flex = randomUUID(), groupLimit = randomUUID();
    await db.insert(categoryGroups).values({ id: legacyGroup, householdId: a, name: "Synthetic legacy group",
      type: "expense", budgetMode: "by_group", displayOrder: 1 });
    await db.insert(categories).values({ id: legacyCategory, householdId: a, groupId: legacyGroup,
      name: "Synthetic legacy category", displayOrder: 0 });
    await db.insert(budgets).values([
      { id: flex, householdId: a, name: "Synthetic flex", isFlexBucket: true, amount: "400.00", currency: "ZMW" },
      { id: groupLimit, householdId: a, name: "Legacy group limit", categoryGroupId: legacyGroup, amount: "500.00", currency: "ZMW" },
      { id: budgetId, householdId: a, name: "Category limit", categoryId: budgeted, amount: "100.00", currency: "ZMW" },
    ]);
    await expense(legacyCategory, "120.00");
    await expense(budgeted, "75.00");
    await expense(unbudgeted, "42.50");

    const body = await progress();
    expect(body.data).toHaveLength(3);
    expect(body.data).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: flex, isFlexBucket: true, spent: { amount: "237.50", currency: "ZMW" } }),
      expect.objectContaining({ id: groupLimit, categoryGroupId: legacyGroup, spent: { amount: "120.00", currency: "ZMW" } }),
      expect.objectContaining({ id: budgetId, categoryId: budgeted, spent: { amount: "75.00", currency: "ZMW" } }),
    ]));
    expect(body.meta.unbudgetedSpent.expense).toEqual({ amount: "42.50", currency: "ZMW" });
  });
});
