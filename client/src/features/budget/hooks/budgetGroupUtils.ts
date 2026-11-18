import { DollarSign } from "lucide-react";
import { parseMoney } from "@/lib/utils";
import { sumMoneyValues, subtractMoneyValues } from "@/lib/money";
import { type Category, type CategoryGroup } from "@/hooks/use-settings";
import { type BudgetWithProgress } from "@/hooks/useBudgets";
import type { BudgetGroup, BudgetCategory } from "../types";

export function buildBudgetGroupsFromApi(
  budgets: BudgetWithProgress[],
  categories: Category[],
  groups: CategoryGroup[],
): BudgetGroup[] {
  const budgetByCategoryId = new Map<string, BudgetWithProgress>();
  const budgetByGroupId = new Map<string, BudgetWithProgress>();

  budgets.forEach((budget) => {
    if (budget.isFlexBucket) return;
    if (budget.categoryId) {
      budgetByCategoryId.set(budget.categoryId, budget);
    }
    if (budget.categoryGroupId) {
      budgetByGroupId.set(budget.categoryGroupId, budget);
    }
  });

  const groupById = new Map(groups.map((group) => [group.id, group]));
  const visibleGroups = groups
    .filter((group) => !group.isArchived && group.type !== "transfers")
    .sort((a, b) => a.displayOrder - b.displayOrder);

  const categoriesByGroup = new Map<string, Category[]>();
  categories.forEach((category) => {
    if (category.isArchived) return;
    if (!category.includeInBudget) return;
    const group = groupById.get(category.groupId);
    if (!group || group.isArchived) return;
    if (group.type === "transfers") return;
    const list = categoriesByGroup.get(category.groupId) || [];
    list.push(category);
    categoriesByGroup.set(category.groupId, list);
  });

  return visibleGroups.map((group) => {
    const groupCategories = (categoriesByGroup.get(group.id) || []).sort(
      (a, b) => a.displayOrder - b.displayOrder,
    );
    const groupBudgetEntry = budgetByGroupId.get(group.id);
    const groupBudgetAmount = groupBudgetEntry
      ? parseMoney(groupBudgetEntry.amount)
      : undefined;
    const isGroupBudget = group.budgetMode === "by_group";

    const items = groupCategories.map((category) => {
      const budgetEntry = budgetByCategoryId.get(category.id);
      const budgetAmount = isGroupBudget
        ? 0
        : Number.isFinite(category.budget)
          ? parseMoney(category.budget)
          : budgetEntry
            ? parseMoney(budgetEntry.amount)
            : 0;
      const actualAmount = budgetEntry
        ? parseMoney(budgetEntry.spent)
        : category.spent || 0;
      const remainingAmount = isGroupBudget
        ? 0
        : budgetEntry
          ? parseMoney(budgetEntry.remaining)
          : subtractMoneyValues(budgetAmount, actualAmount).toNumber();

      return {
        id: category.id,
        name: category.name,
        icon: DollarSign,
        budget: budgetAmount,
        actual: actualAmount,
        remaining: remainingAmount,
        budgetId: budgetEntry?.id,
      };
    });

    const mappedType = group.type === "income" ? "income" : "expense";

    return {
      id: group.id,
      name: group.name,
      type: mappedType,
      expanded: true,
      items,
      budget: isGroupBudget
        ? Number.isFinite(groupBudgetAmount)
          ? groupBudgetAmount
          : 0
        : undefined,
      budgetId: isGroupBudget ? groupBudgetEntry?.id : undefined,
      budgetMode: group.budgetMode as "by_category" | "by_group",
      isGroupBudget,
    };
  });
}

export function buildFlexDisplayGroups(options: {
  groups: BudgetGroup[];
  flexBudgetDraft?: number;
  flexBudgetAmount?: number;
  flexBudgetId?: string;
}): BudgetGroup[] {
  const { groups, flexBudgetDraft, flexBudgetAmount, flexBudgetId } = options;
  const expenseGroups = groups.filter((g) => g.type === "expense");
  const otherGroups = groups.filter((g) => g.type !== "expense");
  const fixedGroupIds = new Set(
    expenseGroups
      .filter((group) => group.budgetMode === "by_group")
      .map((group) => group.id),
  );
  const nonMonthlyGroupIds = new Set(
    expenseGroups
      .filter((group) => group.name.toLowerCase().includes("non-monthly"))
      .map((group) => group.id),
  );

  const fixedItems: BudgetCategory[] = [];
  const flexibleItems: BudgetCategory[] = [];
  const nonMonthlyItems: BudgetCategory[] = [];

  expenseGroups.forEach((group) => {
    if (nonMonthlyGroupIds.has(group.id)) {
      nonMonthlyItems.push(...group.items);
    } else if (fixedGroupIds.has(group.id)) {
      fixedItems.push(...group.items);
    } else {
      flexibleItems.push(...group.items);
    }
  });

  const fallbackFlexBudget = sumMoneyValues(
    flexibleItems.map((item) => item.budget),
  ).toNumber();
  const flexibleBudgetValue = Number.isFinite(flexBudgetDraft)
    ? flexBudgetDraft
    : Number.isFinite(flexBudgetAmount)
      ? flexBudgetAmount
      : fallbackFlexBudget;

  const nextExpenseGroups: BudgetGroup[] = [];

  if (fixedItems.length > 0) {
    nextExpenseGroups.push({
      id: "fixed-expenses",
      name: "Fixed",
      type: "expense",
      items: fixedItems,
      expanded: true,
    });
  }

  nextExpenseGroups.push({
    id: "flexible-expenses",
    name: "Flexible",
    type: "expense",
    items: flexibleItems,
    expanded: true,
    isFlexible: true,
    budget: flexibleBudgetValue,
    budgetId: flexBudgetId,
  });

  if (nonMonthlyItems.length > 0) {
    nextExpenseGroups.push({
      id: "non-monthly-expenses",
      name: "Non-Monthly",
      type: "expense",
      items: nonMonthlyItems,
      expanded: true,
    });
  }

  return [...otherGroups, ...nextExpenseGroups];
}

export function calculateBudgetTotals(groups: BudgetGroup[]) {
  const calculateTotalBudget = (type: string) => {
    const groupBudgets = groups
      .filter((g) => g.type === type)
      .map((group) =>
        group.isFlexible && group.budget !== undefined
          ? group.budget
          : sumMoneyValues(group.items.map((item) => item.budget)).toNumber(),
      );
    return sumMoneyValues(groupBudgets).toNumber();
  };

  const calculateTotalActual = (type: string) => {
    const groupActuals = groups
      .filter((g) => g.type === type)
      .map((group) =>
        sumMoneyValues(group.items.map((item) => item.actual)).toNumber(),
      );
    return sumMoneyValues(groupActuals).toNumber();
  };

  const totalIncomeBudget = calculateTotalBudget("income");
  const totalIncomeActual = calculateTotalActual("income");
  const totalExpenseBudget = calculateTotalBudget("expense");
  const totalExpenseActual = calculateTotalActual("expense");
  const incomeRemaining = subtractMoneyValues(
    totalIncomeBudget,
    totalIncomeActual,
  ).toNumber();
  const expenseRemaining = subtractMoneyValues(
    totalExpenseBudget,
    totalExpenseActual,
  ).toNumber();
  const leftToBudget = subtractMoneyValues(
    totalIncomeActual,
    totalExpenseActual,
  ).toNumber();

  return {
    totalIncomeBudget,
    totalIncomeActual,
    totalExpenseBudget,
    totalExpenseActual,
    incomeRemaining,
    expenseRemaining,
    leftToBudget,
  };
}
