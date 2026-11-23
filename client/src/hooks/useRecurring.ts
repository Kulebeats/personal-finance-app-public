/**
 * Recurring Transaction Hooks
 *
 * TanStack Query hooks for recurring transaction operations.
 */

import { userErrorMessage } from "@/lib/errorCopy";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import type { Transaction } from "@/lib/api";
import { accountKeys } from "./useAccounts";
import { RECURRING_TRANSACTION_ENDPOINT, mapServerFieldErrors } from "@/lib/recurringTransactionRequest";
import { type MoneyDto } from "@shared/money";
import type { CalendarDateRange } from "@shared/household-calendar";
import type { PatternSelection } from "@shared/recurring-pattern";

// Types matching server schema
export interface RecurringTransaction {
  id: string;
  householdId: string;
  accountId: string;
  name: string;
  amount: MoneyDto;
  verifiedCurrency?: "ZMW" | null;
  definitionToken?: string;
  amountType?: "fixed" | "variable" | null;
  amountTolerance?: number | null;
  type: "income" | "expense";
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
  categoryId?: string | null;
  merchantId?: string | null;
  intervalValue?: number | null;
  intervalUnit?: "days" | "weeks" | "months" | "years" | null;
  startDate?: string | null;
  endDate?: string | null;
  nextDueDate: string;
  dayOfMonth?: number | null;
  dayOfWeek?: number | null;
  reminderDays?: number | null;
  reminderEmail?: boolean | null;
  reminderPush?: boolean | null;
  reminderInApp?: boolean | null;
  autoLinkEnabled?: boolean | null;
  autoMarkReviewed?: boolean | null;
  isSubscription?: boolean | null;
  trialEndDate?: string | null;
  totalOccurrences?: number | null;
  missedCount?: number | null;
  lastOccurredDate?: string | null;
  detectionMethod?: string | null;
  detectionConfidence?: number | null;
  isActive: boolean;
  isPaused: boolean;
  notes?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RecurringCalendarOccurrence {
  id: string;
  date: string;
  status: "upcoming" | "due" | "overdue" | "pending" | "paid" | "received" | "skipped";
  rule: RecurringTransaction;
  amount: MoneyDto | null;
}

export interface CreateRecurringInput {
  accountId: string;
  name: string;
  amount: MoneyDto;
  amountType?: "fixed" | "variable";
  amountTolerance?: number;
  type: "income" | "expense";
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
  categoryId?: string | null;
  merchantId?: string | null;
  intervalValue?: number;
  intervalUnit?: "days" | "weeks" | "months" | "years";
  startDate?: string;
  endDate?: string | null;
  nextDueDate: string;
  dayOfMonth?: number | null;
  dayOfWeek?: number | null;
  reminderDays?: number;
  reminderEmail?: boolean;
  reminderPush?: boolean;
  reminderInApp?: boolean;
  autoLinkEnabled?: boolean;
  autoMarkReviewed?: boolean;
  isSubscription?: boolean;
  trialEndDate?: string | null;
  notes?: string | null;
  isActive?: boolean;
}

export interface CreateRecurringTransactionInput {
  accountId: string;
  date: string;
  name: string;
  amount: MoneyDto;
  type: "income" | "expense";
  categoryId?: string;
  merchantId?: string;
  notes?: string;
  ownerUserId?: string | null;
  idempotencyKey?: string;
  recurring: {
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
    startDate?: string;
    endDate?: string | null;
    intervalValue?: number;
    intervalUnit?: "days" | "weeks" | "months" | "years";
    amountType?: "fixed" | "variable";
    amountTolerance?: number;
    reminderDays?: number;
    reminderEmail?: boolean;
    reminderPush?: boolean;
    reminderInApp?: boolean;
    autoLinkEnabled?: boolean;
    autoMarkReviewed?: boolean;
    isSubscription?: boolean;
    trialEndDate?: string | null;
    notes?: string | null;
  };
}

export interface CreateRecurringForExistingTransactionInput {
  transactionId: string;
  recurring: CreateRecurringTransactionInput["recurring"];
}

export interface UpdateRecurringInput {
  confirmDenomination?: boolean;
  expectedDefinition?: string;
  accountId?: string;
  name?: string;
  amount?: MoneyDto;
  amountType?: "fixed" | "variable";
  amountTolerance?: number;
  type?: "income" | "expense";
  frequency?:
    | "daily"
    | "weekly"
    | "biweekly"
    | "monthly"
    | "quarterly"
    | "semi_annually"
    | "annually"
    | "yearly"
    | "custom";
  categoryId?: string | null;
  merchantId?: string | null;
  intervalValue?: number;
  intervalUnit?: "days" | "weeks" | "months" | "years";
  endDate?: string | null;
  nextDueDate?: string;
  dayOfMonth?: number | null;
  dayOfWeek?: number | null;
  reminderDays?: number;
  reminderEmail?: boolean;
  reminderPush?: boolean;
  reminderInApp?: boolean;
  autoLinkEnabled?: boolean;
  autoMarkReviewed?: boolean;
  isSubscription?: boolean;
  trialEndDate?: string | null;
  notes?: string | null;
  isActive?: boolean;
  isPaused?: boolean;
}

export interface ProcessResult {
  processed: number;
  created: number;
  errors: Array<{ ruleId: string; error: string }>;
}

export interface RecurringSummary {
  totalMonthlyIncome: MoneyDto;
  totalMonthlyExpenses: MoneyDto;
  activeCount: number;
  subscriptionCount: number;
  upcomingCount: number;
}

export interface DetectionOptions {
  minOccurrences?: number;
  lookbackMonths?: number;
  confidenceThreshold?: number;
  merchantId?: string;
  categoryId?: string;
}

export interface DetectedPattern {
  selection?: PatternSelection;
  confirmationIssue?: string;
  amountTolerance?: number;
  name: string;
  type: "income" | "expense";
  merchantId?: string | null;
  estimatedAmount: MoneyDto;
  amountVariance: number;
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
  dayOfMonth?: number | null;
  dayOfWeek?: number | null;
  confidence: number;
  occurrences: number;
  sampleTransactionIds: string[];
  suggestedStartDate: string;
  suggestedNextDueDate: string;
}

export interface RecurringTransactionLink {
  id: string;
  recurringTransactionId: string;
  transactionId: string;
  matchConfidence?: number | null;
  matchMethod?: "auto" | "manual" | "confirmed" | null;
  expectedDate?: string | null;
  actualDate?: string | null;
  expectedAmount?: MoneyDto | null;
  actualAmount?: MoneyDto | null;
  status?: string | null;
  createdAt: string;
}

export interface RecurringTransactionHistory {
  id: string;
  recurringTransactionId: string;
  action: string;
  previousState?: Record<string, unknown> | null;
  newState?: Record<string, unknown> | null;
  changeReason?: string | null;
  performedBy?: string | null;
  linkedTransactionId?: string | null;
  createdAt: string;
}

// API response types
interface ApiResponse<T> {
  success: boolean;
  data: T;
}

// CSRF-aware API helper (attaches x-csrf-token + self-heals on stale token).
import { apiCall } from "@/lib/api";

// Query keys
export const recurringKeys = {
  all: ["recurring"] as const,
  lists: () => [...recurringKeys.all, "list"] as const,
  list: (params?: { includeInactive?: boolean; includePaused?: boolean }) =>
    [...recurringKeys.lists(), params] as const,
  detail: (id: string) => [...recurringKeys.all, "detail", id] as const,
  calendar: () => [...recurringKeys.all, "calendar"] as const,
  summary: () => [...recurringKeys.all, "summary"] as const,
  upcoming: (days?: number) =>
    [...recurringKeys.all, "upcoming", days] as const,
  history: (id: string) => [...recurringKeys.all, "history", id] as const,
  links: (id: string) => [...recurringKeys.all, "links", id] as const,
  patterns: () => [...recurringKeys.all, "patterns"] as const,
};

// Hooks
export function useRecurringCalendar({ from, to }: CalendarDateRange, enabled: boolean) {
  return useQuery({
    queryKey: [...recurringKeys.calendar(), from, to],
    enabled,
    staleTime: 0,
    queryFn: async ({ signal }) => {
      const query = new URLSearchParams({ from, to });
      const res = await apiCall<ApiResponse<RecurringCalendarOccurrence[]>>(
        `/recurring/calendar?${query}`, { signal },
      );
      return res.data;
    },
  });
}

export function useRecurring(params?: {
  includeInactive?: boolean;
  includePaused?: boolean;
}) {
  return useQuery({
    queryKey: recurringKeys.list(params),
    queryFn: async () => {
      const query = new URLSearchParams();
      if (params?.includeInactive) query.set("includeInactive", "true");
      if (params?.includePaused) query.set("includePaused", "true");
      const queryStr = query.toString();
      const res = await apiCall<ApiResponse<RecurringTransaction[]>>(
        `/recurring${queryStr ? `?${queryStr}` : ""}`
      );
      return res.data;
    },
    staleTime: 30_000,
  });
}

export function useRecurringRule(id: string) {
  return useQuery({
    queryKey: recurringKeys.detail(id),
    queryFn: async () => {
      const res = await apiCall<ApiResponse<RecurringTransaction>>(
        `/recurring/${id}`
      );
      return res.data;
    },
    enabled: !!id,
  });
}

export function useUpcomingBills(days: number = 14) {
  return useQuery({
    queryKey: recurringKeys.upcoming(days),
    queryFn: async () => {
      const res = await apiCall<ApiResponse<RecurringTransaction[]>>(
        `/recurring/upcoming?days=${days}`
      );
      return res.data;
    },
    staleTime: 60_000,
  });
}

export function useRecurringSummary() {
  return useQuery({
    queryKey: recurringKeys.summary(),
    queryFn: async () => {
      const res = await apiCall<ApiResponse<RecurringSummary>>(
        "/recurring/summary"
      );
      return res.data;
    },
    staleTime: 60_000,
  });
}

export function useDetectPatterns() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (options?: DetectionOptions) => {
      const res = await apiCall<ApiResponse<DetectedPattern[]>>(
        "/recurring/detect",
        {
          method: "POST",
          body: JSON.stringify(options ?? {}),
        }
      );
      return res.data;
    },
    onSuccess: (patterns) => {
      queryClient.setQueryData(recurringKeys.patterns(), patterns);
      toast({
        title: "Recurring patterns detected",
        description: `Found ${patterns.length} pattern${
          patterns.length === 1 ? "" : "s"
        }.`,
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Pattern detection failed",
        description: userErrorMessage(error, "Please try again."),
        variant: "destructive",
      });
    },
  });
}

