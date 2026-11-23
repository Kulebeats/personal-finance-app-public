/**
 * useBudgetModals Hook
 *
 * Manages modal state and handlers for Budget page:
 * - BudgetEditModal
 * - ForecastEditModal
 * - MoveMoneyModal
 */

import { useState, useCallback } from "react";
import { useToast } from "@/hooks/use-toast";
import {
  useCreateBudget,
  useUpdateBudget,
  useUpdateBudgetForecast,
  useMoveBudgetAmount,
  type BudgetForecastEntry,
  type BudgetForecastPeriod,
} from "@/hooks/useBudgets";
import type { MoneyDto } from "@shared/money";
import type {
  BudgetCategory,
  BudgetGroup,
  BudgetEditData,
  ForecastEditData,
  ApplyScope,
} from "../types";
import {
  budgetCurrency,
  validCurrency,
  CURRENCY_UNKNOWN_MESSAGE,
  type BudgetDenomination,
} from "./budgetWriteCurrency";
import { unavailableBudgetFor, type UnavailableBudget } from "@/hooks/useUnavailableBudgets";
import { useDialogOpener } from "./useDialogOpener";
import { useCommitOutcome } from "./useCommitOutcome";

const NO_UNAVAILABLE_BUDGETS: ReadonlyArray<UnavailableBudget> = [];

interface MoveMoneyState {
  fromBudgetId: string;
  amount: string;
}

interface BudgetEditPayload {
  budgetId?: string;
  categoryId: string;
  categoryName: string;
  year: number;
  month: number;
  amount: string;
  applyScope: ApplyScope;
}

interface ForecastEditPayload {
  budgetId: string;
  year: number;
  month: number;
  amount: string;
  currency: string;
  applyScope: ApplyScope;
}

interface MoveMoneyPayload {
  fromBudgetId: string;
  toBudgetId: string;
  amount: string;
  applyScope: ApplyScope;
}

interface UseBudgetModalsOptions {
  selectedYear: number;
  selectedMonth: number;
  moveMoneyOptions: Array<{ id: string }>;
  /** Budgets on screen; an update is written in the budget's own currency. */
  budgets?: ReadonlyArray<BudgetDenomination>;
  /** A new budget is created in the household currency; undefined while loading. */
  householdCurrency?: string;
  /** Budgets the server could not report; never create a second one over them. */
  unavailableBudgets?: ReadonlyArray<UnavailableBudget>;
  createBudget: ReturnType<typeof useCreateBudget>;
  updateBudget: ReturnType<typeof useUpdateBudget>;
  updateBudgetForecast: ReturnType<typeof useUpdateBudgetForecast>;
  moveBudgetAmount: ReturnType<typeof useMoveBudgetAmount>;
}

