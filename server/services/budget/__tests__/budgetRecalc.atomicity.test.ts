/**
 * SCP-322: budget recalculation writes (delete + per-budget update/insert) must be
 * atomic. recalculateBudgets now wraps its write sequence in withTransaction, so a
 * mid-sequence failure rolls back fully instead of leaving partial/corrupt budgets.
 *
 * This proves the atomicity guarantee on the budgets table (the heart of the fix):
 * a failure after the first write leaves NO rows; a clean run commits all.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "../../../db";
import { eq } from "drizzle-orm";
import { budgets, households } from "@shared/schema";
import { withTransaction } from "../../../utils/withTransaction";
import { createTestHousehold } from "../../../__tests__/fixtures";

describe("Budget recalc atomicity (SCP-322)", () => {
  let householdId: string;

  beforeAll(async () => {
    const hh = createTestHousehold("seed", { name: `scp322-${Date.now()}` });
    householdId = hh.id;
    await db.insert(households).values({
      id: hh.id,
      name: hh.name,
      currency: hh.currency,
    });
  });

  afterAll(async () => {
    try {
      await db.delete(budgets).where(eq(budgets.householdId, householdId));
      await db.delete(households).where(eq(households.id, householdId));
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error("SCP-322 cleanup error", error);
    }
  });

  const countBudgets = async () =>
    (await db.select().from(budgets).where(eq(budgets.householdId, householdId)))
      .length;

  it("rolls back ALL budget writes when the sequence fails mid-way", async () => {
    const before = await countBudgets();
    await expect(
      withTransaction(async (tx) => {
        await tx.insert(budgets).values({
          householdId,
          name: "Atomic A",
          amount: "100.00",
          period: "monthly",
        });
        await tx.insert(budgets).values({
          householdId,
          name: "Atomic B",
          amount: "200.00",
          period: "monthly",
        });
        throw new Error("simulated mid-sequence failure");
      }),
    ).rejects.toThrow("simulated mid-sequence failure");

    // Neither insert may persist — full rollback.
    expect(await countBudgets()).toBe(before);
  });

  it("commits all budget writes when the sequence succeeds", async () => {
    await withTransaction(async (tx) => {
      await tx.insert(budgets).values({
        householdId,
        name: "Commit A",
        amount: "300.00",
        period: "monthly",
      });
      await tx.insert(budgets).values({
        householdId,
        name: "Commit B",
        amount: "400.00",
        period: "monthly",
      });
    });
    const rows = await db
      .select()
      .from(budgets)
      .where(eq(budgets.householdId, householdId));
    expect(rows.filter((r) => r.name.startsWith("Commit")).length).toBe(2);
  });
});