export function useConfirmPattern() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({
      pattern,
      accountId,
    }: {
      pattern: DetectedPattern;
      accountId: string;
    }) => {
      const res = await apiCall<ApiResponse<RecurringTransaction>>(
        "/recurring/confirm",
        {
          method: "POST",
          body: JSON.stringify({ pattern, accountId }),
        }
      );
      return res.data;
    },
    onSuccess: (rule) => {
      queryClient.invalidateQueries({ queryKey: recurringKeys.all });
      toast({
        title: "Recurring rule created",
        description: `${rule.name} has been added.`,
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to confirm pattern",
        description: userErrorMessage(error, "Please try again."),
        variant: "destructive",
      });
    },
  });
}

export function useLinkTransaction() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({
      recurringId,
      transactionId,
      matchConfidence,
    }: {
      recurringId: string;
      transactionId: string;
      matchConfidence?: number;
    }) => {
      const res = await apiCall<ApiResponse<RecurringTransactionLink>>(
        `/recurring/${recurringId}/link`,
        {
          method: "POST",
          body: JSON.stringify({ transactionId, matchConfidence }),
        }
      );
      return res.data;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: recurringKeys.links(variables.recurringId),
      });
      queryClient.invalidateQueries({
        queryKey: recurringKeys.detail(variables.recurringId),
      });
      queryClient.invalidateQueries({ queryKey: recurringKeys.calendar() });
      toast({
        title: "Transaction linked",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to link transaction",
        description: userErrorMessage(error, "Please try again."),
        variant: "destructive",
      });
    },
  });
}