export function useBudgetModals({
  selectedYear,
  selectedMonth,
  moveMoneyOptions,
  budgets,
  householdCurrency,
  unavailableBudgets = NO_UNAVAILABLE_BUDGETS,
  createBudget,
  updateBudget,
  updateBudgetForecast,
  moveBudgetAmount,
}: UseBudgetModalsOptions) {
  const { toast } = useToast();
  const [budgetEdit, setBudgetEdit] = useState<BudgetEditData | null>(null);
  // Edit Budget mounts only once it has data, already open, so the press that
  // opens it (an amount field's Enter, a row's button) is recorded here.
  const budgetEditOpener = useDialogOpener(budgetEdit !== null);
  const commitOutcome = useCommitOutcome();
  const [forecastEdit, setForecastEdit] = useState<ForecastEditData | null>(
    null
  );
  const [moveMoneyState, setMoveMoneyState] = useState<MoveMoneyState | null>(
    null
  );

  // Never the display currency: an existing budget keeps its own currency and
  // a new one takes the household's. Unknown currency means nothing is sent.
  const writeCurrency = useCallback(
    (budgetId: string | undefined): string | undefined => {
      const resolved = budgetId ? budgetCurrency(budgets, budgetId) : validCurrency(householdCurrency);
      if (!resolved) {
        toast({
          title: "Budget not saved",
          description: budgetId ? CURRENCY_UNKNOWN_MESSAGE.existing : CURRENCY_UNKNOWN_MESSAGE.create,
          variant: "destructive",
        });
      }
      return resolved;
    },
    [budgets, householdCurrency, toast]
  );

  const handleForecastEdit = (
    budget: BudgetForecastEntry,
    period: BudgetForecastPeriod
  ) => {
    const currencies = (period.amount ? [period.amount.currency] : [budget.currency, budget.amount?.currency])
      .filter((value): value is string => value !== undefined);
    const sourceCurrency = currencies.length && currencies.every(value => /^[A-Z]{3}$/.test(value) && value === currencies[0]) ? currencies[0] : null;
    setForecastEdit({
      budgetId: budget.id,
      budgetName: budget.name,
      year: period.year,
      month: period.month,
      amount: period.amount?.amount ?? "",
      currency: sourceCurrency,
    });
  };

  const handleMoveMoney = (item: BudgetCategory) => {
    const fromBudgetId = moveMoneyOptions[0]?.id || "";
    if (!fromBudgetId) return;
    const amount =
      item.remaining !== null && item.remaining < 0 ? Math.abs(item.remaining).toFixed(2) : "";
    setMoveMoneyState({ fromBudgetId, amount });
  };

  const handleCommitItemBudget = (
    item: BudgetCategory,
    _group: BudgetGroup,
    value: number
  ): Promise<boolean> => {
    if (!Number.isFinite(value)) return Promise.resolve(false);
    const outcome = commitOutcome.begin();
    setBudgetEdit({
      budgetId: item.budgetId,
      categoryId: item.id,
      categoryName: item.name,
      year: selectedYear,
      month: selectedMonth,
      amount: value.toFixed(2),
    });
    return outcome;
  };

  const { settle: settleCommit } = commitOutcome;
  // Closing without a save (cancel, or after a failed save) is not a save.
  const closeBudgetEdit = useCallback(() => {
    settleCommit(false);
    setBudgetEdit(null);
  }, [settleCommit]);
  const finishBudgetEdit = useCallback(() => {
    settleCommit(true);
    setBudgetEdit(null);
  }, [settleCommit]);
  const closeForecastEdit = useCallback(() => setForecastEdit(null), []);
  const closeMoveMoneyModal = useCallback(() => setMoveMoneyState(null), []);

  // Budget Edit Save Handler
  const handleBudgetEditSave = useCallback(
    (payload: BudgetEditPayload) => {
      const hidden = payload.budgetId ? undefined : unavailableBudgetFor(unavailableBudgets, { categoryId: payload.categoryId });
      if (hidden) {
        toast({ title: "Budget not saved", description: hidden.reason.message, variant: "destructive" });
        return;
      }
      const currency = writeCurrency(payload.budgetId);
      if (!currency) return;
      const amount: MoneyDto = { amount: payload.amount, currency };
      const applyForecastUpdate = (budgetId: string) => {
        updateBudgetForecast.mutate(
          {
            id: budgetId,
            data: {
              year: payload.year,
              month: payload.month,
              amount,
              applyScope: payload.applyScope,
              months: payload.applyScope === "all_future" ? 12 : undefined,
            },
          },
          { onSuccess: finishBudgetEdit }
        );
      };

      if (!payload.budgetId) {
        // "This month only" is one create with that month's limit and no
        // recurring default; the server writes both together (A-16).
        const onlyFor = payload.applyScope === "this_month"
          ? { year: payload.year, month: payload.month }
          : undefined;
        createBudget.mutate(
          {
            name: payload.categoryName,
            categoryId: payload.categoryId,
            amount,
            period: "monthly",
            ...(onlyFor ? { onlyFor } : {}),
          },
          {
            onSuccess: (created: { id: string }) =>
              onlyFor ? finishBudgetEdit() : applyForecastUpdate(created.id),
          }
        );
        return;
      }

      const budgetId = payload.budgetId;
      if (payload.applyScope === "all_future") {
        updateBudget.mutate(
          { id: budgetId, data: { amount } },
          { onSuccess: () => applyForecastUpdate(budgetId) }
        );
        return;
      }
      applyForecastUpdate(budgetId);
    },
    [createBudget, updateBudget, updateBudgetForecast, finishBudgetEdit, writeCurrency, unavailableBudgets, toast]
  );

  // Forecast Edit Save Handler
  const handleForecastEditSave = useCallback(
    (payload: ForecastEditPayload) => {
      if (!/^[A-Z]{3}$/.test(payload.currency)) return;
      updateBudgetForecast.mutate(
        {
          id: payload.budgetId,
          data: {
            year: payload.year,
            month: payload.month,
            amount: { amount: payload.amount, currency: payload.currency },
            applyScope: payload.applyScope,
            months: payload.applyScope === "all_future" ? 12 : undefined,
          },
        },
        { onSuccess: closeForecastEdit }
      );
    },
    [updateBudgetForecast, closeForecastEdit]
  );

  // Move Money Save Handler
  const handleMoveMoneySubmit = useCallback(
    (payload: MoveMoneyPayload) => {
      // Money moves in the source budget's own currency.
      const currency = writeCurrency(payload.fromBudgetId);
      if (!currency) return;
      moveBudgetAmount.mutate(
        {
          ...payload,
          amount: { amount: payload.amount, currency },
          year: selectedYear,
          month: selectedMonth,
          months: payload.applyScope === "all_future" ? 12 : undefined,
        },
        { onSuccess: closeMoveMoneyModal }
      );
    },
    [moveBudgetAmount, selectedYear, selectedMonth, closeMoveMoneyModal, writeCurrency]
  );

  return {
    budgetEdit,
    setBudgetEdit,
    budgetEditOpener,
    forecastEdit,
    setForecastEdit,
    moveMoneyState,
    setMoveMoneyState,
    handleForecastEdit,
    handleMoveMoney,
    handleCommitItemBudget,
    closeBudgetEdit,
    closeForecastEdit,
    closeMoveMoneyModal,
    handleBudgetEditSave,
    handleForecastEditSave,
    handleMoveMoneySubmit,
  };
}
