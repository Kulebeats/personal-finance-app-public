/**
 * useBudgetGroups Hook
 *
 * Manages budget group state, data transformations, and calculations.
 * Extracted from useBudgetPageData to reduce complexity.
 */

import { useState, useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { type Category, type CategoryGroup } from "@/hooks/use-settings";
import {
  type BudgetWithProgress,
  ensureFlexBudget,
  useCreateBudget,
  useUpdateBudget,
} from "@/hooks/useBudgets";
import { toMoneyDto } from "@/lib/money";
import { parseMoney } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { userErrorMessage } from "@/lib/errorCopy";
import { captureOperationLifetime } from "@/lib/operation-lifetime";
import { budgetCurrency, validCurrency, CURRENCY_UNKNOWN_MESSAGE } from "./budgetWriteCurrency";
import { isUnavailableFlexBudget, unavailableBudgetFor, type UnavailableBudget } from "@/hooks/useUnavailableBudgets";
import type { UnbudgetedSpend } from "@/hooks/useUnbudgetedSpend";
import { remainingBudget } from "../budgetLimits";
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
  isBudgetView: boolean;
  householdId?: string;
  selectedYear: number;
  selectedMonth: number;
  /** New budgets are created in the household currency; undefined while loading. */
  householdCurrency?: string;
  reportingCurrency?: string | null;
  /** Budgets the server could not report; never create a second one over them. */
  unavailableBudgets?: ReadonlyArray<UnavailableBudget>;
  /** This month's spending in categories no budget covers, counted in the totals. */
  unbudgetedSpend?: UnbudgetedSpend;
  createBudget: ReturnType<typeof useCreateBudget>;
  setLocation: (path: string) => void;
}

const initialGroups: BudgetGroup[] = [];
const noUnavailableBudgets: readonly UnavailableBudget[] = [];

