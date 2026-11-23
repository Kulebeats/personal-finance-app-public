/**
 * Goal Hooks
 *
 * TanStack Query hooks for goals.
 */

import { userErrorMessage } from "@/lib/errorCopy";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import type { MoneyDto } from "@shared/money";

export type GoalType = "save_up" | "pay_down" | "investment";
export type GoalStatus = "on_track" | "behind" | "at_risk" | "completed";
export type PayoffMethod = "avalanche" | "snowball" | "custom";
export type AssignmentType = "full_balance" | "partial_balance";
export type TransactionLinkType = "contribution" | "spending";

export type SaveUpGoalType =
  | "vacation"
  | "emergency_fund"
  | "down_payment"
  | "wedding"
  | "vehicle"
  | "home_improvement"
  | "special_event"
  | "education"
  | "other";

export type PayDownGoalType =
  | "credit_card"
  | "student_loan"
  | "car_loan"
  | "mortgage"
  | "personal_loan"
  | "medical_debt"
  | "other";

export type InvestmentGoalType =
  | "retirement"
  | "wealth_building"
  | "education"
  | "property"
  | "other";

export interface Goal {
  id: string;
  householdId: string;
  name: string;
  description?: string | null;
  icon?: string | null;
  color?: string | null;
  customImageUrl?: string | null;
  targetAmount: string;
  currentAmount: string;
  currency: string;
  targetDate?: string | null;
  startDate: string;
  projectedCompletionDate?: string | null;
  monthlyProjection?: string | null;
  linkedAccountId?: string | null;
  expectedReturn?: string | null;
  inflationRate?: string | null;
  progressSource?: "contributions" | "holdings" | null;
  type: GoalType;
  goalType?: string | null;
  status: GoalStatus;
  /** "unavailable" when a progress source is another member's private item; the server then withholds progress. */
  progressAvailability?: "available" | "unavailable";
  spendingReducesProgress?: boolean | null;
  debtAccountId?: string | null;
  originalBalance?: string | null;
  interestRate?: string | null;
  minimumPayment?: string | null;
  monthlyPayment?: string | null;
  oneTimePayment?: string | null;
  payoffMethod?: PayoffMethod | null;
  priority?: number | null;
  notes?: string | null;
  createdBy?: string | null;
  isCompleted: boolean;
  completedAt?: string | null;
  isArchived: boolean;
  archivedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface GoalAccountAssignment {
  id: string;
  goalId: string;
  accountId: string;
  assignmentType: AssignmentType;
  partialAmount?: string | null;
  autoUpdate: boolean;
  createdAt: string;
  updatedAt: string;
  accountName?: string | null;
  accountBalance?: string | null;
  accountCurrency?: string | null;
  accountType?: string | null;
}

export interface GoalAccountAssignmentWithGoal extends GoalAccountAssignment {
  goalName?: string | null;
  goalType?: GoalType | null;
  goalCurrency?: string | null;
}

export interface GoalWithProgress extends Goal {
  percentComplete: number;
  remaining: number;
  daysLeft?: number | null;
  assignments?: GoalAccountAssignment[];
}

export interface GoalContribution {
  id: string;
  goalId: string;
  amount: string;
  date: string;
  notes?: string | null;
  transactionId?: string | null;
  createdAt: string;
}

export interface GoalTransfer {
  id: string;
  householdId: string;
  fromGoalId: string;
  toGoalId: string;
  /** Null when the transfer touches a goal whose progress you cannot see. */
  amount: MoneyDto | string | null;
  reason?: string | null;
  createdBy?: string | null;
  createdAt: string;
}

export interface TransactionGoalLink {
  id: string;
  transactionId: string;
  goalId: string;
  amount: string;
  linkType: TransactionLinkType;
  linkedAt: string;
  linkedBy?: string | null;
}

export interface TransactionGoalLinkWithTransaction
  extends TransactionGoalLink {
  transaction: {
    id: string;
    accountId: string;
    householdId: string;
    date: string;
    name: string;
    amount: string;
    type: string;
    categoryId?: string | null;
    merchantId?: string | null;
    notes?: string | null;
  };
}

export interface TransactionGoalLinkWithGoal extends TransactionGoalLink {
  goal: {
    id: string;
    name: string;
    type: GoalType;
    goalType?: string | null;
    icon?: string | null;
    color?: string | null;
    customImageUrl?: string | null;
  };
}

export interface GoalActivityLogEntry {
  id: string;
  goalId: string;
  activityType: string;
  amount?: string | null;
  previousBalance?: string | null;
  newBalance?: string | null;
  metadata?: Record<string, unknown> | null;
  createdBy?: string | null;
  createdAt: string;
}

export interface GoalProjection {
  /** "unavailable" when the goal's sources are hidden or a price or rate is missing; every field is then null. */
  availability: "available" | "unavailable";
  monthlyProjection: MoneyDto | null;
  projectedCompletionDate: string | null;
  status: GoalStatus | null;
  monthsRemaining: number | null;
}

export interface GoalsSummaryResponse {
  saveUp: {
    total: number;
    onTrack: number;
    behind: number;
    atRisk: number;
    completed: number;
    totalSaved: MoneyDto;
    totalTarget: MoneyDto;
    overallProgress: number;
    /** Goals left out of the totals: no rate to the household currency (A-09). */
    excludedCount?: number;
  };
  payDown: {
    total: number;
    totalDebt: MoneyDto;
    totalPaid: MoneyDto;
    projectedInterest: MoneyDto;
    onTrack: number;
    behind: number;
    excludedCount?: number;
  };
  investment?: {
    total: number;
    totalSaved: MoneyDto;
    totalTarget: MoneyDto;
    excludedCount?: number;
  };
  recentActivity: Array<{
    goalId: string;
    goalName: string;
    activityType: string;
    amount: MoneyDto | null;
    createdAt: string | null;
  }>;
  upcomingMilestones: Array<{
    goalId: string;
    goalName: string;
    milestone: string;
    daysAway: number;
  }>;
}

export interface PaymentScheduleItem {
  month: number;
  interest: number;
  principal: number;
  balance: number;
}

export interface PayoffScenario {
  monthlyPayment: number;
  payoffDate: string | null;
  totalInterest: number;
  totalPayment: number;
  monthsToPayoff: number | null;
  interestSavedVsMinimum: number;
  schedule: PaymentScheduleItem[];
}

export interface PayoffScenariosResponse {
  minimum: PayoffScenario;
  current: PayoffScenario;
  accelerated: PayoffScenario;
  aggressive: PayoffScenario;
  custom?: PayoffScenario;
}

export interface AvailableFundsResponse {
  accountId: string;
  accountName: string;
  balance: string;
  currency: string;
  assignedAmount: string;
  availableAmount: string;
}

export interface GoalImageUpload {
  id: string;
  url: string;
  originalFilename: string;
  mimeType: string;
  fileSize: number;
  uploadedAt: string | null;
  uploadedBy?: string | null;
}

export interface CreateSaveUpGoalInput {
  type: "save_up";
  goalType: SaveUpGoalType | string;
  name: string;
  description?: string | null;
  icon?: string | null;
  color?: string | null;
  customImageUrl?: string | null;
  targetAmount: MoneyDto;
  targetDate?: string | null;
  startDate?: string;
  spendingReducesProgress?: boolean;
  priority?: number;
  notes?: string | null;
}

export interface CreatePayDownGoalInput {
  type: "pay_down";
  goalType: PayDownGoalType | string;
  name: string;
  debtAccountId: string;
  interestRate: string;
  minimumPayment: MoneyDto;
  monthlyPayment: MoneyDto;
  oneTimePayment?: MoneyDto | null;
  payoffMethod?: PayoffMethod;
  priority?: number;
  notes?: string | null;
}

export interface CreateInvestmentGoalInput {
  type: "investment";
  goalType: InvestmentGoalType | string;
  name: string;
  description?: string | null;
  icon?: string | null;
  color?: string | null;
  customImageUrl?: string | null;
  targetAmount: MoneyDto;
  targetDate?: string | null;
  startDate?: string;
  linkedAccountId?: string | null;
  progressSource?: "contributions" | "holdings";
  expectedReturn?: string;
  inflationRate?: string;
  priority?: number;
  notes?: string | null;
}

export type CreateGoalInput =
  | CreateSaveUpGoalInput
  | CreatePayDownGoalInput
  | CreateInvestmentGoalInput;
export type UpdateGoalInput = Partial<
  Omit<CreateSaveUpGoalInput, "type"> &
    Omit<CreatePayDownGoalInput, "type"> &
    Omit<CreateInvestmentGoalInput, "type">
>;

export interface AddContributionInput {
  amount: MoneyDto;
  date?: string;
  notes?: string;
  transactionId?: string;
  /** NEW-29: required to take the goal past its target. */
  confirmOverfund?: boolean;
}

export interface AssignAccountInput {
  accountId: string;
  assignmentType: AssignmentType;
  partialAmount?: MoneyDto | null;
  autoUpdate?: boolean;
}

export interface GoalTransferInput {
  fromGoalId: string;
  toGoalId: string;
  amount: MoneyDto;
  reason?: string | null;
  /** NEW-29 / goals QA F5: required to take the receiving goal past its target. */
  confirmOverfund?: boolean;
}

export interface LinkTransactionInput {
  transactionId: string;
  linkType: TransactionLinkType;
  /** Must be in the transaction's own currency. */
  amount?: MoneyDto;
  /** Needed when an explicit contribution would take the goal past its target. */
  confirmOverfund?: boolean;
}

export interface DebtStrategyInput {
  method: "snowball" | "avalanche";
  debts: Array<{
    id: string;
    balance: number;
    rate: number;
    minPayment: number;
  }>;
}

// API response types
interface ApiResponse<T> {
  success: boolean;
  data: T;
}

// CSRF-aware API helper (attaches x-csrf-token + self-heals on stale token).
import { apiCall } from "@/lib/api";

// Query keys
export const goalKeys = {
  all: ["goals"] as const,
  listRoot: () => [...goalKeys.all, "list"] as const,
  list: (params?: {
    includeArchived?: boolean;
    includeCompleted?: boolean;
    type?: GoalType;
    status?: GoalStatus;
  }) => [...goalKeys.all, "list", params] as const,
  detail: (id: string) => [...goalKeys.all, "detail", id] as const,
  contributions: (id: string) =>
    [...goalKeys.all, "contributions", id] as const,
  summary: () => [...goalKeys.all, "summary"] as const,
  assignments: (id: string) => [...goalKeys.all, "assignments", id] as const,
  assignmentsAll: () => [...goalKeys.all, "assignments-all"] as const,
  availableFunds: () => [...goalKeys.all, "available-funds"] as const,
  images: () => [...goalKeys.all, "images"] as const,
  transfers: () => [...goalKeys.all, "transfers"] as const,
  transfersForGoal: (id: string) => [...goalKeys.all, "transfers", id] as const,
  transactions: (id: string) => [...goalKeys.all, "transactions", id] as const,
  transactionLinks: (transactionId: string) =>
    [...goalKeys.all, "transaction-links", transactionId] as const,
  activityRoot: (id: string) => [...goalKeys.all, "activity", id] as const,
  activity: (id: string, options?: { limit?: number; offset?: number }) =>
    [...goalKeys.all, "activity", id, options] as const,
  projection: (id: string) => [...goalKeys.all, "projection", id] as const,
  payoff: (id: string) => [...goalKeys.all, "payoff", id] as const,
  payoffScenarios: (id: string) =>
    [...goalKeys.all, "payoff-scenarios", id] as const,
};

// Hooks
export function useGoals(params?: {
  includeArchived?: boolean;
  includeCompleted?: boolean;
  type?: GoalType;
  status?: GoalStatus;
}) {
  return useQuery({
    queryKey: goalKeys.list(params),
    queryFn: async () => {
      const query = new URLSearchParams();
      if (params?.includeArchived) query.set("includeArchived", "true");
      if (params?.includeCompleted) query.set("includeCompleted", "true");
      if (params?.type) query.set("type", params.type);
      if (params?.status) query.set("status", params.status);
      const queryStr = query.toString();
      const res = await apiCall<ApiResponse<Goal[]>>(
        `/goals${queryStr ? `?${queryStr}` : ""}`
      );
      return res.data;
    },
    staleTime: 30_000,
  });
}

export function useGoal(id: string) {
  return useQuery({
    queryKey: goalKeys.detail(id),
    queryFn: async () => {
      const res = await apiCall<ApiResponse<GoalWithProgress>>(`/goals/${id}`);
      return res.data;
    },
    enabled: !!id,
  });
}

export function useGoalsSummary() {
  return useQuery({
    queryKey: goalKeys.summary(),
    queryFn: async () => {
      const res = await apiCall<ApiResponse<GoalsSummaryResponse>>(
        "/goals/summary"
      );
      return res.data;
    },
    staleTime: 30_000,
  });
}

export function useGoalProjection(id: string) {
  return useQuery({
    queryKey: goalKeys.projection(id),
    queryFn: async () => {
      const res = await apiCall<ApiResponse<GoalProjection>>(
        `/goals/${id}/projection`
      );
      return res.data;
    },
    enabled: !!id,
  });
}

export function useGoalContributions(id: string) {
  return useQuery({
    queryKey: goalKeys.contributions(id),
    queryFn: async () => {
      const res = await apiCall<ApiResponse<GoalContribution[]>>(
        `/goals/${id}/contributions`
      );
      return res.data;
    },
    enabled: !!id,
  });
}

export function useGoalAssignments(id: string) {
  return useQuery({
    queryKey: goalKeys.assignments(id),
    queryFn: async () => {
      const res = await apiCall<ApiResponse<GoalAccountAssignment[]>>(
        `/goals/${id}/assignments`
      );
      return res.data;
    },
    enabled: !!id,
  });
}

export function useGoalAssignmentsAll() {
  return useQuery({
    queryKey: goalKeys.assignmentsAll(),
    queryFn: async () => {
      const res = await apiCall<ApiResponse<GoalAccountAssignmentWithGoal[]>>(
        "/goals/assignments"
      );
      return res.data;
    },
  });
}

export function useAvailableFunds() {
  return useQuery({
    queryKey: goalKeys.availableFunds(),
    queryFn: async () => {
      const res = await apiCall<ApiResponse<AvailableFundsResponse[]>>(
        "/goals/available-funds"
      );
      return res.data;
    },
  });
}

export function useGoalImages() {
  return useQuery({
    queryKey: goalKeys.images(),
    queryFn: async () => {
      const res = await apiCall<ApiResponse<GoalImageUpload[]>>(
        "/goals/images"
      );
      return res.data;
    },
  });
}

export function useUploadGoalImage() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append("file", file);

