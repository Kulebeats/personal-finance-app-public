/**
 * useBudgetModals Hook
 *
 * Manages modal state and handlers for Budget page:
 * - BudgetEditModal
 * - ForecastEditModal
 * - MoveMoneyModal
 */

import { useState, useCallback } from "react";
import { useFormatters } from "@/contexts/SettingsContext";
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
  createBudget: ReturnType<typeof useCreateBudget>;
  updateBudget: ReturnType<typeof useUpdateBudget>;
  updateBudgetForecast: ReturnType<typeof useUpdateBudgetForecast>;
  moveBudgetAmount: ReturnType<typeof useMoveBudgetAmount>;
}

export function useBudgetModals({
  selectedYear,
  selectedMonth,
  moveMoneyOptions,
  createBudget,
  updateBudget,
  updateBudgetForecast,
  moveBudgetAmount,
}: UseBudgetModalsOptions) {
  const { currency } = useFormatters();
  const [budgetEdit, setBudgetEdit] = useState<BudgetEditData | null>(null);
  const [forecastEdit, setForecastEdit] = useState<ForecastEditData | null>(
    null
  );
  const [moveMoneyState, setMoveMoneyState] = useState<MoveMoneyState | null>(
    null
  );

  const toMoneyDto = (amount: string): MoneyDto => ({
    amount,
    currency,
  });

  const handleForecastEdit = (
    budget: BudgetForecastEntry,
    period: BudgetForecastPeriod
  ) => {
    setForecastEdit({
      budgetId: budget.id,
      budgetName: budget.name,
      year: period.year,
      month: period.month,
      amount: period.amount?.amount ?? period.amount,
    });
  };

  const handleMoveMoney = (item: BudgetCategory) => {
    const fromBudgetId = moveMoneyOptions[0]?.id || "";
    if (!fromBudgetId) return;
    const amount =
      item.remaining < 0 ? Math.abs(item.remaining).toFixed(2) : "";
    setMoveMoneyState({ fromBudgetId, amount });
  };

  const handleCommitItemBudget = (
    item: BudgetCategory,
    _group: BudgetGroup,
    value: number
  ) => {
    if (!Number.isFinite(value)) return;
    setBudgetEdit({
      budgetId: item.budgetId,
      categoryId: item.id,
      categoryName: item.name,
      year: selectedYear,
      month: selectedMonth,
      amount: value.toFixed(2),
    });
  };

  const closeBudgetEdit = useCallback(() => setBudgetEdit(null), []);
  const closeForecastEdit = useCallback(() => setForecastEdit(null), []);
  const closeMoveMoneyModal = useCallback(() => setMoveMoneyState(null), []);

  // Budget Edit Save Handler
  const handleBudgetEditSave = useCallback(
    (payload: BudgetEditPayload) => {
      const applyForecastUpdate = (budgetId: string) => {
        updateBudgetForecast.mutate(
          {
            id: budgetId,
            data: {
              year: payload.year,
              month: payload.month,
              amount: toMoneyDto(payload.amount),
              applyScope: payload.applyScope,
              months: payload.applyScope === "all_future" ? 12 : undefined,
            },
          },
          { onSuccess: closeBudgetEdit }
        );
      };

      if (payload.applyScope === "all_future") {
        if (payload.budgetId) {
          updateBudget.mutate(
            {
              id: payload.budgetId,
              data: { amount: toMoneyDto(payload.amount) },
            },
            { onSuccess: () => applyForecastUpdate(payload.budgetId!) }
          );
          return;
        }
        createBudget.mutate(
          {
            name: payload.categoryName,
            categoryId: payload.categoryId,
            amount: toMoneyDto(payload.amount),
            period: "monthly",
          },
          {
            onSuccess: (created: { id: string }) =>
              applyForecastUpdate(created.id),
          }
        );
        return;
      }

      if (payload.budgetId) {
        applyForecastUpdate(payload.budgetId);
        return;
      }

      createBudget.mutate(
        {
          name: payload.categoryName,
          categoryId: payload.categoryId,
          amount: toMoneyDto(payload.amount),
          period: "monthly",
        },
        {
          onSuccess: (created: { id: string }) =>
            applyForecastUpdate(created.id),
        }
      );
    },
    [createBudget, updateBudget, updateBudgetForecast, closeBudgetEdit]
  );

  // Forecast Edit Save Handler
  const handleForecastEditSave = useCallback(
    (payload: ForecastEditPayload) => {
      updateBudgetForecast.mutate(
        {
          id: payload.budgetId,
          data: {
            year: payload.year,
            month: payload.month,
            amount: toMoneyDto(payload.amount),
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
      moveBudgetAmount.mutate(
        {
          ...payload,
          amount: toMoneyDto(payload.amount),
          year: selectedYear,
          month: selectedMonth,
          months: payload.applyScope === "all_future" ? 12 : undefined,
        },
        { onSuccess: closeMoveMoneyModal }
      );
    },
    [moveBudgetAmount, selectedYear, selectedMonth, closeMoveMoneyModal]
  );

  return {
    budgetEdit,
    setBudgetEdit,
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
