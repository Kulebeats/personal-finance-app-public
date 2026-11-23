import { DollarSign } from "lucide-react";
import { parseMoney } from "@/lib/utils";
import { subtractMoneyValues, sumMoneyValues } from "@/lib/money";
import { type Category, type CategoryGroup } from "@/hooks/use-settings";
import { type BudgetWithProgress } from "@/hooks/useBudgets";
import { isUnbudgetedUnavailable, type UnbudgetedSpend } from "@/hooks/useUnbudgetedSpend";
import { unavailableBudgetFor, type UnavailableBudget } from "@/hooks/useUnavailableBudgets";
import type { BudgetGroup, BudgetCategory } from "../types";
import { groupActual, groupBudgetLimit, remainingBudget, sumBudgetLimits } from "../budgetLimits";
import { commonBudgetCurrency } from "../budgetMoneyDisplay";

export function buildBudgetGroupsFromApi(
  budgets: BudgetWithProgress[],
  categories: Category[],
  groups: CategoryGroup[],
  unavailable: readonly UnavailableBudget[] = [],
  reportingCurrency?: string | null,
): BudgetGroup[] {
  const budgetByCategoryId = new Map<string, BudgetWithProgress>();
  const budgetByGroupId = new Map<string, BudgetWithProgress>();
  const currency = reportingCurrency === undefined && budgets.length
    ? commonBudgetCurrency(budgets.flatMap(({ amount, spent, remaining }) => [amount, spent, remaining]))
    : reportingCurrency;

  budgets.forEach((budget) => {
    if (budget.isFlexBucket) return;
    if (budget.categoryId) {
      budgetByCategoryId.set(budget.categoryId, budget);
    }
    if (budget.categoryGroupId) {
      budgetByGroupId.set(budget.categoryGroupId, budget);
    }
  });

  const visibleGroups = groups
    .filter((group) => !group.isArchived && ["expense", "expenses", "income"].includes(group.type))
    .sort((a, b) => a.displayOrder - b.displayOrder);
  const visibleGroupIds = new Set(visibleGroups.map(group => group.id));

  const categoriesByGroup = new Map<string, Category[]>();
  categories.forEach((category) => {
    if (category.isArchived || category.deletedAt || !category.includeInBudget || !visibleGroupIds.has(category.groupId)) return;
    const list = categoriesByGroup.get(category.groupId) || [];
    list.push(category);
    categoriesByGroup.set(category.groupId, list);
  });

  return visibleGroups.map((group) => {
    const groupCategories = (categoriesByGroup.get(group.id) || []).sort(
      (a, b) => a.displayOrder - b.displayOrder,
    );
    const isGroupBudget = group.budgetMode === "by_group";
    const groupBudgetEntry = isGroupBudget ? budgetByGroupId.get(group.id) : undefined;
    const groupUnavailable = isGroupBudget && Boolean(unavailableBudgetFor(unavailable, { categoryGroupId: group.id }));
    const groupBudgetAmount = groupBudgetEntry
      ? parseMoney(groupBudgetEntry.amount)
      : null;
    const items = groupCategories.map((category): BudgetCategory => {
      const budgetEntry = isGroupBudget ? undefined : budgetByCategoryId.get(category.id);
      const categoryUnavailable = !isGroupBudget && Boolean(unavailableBudgetFor(unavailable, { categoryId: category.id }));

      return {
        id: category.id,
        name: category.name,
        icon: DollarSign,
        budget: budgetEntry ? parseMoney(budgetEntry.amount) : null,
        actual: budgetEntry ? parseMoney(budgetEntry.spent) : null,
        remaining: budgetEntry ? parseMoney(budgetEntry.remaining) : null,
        budgetId: budgetEntry?.id,
        currency: budgetEntry ? commonBudgetCurrency([budgetEntry.amount, budgetEntry.spent, budgetEntry.remaining]) : currency,
        coverage: groupBudgetEntry || groupUnavailable ? "group" : categoryUnavailable ? "unavailable" : undefined,
      };
    });

    const mappedType = group.type === "income" ? "income" : "expense";
    const hasWithheldLimit = groupUnavailable || items.some(item => item.coverage === "unavailable");

    return {
      id: group.id,
      name: group.name,
      type: mappedType,
      expanded: true,
      items,
      budget: isGroupBudget ? groupBudgetAmount : undefined,
      hasWithheldLimit,
      budgetId: isGroupBudget ? groupBudgetEntry?.id : undefined,
      actual: groupBudgetEntry ? parseMoney(groupBudgetEntry.spent) : undefined,
      actualIncomplete: hasWithheldLimit,
      currency: groupBudgetEntry ? commonBudgetCurrency([groupBudgetEntry.amount, groupBudgetEntry.spent, groupBudgetEntry.remaining]) : currency,
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
  hasWithheldFlexLimit?: boolean;
  flexBudgetEditCurrency?: string | null;
  flexBudgetEditPending?: boolean;
  currency?: string | null;
}): BudgetGroup[] {
  const { groups, flexBudgetDraft, flexBudgetAmount, flexBudgetId, hasWithheldFlexLimit, flexBudgetEditCurrency, flexBudgetEditPending, currency } = options;
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

  const fixedGroups: BudgetGroup[] = [];
  const flexibleGroups: BudgetGroup[] = [];
  const nonMonthlyGroups: BudgetGroup[] = [];

  expenseGroups.forEach((group) => {
    if (nonMonthlyGroupIds.has(group.id)) {
      nonMonthlyGroups.push(group);
    } else if (fixedGroupIds.has(group.id)) {
      fixedGroups.push(group);
    } else {
      flexibleGroups.push(group);
    }
  });

  const bucket = (source: BudgetGroup[]) => ({
    items: source.flatMap(group => group.items),
    budget: sumBudgetLimits(source.map(groupBudgetLimit)),
    hasWithheldLimit: source.some(group => group.hasWithheldLimit),
    actual: sumMoneyValues(source.map(groupActual)).toNumber(),
    actualIncomplete: source.some(group => group.actualIncomplete),
    currency,
  });
  const fixed = bucket(fixedGroups), flexible = bucket(flexibleGroups), nonMonthly = bucket(nonMonthlyGroups);
  const availableFlex = Number.isFinite(flexBudgetAmount) ? flexBudgetAmount : undefined;
  const hasFlex = flexBudgetId !== undefined || availableFlex !== undefined;
  const flexibleBudgetValue = hasWithheldFlexLimit ? null : hasFlex ? availableFlex ?? null : flexible.budget;
  const flexibleLimitWithheld = Boolean(hasWithheldFlexLimit || (hasFlex ? availableFlex === undefined : flexible.hasWithheldLimit));

  const nextExpenseGroups: BudgetGroup[] = [];

  if (fixed.items.length > 0 || fixed.budget !== null || fixed.actual !== 0 || fixed.actualIncomplete) {
    nextExpenseGroups.push({
      id: "fixed-expenses",
      name: "Fixed",
      type: "expense",
      ...fixed,
      expanded: true,
    });
  }

  nextExpenseGroups.push({
    id: "flexible-expenses",
    name: "Flexible",
    type: "expense",
    ...flexible,
    expanded: true,
    isFlexible: true,
    budget: flexibleBudgetValue,
    hasWithheldLimit: flexibleLimitWithheld,
    budgetDraft: flexBudgetDraft,
    budgetEditCurrency: hasWithheldFlexLimit ? null : flexBudgetEditCurrency,
    budgetEditPending: flexBudgetEditPending,
    budgetId: flexBudgetId,
  });

  if (nonMonthly.items.length > 0 || nonMonthly.budget !== null || nonMonthly.actual !== 0 || nonMonthly.actualIncomplete) {
    nextExpenseGroups.push({
      id: "non-monthly-expenses",
      name: "Non-Monthly",
      type: "expense",
      ...nonMonthly,
      expanded: true,
    });
  }

  return [...otherGroups, ...nextExpenseGroups];
}

/**
 * A section's spending in categories no budget covers, to add to its total; 0 when not
 * reported. When it is unavailable (null) the caller marks the total incomplete (N3).
 */
export function unbudgetedActual(spend: UnbudgetedSpend | undefined, type: "income" | "expense"): number {
  return parseMoney(spend?.[type]);
}

export function calculateBudgetTotals(groups: BudgetGroup[], unbudgeted?: UnbudgetedSpend, currency?: string | null) {
  const totalsFor = (type: "income" | "expense") => {
    const section = groups.filter(g => g.type === type);
    const limit = sumBudgetLimits(section.map(groupBudgetLimit));
    // Both display modes partition detailed actuals. Add unbudgeted spending once.
    const actual = sumMoneyValues([...section.map(groupActual), unbudgetedActual(unbudgeted, type)]).toNumber();
    const incomplete = currency === null || isUnbudgetedUnavailable(unbudgeted?.[type]) ||
      section.some(group => group.hasWithheldLimit || group.actualIncomplete || group.currency === null);
    return { limit, actual, remaining: incomplete ? null : remainingBudget(limit, actual) };
  };
  const income = totalsFor("income"), expense = totalsFor("expense");
  return {
    totalIncomeBudget: income.limit,
    totalIncomeActual: income.actual,
    totalExpenseBudget: expense.limit,
    totalExpenseActual: expense.actual,
    incomeRemaining: income.remaining,
    expenseRemaining: expense.remaining,
    // The existing helper contract represents observed actuals. The page
    // computes its planned difference separately, with completeness checks.
    leftToBudget: subtractMoneyValues(income.actual, expense.actual).toNumber(),
  };
}