      const res = await apiCall<ApiResponse<{ image: GoalImageUpload }>>(
        "/goals/images",
        { method: "POST", body: formData }
      );
      return res.data.image;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: goalKeys.images() });
      toast({
        title: "Image uploaded",
        description: "Goal image is ready to use.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to upload image",
        description: userErrorMessage(error, "Please try again."),
        variant: "destructive",
      });
    },
  });
}

export function useGoalTransfers() {
  return useQuery({
    queryKey: goalKeys.transfers(),
    queryFn: async () => {
      const res = await apiCall<ApiResponse<GoalTransfer[]>>(
        "/goals/transfers"
      );
      return res.data;
    },
  });
}

export function useGoalTransfersForGoal(id: string) {
  return useQuery({
    queryKey: goalKeys.transfersForGoal(id),
    queryFn: async () => {
      const res = await apiCall<ApiResponse<GoalTransfer[]>>(
        `/goals/${id}/transfers`
      );
      return res.data;
    },
    enabled: !!id,
  });
}

export function useGoalTransactions(id: string) {
  return useQuery({
    queryKey: goalKeys.transactions(id),
    queryFn: async () => {
      const res = await apiCall<
        ApiResponse<TransactionGoalLinkWithTransaction[]>
      >(`/goals/${id}/transactions`);
      return res.data;
    },
    enabled: !!id,
  });
}

