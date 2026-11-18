/**
 * useBudgetPageData Hook
 *
 * Manages budget page state and data transformations.
 */

import { useState, useEffect, useMemo } from "react";
import { useLocation } from "wouter";
import { useIsMobile } from "@/hooks/use-mobile";
import { useFormatters } from "@/contexts/SettingsContext";
import { useCategories } from "@/hooks/use-settings";
import { useGoals } from "@/hooks/useGoals";
import {
  useBudgetProgress,
  useBudgetSettings,
  useUpdateBudgetSettings,
  useRecalculateBudgets,
  useClearBudgets,
  useUpdateBudget,
  useCreateBudget,
  useBudgetForecast,
  useUpdateBudgetForecast,
  useMoveBudgetAmount,
} from "@/hooks/useBudgets";
import { useBudgetGroups } from "./useBudgetGroups";
import type { SelectedItem, ApplyScope } from "../types";

export function useBudgetPageData() {
  const today = new Date();
  const todayYear = today.getFullYear();
  const todayMonth = today.getMonth() + 1;
  const isMobile = useIsMobile();
  const [, setLocation] = useLocation();
  const { currency } = useFormatters();

  const [selectedYear, setSelectedYear] = useState(todayYear);
  const [selectedMonth, setSelectedMonth] = useState(todayMonth);

  const categoriesQuery = useMemo(
    () => ({
      includeArchived: false,
      includeStats: true,
      month: selectedMonth,
      year: selectedYear,
    }),
    [selectedMonth, selectedYear],
  );

  // API Integration
  const {
    data: apiBudgets,
    isLoading,
    error,
  } = useBudgetProgress(selectedYear, selectedMonth);
  const { data: categoriesData, isLoading: categoriesLoading } =
    useCategories(categoriesQuery);
  const { data: goals } = useGoals({
    includeArchived: false,
    includeCompleted: false,
  });
  const { data: budgetSettings } = useBudgetSettings();
  const updateBudgetSettings = useUpdateBudgetSettings();
  const recalculateBudgets = useRecalculateBudgets();
  const clearBudgets = useClearBudgets();
  const createBudget = useCreateBudget();
  const updateBudget = useUpdateBudget();
  const updateBudgetForecast = useUpdateBudgetForecast();
  const moveBudgetAmount = useMoveBudgetAmount();

  const [viewMode, setViewMode] = useState<"budget" | "forecast">("budget");
  const [timeframe, setTimeframe] = useState<"monthly" | "yearly">("monthly");
  const [selectedItem, setSelectedItem] = useState<SelectedItem | null>(null);
  const [budgetSystem, setBudgetSystem] = useState<"flex" | "category">("flex");
  const [defaultApplyScope, setDefaultApplyScope] =
    useState<ApplyScope>("all_future");
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isWalkthroughActive, setIsWalkthroughActive] = useState(false);
  const [summaryTab, setSummaryTab] = useState<
    "summary" | "income" | "expenses"
  >("summary");
  const [showUnbudgetedForecast, setShowUnbudgetedForecast] = useState(false);

  const forecastMonths = timeframe === "yearly" ? 12 : 8;
  const forecastQuery = useBudgetForecast(
    selectedYear,
    selectedMonth,
    forecastMonths,
  );
  const categories = categoriesData?.categories ?? [];
  const categoryGroups = categoriesData?.groups ?? [];
  const contributionGoals =
    goals?.filter(
      (goal) =>
        goal.type === "save_up" && !goal.isArchived && !goal.isCompleted,
    ) || [];

  // Mobile restriction for forecast
  useEffect(() => {
    if (isMobile && viewMode === "forecast") {
      setViewMode("budget");
    }
  }, [isMobile, viewMode]);

  // Sync budget settings
  useEffect(() => {
    if (!budgetSettings) return;
    setBudgetSystem(budgetSettings.budgetSystem);
    setDefaultApplyScope(budgetSettings.defaultApplyScope);
  }, [budgetSettings]);

  // Use the new hook for group management and calculations
  const {
    groups,
    displayGroups,
    flexBudgetDraft,
    flexBudgetOption,
    flexBudget,
    showUnbudgetedBySection,
    toggleUnbudgetedSection,
    totalIncomeBudget,
    totalIncomeActual,
    totalExpenseBudget,
    totalExpenseActual,
    incomeRemaining,
    expenseRemaining,
    leftToBudget,
    toggleGroup,
    addItemToGroup,
    updateItem,
    updateGroupBudget,
    commitGroupBudget,
  } = useBudgetGroups({
    apiBudgets,
    categories,
    categoryGroups,
    budgetSystem,
    currency,
    createBudget,
    updateBudget,
    setLocation,
  });

  const incomeGroups = displayGroups.filter((g) => g.type === "income");
  const expenseGroupsDisplay = displayGroups.filter(
    (g) => g.type === "expense",
  );
  const savingsGroups = displayGroups.filter((g) => g.type === "savings");
  const debtGroups = displayGroups.filter((g) => g.type === "debt");

  const headerLabel =
    timeframe === "yearly"
      ? `${selectedYear}`
      : new Date(selectedYear, selectedMonth - 1, 1).toLocaleString("en-US", {
          month: "long",
          year: "numeric",
        });

  const budgetOptions = apiBudgets
    ? apiBudgets.map((budget) => ({
        id: budget.id,
        name: budget.name,
        isFlexBucket: budget.isFlexBucket,
      }))
    : [];

  const moveMoneyOptions =
    budgetSystem === "flex"
      ? budgetOptions
      : budgetOptions.filter((budget) => !budget.isFlexBucket);

  const moveMoneyDisabledReason =
    moveMoneyOptions.length === 0
      ? "No budgets available to move."
      : budgetSystem === "flex" && !flexBudgetOption
        ? "Flexible budget is not set up yet."
        : undefined;
  const moveMoneyFromLocked =
    budgetSystem === "flex" && Boolean(flexBudgetOption);

  const shiftMonth = (delta: number) => {
    const step = timeframe === "yearly" ? 12 : 1;
    let nextYear = selectedYear;
    let nextMonth = selectedMonth + delta * step;
    if (nextMonth < 1) {
      nextMonth = 12;
      nextYear -= 1;
    }
    if (nextMonth > 12) {
      nextMonth = 1;
      nextYear += 1;
    }
    setSelectedYear(nextYear);
    setSelectedMonth(nextMonth);
  };

  const resetToToday = () => {
    setSelectedYear(todayYear);
    setSelectedMonth(todayMonth);
  };

  return {
    // State
    isLoading,
    error,
    categoriesLoading,
    categoryGroups,
    isMobile,
    todayYear,
    todayMonth,
    selectedYear,
    selectedMonth,
    viewMode,
    setViewMode,
    timeframe,
    setTimeframe,
    headerLabel,
    selectedItem,
    setSelectedItem,
    budgetSystem,
    defaultApplyScope,
    isSettingsOpen,
    setIsSettingsOpen,
    isWalkthroughActive,
    setIsWalkthroughActive,
    summaryTab,
    setSummaryTab,
    showUnbudgetedBySection,
    showUnbudgetedForecast,
    setShowUnbudgetedForecast,
    flexBudgetDraft,

    // Groups
    groups,
    displayGroups,
    incomeGroups,
    expenseGroups: expenseGroupsDisplay,
    savingsGroups,
    debtGroups,

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
    toggleUnbudgetedSection,
    shiftMonth,
    resetToToday,
    setLocation,

    // Mutations
    updateBudgetSettings,
    recalculateBudgets,
    clearBudgets,
    createBudget,
    updateBudget,
    updateBudgetForecast,
    moveBudgetAmount,

    // Goals & Forecast
    contributionGoals,
    forecastQuery,

    // Move Money
    budgetOptions,
    moveMoneyOptions,
    moveMoneyDisabledReason,
    moveMoneyFromLocked,
    flexBudgetOption,
    currency,
  };
}