export function useUnlinkTransaction() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({
      linkId,
      recurringId,
    }: {
      linkId: string;
      recurringId: string;
    }) => {
      await apiCall<ApiResponse<{ message: string }>>(
        `/recurring/${recurringId}/link/${linkId}`,
        {
          method: "DELETE",
        }
      );
      return { recurringId };
    },
    onSuccess: ({ recurringId }) => {
      queryClient.invalidateQueries({
        queryKey: recurringKeys.links(recurringId),
      });
      queryClient.invalidateQueries({ queryKey: recurringKeys.calendar() });
      toast({ title: "Transaction unlinked" });
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to unlink transaction",
        description: userErrorMessage(error, "Please try again."),
        variant: "destructive",
      });
    },
  });
}

export function useRecurringHistory(id: string, limit?: number) {
  return useQuery({
    queryKey: recurringKeys.history(id),
    queryFn: async () => {
      const query = limit ? `?limit=${limit}` : "";
      const res = await apiCall<ApiResponse<RecurringTransactionHistory[]>>(
        `/recurring/${id}/history${query}`
      );
      return res.data;
    },
    enabled: !!id,
  });
}

export function useRecurringLinks(id: string) {
  return useQuery({
    queryKey: recurringKeys.links(id),
    queryFn: async () => {
      const res = await apiCall<ApiResponse<RecurringTransactionLink[]>>(
        `/recurring/${id}/transactions`
      );
      return res.data;
    },
    enabled: !!id,
  });
}