export function useTransactionGoalLinks(transactionId: string) {
  return useQuery({
    queryKey: goalKeys.transactionLinks(transactionId),
    queryFn: async () => {
      const res = await apiCall<ApiResponse<TransactionGoalLinkWithGoal[]>>(
        `/transactions/${transactionId}/goals`
      );
      return res.data;
    },
    enabled: !!transactionId,
  });
}

export function useGoalActivity(
  id: string,
  options?: { limit?: number; offset?: number }
) {
  return useQuery({
    queryKey: goalKeys.activity(id, options),
    queryFn: async () => {
      const query = new URLSearchParams();
      if (options?.limit !== undefined) {
        query.set("limit", String(options.limit));
      }
      if (options?.offset !== undefined) {
        query.set("offset", String(options.offset));
      }
      const queryStr = query.toString();
      const res = await apiCall<ApiResponse<GoalActivityLogEntry[]>>(
        `/goals/${id}/activity${queryStr ? `?${queryStr}` : ""}`
      );
      return res.data;
    },
    enabled: !!id,
  });
}

export function useCreateGoal() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (data: CreateGoalInput) => {
      const res = await apiCall<ApiResponse<Goal>>("/goals", {
        method: "POST",
        body: JSON.stringify(data),
      });
      return res.data;
    },
    onSuccess: (goal) => {
      queryClient.invalidateQueries({ queryKey: goalKeys.all });
      toast({
        title: "Goal created",
        description: `${goal.name} has been added.`,
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to create goal",
        description: userErrorMessage(error, "Please try again."),
        variant: "destructive",
      });
    },
  });
}

