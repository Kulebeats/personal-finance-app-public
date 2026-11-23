import { and, eq } from "drizzle-orm";
import { budgets, type Budget, type InsertBudget } from "@shared/schema";
import { db } from "../../db";
import { filterBudgets, loadBudgetContext } from "../budgetQueryUtils";
import type { TransactionType } from "../../utils/withTransaction";

export class BudgetCrudRepository {
  async findByHousehold(
    householdId: string,
    options?: { includeInactive?: boolean },
  ): Promise<Budget[]> {
    const results = await db
      .select()
      .from(budgets)
      .where(eq(budgets.householdId, householdId))
      .orderBy(budgets.name);

    const visible = options?.includeInactive
      ? results
      : results.filter((budget) => budget.isActive);

    if (visible.length === 0) return visible;

    const context = await loadBudgetContext(householdId, visible);
    return filterBudgets(visible, context);
  }

  async findById(id: string, householdId: string, tx?: TransactionType, forUpdate = false): Promise<Budget | undefined> {
    const query = (tx ?? db)
      .select()
      .from(budgets)
      .where(and(eq(budgets.id, id), eq(budgets.householdId, householdId)))
      .limit(1);
    const [budget] = await (tx && forUpdate ? query.for("update") : query);
    return budget;
  }

  async create(data: InsertBudget, tx?: TransactionType): Promise<Budget> {
    const [budget] = await (tx ?? db).insert(budgets).values(data).returning();
    return budget;
  }

  async update(
    id: string,
    householdId: string,
    data: Partial<Budget>,
    tx?: TransactionType,
  ): Promise<Budget | undefined> {
    const [budget] = await (tx ?? db)
      .update(budgets)
      .set({ ...data, updatedAt: new Date() })
      .where(and(eq(budgets.id, id), eq(budgets.householdId, householdId)))
      .returning();

    return budget;
  }

  async delete(id: string, householdId: string, tx?: TransactionType): Promise<boolean> {
    // The household scope on this single statement is the cross-tenant guard:
    // if the budget belongs to another household, nothing is deleted at all.
    // budget_periods cleanup rides the ON DELETE CASCADE on budgetId, inside
    // the same statement's implicit transaction.
    const result = await (tx ?? db)
      .delete(budgets)
      .where(and(eq(budgets.id, id), eq(budgets.householdId, householdId)))
      .returning({ id: budgets.id });

    return result.length > 0;
  }
}

export const budgetCrudRepository = new BudgetCrudRepository();