export function useCreateRecurring() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (data: CreateRecurringInput) => {
      const res = await apiCall<ApiResponse<RecurringTransaction>>(
        "/recurring",
        {
          method: "POST",
          body: JSON.stringify(data),
        }
      );
      return res.data;
    },
    onSuccess: (rule) => {
      queryClient.invalidateQueries({ queryKey: recurringKeys.all });
      toast({
        title: "Recurring rule created",
        description: `${rule.name} has been added.`,
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to create rule",
        description: userErrorMessage(error, "Please try again."),
        variant: "destructive",
      });
    },
  });
}

export function useCreateRecurringTransaction() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (data: CreateRecurringTransactionInput) => {
      const res = await apiCall<
        ApiResponse<{
          transaction: Transaction;
          recurringRule: RecurringTransaction;
          isDuplicate?: boolean;
        }>
      >(RECURRING_TRANSACTION_ENDPOINT, {
        method: "POST",
        body: JSON.stringify(data),
      });
      return {
        transaction: res.data.transaction,
        recurringRule: res.data.recurringRule,
        // The combined route reports a replay inside data (recurring.controller createWithTransaction).
        isDuplicate: res.data.isDuplicate ?? false,
      };
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: recurringKeys.all });
      queryClient.invalidateQueries({ queryKey: ["transactions"] });
      queryClient.invalidateQueries({ queryKey: accountKeys.all });
      toast({
        title: result.isDuplicate
          ? "Duplicate detected"
          : "Recurring transaction created",
        description: result.isDuplicate
          ? "This transaction was already created."
          : `${result.transaction.name} has been added.`,
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to create recurring transaction",
        description: mapServerFieldErrors(error).summary ?? userErrorMessage(error, "Please try again."),
        variant: "destructive",
      });
    },
  });
}

export function useCreateRecurringForTransaction() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (data: CreateRecurringForExistingTransactionInput) => {
      const res = await apiCall<
        ApiResponse<{
          transaction: Transaction;
          recurringRule: RecurringTransaction;
        }> & { isDuplicate?: boolean }
      >(`/recurring/transaction/${data.transactionId}`, {
        method: "POST",
        body: JSON.stringify(data.recurring),
      });
      return {
        transaction: res.data.transaction,
        recurringRule: res.data.recurringRule,
        isDuplicate: res.isDuplicate ?? false,
      };
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: recurringKeys.all });
      queryClient.invalidateQueries({ queryKey: ["transactions"] });
      queryClient.invalidateQueries({ queryKey: accountKeys.all });
      toast({
        title: result.isDuplicate
          ? "Already recurring"
          : "Recurring rule created",
        description: result.isDuplicate
          ? "This transaction is already linked to a recurring rule."
          : `${result.transaction.name} has been marked as recurring.`,
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to create recurring rule",
        description: userErrorMessage(error, "Please try again."),
        variant: "destructive",
      });
    },
  });
}