export function useUpdateGoal() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: UpdateGoalInput }) => {
      const res = await apiCall<ApiResponse<Goal>>(`/goals/${id}`, {
        method: "PUT",
        body: JSON.stringify(data),
      });
      return res.data;
    },
    onSuccess: (goal) => {
      queryClient.invalidateQueries({ queryKey: goalKeys.detail(goal.id) });
      queryClient.invalidateQueries({ queryKey: goalKeys.listRoot() });
      queryClient.invalidateQueries({ queryKey: goalKeys.summary() });
      toast({
        title: "Goal updated",
        description: `${goal.name} has been updated.`,
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to update goal",
        description: userErrorMessage(error, "Please try again."),
        variant: "destructive",
      });
    },
  });
}

export function useBulkUpdateGoalPriority() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (
      updates: Array<{ id: string; priority: number }>
    ): Promise<void> => {
      await Promise.all(
        updates.map((update) =>
          apiCall<ApiResponse<Goal>>(`/goals/${update.id}`, {
            method: "PUT",
            body: JSON.stringify({ priority: update.priority }),
          })
        )
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: goalKeys.all });
      toast({
        title: "Priorities updated",
        description: "Goal order has been saved.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to update priorities",
        description: userErrorMessage(error, "Please try again."),
        variant: "destructive",
      });
    },
  });
}

