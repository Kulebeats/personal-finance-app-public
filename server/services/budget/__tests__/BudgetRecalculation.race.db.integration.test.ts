/**
 * Budget auto-recalculation race — REAL DB.
 *
 * recalculateBudgets decides update-vs-insert per category from a read of the
 * household's existing budgets. That read ran OUTSIDE the transaction that then
 * performed the writes, on its own connection. So two concurrent recalcs (a
 * double-clicked "recalculate", a retried request, two household members acting
 * at once) both read "no budget exists for category X", both took the insert
 * branch, and the household ended up with TWO budget rows for one category.
 *
 * That corruption is silent: the UI lists one row per category, and every
 * downstream read (progress, forecast, reports) picks one of the duplicates
 * arbitrarily — so the user sees a budget whose value depends on which row won,
 * with no indication a second exists. Nothing self-corrects it; a later recalc
 * builds its map from the duplicates and updates only one of them.
 *
 * THE FIX and why it is shaped this way (the R18 phantom-row lesson):
 * Postgres has NO gap/next-key locking, so `FOR UPDATE` on the budget row would
 * lock NOTHING in the case that actually breaks — the row does not exist yet,
 * which is precisely why both racers insert. There is likewise no unique
 * constraint on (household_id, category_id) to collide on (adding one would need
 * a dedupe-first migration). So the fix takes the household row — which always
 * exists — as the serialization anchor with SELECT ... FOR UPDATE, and moves the
 * existing-budgets read inside the transaction, under that lock. The loser then
 * reads the winner's committed budget and takes the UPDATE branch.
 *
 * DETERMINISM — why this reproduces every run rather than by timing luck:
 *   - The pool is pre-warmed (10 concurrent SELECT 1) so neither racer pays a
 *     connection-setup cost that would accidentally serialize them.
 *   - The race window is structurally wide, not a narrow instruction gap: between
 *     the existing-budgets read and the insert, recalculateBudgets runs several
 *     awaited aggregate queries. Both racers are therefore always still inside
 *     that window when the other reads, so on unfixed code both ALWAYS insert.
 *   - The assertion is on the COMMITTED END STATE (how many budget rows exist for
 *     the category), never on which recalc won or on the returned created/updated
 *     counts. That makes it a true detector: 2 on old code, 1 on new code,
 *     regardless of scheduling. It is not relaxed to tolerate either outcome.
 *
 * RED evidence: with the fix reverted, `expect(categoryBudgets).toHaveLength(1)`
 * fails with 2 — reproduced on every run.
 *
 * Run explicitly:  cd server && npx vitest run BudgetRecalculation.race
 */
import { describe, it, expect, afterEach, beforeAll } from "vitest";
import { randomUUID } from "crypto";
import { eq, sql } from "drizzle-orm";

import { db } from "../../../db";
import {
  budgets,
  categories,
  categoryGroups,
  households,
  householdMembers,
  transactions,
  accounts,
  users,
} from "@shared/schema";
import { createTestUser } from "../../../__tests__/fixtures";
import { BudgetRecalculationService } from "../BudgetRecalculationService";

const service = new BudgetRecalculationService();

const createdHouseholdIds: string[] = [];
const createdUserIds: string[] = [];

