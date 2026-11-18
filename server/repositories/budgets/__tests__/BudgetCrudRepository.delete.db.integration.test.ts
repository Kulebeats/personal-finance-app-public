/**
 * BudgetCrudRepository.delete — cross-tenant guard (real DB)
 *
 * Regression: delete() used to remove budget_periods scoped ONLY by budgetId
 * BEFORE the household-scoped budgets delete, in two separate statements with
 * no transaction — any authenticated user could destroy another household's
 * period history (rollover/spend cache) by sending a foreign budget UUID and
 * would still receive a 404. Now a single household-scoped budgets delete
 * decides whether anything is deleted at all; budget_periods cleanup rides
 * the ON DELETE CASCADE inside the same statement.
 *
 * Run against the test DB ONLY (never finance_app):
 *   DATABASE_URL=...finance_app_test npx vitest run \
 *     --config server/vitest.config.ts \
 *     server/repositories/budgets/__tests__/BudgetCrudRepository.delete.db.integration.test.ts
 *
 * @module repositories/budgets/__tests__/BudgetCrudRepository.delete.db.integration
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "crypto";
import { eq } from "drizzle-orm";
import { db } from "../../../db";
import { households, budgets, budgetPeriods } from "@shared/schema";
import { budgetCrudRepository } from "../BudgetCrudRepository";

describe("BudgetCrudRepository.delete — cross-tenant guard (real DB)", () => {
  const attackerHouseholdId = randomUUID();
  const victimHouseholdId = randomUUID();
  const victimBudgetId = randomUUID();

  beforeAll(async () => {
    await db.insert(households).values([
      {
        id: attackerHouseholdId,
        name: "Attacker household",
        currency: "ZMW",
      },
      {
        id: victimHouseholdId,
        name: "Victim household",
        currency: "ZMW",
      },
    ]);

    await db.insert(budgets).values({
      id: victimBudgetId,
      householdId: victimHouseholdId,
      name: "Victim budget",
      amount: "1000.00",
      period: "monthly",
    });

    await db.insert(budgetPeriods).values({
      budgetId: victimBudgetId,
      startDate: "2026-06-01",
      endDate: "2026-06-30",
      budgetAmount: "1000.00",
    });
  });

  afterAll(async () => {
    await db
      .delete(budgetPeriods)
      .where(eq(budgetPeriods.budgetId, victimBudgetId));
    await db.delete(budgets).where(eq(budgets.householdId, victimHouseholdId));
    await db.delete(households).where(eq(households.id, attackerHouseholdId));
    await db.delete(households).where(eq(households.id, victimHouseholdId));
  });

  it("deletes nothing when the budget belongs to another household", async () => {
    const deleted = await budgetCrudRepository.delete(
      victimBudgetId,
      attackerHouseholdId,
    );
    expect(deleted).toBe(false);

    const periods = await db
      .select()
      .from(budgetPeriods)
      .where(eq(budgetPeriods.budgetId, victimBudgetId));
    expect(periods).toHaveLength(1);

    const [budget] = await db
      .select()
      .from(budgets)
      .where(eq(budgets.id, victimBudgetId));
    expect(budget).toBeDefined();
  });

  it("deletes the budget and cascades its periods for the owning household", async () => {
    const deleted = await budgetCrudRepository.delete(
      victimBudgetId,
      victimHouseholdId,
    );
    expect(deleted).toBe(true);

    const periods = await db
      .select()
      .from(budgetPeriods)
      .where(eq(budgetPeriods.budgetId, victimBudgetId));
    expect(periods).toHaveLength(0);

    const remaining = await db
      .select()
      .from(budgets)
      .where(eq(budgets.id, victimBudgetId));
    expect(remaining).toHaveLength(0);
  });
});
