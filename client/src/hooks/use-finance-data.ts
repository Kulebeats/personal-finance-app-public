/**
 * Finance Data Hooks - Compatibility Layer
 *
 * This file provides backwards compatibility with the old localStorage-based hooks.
 * It now proxies to the new TanStack Query API hooks for real database operations.
 */
import { useMemo, useCallback } from "react";
import { useFormatters } from "@/contexts/SettingsContext";
import {
  useAccounts as useAccountsAPI,
  useNetWorthSummary,
  useCreateAccount,
  useUpdateAccount,
  useDeleteAccount,
} from "./useAccounts";
import { toMoneyNumber } from "@/lib/money";
import {
  useTransactions as useTransactionsAPI,
  useTransactionSummary,
  useCreateTransaction,
  useUpdateTransaction,
  useDeleteTransaction,
} from "./useTransactions";
import {
  useBudgets as useBudgetsAPI,
  useBudgetProgress,
  useCreateBudget,
  useUpdateBudget,
  useDeleteBudget,
} from "./useBudgets";
import {
  useGoals as useGoalsAPI,
  useCreateGoal,
  useUpdateGoal,
  useDeleteGoal,
  useAddContribution,
} from "./useGoals";
import {
  useRecurring as useRecurringAPI,
  useCreateRecurring,
  useUpdateRecurring,
  useDeleteRecurring,
  useProcessRecurring,
} from "./useRecurring";
import {
  useCategories as useSettingsCategories,
  useCreateCategory,
  useUpdateCategory,
  useDeleteCategory,
} from "./use-settings";

import type {
  Account as APIAccount,
  Transaction as APITransaction,
  CreateAccountInput,
} from "../lib/api";

// ============================================================================
// LEGACY TYPE DEFINITIONS (for backwards compatibility)
// ============================================================================

export type Transaction = {
  id: string;
  date: string;
  description: string;
  amount: number;
  type: "income" | "expense" | "transfer";
  category: string;
  accountId: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
};

export type Account = {
  id: string;
  name: string;
  type: "checking" | "savings" | "credit" | "investment" | "cash" | "other";
  balance: number;
  currency?: string;
  institution?: string;
  color?: string;
  createdAt: string;
  updatedAt: string;
};

export type Budget = {
  id: string;
  name: string;
  category: string;
  amount: number;
  spent: number;
  period: "monthly";
  year: number;
  month: number;
  createdAt: string;
  updatedAt: string;
};

export type Category = {
  id: string;
  name: string;
  type: "income" | "expense" | "transfer";
  color?: string;
  icon?: string;
  createdAt: string;
  updatedAt: string;
};

export type Goal = {
  id: string;
  name: string;
  targetAmount: number;
  currentAmount: number;
  targetDate?: string;
  description?: string;
  createdAt: string;
  updatedAt: string;
};

