/**
 * useBudgetGroups Hook
 *
 * Manages budget group state, data transformations, and calculations.
 * Extracted from useBudgetPageData to reduce complexity.
 */

import { useState, useEffect, useMemo } from "react";
import { type Category, type CategoryGroup } from "@/hooks/use-settings";
import {
  type BudgetWithProgress,
  useCreateBudget,
  useUpdateBudget,
} from "@/hooks/useBudgets";
import { parseMoney } from "@/lib/utils";
import type { BudgetGroup, BudgetCategory } from "../types";
import {
  buildBudgetGroupsFromApi,
  buildFlexDisplayGroups,
  calculateBudgetTotals,
} from "./budgetGroupUtils";

interface UseBudgetGroupsProps {
  apiBudgets: BudgetWithProgress[] | undefined;
  categories: Category[];
  categoryGroups: CategoryGroup[];
  budgetSystem: "flex" | "category";
  currency: string;
  createBudget: ReturnType<typeof useCreateBudget>;
  updateBudget: ReturnType<typeof useUpdateBudget>;
  setLocation: (path: string) => void;
}

const initialGroups: BudgetGroup[] = [];

export function useBudgetGroups({
  apiBudgets,
  categories,
  categoryGroups,
  budgetSystem,
  currency,
  createBudget,
  updateBudget,
  setLocation,
}: UseBudgetGroupsProps) {
  const [groups, setGroups] = useState<BudgetGroup[]>(initialGroups);
  const [flexBudgetDraft, setFlexBudgetDraft] = useState<number | undefined>(
    undefined,
  );
  const [showUnbudgetedBySection, setShowUnbudgetedBySection] = useState<
    Record<string, boolean>
  >({});

  const flexBudgetGroupId = "flexible-expenses";
  const isFlexEnabled = budgetSystem === "flex";

  const flexBudget = apiBudgets?.find((budget) => budget.isFlexBucket);
  const flexBudgetAmount = flexBudget
    ? parseMoney(flexBudget.amount)
    : undefined;

  const groupBudgetLookup = useMemo(() => {
    const map = new Map<string, BudgetWithProgress>();
    (apiBudgets || []).forEach((budget) => {
      if (budget.categoryGroupId) {
        map.set(budget.categoryGroupId, budget);
      }
    });
    return map;
  }, [apiBudgets]);

  useEffect(() => {
    if (!Number.isFinite(flexBudgetAmount)) return;
    setFlexBudgetDraft(flexBudgetAmount);
  }, [flexBudgetAmount]);

  // Transform API data to UI format
  useEffect(() => {
    if (!apiBudgets || !categories || !categoryGroups) return;
    const apiGroups = buildBudgetGroupsFromApi(
      apiBudgets || [],
      categories,
      categoryGroups,
    );
    setGroups(apiGroups);
  }, [apiBudgets, categories, categoryGroups]);

  // Actions
  const toggleGroup = (id: string) => {
    setGroups(
      groups.map((g) => (g.id === id ? { ...g, expanded: !g.expanded } : g)),
    );
  };

  const addItemToGroup = (_groupId: string) => {
    setLocation("/settings/categories");
  };

  const updateItem = (
    groupId: string,
    itemId: string,
    field: keyof BudgetCategory,
    value: BudgetCategory[keyof BudgetCategory],
  ) => {
    setGroups(
      groups.map((g) => {
        if (g.id === groupId) {
          const updatedItems = g.items.map((item) => {
            if (item.id === itemId) {
              const updatedItem = { ...item, [field]: value };
              if (field === "budget" || field === "actual") {
                updatedItem.remaining = updatedItem.budget - updatedItem.actual;
              }
              return updatedItem;
            }
            return item;
          });
          return { ...g, items: updatedItems };
        }
        return g;
      }),
    );
  };

  const updateGroupBudget = (groupId: string, val: number) => {
    if (groupId === flexBudgetGroupId) {
      if (Number.isFinite(val)) {
        setFlexBudgetDraft(val);
      }
      return;
    }
    setGroups(
      groups.map((g) => (g.id === groupId ? { ...g, budget: val } : g)),
    );
  };

  const commitGroupBudget = (groupId: string, val: number) => {
    if (!Number.isFinite(val)) return;

    if (groupId === flexBudgetGroupId) {
      if (!flexBudget?.id) return;
      if (Number.isFinite(flexBudgetAmount) && val === flexBudgetAmount) return;
      updateBudget.mutate(
        {
          id: flexBudget.id,
          data: { amount: { amount: val.toFixed(2), currency } },
        },
        {
          onError: () => {
            if (Number.isFinite(flexBudgetAmount))
              setFlexBudgetDraft(flexBudgetAmount);
          },
        },
      );
      return;
    }

    const targetGroup = groups.find((g) => g.id === groupId);
    if (!targetGroup) return;
    if (!targetGroup.budgetId) {
      createBudget.mutate({
        name: targetGroup.name,
        categoryGroupId: groupId,
        amount: { amount: val.toFixed(2), currency },
        period: "monthly",
      });
      return;
    }
    const existingAmount = groupBudgetLookup.get(groupId)
      ? parseMoney(groupBudgetLookup.get(groupId)!.amount)
      : undefined;
    if (Number.isFinite(existingAmount) && val === existingAmount) return;
    updateBudget.mutate({
      id: targetGroup.budgetId,
      data: { amount: { amount: val.toFixed(2), currency } },
    });
  };

  const toggleUnbudgetedSection = (section: string) => {
    setShowUnbudgetedBySection((prev) => ({
      ...prev,
      [section]: !prev[section],
    }));
  };

  const displayGroups = useMemo(() => {
    if (!isFlexEnabled) {
      return groups;
    }
    return buildFlexDisplayGroups({
      groups,
      flexBudgetDraft,
      flexBudgetAmount,
      flexBudgetId: flexBudget?.id,
    });
  }, [groups, isFlexEnabled, flexBudgetDraft, flexBudgetAmount, flexBudget?.id]);

  const totals = useMemo(() => calculateBudgetTotals(groups), [groups]);
  const {
    totalIncomeBudget,
    totalIncomeActual,
    totalExpenseBudget,
    totalExpenseActual,
    incomeRemaining,
    expenseRemaining,
    leftToBudget,
  } = totals;

  return {
    groups,
    displayGroups,
    flexBudgetDraft,
    flexBudgetOption: apiBudgets?.find((b) => b.isFlexBucket),
    flexBudget,
    showUnbudgetedBySection,
    toggleUnbudgetedSection,

    // Totals
    totalIncomeBudget,
    totalIncomeActual,
    totalExpenseBudget,
    totalExpenseActual,
    incomeRemaining,
    expenseRemaining,
    leftToBudget,

    // Actions
    toggleGroup,
    addItemToGroup,
    updateItem,
    updateGroupBudget,
    commitGroupBudget,
  };
}