export function useAddContribution() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({
      id,
      data,
    }: {
      id: string;
      data: AddContributionInput;
    }) => {
      const res = await apiCall<
        ApiResponse<{ goal: Goal; contribution: GoalContribution }>
      >(`/goals/${id}/contribute`, {
        method: "POST",
        body: JSON.stringify(data),
      });
      return res.data;
    },
    onSuccess: (result, { id }) => {
      queryClient.invalidateQueries({ queryKey: goalKeys.detail(id) });
      queryClient.invalidateQueries({ queryKey: goalKeys.contributions(id) });
      queryClient.invalidateQueries({ queryKey: goalKeys.activityRoot(id) });
      queryClient.invalidateQueries({ queryKey: goalKeys.summary() });
      queryClient.invalidateQueries({ queryKey: goalKeys.listRoot() });
      toast({
        title: "Contribution added",
        description: `Added to ${result.goal.name}.`,
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to add contribution",
        description: userErrorMessage(error, "Please try again."),
        variant: "destructive",
      });
    },
  });
}

export function useAssignAccount(goalId: string) {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (data: AssignAccountInput) => {
      const res = await apiCall<
        ApiResponse<{ assignment: GoalAccountAssignment; goal: Goal }>
      >(`/goals/${goalId}/assign-account`, {
        method: "POST",
        body: JSON.stringify(data),
      });
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: goalKeys.assignments(goalId) });
      queryClient.invalidateQueries({ queryKey: goalKeys.assignmentsAll() });
      queryClient.invalidateQueries({ queryKey: goalKeys.detail(goalId) });
      queryClient.invalidateQueries({ queryKey: goalKeys.availableFunds() });
      queryClient.invalidateQueries({
        queryKey: goalKeys.activityRoot(goalId),
      });
      queryClient.invalidateQueries({ queryKey: goalKeys.summary() });
      queryClient.invalidateQueries({ queryKey: goalKeys.listRoot() });
      toast({ title: "Account assigned" });
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to assign account",
        description: userErrorMessage(error, "Please try again."),
        variant: "destructive",
      });
    },
  });
}