export type RecurringTransaction = {
  id: string;
  name: string;
  amount: number;
  type: "income" | "expense";
  category: string;
  accountId: string;
  frequency:
    | "daily"
    | "weekly"
    | "biweekly"
    | "monthly"
    | "quarterly"
    | "semi_annually"
    | "annually"
    | "yearly"
    | "custom";
  nextDueDate: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

// ============================================================================
// ACCOUNTS HOOK (Proxies to API)
// ============================================================================

export function useAccounts() {
  const { data: accounts, isLoading, refetch, error } = useAccountsAPI();
  const { data: netWorthData } = useNetWorthSummary();
  const createMutation = useCreateAccount();
  const updateMutation = useUpdateAccount();
  const deleteMutation = useDeleteAccount();

  // Transform API accounts to legacy format
  const legacyAccounts = useMemo(() => {
    if (!accounts) return [];
    return accounts.map(
      (acc): Account => ({
        id: acc.id,
        name: acc.name,
        type: acc.type as Account["type"],
        balance: toMoneyNumber(acc.balance),
        currency: acc.currency || "ZMW",
        institution: acc.institution || undefined,
        color: acc.color || undefined,
        createdAt: acc.createdAt,
        updatedAt: acc.updatedAt,
      })
    );
  }, [accounts]);

  const add = useCallback(
    (data: Partial<Account>) => {
      const input: CreateAccountInput = {
        name: data.name || "New Account",
        type: data.type || "checking",
        institution: data.institution,
        currency: data.currency || "ZMW",
      };
      createMutation.mutate(input);
      return { id: "pending", ...data } as Account;
    },
    [createMutation]
  );

  const edit = useCallback(
    (id: string, updates: Partial<Account>) => {
      updateMutation.mutate({
        id,
        data: {
          name: updates.name,
          type: updates.type,
          institution: updates.institution,
        },
      });
      return { id, ...updates } as Account;
    },
    [updateMutation]
  );

  const del = useCallback(
    (id: string) => {
      deleteMutation.mutate(id);
      return true;
    },
    [deleteMutation]
  );

  const getTotalBalance = useCallback(() => {
    return legacyAccounts.reduce((sum, acc) => sum + acc.balance, 0);
  }, [legacyAccounts]);

  const getNetWorth = useCallback(() => {
    return netWorthData?.netWorth || 0;
  }, [netWorthData]);

  return {
    data: legacyAccounts,
    accounts: legacyAccounts,
    loading: isLoading,
    refresh: refetch,
    error,
    add,
    edit,
    delete: del,
    getTotalBalance,
    getNetWorth,
  };
}

// ============================================================================
// TRANSACTIONS HOOK (Proxies to API)
// ============================================================================

export function useTransactions() {
  const now = new Date();
  const { currency } = useFormatters();
  const {
    data: response,
    isLoading,
    refetch,
  } = useTransactionsAPI({
    startDate: new Date(now.getFullYear(), 0, 1).toISOString().split("T")[0],
    endDate: now.toISOString().split("T")[0],
  });
  const createMutation = useCreateTransaction();
  const updateMutation = useUpdateTransaction();
  const deleteMutation = useDeleteTransaction();

  // Transform API transactions to legacy format
  const legacyTransactions = useMemo(() => {
    if (!response?.transactions) return [];
    return response.transactions.map(
      (txn): Transaction => ({
        id: txn.id,
        date: txn.date,
        description: txn.name,
        amount: toMoneyNumber(txn.amount),
        type: txn.type as Transaction["type"],
        category: txn.categoryId || "Uncategorized",
        accountId: txn.accountId,
        notes: txn.notes || undefined,
        createdAt: txn.createdAt,
        updatedAt: txn.updatedAt,
      })
    );
  }, [response]);

  const add = useCallback(
    (data: {
      accountId: string;
      date: string;
      description?: string;
      name: string;
      amount: number;
      type: "income" | "expense";
      categoryId?: string;
      notes?: string;
    }) => {
      createMutation.mutate({
        accountId: data.accountId,
        date: data.date,
        name: data.description || data.name,
        amount: { amount: String(Math.abs(data.amount)), currency },
        type: data.type,
        categoryId: data.categoryId,
        notes: data.notes,
      });
      return { id: "pending", ...data } as unknown as Transaction;
    },
    [createMutation, currency]
  );

  const edit = useCallback(
    (id: string, updates: Partial<Transaction>) => {
      updateMutation.mutate({
        id,
        data: {
          name: updates.description,
          amount: updates.amount
            ? { amount: String(updates.amount), currency }
            : undefined,
          notes: updates.notes,
        },
      });
      return { id, ...updates } as Transaction;
    },
    [updateMutation, currency]
  );

  const del = useCallback(
    (id: string) => {
      deleteMutation.mutate(id);
      return true;
    },
    [deleteMutation]
  );

  const getByMonth = useCallback(
    (year: number, month: number) => {
      return legacyTransactions.filter((t) => {
        const d = new Date(t.date);
        return d.getFullYear() === year && d.getMonth() + 1 === month;
      });
    },
    [legacyTransactions]
  );

  const getByDateRange = useCallback(
    (start: string, end: string) => {
      return legacyTransactions.filter((t) => t.date >= start && t.date <= end);
    },
    [legacyTransactions]
  );

  const getSummary = useCallback(
    (year: number, month?: number) => {
      const filtered = month
        ? legacyTransactions.filter((t) => {
            const d = new Date(t.date);
            return d.getFullYear() === year && d.getMonth() + 1 === month;
          })
        : legacyTransactions.filter(
            (t) => new Date(t.date).getFullYear() === year
          );

      const income = filtered
        .filter((t) => t.type === "income")
        .reduce((sum, t) => sum + t.amount, 0);
      const expenses = filtered
        .filter((t) => t.type === "expense")
        .reduce((sum, t) => sum + Math.abs(t.amount), 0);

      return { income, expenses, balance: income - expenses };
    },
    [legacyTransactions]
  );

  const getByCategory = useCallback(
    (category: string) => {
      return legacyTransactions.filter((t) => t.category === category);
    },
    [legacyTransactions]
  );

  return {
    data: legacyTransactions,
    transactions: legacyTransactions,
    loading: isLoading,
    refresh: refetch,
    add,
    edit,
    delete: del,
    getByMonth,
    getByDateRange,
    getSummary,
    getByCategory,
  };
}

// ============================================================================
// BUDGETS HOOK (Proxies to API)
// ============================================================================

export function useBudgets() {
  const now = new Date();
  const { currency } = useFormatters();
  const { data: budgets, isLoading, refetch } = useBudgetsAPI();
  const { data: progress } = useBudgetProgress(
    now.getFullYear(),
    now.getMonth() + 1
  );
  const createMutation = useCreateBudget();
  const updateMutation = useUpdateBudget();
  const deleteMutation = useDeleteBudget();

  // Transform to legacy format with progress
  const legacyBudgets = useMemo(() => {
    if (!budgets) return [];
    return budgets.map((b): Budget => {
      const prog = progress?.find((p) => p.id === b.id);
      return {
        id: b.id,
        name: b.name,
        category: b.categoryId || "General",
        amount: toMoneyNumber(b.amount),
        spent: prog ? toMoneyNumber(prog.spent) : 0,
        period: b.period as Budget["period"],
        year: now.getFullYear(),
        month: now.getMonth() + 1,
        createdAt: b.createdAt,
        updatedAt: b.updatedAt,
      };
    });
  }, [budgets, progress]);

  const add = useCallback(
    (data: {
      name: string;
      categoryId: string;
      amount: number;
      period?: "monthly";
    }) => {
      createMutation.mutate({
        name: data.name,
        categoryId: data.categoryId,
        amount: { amount: String(data.amount), currency },
        period: data.period || "monthly",
      });
      return { id: "pending", ...data } as unknown as Budget;
    },
    [createMutation, currency]
  );

  const edit = useCallback(
    (id: string, updates: Partial<Budget>) => {
      updateMutation.mutate({
        id,
        data: {
          name: updates.name,
          amount: updates.amount
            ? { amount: String(updates.amount), currency }
            : undefined,
        },
      });
      return { id, ...updates } as Budget;
    },
    [updateMutation, currency]
  );

  const del = useCallback(
    (id: string) => {
      deleteMutation.mutate(id);
      return true;
    },
    [deleteMutation]
  );

  const getByMonth = useCallback(
    (year: number, month: number) => {
      return legacyBudgets; // Already filtered for current month
    },
    [legacyBudgets]
  );

  const updateAllSpent = useCallback(
    (year: number, month: number) => {
      refetch();
    },
    [refetch]
  );

  return {
    data: legacyBudgets,
    budgets: legacyBudgets,
    loading: isLoading,
    refresh: refetch,
    add,
    edit,
    delete: del,
    getByMonth,
    updateAllSpent,
  };
}

// ============================================================================
// CATEGORIES HOOK (Stub - would need API implementation)
// ============================================================================

export function useCategories() {
  const { data, isLoading, refetch } = useSettingsCategories({
    includeArchived: false,
    includeStats: false,
  });
  const createCategory = useCreateCategory();
  const updateCategory = useUpdateCategory();
  const deleteCategory = useDeleteCategory();

  const groupById = useMemo(() => {
    return new Map((data?.groups ?? []).map((group) => [group.id, group]));
  }, [data]);

  const categories = useMemo((): Category[] => {
    if (!data?.categories || !data?.groups) return [];

    return data.categories
      .map((category) => {
        const groupType = groupById.get(category.groupId)?.type;
        if (!groupType) return null;
        return {
          id: category.id,
          name: category.name,
          type:
            groupType === "income"
              ? "income"
              : groupType === "transfers"
              ? "transfer"
              : "expense",
          color: category.color ?? undefined,
          icon: category.icon ?? undefined,
          createdAt: category.createdAt,
          updatedAt: category.updatedAt,
        } as Category;
      })
      .filter((category): category is Category => category !== null);
  }, [data, groupById]);

  const add = useCallback(
    (data: {
      groupId?: string;
      name?: string;
      icon?: string;
      color?: string;
      includeInBudget?: boolean;
      rolloverEnabled?: boolean;
      rolloverStartBalance?: string | null;
    }) => {
      if (!data?.groupId || !data?.name) return undefined;
      createCategory.mutate({
        groupId: data.groupId,
        name: data.name,
        icon: data.icon,
        color: data.color,
        includeInBudget: data.includeInBudget,
        rolloverEnabled: data.rolloverEnabled,
        rolloverStartBalance: data.rolloverStartBalance,
      });

      const groupType = groupById.get(data.groupId)?.type;
      const type =
        groupType === "income"
          ? "income"
          : groupType === "transfers"
          ? "transfer"
          : "expense";
      const now = new Date().toISOString();
      return {
        id: "pending",
        name: data.name,
        type,
        color: data.color,
        icon: data.icon,
        createdAt: now,
        updatedAt: now,
      } as Category;
    },
    [createCategory, groupById]
  );

  const edit = useCallback(
    (id: string, updates: {
      name?: string;
      icon?: string;
      color?: string;
      includeInBudget?: boolean;
      rolloverEnabled?: boolean;
      rolloverStartBalance?: string | null;
      isArchived?: boolean;
    }) => {
      updateCategory.mutate({
        id,
        data: {
          name: updates?.name,
          icon: updates?.icon,
          color: updates?.color,
          includeInBudget: updates?.includeInBudget,
          rolloverEnabled: updates?.rolloverEnabled,
          rolloverStartBalance: updates?.rolloverStartBalance,
          isArchived: updates?.isArchived,
        },
      });
      return { id, ...updates } as Category;
    },
    [updateCategory]
  );

  const del = useCallback(
    (id: string) => {
      deleteCategory.mutate(id);
      return true;
    },
    [deleteCategory]
  );

  return {
    data: categories,
    categories,
    loading: isLoading,
    refresh: refetch,
    add,
    edit,
    delete: del,
    getByType: (type: "income" | "expense" | "transfer") =>
      categories.filter((c) => c.type === type),
  };
}

// ============================================================================
// GOALS HOOK (Proxies to API)
// ============================================================================

export function useGoals() {
  const { currency } = useFormatters();
  const { data: goals, isLoading, refetch } = useGoalsAPI();
  const createMutation = useCreateGoal();
  const updateMutation = useUpdateGoal();
  const deleteMutation = useDeleteGoal();
  const addContributionMutation = useAddContribution();

  const legacyGoals = useMemo(() => {
    if (!goals) return [];
    return goals.map(
      (g): Goal => ({
        id: g.id,
        name: g.name,
        targetAmount: toMoneyNumber(g.targetAmount),
        currentAmount: toMoneyNumber(g.currentAmount),
        targetDate: g.targetDate || undefined,
        description: g.description || undefined,
        createdAt: g.createdAt,
        updatedAt: g.updatedAt,
      })
    );
  }, [goals]);

  const add = useCallback(
    (data: {
      name: string;
      targetAmount: number;
      targetDate?: string;
      description?: string;
    }) => {
      createMutation.mutate({
        type: "save_up",
        goalType: "other",
        name: data.name,
        targetAmount: { amount: String(data.targetAmount), currency },
        targetDate: data.targetDate,
        description: data.description,
      });
      return { id: "pending", ...data } as Goal;
    },
    [createMutation, currency]
  );

  const edit = useCallback(
    (id: string, updates: Partial<Goal>) => {
      updateMutation.mutate({
        id,
        data: {
          name: updates.name,
          targetAmount: updates.targetAmount
            ? { amount: String(updates.targetAmount), currency }
            : undefined,
          targetDate: updates.targetDate,
          description: updates.description,
        },
      });
      return { id, ...updates } as Goal;
    },
    [updateMutation, currency]
  );

  const del = useCallback(
    (id: string) => {
      deleteMutation.mutate(id);
      return true;
    },
    [deleteMutation]
  );

  const addContribution = useCallback(
    (id: string, amount: number) => {
      addContributionMutation.mutate({
        id,
        data: { amount: { amount: String(amount), currency } },
      });
      return legacyGoals.find((g) => g.id === id) || null;
    },
    [addContributionMutation, legacyGoals, currency]
  );

  return {
    data: legacyGoals,
    goals: legacyGoals,
    loading: isLoading,
    refresh: refetch,
    add,
    edit,
    delete: del,
    addContribution,
  };
}

// ============================================================================
// RECURRING HOOK (Proxies to API)
// ============================================================================

export function useRecurring() {
  const { currency } = useFormatters();
  const { data: recurring, isLoading, refetch } = useRecurringAPI();
  const createMutation = useCreateRecurring();
  const updateMutation = useUpdateRecurring();
  const deleteMutation = useDeleteRecurring();
  const processMutation = useProcessRecurring();

  const legacyRecurring = useMemo(() => {
    if (!recurring) return [];
    return recurring.map(
      (r): RecurringTransaction => ({
        id: r.id,
        name: r.name,
        amount: toMoneyNumber(r.amount),
        type: r.type,
        category: r.categoryId || "General",
        accountId: r.accountId,
        frequency: r.frequency,
        nextDueDate: r.nextDueDate,
        isActive: r.isActive,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
      })
    );
  }, [recurring]);

  const add = useCallback(
    (data: {
      accountId: string;
      name: string;
      amount: number;
      type: "income" | "expense";
      frequency:
        | "custom"
        | "monthly"
        | "daily"
        | "weekly"
        | "biweekly"
        | "quarterly"
        | "yearly"
        | "semi_annually"
        | "annually";
      nextDueDate: string;
    }) => {
      createMutation.mutate({
        accountId: data.accountId,
        name: data.name,
        amount: { amount: String(data.amount), currency },
        type: data.type,
        frequency: data.frequency,
        nextDueDate: data.nextDueDate,
      });
      return { id: "pending", ...data } as RecurringTransaction;
    },
    [createMutation, currency]
  );

  const edit = useCallback(
    (id: string, updates: Partial<RecurringTransaction>) => {
      updateMutation.mutate({
        id,
        data: {
          name: updates.name,
          amount: updates.amount
            ? { amount: String(updates.amount), currency }
            : undefined,
          isActive: updates.isActive,
        },
      });
      return { id, ...updates } as RecurringTransaction;
    },
    [updateMutation, currency]
  );

  const del = useCallback(
    (id: string) => {
      deleteMutation.mutate(id);
      return true;
    },
    [deleteMutation]
  );

  const getActive = useCallback(() => {
    return legacyRecurring.filter((r) => r.isActive);
  }, [legacyRecurring]);

  const processRecurring = useCallback(() => {
    processMutation.mutate();
    return [];
  }, [processMutation]);

  return {
    data: legacyRecurring,
    recurring: legacyRecurring,
    loading: isLoading,
    refresh: refetch,
    add,
    edit,
    delete: del,
    getActive,
    processRecurring,
  };
}

// ============================================================================
// DATA MANAGEMENT HOOK
// ============================================================================

export function useDataManagement() {
  return {
    exportData: () => JSON.stringify({}),
    importData: (jsonString: string) => true,
    clearAllData: () => {},
  };
}

// ============================================================================
// DASHBOARD SUMMARY HOOK
// ============================================================================

export function useDashboardSummary() {
  const { accounts, getTotalBalance, getNetWorth } = useAccounts();
  const { transactions, getSummary } = useTransactions();

  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  const monthlySummary = getSummary(year, month);

  const recentTransactions = useMemo(() => {
    return [...transactions]
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
      .slice(0, 5);
  }, [transactions]);

  const summary = {
    totalBalance: getTotalBalance(),
    monthlyIncome: monthlySummary.income,
    monthlyExpenses: monthlySummary.expenses,
    monthlyBalance: monthlySummary.balance,
    netWorth: getNetWorth(),
    recentTransactions,
  };

  return { summary, refresh: () => {} };
}

