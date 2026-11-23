/**
 * Budget Hooks
 *
 * TanStack Query hooks for budget operations.
 */

import { userErrorMessage } from "@/lib/errorCopy";
import { calendarToday, useCalendarTimeZone } from "@/lib/calendarZone";
import { useQuery, useMutation, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import type { MoneyDto } from "@shared/money";
import { isUnavailableFlexBudget, storeUnavailableBudgets, useUnavailableBudgets } from "@/hooks/useUnavailableBudgets";
import { storeUnbudgetedSpend } from "@/hooks/useUnbudgetedSpend";

// Types matching server schema
export type BudgetPeriod = "monthly";

export interface Budget {
  id: string;
  householdId: string;
  name: string;
  categoryId?: string | null;
  categoryGroupId?: string | null;
  amount: MoneyDto | null;
  /** Target denomination remains available when the recurring default is absent. */
  currency?: string;
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
  // Progress omits months without an effective limit.
  amount: MoneyDto;
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
  amount: MoneyDto | null;
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
  /** "This month only": the amount is that month's limit, with no recurring default. */
  onlyFor?: { year: number; month: number };
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

export async function fetchBudgetProgress(queryClient: QueryClient, year: number, month: number) {
  const res = await apiCall<ApiResponse<BudgetWithProgress[]> & { meta?: unknown }>(
    `/budgets/progress?year=${year}&month=${month}`
  );
  // Every reader of the progress cache must store its companion metadata.
  storeUnavailableBudgets(queryClient, year, month, res.meta);
  storeUnbudgetedSpend(queryClient, year, month, res.meta);
  return res.data;
}

export function useBudgetProgress(year: number, month: number) {
  const queryClient = useQueryClient();
  return useQuery({
    queryKey: budgetKeys.progress(year, month),
    queryFn: () => fetchBudgetProgress(queryClient, year, month),
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

export function useBudgetSettings(enabled = true) {
  return useQuery({
    queryKey: budgetKeys.settings(),
    enabled,
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
        description: userErrorMessage(error, "Please try again."),
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
        description: userErrorMessage(error, "Please try again."),
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
        description: userErrorMessage(error, "Please try again."),
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
        description: userErrorMessage(error, "Please try again."),
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
        description: userErrorMessage(error, "Please try again."),
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
        description: userErrorMessage(error, "Please try again."),
        variant: "destructive",
      });
    },
  });
}

/**
 * The household's flex budget, created on the server (once, audited) when it
 * has none yet: a new household is on the flex system before any bucket
 * exists, so its first flex amount needs one to be written to (N8 b2).
 */
export async function ensureFlexBudget(): Promise<Budget> {
  const res = await apiCall<ApiResponse<Budget>>("/budgets/flex", {
    method: "POST",
    body: JSON.stringify({}),
  });
  return res.data;
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
      /** The inline editor may have retired while the request was in flight. */
      canShowFeedback?: () => boolean;
    }) => {
      const res = await apiCall<ApiResponse<Budget>>(`/budgets/${id}`, {
        method: "PUT",
        body: JSON.stringify(data),
      });
      return res.data;
    },
    onSuccess: (budget, { canShowFeedback }) => {
      queryClient.invalidateQueries({ queryKey: budgetKeys.all });
      if (canShowFeedback && !canShowFeedback()) return;
      toast({
        title: "Budget updated",
        description: `${budget.name} has been updated.`,
      });
    },
    onError: (error: Error, { canShowFeedback }) => {
      if (canShowFeedback && !canShowFeedback()) return;
      toast({
        title: "Failed to update budget",
        description: userErrorMessage(error, "Please try again."),
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
        description: userErrorMessage(error, "Please try again."),
        variant: "destructive",
      });
    },
  });
}

// Helper for current month budgets
export function useCurrentMonthBudgets() {
  useCalendarTimeZone(); // NEW-15: re-derive when the household zone arrives.
  // NEW-15: the calendar zone's month.
  const [year, month] = calendarToday().split("-").map((part) => parseInt(part, 10));
  const progress = useBudgetProgress(year, month);
  const unavailableBudgets = useUnavailableBudgets(year, month);
  // Without a flex row, both modes show the available category/group progress.
  const needsMode = Boolean(progress.data?.some(budget => budget.isFlexBucket) || unavailableBudgets.some(isUnavailableFlexBudget));
  const settings = useBudgetSettings(needsMode);
  return { ...progress, unavailableBudgets, budgetSystem: settings.data?.budgetSystem,
    isLoading: progress.isLoading || (needsMode && settings.isLoading) };
}