export function useUpdateAssignment(goalId: string, accountId: string) {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (data: Partial<AssignAccountInput>) => {
      const res = await apiCall<
        ApiResponse<{ assignment: GoalAccountAssignment; goal: Goal }>
      >(`/goals/${goalId}/accounts/${accountId}`, {
        method: "PUT",
        body: JSON.stringify(data),
      });
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: goalKeys.assignments(goalId) });
      queryClient.invalidateQueries({ queryKey: goalKeys.assignmentsAll() });
      queryClient.invalidateQueries({ queryKey: goalKeys.detail(goalId) });
      queryClient.invalidateQueries({ queryKey: goalKeys.availableFunds() });
      queryClient.invalidateQueries({
        queryKey: goalKeys.activityRoot(goalId),
      });
      queryClient.invalidateQueries({ queryKey: goalKeys.summary() });
      queryClient.invalidateQueries({ queryKey: goalKeys.listRoot() });
      toast({ title: "Assignment updated" });
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to update assignment",
        description: userErrorMessage(error, "Please try again."),
        variant: "destructive",
      });
    },
  });
}

export function useRemoveAssignment(goalId: string, accountId: string) {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async () => {
      const res = await apiCall<ApiResponse<{ success: boolean; goal: Goal }>>(
        `/goals/${goalId}/accounts/${accountId}`,
        { method: "DELETE" }
      );
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: goalKeys.assignments(goalId) });
      queryClient.invalidateQueries({ queryKey: goalKeys.assignmentsAll() });
      queryClient.invalidateQueries({ queryKey: goalKeys.detail(goalId) });
      queryClient.invalidateQueries({ queryKey: goalKeys.availableFunds() });
      queryClient.invalidateQueries({
        queryKey: goalKeys.activityRoot(goalId),
      });
      queryClient.invalidateQueries({ queryKey: goalKeys.summary() });
      queryClient.invalidateQueries({ queryKey: goalKeys.listRoot() });
      toast({ title: "Assignment removed" });
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to remove assignment",
        description: userErrorMessage(error, "Please try again."),
        variant: "destructive",
      });
    },
  });
}

export function useAssignAccountForGoal() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({
      goalId,
      data,
    }: {
      goalId: string;
      data: AssignAccountInput;
    }) => {
      const res = await apiCall<
        ApiResponse<{ assignment: GoalAccountAssignment; goal: Goal }>
      >(`/goals/${goalId}/assign-account`, {
        method: "POST",
        body: JSON.stringify(data),
      });
      return res.data;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: goalKeys.assignments(variables.goalId),
      });
      queryClient.invalidateQueries({ queryKey: goalKeys.assignmentsAll() });
      queryClient.invalidateQueries({
        queryKey: goalKeys.detail(variables.goalId),
      });
      queryClient.invalidateQueries({ queryKey: goalKeys.availableFunds() });
      queryClient.invalidateQueries({
        queryKey: goalKeys.activityRoot(variables.goalId),
      });
      queryClient.invalidateQueries({ queryKey: goalKeys.summary() });
      queryClient.invalidateQueries({ queryKey: goalKeys.listRoot() });
      toast({ title: "Account assigned" });
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to assign account",
        description: userErrorMessage(error, "Please try again."),
        variant: "destructive",
      });
    },
  });
}

export function useUpdateAssignmentForGoal() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({
      goalId,
      accountId,
      data,
    }: {
      goalId: string;
      accountId: string;
      data: Partial<AssignAccountInput>;
    }) => {
      const res = await apiCall<
        ApiResponse<{ assignment: GoalAccountAssignment; goal: Goal }>
      >(`/goals/${goalId}/accounts/${accountId}`, {
        method: "PUT",
        body: JSON.stringify(data),
      });
      return res.data;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: goalKeys.assignments(variables.goalId),
      });
      queryClient.invalidateQueries({ queryKey: goalKeys.assignmentsAll() });
      queryClient.invalidateQueries({
        queryKey: goalKeys.detail(variables.goalId),
      });
      queryClient.invalidateQueries({ queryKey: goalKeys.availableFunds() });
      queryClient.invalidateQueries({
        queryKey: goalKeys.activityRoot(variables.goalId),
      });
      queryClient.invalidateQueries({ queryKey: goalKeys.summary() });
      queryClient.invalidateQueries({ queryKey: goalKeys.listRoot() });
      toast({ title: "Assignment updated" });
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to update assignment",
        description: userErrorMessage(error, "Please try again."),
        variant: "destructive",
      });
    },
  });
}

