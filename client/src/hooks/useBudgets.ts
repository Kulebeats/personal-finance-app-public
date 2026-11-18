/**
 * Budget Hooks
 *
 * TanStack Query hooks for budget operations.
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import type { MoneyDto } from "@shared/money";

// Types matching server schema
export type BudgetPeriod = "monthly";

export interface Budget {
  id: string;
  householdId: string;
  name: string;
  categoryId?: string | null;
  categoryGroupId?: string | null;
  amount: MoneyDto;
  period: BudgetPeriod;
  rolloverEnabled: boolean;
  rolloverAmount?: MoneyDto | null;
  warningThreshold?: number | null;
  alertThreshold?: number | null;
  isActive: boolean;
  isFlexBucket?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface BudgetWithProgress extends Budget {
  spent: MoneyDto;
  remaining: MoneyDto;
  percentUsed: number;
}

export interface BudgetAlert {
  budget: Budget;
  spent: MoneyDto;
  percentUsed: number;
  alertLevel: "warning" | "alert" | "exceeded";
}

export interface BudgetSettings {
  budgetSystem: "flex" | "category";
  defaultApplyScope: "this_month" | "all_future";
}

export interface BudgetForecastPeriod {
  year: number;
  month: number;
  amount: MoneyDto;
}

export interface BudgetForecastEntry extends Budget {
  periods: BudgetForecastPeriod[];
}

export interface BudgetForecastData {
  range: Array<{ year: number; month: number }>;
  budgets: BudgetForecastEntry[];
}

export interface CreateBudgetInput {
  name: string;
  categoryId?: string | null;
  categoryGroupId?: string | null;
  amount: MoneyDto;
  period?: BudgetPeriod;
  rolloverEnabled?: boolean;
  warningThreshold?: number;
  alertThreshold?: number;
  isActive?: boolean;
}

// API response types
interface ApiResponse<T> {
  success: boolean;
  data: T;
}

// CSRF-aware API helper (attaches x-csrf-token + self-heals on stale token).
import { apiCall } from "@/lib/api";

// Query keys
export const budgetKeys = {
  all: ["budgets"] as const,
  list: (params?: { includeInactive?: boolean }) =>
    [...budgetKeys.all, "list", params] as const,
  detail: (id: string) => [...budgetKeys.all, "detail", id] as const,
  progress: (year: number, month: number) =>
    [...budgetKeys.all, "progress", year, month] as const,
  alerts: (year: number, month: number) =>
    [...budgetKeys.all, "alerts", year, month] as const,
  settings: () => [...budgetKeys.all, "settings"] as const,
  forecast: (year: number, month: number, months: number) =>
    [...budgetKeys.all, "forecast", year, month, months] as const,
};

// Hooks
export function useBudgets(params?: { includeInactive?: boolean }) {
  return useQuery({
    queryKey: budgetKeys.list(params),
    queryFn: async () => {
      const query = params?.includeInactive ? "?includeInactive=true" : "";
      const res = await apiCall<ApiResponse<Budget[]>>(`/budgets${query}`);
      return res.data;
    },
    staleTime: 30_000,
  });
}

export function useBudgetProgress(year: number, month: number) {
  return useQuery({
    queryKey: budgetKeys.progress(year, month),
    queryFn: async () => {
      const res = await apiCall<ApiResponse<BudgetWithProgress[]>>(
        `/budgets/progress?year=${year}&month=${month}`
      );
      return res.data;
    },
    staleTime: 60_000,
  });
}

export function useBudgetAlerts(year: number, month: number) {
  return useQuery({
    queryKey: budgetKeys.alerts(year, month),
    queryFn: async () => {
      const res = await apiCall<ApiResponse<BudgetAlert[]>>(
        `/budgets/alerts?year=${year}&month=${month}`
      );
      return res.data;
    },
    staleTime: 60_000,
  });
}

export function useBudgetSettings() {
  return useQuery({
    queryKey: budgetKeys.settings(),
    queryFn: async () => {
      const res = await apiCall<ApiResponse<BudgetSettings>>(
        "/budgets/settings"
      );
      return res.data;
    },
    staleTime: 60_000,
  });
}

export function useUpdateBudgetSettings() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (data: Partial<BudgetSettings>) => {
      const res = await apiCall<ApiResponse<BudgetSettings>>(
        "/budgets/settings",
        {
          method: "PUT",
          body: JSON.stringify(data),
        }
      );
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: budgetKeys.settings() });
      toast({ title: "Budget settings updated" });
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to update budget settings",
        description: error.message,
        variant: "destructive",
      });
    },
  });
}

export function useBudgetForecast(
  year: number,
  month: number,
  months = 12
) {
  return useQuery({
    queryKey: budgetKeys.forecast(year, month, months),
    queryFn: async () => {
      const res = await apiCall<ApiResponse<BudgetForecastData>>(
        `/budgets/forecast?year=${year}&month=${month}&months=${months}`
      );
      return res.data;
    },
    staleTime: 60_000,
  });
}

export function useUpdateBudgetForecast() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({
      id,
      data,
    }: {
      id: string;
      data: {
        year: number;
        month: number;
        amount: MoneyDto;
        applyScope?: "this_month" | "all_future";
        months?: number;
      };
    }) => {
      const res = await apiCall<ApiResponse<{ budgetId: string }>>(
        `/budgets/forecast/${id}`,
        {
          method: "PUT",
          body: JSON.stringify(data),
        }
      );
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: budgetKeys.all });
      toast({ title: "Forecast updated" });
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to update forecast",
        description: error.message,
        variant: "destructive",
      });
    },
  });
}

export function useRecalculateBudgets() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (data: { months?: number } = {}) => {
      const res = await apiCall<ApiResponse<{ updated: number }>>(
        "/budgets/recalculate",
        {
          method: "POST",
          body: JSON.stringify(data),
        }
      );
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: budgetKeys.all });
      toast({ title: "Budgets recalculated" });
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to recalculate budgets",
        description: error.message,
        variant: "destructive",
      });
    },
  });
}

export function useClearBudgets() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async () => {
      const res = await apiCall<ApiResponse<{ cleared: number }>>(
        "/budgets/clear",
        {
          method: "POST",
          body: JSON.stringify({ confirm: true }),
        }
      );
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: budgetKeys.all });
      toast({ title: "Budgets cleared" });
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to clear budgets",
        description: error.message,
        variant: "destructive",
      });
    },
  });
}

export function useMoveBudgetAmount() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (data: {
      fromBudgetId: string;
      toBudgetId: string;
      amount: MoneyDto;
      year: number;
      month: number;
      applyScope?: "this_month" | "all_future";
      months?: number;
    }) => {
      const res = await apiCall<ApiResponse<{ scope: string }>>("/budgets/move", {
        method: "POST",
        body: JSON.stringify(data),
      });
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: budgetKeys.all });
      toast({ title: "Budget updated" });
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to move budget",
        description: error.message,
        variant: "destructive",
      });
    },
  });
}

export function useCreateBudget() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (data: CreateBudgetInput) => {
      const res = await apiCall<ApiResponse<Budget>>("/budgets", {
        method: "POST",
        body: JSON.stringify(data),
      });
      return res.data;
    },
    onSuccess: (budget) => {
      queryClient.invalidateQueries({ queryKey: budgetKeys.all });
      toast({
        title: "Budget created",
        description: `${budget.name} has been added.`,
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to create budget",
        description: error.message,
        variant: "destructive",
      });
    },
  });
}

export function useUpdateBudget() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({
      id,
      data,
    }: {
      id: string;
      data: Partial<CreateBudgetInput>;
    }) => {
      const res = await apiCall<ApiResponse<Budget>>(`/budgets/${id}`, {
        method: "PUT",
        body: JSON.stringify(data),
      });
      return res.data;
    },
    onSuccess: (budget) => {
      queryClient.invalidateQueries({ queryKey: budgetKeys.all });
      toast({
        title: "Budget updated",
        description: `${budget.name} has been updated.`,
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to update budget",
        description: error.message,
        variant: "destructive",
      });
    },
  });
}

export function useDeleteBudget() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (id: string) => {
      await apiCall<ApiResponse<{ message: string }>>(`/budgets/${id}`, {
        method: "DELETE",
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: budgetKeys.all });
      toast({ title: "Budget deleted" });
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to delete budget",
        description: error.message,
        variant: "destructive",
      });
    },
  });
}

// Helper for current month budgets
export function useCurrentMonthBudgets() {
  const now = new Date();
  return useBudgetProgress(now.getFullYear(), now.getMonth() + 1);
}