export function useBudgetGroups({
  apiBudgets,
  categories,
  categoryGroups,
  budgetSystem,
  isBudgetView,
  householdId,
  selectedYear,
  selectedMonth,
  householdCurrency,
  reportingCurrency,
  unavailableBudgets = noUnavailableBudgets,
  unbudgetedSpend,
  createBudget,
  setLocation,
}: UseBudgetGroupsProps) {
  const [groups, setGroups] = useState<BudgetGroup[]>(initialGroups);
  const { toast } = useToast();
  // A group save must not replace the category editor's mutation callback.
  const updateBudget = useUpdateBudget();
  const [showUnbudgetedBySection, setShowUnbudgetedBySection] = useState<
    Record<string, boolean>
  >({});

  const flexBudgetGroupId = "flexible-expenses";
  const isFlexEnabled = budgetSystem === "flex";

  const withheldFlex = unavailableBudgets.find(isUnavailableFlexBudget);
  const flexBudget = withheldFlex ? undefined : apiBudgets?.find((budget) => budget.isFlexBucket);
  const confirmedHouseholdCurrency = validCurrency(householdCurrency);
  const flexBudgetEditCurrency = flexBudget ? budgetCurrency(apiBudgets, flexBudget.id) : confirmedHouseholdCurrency;
  const flexBudgetAmount = flexBudget
    ? parseMoney(flexBudget.amount)
    : undefined;
  const operation = captureOperationLifetime();
  const flexTargetId = flexBudget?.id;
  const flexTargetHousehold = flexBudget?.householdId;
  const withheldFlexId = withheldFlex?.id;
  // Layout-committed identity also retires old handlers when the user returns
  // to a scope with the same values. An amount alone cannot identify a draft.
  const editorVisible = isFlexEnabled && isBudgetView && apiBudgets !== undefined;
  const flexScope = useMemo(() => ({
    operation, householdId, confirmedHouseholdCurrency, selectedYear, selectedMonth,
    editorVisible, flexTargetId, flexTargetHousehold, flexBudgetAmount, flexBudgetEditCurrency, withheldFlexId,
  }), [operation, householdId, confirmedHouseholdCurrency, selectedYear, selectedMonth, editorVisible,
    flexTargetId, flexTargetHousehold, flexBudgetAmount, flexBudgetEditCurrency, withheldFlexId]);
  const mountedFlexScope = useRef<typeof flexScope | null>(null);
  const [draft, setDraft] = useState<{ scope: typeof flexScope; value: number }>();
  const admittedFlexSave = useRef<{ scope: typeof flexScope; updateDispatched: boolean } | null>(null);
  const [isSavingFlexBudget, setSavingFlexBudget] = useState(false);
  useLayoutEffect(() => {
    mountedFlexScope.current = flexScope;
    setDraft(undefined);
    const save = admittedFlexSave.current;
    // A retired ensure cannot dispatch an amount. An in-flight update still
    // owns admission until it settles, so a later write cannot overtake it.
    if (save && save.scope !== flexScope && !save.updateDispatched) {
      admittedFlexSave.current = null;
      setSavingFlexBudget(false);
    }
    return () => { mountedFlexScope.current = null; };
  }, [flexScope]);
  const canUseFlexScope = editorVisible && !!householdId && operation?.active === true &&
    operation.expectations?.household === householdId && (!flexTargetId || flexTargetHousehold === householdId);
  const isCurrentFlexScope = () => canUseFlexScope && mountedFlexScope.current === flexScope &&
    operation?.active === true && captureOperationLifetime() === operation;
  const flexBudgetDraft = canUseFlexScope && draft?.scope === flexScope ? draft.value : undefined;

  const groupBudgetLookup = useMemo(() => {
    const map = new Map<string, BudgetWithProgress>();
    (apiBudgets || []).forEach((budget) => {
      if (budget.categoryGroupId) {
        map.set(budget.categoryGroupId, budget);
      }
    });
    return map;
  }, [apiBudgets]);

  // Transform API data to UI format
  useEffect(() => {
    if (!apiBudgets || !categories || !categoryGroups) return;
    const apiGroups = buildBudgetGroupsFromApi(
      apiBudgets || [],
      categories,
      categoryGroups,
      unavailableBudgets,
      reportingCurrency,
    );
    setGroups(apiGroups);
  }, [apiBudgets, categories, categoryGroups, unavailableBudgets, reportingCurrency]);

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
                updatedItem.remaining = remainingBudget(updatedItem.budget, updatedItem.actual);
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
      if (isCurrentFlexScope() && !admittedFlexSave.current && !withheldFlex &&
          confirmedHouseholdCurrency && flexBudgetEditCurrency && Number.isFinite(val)) {
        setDraft({ scope: flexScope, value: val });
      }
      return;
    }
    setGroups(
      groups.map((g) => (g.id === groupId ? { ...g, budget: val } : g)),
    );
  };

  // An existing budget is written in its own currency, a new one in the
  // household's; never the viewer's display currency (C3-10).
  const writeCurrency = (budgetId: string | undefined): string | undefined => {
    const resolved = budgetId ? budgetCurrency(apiBudgets, budgetId) : validCurrency(householdCurrency);
    if (!resolved) {
      toast({
        title: "Budget not saved",
        description: budgetId ? CURRENCY_UNKNOWN_MESSAGE.existing : CURRENCY_UNKNOWN_MESSAGE.create,
        variant: "destructive",
      });
    }
    return resolved;
  };

  const refuseFlexDraft = (description: string) => {
    setDraft(undefined);
    toast({ title: "Budget not saved", description, variant: "destructive" });
  };

  const saveFlexBudget = async (val: number, expectedCurrency: string) => {
    // Admit synchronously because Enter and blur can arrive before the input disables.
    const save = { scope: flexScope, updateDispatched: false };
    admittedFlexSave.current = save;
    setSavingFlexBudget(true);
    setDraft({ scope: flexScope, value: val });
    const isCurrentSave = () => admittedFlexSave.current === save && isCurrentFlexScope();

    try {
      const target = flexBudget ?? await ensureFlexBudget();
      if (!isCurrentSave()) return;
      // Ensure can return an existing bucket in a different currency.
      if (!target.id || !target.isFlexBucket || target.householdId !== flexScope.householdId) {
        return refuseFlexDraft("The flexible budget could not be verified. Reload the page before changing it.");
      }
      const currency = budgetCurrency([target], target.id);
      if (!currency) return refuseFlexDraft(CURRENCY_UNKNOWN_MESSAGE.existing);
      if (currency !== expectedCurrency) {
        return refuseFlexDraft("The flexible budget uses a different currency. Reload the page before changing it.");
      }
      const amount = flexBudget
        ? { amount: val.toFixed(2), currency }
        : toMoneyDto(val, currency);
      save.updateDispatched = true;
      await updateBudget.mutateAsync({ id: target.id, data: { amount }, canShowFeedback: isCurrentSave });
    } catch (error: unknown) {
      if (!isCurrentSave()) return;
      if (save.updateDispatched) {
        setDraft(undefined);
      } else {
        refuseFlexDraft(userErrorMessage(error, "The flex budget could not be created."));
      }
    } finally {
      if (admittedFlexSave.current === save) {
        admittedFlexSave.current = null;
        if (mountedFlexScope.current) setSavingFlexBudget(false);
      }
    }
  };

  const commitGroupBudget = (groupId: string, val: number) => {
    if (!Number.isFinite(val)) return;

    if (groupId === flexBudgetGroupId) {
      if (!isCurrentFlexScope() || admittedFlexSave.current) return;
      if (withheldFlex) {
        refuseFlexDraft(withheldFlex.reason.message);
        return;
      }
      if (!confirmedHouseholdCurrency) {
        refuseFlexDraft(CURRENCY_UNKNOWN_MESSAGE.create);
        return;
      }
      if (!flexBudget?.id) {
        void saveFlexBudget(val, confirmedHouseholdCurrency);
        return;
      }
      if (Number.isFinite(flexBudgetAmount) && val === flexBudgetAmount) return;
      const flexCurrency = writeCurrency(flexBudget.id);
      if (!flexCurrency) return;
      void saveFlexBudget(val, flexCurrency);
      return;
    }

    const targetGroup = groups.find((g) => g.id === groupId);
    if (!targetGroup) return;
    if (!targetGroup.budgetId) {
      const hidden = unavailableBudgetFor(unavailableBudgets, { categoryGroupId: groupId });
      if (hidden) {
        toast({ title: "Budget not saved", description: hidden.reason.message, variant: "destructive" });
        return;
      }
      const createCurrency = writeCurrency(undefined);
      if (!createCurrency) return;
      createBudget.mutate({
        name: targetGroup.name,
        categoryGroupId: groupId,
        amount: { amount: val.toFixed(2), currency: createCurrency },
        period: "monthly",
      });
      return;
    }
    const existingAmount = groupBudgetLookup.get(groupId)
      ? parseMoney(groupBudgetLookup.get(groupId)!.amount)
      : undefined;
    if (Number.isFinite(existingAmount) && val === existingAmount) return;
    const groupCurrency = writeCurrency(targetGroup.budgetId);
    if (!groupCurrency) return;
    updateBudget.mutate({
      id: targetGroup.budgetId,
      data: { amount: { amount: val.toFixed(2), currency: groupCurrency } },
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
      hasWithheldFlexLimit: Boolean(withheldFlex),
      flexBudgetEditCurrency: canUseFlexScope && confirmedHouseholdCurrency ? flexBudgetEditCurrency ?? null : null,
      flexBudgetEditPending: isSavingFlexBudget,
      currency: reportingCurrency,
    });
  }, [groups, isFlexEnabled, flexBudgetDraft, flexBudgetAmount, flexBudget?.id, withheldFlex, flexBudgetEditCurrency,
    canUseFlexScope, confirmedHouseholdCurrency, isSavingFlexBudget, reportingCurrency]);

  const totals = useMemo(() => calculateBudgetTotals(displayGroups, unbudgetedSpend, reportingCurrency),
    [displayGroups, unbudgetedSpend, reportingCurrency]);
  const {
    totalIncomeBudget,
    totalIncomeActual,
    totalExpenseBudget,
    totalExpenseActual,
    incomeRemaining,
    expenseRemaining,
  } = totals;

  return {
    groups,
    displayGroups,
    flexBudgetDraft,
    flexBudgetOption: flexBudget,
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

    // Actions
    toggleGroup,
    addItemToGroup,
    updateItem,
    updateGroupBudget,
    commitGroupBudget,
  };
}