export function useRemoveAssignmentForGoal() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({
      goalId,
      accountId,
    }: {
      goalId: string;
      accountId: string;
    }) => {
      const res = await apiCall<ApiResponse<{ success: boolean; goal: Goal }>>(
        `/goals/${goalId}/accounts/${accountId}`,
        { method: "DELETE" }
      );
      return res.data;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: goalKeys.assignments(variables.goalId),
      });
      queryClient.invalidateQueries({ queryKey: goalKeys.assignmentsAll() });
      queryClient.invalidateQueries({
        queryKey: goalKeys.detail(variables.goalId),
      });
      queryClient.invalidateQueries({ queryKey: goalKeys.availableFunds() });
      queryClient.invalidateQueries({
        queryKey: goalKeys.activityRoot(variables.goalId),
      });
      queryClient.invalidateQueries({ queryKey: goalKeys.summary() });
      queryClient.invalidateQueries({ queryKey: goalKeys.listRoot() });
      toast({ title: "Assignment removed" });
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to remove assignment",
        description: userErrorMessage(error, "Please try again."),
        variant: "destructive",
      });
    },
  });
}

export function useTransferBetweenGoals() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (data: GoalTransferInput) => {
      const res = await apiCall<
        ApiResponse<{ transfer: GoalTransfer; fromGoal: Goal; toGoal: Goal }>
      >("/goals/transfers", {
        method: "POST",
        body: JSON.stringify(data),
      });
      return res.data;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: goalKeys.transfers() });
      queryClient.invalidateQueries({
        queryKey: goalKeys.transfersForGoal(variables.fromGoalId),
      });
      queryClient.invalidateQueries({
        queryKey: goalKeys.transfersForGoal(variables.toGoalId),
      });
      queryClient.invalidateQueries({
        queryKey: goalKeys.detail(variables.fromGoalId),
      });
      queryClient.invalidateQueries({
        queryKey: goalKeys.detail(variables.toGoalId),
      });
      queryClient.invalidateQueries({
        queryKey: goalKeys.activityRoot(variables.fromGoalId),
      });
      queryClient.invalidateQueries({
        queryKey: goalKeys.activityRoot(variables.toGoalId),
      });
      queryClient.invalidateQueries({ queryKey: goalKeys.summary() });
      queryClient.invalidateQueries({ queryKey: goalKeys.listRoot() });
      toast({ title: "Transfer completed" });
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to transfer",
        description: userErrorMessage(error, "Please try again."),
        variant: "destructive",
      });
    },
  });
}

export function useLinkTransaction(goalId: string) {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (data: LinkTransactionInput) => {
      const res = await apiCall<
        ApiResponse<{ link: TransactionGoalLink; goal: Goal }>
      >(`/goals/${goalId}/transactions`, {
        method: "POST",
        body: JSON.stringify(data),
      });
      return res.data;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: goalKeys.transactions(goalId),
      });
      queryClient.invalidateQueries({ queryKey: goalKeys.detail(goalId) });
      queryClient.invalidateQueries({
        queryKey: goalKeys.transactionLinks(variables.transactionId),
      });
      if (variables.linkType === "contribution") {
        queryClient.invalidateQueries({
          queryKey: goalKeys.contributions(goalId),
        });
      }
      queryClient.invalidateQueries({
        queryKey: goalKeys.activityRoot(goalId),
      });
      queryClient.invalidateQueries({ queryKey: goalKeys.summary() });
      queryClient.invalidateQueries({ queryKey: goalKeys.listRoot() });
      toast({ title: "Transaction linked" });
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