export function useUpdateRecurring() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({
      id,
      data,
    }: {
      id: string;
      data: UpdateRecurringInput;
    }) => {
      const res = await apiCall<ApiResponse<RecurringTransaction>>(
        `/recurring/${id}`,
        {
          method: "PUT",
          body: JSON.stringify(data),
        }
      );
      return res.data;
    },
    onSuccess: (rule) => {
      queryClient.setQueryData(recurringKeys.detail(rule.id), rule);
      queryClient.invalidateQueries({ queryKey: recurringKeys.list() });
      queryClient.invalidateQueries({ queryKey: recurringKeys.calendar() });
      toast({
        title: "Rule updated",
        description: `${rule.name} has been updated.`,
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to update rule",
        description: userErrorMessage(error, "Please try again."),
        variant: "destructive",
      });
    },
  });
}

export function useSkipRecurring() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    // Naming the occurrence makes a double click an idempotent no-op on the server (R14).
    mutationFn: async ({ id, occurrenceDate }: { id: string; occurrenceDate: string }) => {
      const res = await apiCall<ApiResponse<RecurringTransaction>>(
        `/recurring/${id}/skip`,
        {
          method: "POST",
          body: JSON.stringify({ occurrenceDate }),
        }
      );
      return res.data;
    },
    onSuccess: (rule) => {
      queryClient.setQueryData(recurringKeys.detail(rule.id), rule);
      queryClient.invalidateQueries({ queryKey: recurringKeys.list() });
      queryClient.invalidateQueries({ queryKey: recurringKeys.upcoming() });
      queryClient.invalidateQueries({ queryKey: recurringKeys.calendar() });
      toast({
        title: "Occurrence skipped",
        description: `Next due: ${rule.nextDueDate}`,
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to skip",
        description: userErrorMessage(error, "Please try again."),
        variant: "destructive",
      });
    },
  });
}

export function usePauseRecurring() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({ id, pause }: { id: string; pause: boolean }) => {
      const res = await apiCall<ApiResponse<RecurringTransaction>>(
        `/recurring/${id}/${pause ? "pause" : "resume"}`,
        { method: "POST" }
      );
      return res.data;
    },
    onSuccess: (rule, { pause }) => {
      queryClient.invalidateQueries({ queryKey: recurringKeys.all });
      toast({ title: pause ? "Rule paused" : "Rule resumed" });
    },
    onError: (error: Error) => {
      toast({
        title: "Operation failed",
        description: userErrorMessage(error, "Please try again."),
        variant: "destructive",
      });
    },
  });
}

export function useEndRecurring() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({
      id,
      endDate,
      reason,
    }: {
      id: string;
      endDate?: string;
      reason?: string;
    }) => {
      const res = await apiCall<ApiResponse<RecurringTransaction>>(
        `/recurring/${id}/end`,
        {
          method: "POST",
          body: JSON.stringify({ endDate, reason }),
        }
      );
      return res.data;
    },
    onSuccess: (rule) => {
      queryClient.invalidateQueries({ queryKey: recurringKeys.all });
      toast({
        title: "Recurring rule ended",
        description: `${rule.name} has been ended.`,
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to end rule",
        description: userErrorMessage(error, "Please try again."),
        variant: "destructive",
      });
    },
  });
}

export function useProcessRecurring() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async () => {
      const res = await apiCall<ApiResponse<ProcessResult>>(
        "/recurring/process",
        {
          method: "POST",
        }
      );
      return res.data;
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: recurringKeys.all });
      // Also invalidate transactions since new ones were created
      queryClient.invalidateQueries({ queryKey: ["transactions"] });
      toast({
        title: "Recurring processed",
        description: `Created ${result.created} transactions`,
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Processing failed",
        description: userErrorMessage(error, "Please try again."),
        variant: "destructive",
      });
    },
  });
}

export function useDeleteRecurring() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (id: string) => {
      await apiCall<ApiResponse<{ message: string }>>(`/recurring/${id}`, {
        method: "DELETE",
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: recurringKeys.all });
      toast({ title: "Rule deleted" });
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to delete",
        description: userErrorMessage(error, "Please try again."),
        variant: "destructive",
      });
    },
  });
}
