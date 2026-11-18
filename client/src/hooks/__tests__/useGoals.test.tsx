/**
 * @vitest-environment jsdom
 */
import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import {
  goalKeys,
  useAddContribution,
  useAssignAccountForGoal,
  useCreateGoal,
  useDeleteGoal,
  useGoal,
  useGoalActivity,
  useGoalAssignmentsAll,
  useGoalContributions,
  useGoalProjection,
  useGoalTransactions,
  useGoals,
  useGoalsSummary,
  useGoalTransfersForGoal,
  useLinkTransaction,
  useTransactionGoalLinks,
  useTransferBetweenGoals,
  useUnlinkTransactionFromGoal,
  useUpdateGoal,
  useAvailableFunds,
} from "../useGoals";

const toastSpy = vi.fn();

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: toastSpy }),
}));

const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );

  return { queryClient, wrapper };
};

const mockFetchResponse = (data: unknown, ok = true): Response =>
  ({
    ok,
    json: vi.fn().mockResolvedValue(data),
  } as unknown as Response);

describe("useGoals hooks", () => {
  const goalId = "11111111-1111-1111-1111-111111111111";

  beforeEach(() => {
    toastSpy.mockReset();
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("fetches goals with query params", async () => {
    const mockFetch = vi.mocked(fetch);
    mockFetch.mockResolvedValue(
      mockFetchResponse({
        success: true,
        data: [
          {
            id: goalId,
            name: "Emergency Fund",
            type: "save_up",
            goalType: "emergency_fund",
            targetAmount: "500.00",
            currentAmount: "100.00",
            currency: "ZMW",
          },
        ],
      })
    );

    const { wrapper } = createWrapper();
    const { result } = renderHook(
      () => useGoals({ includeArchived: true, type: "save_up" }),
      { wrapper }
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockFetch).toHaveBeenCalledWith(
      "/api/goals?includeArchived=true&type=save_up",
      expect.objectContaining({ credentials: "include" })
    );
  });

  it("fetches goals summary", async () => {
    const mockFetch = vi.mocked(fetch);
    mockFetch.mockResolvedValue(
      mockFetchResponse({
        success: true,
        data: {
          saveUp: {
            total: 1,
            onTrack: 1,
            behind: 0,
            atRisk: 0,
            completed: 0,
            totalSaved: 100,
            totalTarget: 500,
            overallProgress: 20,
          },
          payDown: {
            total: 0,
            totalDebt: 0,
            totalPaid: 0,
            projectedInterest: 0,
            onTrack: 0,
            behind: 0,
          },
          recentActivity: [],
          upcomingMilestones: [],
        },
      })
    );

    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useGoalsSummary(), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockFetch).toHaveBeenCalledWith(
      "/api/goals/summary",
      expect.objectContaining({ credentials: "include" })
    );
  });

  it("fetches a goal by id", async () => {
    const mockFetch = vi.mocked(fetch);
    mockFetch.mockResolvedValue(
      mockFetchResponse({
        success: true,
        data: {
          id: goalId,
          name: "Emergency Fund",
          type: "save_up",
          goalType: "emergency_fund",
          targetAmount: "500.00",
          currentAmount: "100.00",
          currency: "ZMW",
          percentComplete: 20,
          remaining: 400,
          isCompleted: false,
          isArchived: false,
          status: "on_track",
          startDate: "2026-01-01",
        },
      })
    );

    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useGoal(goalId), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockFetch).toHaveBeenCalledWith(
      `/api/goals/${goalId}`,
      expect.objectContaining({ credentials: "include" })
    );
  });

  it("fetches household assignments", async () => {
    const mockFetch = vi.mocked(fetch);
    mockFetch.mockResolvedValue(
      mockFetchResponse({
        success: true,
        data: [
          {
            id: "assign-1",
            goalId,
            accountId: "22222222-2222-2222-2222-222222222222",
            assignmentType: "full_balance",
            autoUpdate: true,
            createdAt: "2026-01-20",
            updatedAt: "2026-01-20",
          },
        ],
      })
    );

    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useGoalAssignmentsAll(), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockFetch).toHaveBeenCalledWith(
      "/api/goals/assignments",
      expect.objectContaining({ credentials: "include" })
    );
  });

  it("fetches available funds", async () => {
    const mockFetch = vi.mocked(fetch);
    mockFetch.mockResolvedValue(
      mockFetchResponse({
        success: true,
        data: [
          {
            accountId: "account-1",
            accountName: "Savings",
            balance: "100.00",
            assignedAmount: "25.00",
            availableAmount: "75.00",
            currency: "ZMW",
          },
        ],
      })
    );

    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useAvailableFunds(), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockFetch).toHaveBeenCalledWith(
      "/api/goals/available-funds",
      expect.objectContaining({ credentials: "include" })
    );
  });

  it("fetches goal projection", async () => {
    const mockFetch = vi.mocked(fetch);
    mockFetch.mockResolvedValue(
      mockFetchResponse({
        success: true,
        data: {
          monthlyProjection: 75,
          projectedCompletionDate: "2026-12-31",
          status: "on_track",
          monthsRemaining: 12,
        },
      })
    );

    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useGoalProjection(goalId), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockFetch).toHaveBeenCalledWith(
      `/api/goals/${goalId}/projection`,
      expect.objectContaining({ credentials: "include" })
    );
  });

  it("fetches goal contributions", async () => {
    const mockFetch = vi.mocked(fetch);
    mockFetch.mockResolvedValue(
      mockFetchResponse({
        success: true,
        data: [
          {
            id: "contrib-1",
            goalId,
            amount: "20.00",
            date: "2026-01-20",
            createdAt: "2026-01-20",
          },
        ],
      })
    );

    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useGoalContributions(goalId), {
      wrapper,
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockFetch).toHaveBeenCalledWith(
      `/api/goals/${goalId}/contributions`,
      expect.objectContaining({ credentials: "include" })
    );
  });

  it("fetches goal transfers for a goal", async () => {
    const mockFetch = vi.mocked(fetch);
    mockFetch.mockResolvedValue(
      mockFetchResponse({
        success: true,
        data: [
          {
            id: "transfer-1",
            fromGoalId: goalId,
            toGoalId: "goal-2",
            amount: "15.00",
            createdAt: "2026-01-20",
          },
        ],
      })
    );

    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useGoalTransfersForGoal(goalId), {
      wrapper,
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockFetch).toHaveBeenCalledWith(
      `/api/goals/${goalId}/transfers`,
      expect.objectContaining({ credentials: "include" })
    );
  });

  it("fetches goal transactions", async () => {
    const mockFetch = vi.mocked(fetch);
    mockFetch.mockResolvedValue(
      mockFetchResponse({
        success: true,
        data: [
          {
            id: "link-1",
            transactionId: "tx-1",
            goalId,
            amount: "10.00",
            linkType: "contribution",
            linkedAt: "2026-01-20",
            transaction: {
              id: "tx-1",
              accountId: "account-1",
              householdId: "house-123",
              date: "2026-01-20",
              name: "Deposit",
              amount: "10.00",
              type: "income",
            },
          },
        ],
      })
    );

    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useGoalTransactions(goalId), {
      wrapper,
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockFetch).toHaveBeenCalledWith(
      `/api/goals/${goalId}/transactions`,
      expect.objectContaining({ credentials: "include" })
    );
  });

  it("fetches transaction goal links", async () => {
    const mockFetch = vi.mocked(fetch);
    mockFetch.mockResolvedValue(
      mockFetchResponse({
        success: true,
        data: [
          {
            id: "link-1",
            transactionId: "tx-1",
            goalId,
            amount: "10.00",
            linkType: "contribution",
            linkedAt: "2026-01-20",
            goal: {
              id: goalId,
              name: "Emergency Fund",
              type: "save_up",
            },
          },
        ],
      })
    );

    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useTransactionGoalLinks("tx-1"), {
      wrapper,
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockFetch).toHaveBeenCalledWith(
      "/api/transactions/tx-1/goals",
      expect.objectContaining({ credentials: "include" })
    );
  });

  it("fetches goal activity with query params", async () => {
    const mockFetch = vi.mocked(fetch);
    mockFetch.mockResolvedValue(
      mockFetchResponse({
        success: true,
        data: [
          {
            id: "activity-1",
            goalId,
            activityType: "goal_created",
            createdAt: "2026-01-20",
          },
        ],
      })
    );

    const { wrapper } = createWrapper();
    const { result } = renderHook(
      () => useGoalActivity(goalId, { limit: 5, offset: 10 }),
      { wrapper }
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockFetch).toHaveBeenCalledWith(
      `/api/goals/${goalId}/activity?limit=5&offset=10`,
      expect.objectContaining({ credentials: "include" })
    );
  });

  it("creates a goal and invalidates cache", async () => {
    const mockFetch = vi.mocked(fetch);
    mockFetch.mockResolvedValue(
      mockFetchResponse({
        success: true,
        data: {
          id: goalId,
          name: "Emergency Fund",
          type: "save_up",
          targetAmount: "100.00",
          currentAmount: "0.00",
          currency: "ZMW",
        },
      })
    );

    const { wrapper, queryClient } = createWrapper();
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
    const { result } = renderHook(() => useCreateGoal(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({
        name: "Emergency Fund",
        type: "save_up",
        goalType: "emergency_fund",
        targetAmount: { amount: "100.00", currency: "ZMW" },
      });
    });

    expect(mockFetch).toHaveBeenCalledWith(
      "/api/goals",
      expect.objectContaining({ method: "POST" })
    );
    expect(invalidateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: goalKeys.all })
    );
    expect(toastSpy).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Goal created" })
    );
  });

  it("updates a goal and invalidates caches", async () => {
    const mockFetch = vi.mocked(fetch);
    mockFetch.mockResolvedValue(
      mockFetchResponse({
        success: true,
        data: {
          id: goalId,
          name: "Updated Goal",
          type: "save_up",
          targetAmount: "150.00",
          currentAmount: "10.00",
          currency: "ZMW",
          status: "on_track",
          isCompleted: false,
          isArchived: false,
          startDate: "2026-01-01",
        },
      })
    );

    const { wrapper, queryClient } = createWrapper();
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
    const { result } = renderHook(() => useUpdateGoal(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({
        id: goalId,
        data: { name: "Updated Goal" },
      });
    });

    expect(mockFetch).toHaveBeenCalledWith(
      `/api/goals/${goalId}`,
      expect.objectContaining({ method: "PUT" })
    );
    expect(invalidateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: goalKeys.detail(goalId) })
    );
    expect(invalidateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: goalKeys.summary() })
    );
    expect(toastSpy).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Goal updated" })
    );
  });

  it("deletes a goal and invalidates list cache", async () => {
    const mockFetch = vi.mocked(fetch);
    mockFetch.mockResolvedValue(
      mockFetchResponse({ success: true, data: { message: "Deleted" } })
    );

    const { wrapper, queryClient } = createWrapper();
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
    const { result } = renderHook(() => useDeleteGoal(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync(goalId);
    });

    expect(mockFetch).toHaveBeenCalledWith(
      `/api/goals/${goalId}`,
      expect.objectContaining({ method: "DELETE" })
    );
    expect(invalidateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: goalKeys.all })
    );
    expect(toastSpy).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Goal deleted" })
    );
  });

  it("assigns an account and invalidates caches", async () => {
    const mockFetch = vi.mocked(fetch);
    mockFetch.mockResolvedValue(
      mockFetchResponse({
        success: true,
        data: {
          assignment: {
            id: "assign-1",
            accountId: "22222222-2222-2222-2222-222222222222",
            assignmentType: "full_balance",
            autoUpdate: true,
            createdAt: "2026-01-20",
            updatedAt: "2026-01-20",
          },
          goal: {
            id: goalId,
            name: "Emergency Fund",
            type: "save_up",
            targetAmount: "100.00",
            currentAmount: "10.00",
            currency: "ZMW",
            createdAt: "2026-01-20",
            updatedAt: "2026-01-20",
            householdId: "house-123",
            status: "on_track",
            isCompleted: false,
            isArchived: false,
            startDate: "2026-01-01",
          },
        },
      })
    );

    const { wrapper, queryClient } = createWrapper();
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
    const { result } = renderHook(() => useAssignAccountForGoal(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({
        goalId,
        data: {
          accountId: "22222222-2222-2222-2222-222222222222",
          assignmentType: "full_balance",
          autoUpdate: true,
        },
      });
    });

    expect(mockFetch).toHaveBeenCalledWith(
      `/api/goals/${goalId}/assign-account`,
      expect.objectContaining({ method: "POST" })
    );
    expect(invalidateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: goalKeys.assignments(goalId) })
    );
    expect(invalidateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: goalKeys.availableFunds() })
    );
    expect(toastSpy).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Account assigned" })
    );
  });

  it("adds a contribution and invalidates caches", async () => {
    const mockFetch = vi.mocked(fetch);
    mockFetch.mockResolvedValue(
      mockFetchResponse({
        success: true,
        data: {
          goal: {
            id: goalId,
            name: "Emergency Fund",
            type: "save_up",
            targetAmount: "100.00",
            currentAmount: "20.00",
            currency: "ZMW",
            status: "on_track",
            isCompleted: false,
            isArchived: false,
            startDate: "2026-01-01",
            householdId: "house-123",
            createdAt: "2026-01-20",
            updatedAt: "2026-01-20",
          },
          contribution: {
            id: "contrib-1",
            goalId,
            amount: "20.00",
            date: "2026-01-20",
            createdAt: "2026-01-20",
          },
        },
      })
    );

    const { wrapper, queryClient } = createWrapper();
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
    const { result } = renderHook(() => useAddContribution(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({
        id: goalId,
        data: {
          amount: { amount: "20.00", currency: "ZMW" },
        },
      });
    });

    expect(mockFetch).toHaveBeenCalledWith(
      `/api/goals/${goalId}/contribute`,
      expect.objectContaining({ method: "POST" })
    );
    expect(invalidateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: goalKeys.contributions(goalId) })
    );
    expect(invalidateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: goalKeys.summary() })
    );
    expect(toastSpy).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Contribution added" })
    );
  });

  it("links a transaction and invalidates caches", async () => {
    const mockFetch = vi.mocked(fetch);
    mockFetch.mockResolvedValue(
      mockFetchResponse({
        success: true,
        data: {
          link: {
            id: "link-1",
            transactionId: "tx-1",
            goalId,
            amount: "10.00",
            linkType: "contribution",
            linkedAt: "2026-01-20",
          },
          goal: {
            id: goalId,
            name: "Emergency Fund",
            type: "save_up",
            targetAmount: "100.00",
            currentAmount: "10.00",
            currency: "ZMW",
            status: "on_track",
            isCompleted: false,
            isArchived: false,
            startDate: "2026-01-01",
            householdId: "house-123",
            createdAt: "2026-01-20",
            updatedAt: "2026-01-20",
          },
        },
      })
    );

    const { wrapper, queryClient } = createWrapper();
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
    const { result } = renderHook(() => useLinkTransaction(goalId), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({
        transactionId: "tx-1",
        linkType: "contribution",
        amount: { amount: "10.00", currency: "ZMW" },
      });
    });

    expect(mockFetch).toHaveBeenCalledWith(
      `/api/goals/${goalId}/transactions`,
      expect.objectContaining({ method: "POST" })
    );
    expect(invalidateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: goalKeys.transactions(goalId) })
    );
    expect(invalidateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: goalKeys.transactionLinks("tx-1") })
    );
    expect(toastSpy).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Transaction linked" })
    );
  });

  it("unlinks a transaction and invalidates caches", async () => {
    const mockFetch = vi.mocked(fetch);
    mockFetch.mockResolvedValue(
      mockFetchResponse({
        success: true,
        data: { success: true, goal: { id: goalId } },
      })
    );

    const { wrapper, queryClient } = createWrapper();
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
    const { result } = renderHook(() => useUnlinkTransactionFromGoal(), {
      wrapper,
    });

    await act(async () => {
      await result.current.mutateAsync({ goalId, transactionId: "tx-1" });
    });

    expect(mockFetch).toHaveBeenCalledWith(
      `/api/goals/${goalId}/transactions/tx-1`,
      expect.objectContaining({ method: "DELETE" })
    );
    expect(invalidateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: goalKeys.transactions(goalId) })
    );
    expect(invalidateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: goalKeys.transactionLinks("tx-1") })
    );
    expect(toastSpy).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Transaction unlinked" })
    );
  });

  it("transfers between goals and invalidates caches", async () => {
    const mockFetch = vi.mocked(fetch);
    mockFetch.mockResolvedValue(
      mockFetchResponse({
        success: true,
        data: {
          transfer: {
            id: "transfer-1",
            fromGoalId: "goal-1",
            toGoalId: "goal-2",
            amount: "10.00",
            createdAt: "2026-01-20",
          },
          fromGoal: { id: "goal-1", name: "From Goal" },
          toGoal: { id: "goal-2", name: "To Goal" },
        },
      })
    );

    const { wrapper, queryClient } = createWrapper();
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
    const { result } = renderHook(() => useTransferBetweenGoals(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({
        fromGoalId: "goal-1",
        toGoalId: "goal-2",
        amount: { amount: "10.00", currency: "ZMW" },
      });
    });

    expect(mockFetch).toHaveBeenCalledWith(
      "/api/goals/transfers",
      expect.objectContaining({ method: "POST" })
    );
    expect(invalidateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: goalKeys.transfers() })
    );
    expect(toastSpy).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Transfer completed" })
    );
  });
});
