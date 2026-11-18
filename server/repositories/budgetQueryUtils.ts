import { db } from "../db";
import { categories, categoryGroups, type Budget } from "@shared/schema";
import { and, eq, inArray } from "drizzle-orm";

export type BudgetContext = {
  categoryMap: Map<
    string,
    {
      id: string;
      groupId: string | null;
      includeInBudget: boolean | null;
      isArchived: boolean | null;
      rolloverEnabled: boolean | null;
      rolloverStartBalance: string | null;
    }
  >;
  groupMap: Map<
    string,
    {
      id: string;
      budgetMode: string | null;
      isArchived: boolean | null;
      type: string | null;
      rolloverEnabled: boolean | null;
    }
  >;
};

export async function loadBudgetContext(
  householdId: string,
  budgetsList: Budget[],
): Promise<BudgetContext> {
  const categoryIds = budgetsList
    .map((budget) => budget.categoryId)
    .filter((id): id is string => Boolean(id));

  const categoryRows = categoryIds.length
    ? await db
        .select({
          id: categories.id,
          groupId: categories.groupId,
          includeInBudget: categories.includeInBudget,
          isArchived: categories.isArchived,
          rolloverEnabled: categories.rolloverEnabled,
          rolloverStartBalance: categories.rolloverStartBalance,
        })
        .from(categories)
        .where(
          and(
            eq(categories.householdId, householdId),
            inArray(categories.id, categoryIds),
          ),
        )
    : [];

  const groupIds = new Set<string>();
  for (const category of categoryRows) {
    if (category.groupId) groupIds.add(category.groupId);
  }
  for (const budget of budgetsList) {
    if (budget.categoryGroupId) groupIds.add(budget.categoryGroupId);
  }

  const groupRows = groupIds.size
    ? await db
        .select({
          id: categoryGroups.id,
          budgetMode: categoryGroups.budgetMode,
          isArchived: categoryGroups.isArchived,
          type: categoryGroups.type,
          rolloverEnabled: categoryGroups.rolloverEnabled,
        })
        .from(categoryGroups)
        .where(
          and(
            eq(categoryGroups.householdId, householdId),
            inArray(categoryGroups.id, Array.from(groupIds)),
          ),
        )
    : [];

  return {
    categoryMap: new Map(categoryRows.map((row) => [row.id, row])),
    groupMap: new Map(groupRows.map((row) => [row.id, row])),
  };
}

export function filterBudgets(
  budgetsList: Budget[],
  context: BudgetContext,
): Budget[] {
  return budgetsList.filter((budget) => {
    if (budget.isFlexBucket) {
      return true;
    }

    if (budget.categoryId) {
      const category = context.categoryMap.get(budget.categoryId);
      if (!category || category.isArchived || !category.includeInBudget) {
        return false;
      }

      const group = category.groupId
        ? context.groupMap.get(category.groupId)
        : null;

      if (!group || group.isArchived) return false;
      if (group.type === "transfers") return false;
      if (group.budgetMode === "by_group") return false;
      return true;
    }

    if (budget.categoryGroupId) {
      const group = context.groupMap.get(budget.categoryGroupId);
      if (!group || group.isArchived) return false;
      if (group.type === "transfers") return false;
      if (group.budgetMode !== "by_group") return false;
      return true;
    }

    return false;
  });
}