export function useUnlinkTransaction(goalId: string) {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (transactionId: string) => {
      const res = await apiCall<ApiResponse<{ success: boolean; goal: Goal }>>(
        `/goals/${goalId}/transactions/${transactionId}`,
        { method: "DELETE" }
      );
      return res.data;
    },
    onSuccess: (_, transactionId) => {
      queryClient.invalidateQueries({
        queryKey: goalKeys.transactions(goalId),
      });
      queryClient.invalidateQueries({ queryKey: goalKeys.detail(goalId) });
      queryClient.invalidateQueries({
        queryKey: goalKeys.transactionLinks(transactionId),
      });
      queryClient.invalidateQueries({
        queryKey: goalKeys.contributions(goalId),
      });
      queryClient.invalidateQueries({
        queryKey: goalKeys.activityRoot(goalId),
      });
      queryClient.invalidateQueries({ queryKey: goalKeys.summary() });
      queryClient.invalidateQueries({ queryKey: goalKeys.listRoot() });
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

export function useUnlinkTransactionFromGoal() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({
      goalId,
      transactionId,
    }: {
      goalId: string;
      transactionId: string;
    }) => {
      const res = await apiCall<ApiResponse<{ success: boolean; goal: Goal }>>(
        `/goals/${goalId}/transactions/${transactionId}`,
        { method: "DELETE" }
      );
      return res.data;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: goalKeys.transactions(variables.goalId),
      });
      queryClient.invalidateQueries({
        queryKey: goalKeys.detail(variables.goalId),
      });
      queryClient.invalidateQueries({
        queryKey: goalKeys.transactionLinks(variables.transactionId),
      });
      queryClient.invalidateQueries({
        queryKey: goalKeys.contributions(variables.goalId),
      });
      queryClient.invalidateQueries({
        queryKey: goalKeys.activityRoot(variables.goalId),
      });
      queryClient.invalidateQueries({ queryKey: goalKeys.summary() });
      queryClient.invalidateQueries({ queryKey: goalKeys.listRoot() });
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

export function useCompleteGoal() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (id: string) => {
      const res = await apiCall<ApiResponse<Goal>>(`/goals/${id}/complete`, {
        method: "POST",
      });
      return res.data;
    },
    onSuccess: (goal) => {
      queryClient.invalidateQueries({ queryKey: goalKeys.all });
      queryClient.invalidateQueries({ queryKey: goalKeys.detail(goal.id) });
      queryClient.invalidateQueries({
        queryKey: goalKeys.activityRoot(goal.id),
      });
      toast({ title: "Goal completed" });
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to complete goal",
        description: userErrorMessage(error, "Please try again."),
        variant: "destructive",
      });
    },
  });
}

export function useArchiveGoal() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({ id, archive }: { id: string; archive: boolean }) => {
      const res = await apiCall<ApiResponse<Goal>>(
        `/goals/${id}/${archive ? "archive" : "unarchive"}`,
        { method: "POST" }
      );
      return res.data;
    },
    onSuccess: (goal, { archive }) => {
      queryClient.invalidateQueries({ queryKey: goalKeys.all });
      queryClient.invalidateQueries({ queryKey: goalKeys.detail(goal.id) });
      queryClient.invalidateQueries({
        queryKey: goalKeys.activityRoot(goal.id),
      });
      toast({ title: archive ? "Goal archived" : "Goal restored" });
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

export function useDeleteGoal() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (id: string) => {
      await apiCall<ApiResponse<{ message: string }>>(`/goals/${id}`, {
        method: "DELETE",
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: goalKeys.all });
      toast({ title: "Goal deleted" });
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to delete goal",
        description: userErrorMessage(error, "Please try again."),
        variant: "destructive",
      });
    },
  });
}

export function useCalculatePayoff(goalId: string) {
  return useMutation({
    mutationFn: async (data: {
      monthlyPayment: number;
      oneTimePayment?: number;
    }) => {
      const res = await apiCall<ApiResponse<PayoffScenario>>(
        `/goals/${goalId}/calculate-payoff`,
        {
          method: "POST",
          body: JSON.stringify(data),
        }
      );
      return res.data;
    },
  });
}

export function usePayoffScenarios(goalId: string) {
  return useQuery({
    queryKey: goalKeys.payoffScenarios(goalId),
    queryFn: async () => {
      const res = await apiCall<ApiResponse<PayoffScenariosResponse>>(
        `/goals/${goalId}/payoff-scenarios`
      );
      return res.data;
    },
    enabled: !!goalId,
  });
}

export function useDebtStrategy() {
  return useMutation({
    mutationFn: async (data: DebtStrategyInput) => {
      const res = await apiCall<ApiResponse<any>>("/goals/debt-strategy", {
        method: "POST",
        body: JSON.stringify(data),
      });
      return res.data;
    },
  });
}