describe("BudgetRecalculationService — concurrent recalc race", () => {
  beforeAll(async () => {
    // Pre-warm the pool so the two racers don't serialize on connection setup.
    await Promise.all(Array.from({ length: 10 }, () => db.execute(sql`SELECT 1`)));
  });

  afterEach(async () => {
    try {
      for (const id of createdHouseholdIds) {
        await db.delete(budgets).where(eq(budgets.householdId, id));
        await db.delete(transactions).where(eq(transactions.householdId, id));
        await db.delete(categories).where(eq(categories.householdId, id));
        await db.delete(categoryGroups).where(eq(categoryGroups.householdId, id));
        await db.delete(accounts).where(eq(accounts.householdId, id));
        await db.delete(householdMembers).where(eq(householdMembers.householdId, id));
        await db.delete(households).where(eq(households.id, id));
      }
      for (const id of createdUserIds) {
        await db.delete(users).where(eq(users.id, id));
      }
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error("budget recalc race cleanup error", error);
    }
    createdHouseholdIds.length = 0;
    createdUserIds.length = 0;
  });

  /**
   * Seeds a household with one spending category and a posted expense in a
   * previous month, so recalculateBudgets has exactly one category to budget and
   * no pre-existing budget row — the insert-vs-insert case that breaks.
   */
  async function seedHouseholdWithSpend() {
    const [hh] = await db
      .insert(households)
      .values({ name: `recalc-race-${randomUUID().slice(0, 8)}`, currency: "ZMW" })
      .returning();
    createdHouseholdIds.push(hh.id);

    const u = createTestUser({
      email: `recalc-race-${randomUUID().slice(0, 8)}@example.com`,
      username: `recalc-race-${randomUUID().slice(0, 8)}`,
    });
    await db.insert(users).values({
      id: u.id,
      email: u.email,
      username: u.username,
      passwordHash: u.passwordHash,
      fullName: u.fullName,
      emailVerified: u.emailVerified,
      mfaEnabled: u.mfaEnabled,
      failedLoginAttempts: u.failedLoginAttempts,
      lockedUntil: u.lockedUntil,
    });
    createdUserIds.push(u.id);
    await db
      .insert(householdMembers)
      .values({ householdId: hh.id, userId: u.id, role: "owner" });

    const [account] = await db
      .insert(accounts)
      .values({
        householdId: hh.id,
        name: "Everyday",
        type: "checking",
        currency: "ZMW",
      })
      .returning();

    const [group] = await db
      .insert(categoryGroups)
      .values({
        householdId: hh.id,
        name: "Living",
        // NOTE: the schema uses "expenses" (plural) for group type; recalc keys
        // its expense aggregation off exactly this value, so the singular would
        // silently produce a zero-amount budget rather than an error.
        type: "expenses",
        displayOrder: 1,
        budgetMode: "by_category",
      })
      .returning();

    const [category] = await db
      .insert(categories)
      .values({
        // NOTE: categories carries no `type` of its own — expense-vs-income is
        // determined by the parent group's type, which recalc reads.
        householdId: hh.id,
        name: "Groceries",
        displayOrder: 1,
        groupId: group.id,
      })
      .returning();

    // A posted expense in the previous month, so it falls inside the recalc
    // window (recalc looks back over completed months, never the current one).
    const now = new Date();
    const prevMonth = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 15),
    );
    await db.insert(transactions).values({
      householdId: hh.id,
      accountId: account.id,
      ownerUserId: u.id,
      date: prevMonth.toISOString().split("T")[0],
      name: "Grocery run",
      amount: "450.00",
      currency: "ZMW",
      type: "expense",
      categoryId: category.id,
    });

    return { householdId: hh.id, categoryId: category.id };
  }

  it("creates exactly one budget per category when two recalcs race", async () => {
    const { householdId, categoryId } = await seedHouseholdWithSpend();

    // Both recalcs believe no budget exists yet — the real-world double-click.
    const results = await Promise.allSettled([
      service.recalculateBudgets(householdId, 3),
      service.recalculateBudgets(householdId, 3),
    ]);

    // Neither recalc may fail: this is a safe, repeatable operation, and the
    // loser must converge on an update rather than erroring out.
    for (const r of results) {
      if (r.status === "rejected") {
        throw new Error(`recalculateBudgets rejected: ${r.reason}`);
      }
    }

    // THE ASSERTION THAT MATTERS: one category, one budget row. On the old code
    // this is 2 — a silent duplicate the UI cannot show.
    const categoryBudgets = await db
      .select()
      .from(budgets)
      .where(eq(budgets.categoryId, categoryId));

    expect(categoryBudgets).toHaveLength(1);
    expect(categoryBudgets[0].amount).toBe("450.00");

    // And the household holds no other stray budget rows.
    const allBudgets = await db
      .select()
      .from(budgets)
      .where(eq(budgets.householdId, householdId));
    expect(allBudgets).toHaveLength(1);
  });

  it("is idempotent: a recalc after an existing budget updates it rather than duplicating", async () => {
    const { householdId, categoryId } = await seedHouseholdWithSpend();

    // Sequential baseline — pins that the serialized outcome the race must
    // converge on is an UPDATE of the one row, not a second insert.
    await service.recalculateBudgets(householdId, 3);
    const second = await service.recalculateBudgets(householdId, 3);

    expect(second.created).toBe(0);
    expect(second.updated).toBe(1);

    const categoryBudgets = await db
      .select()
      .from(budgets)
      .where(eq(budgets.categoryId, categoryId));
    expect(categoryBudgets).toHaveLength(1);
  });
});
