/**
 * useBudgets Hook Tests
 *
 * Tests for the budgets data fetching hooks:
 * - Budget list fetching
 * - Budget progress with period
 * - Budget alerts
 * - Budget mutations (create, update, delete)
 * - Error handling
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ReactNode } from "react";

// Mock toast
vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({
    toast: vi.fn(),
  }),
}));

// Mock fetch
const mockFetch = vi.fn();
// apiCall() fetches a CSRF token (GET /api/csrf-token) before every mutating request
// (POST/PUT/DELETE). Serve that token transparently so it neither consumes the per-test
// response mock nor shows up in mockFetch call assertions; all other calls delegate to
// mockFetch exactly as before.
global.fetch = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
  if (String(input).includes("/csrf-token")) {
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ csrfToken: "test-csrf" }),
    });
  }
  return mockFetch(input, init);
}) as unknown as typeof fetch;

const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: 0,
      },
    },
  });

  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  };
};

// Import after mocks
import {
  useBudgets,
  useBudgetProgress,
  useBudgetAlerts,
  useBudgetSettings,
  useCreateBudget,
  useUpdateBudget,
  useDeleteBudget,
  useMoveBudgetAmount,
} from "../useBudgets";

describe("useBudgets Hook", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("useBudgets - List Fetching", () => {
    it("should fetch budgets successfully", async () => {
      const mockData = {
        success: true,
        data: [
          { id: "budget-1", name: "Groceries", amount: { amount: "500.00", currency: "ZMW" } },
          { id: "budget-2", name: "Entertainment", amount: { amount: "200.00", currency: "ZMW" } },
        ],
      };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockData),
      });

      const { result } = renderHook(() => useBudgets(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.data).toEqual(mockData.data);
    });

    it("should handle loading state", async () => {
      mockFetch.mockImplementation(
        () => new Promise((resolve) => setTimeout(resolve, 100))
      );

      const { result } = renderHook(() => useBudgets(), {
        wrapper: createWrapper(),
      });

      expect(result.current.isLoading).toBe(true);
    });

    it("should handle error state", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        json: () => Promise.resolve({ error: { message: "Failed to fetch budgets" } }),
      });

      const { result } = renderHook(() => useBudgets(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.isError).toBe(true);
      });
    });

    it("should include inactive budgets when specified", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true, data: [] }),
      });

      renderHook(() => useBudgets({ includeInactive: true }), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledWith(
          expect.stringContaining("includeInactive=true"),
          expect.any(Object)
        );
      });
    });
  });
});

describe("useBudgetProgress Hook", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should fetch budget progress for year and month", async () => {
    const mockData = {
      success: true,
      data: [
        {
          id: "budget-1",
          name: "Groceries",
          amount: { amount: "500.00", currency: "ZMW" },
          spent: { amount: "250.00", currency: "ZMW" },
          remaining: { amount: "250.00", currency: "ZMW" },
          percentUsed: 50,
        },
      ],
    };
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockData),
    });

    const { result } = renderHook(() => useBudgetProgress(2026, 1), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.data?.[0].percentUsed).toBe(50);
  });

  it("should call correct endpoint with year and month", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ success: true, data: [] }),
    });

    renderHook(() => useBudgetProgress(2026, 2), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("year=2026"),
        expect.any(Object)
      );
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("month=2"),
        expect.any(Object)
      );
    });
  });
});

describe("useBudgetAlerts Hook", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should fetch budget alerts", async () => {
    const mockAlerts = {
      success: true,
      data: [
        {
          budget: { id: "budget-1", name: "Groceries" },
          spent: { amount: "450.00", currency: "ZMW" },
          percentUsed: 90,
          alertLevel: "warning",
        },
      ],
    };
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockAlerts),
    });

    const { result } = renderHook(() => useBudgetAlerts(2026, 1), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.data?.[0].alertLevel).toBe("warning");
  });
});

describe("useBudgetSettings Hook", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should fetch budget settings", async () => {
    const mockSettings = {
      success: true,
      data: {
        budgetSystem: "category",
        defaultApplyScope: "this_month",
      },
    };
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockSettings),
    });

    const { result } = renderHook(() => useBudgetSettings(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.data?.budgetSystem).toBe("category");
  });
});

describe("Budget Mutation Hooks", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should create a budget", async () => {
    const newBudget = {
      id: "budget-new",
      name: "New Budget",
      amount: { amount: "300.00", currency: "ZMW" },
    };
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ success: true, data: newBudget }),
    });

    const { result } = renderHook(() => useCreateBudget(), {
      wrapper: createWrapper(),
    });

    await result.current.mutateAsync({
      name: "New Budget",
      amount: { amount: "300.00", currency: "ZMW" },
      categoryId: "cat-1",
    });

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("/budgets"),
      expect.objectContaining({
        method: "POST",
      })
    );
  });

  it("should update a budget", async () => {
    const updatedBudget = {
      id: "budget-1",
      name: "Updated Budget",
      amount: { amount: "600.00", currency: "ZMW" },
    };
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ success: true, data: updatedBudget }),
    });

    const { result } = renderHook(() => useUpdateBudget(), {
      wrapper: createWrapper(),
    });

    await result.current.mutateAsync({
      id: "budget-1",
      data: { amount: { amount: "600.00", currency: "ZMW" } },
    });

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("/budgets/budget-1"),
      expect.objectContaining({
        method: "PUT",
      })
    );
  });

  it("should delete a budget", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ success: true, data: { message: "Deleted" } }),
    });

    const { result } = renderHook(() => useDeleteBudget(), {
      wrapper: createWrapper(),
    });

    await result.current.mutateAsync("budget-1");

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("/budgets/budget-1"),
      expect.objectContaining({
        method: "DELETE",
      })
    );
  });

  it("should move budget amount between budgets", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ success: true, data: { scope: "this_month" } }),
    });

    const { result } = renderHook(() => useMoveBudgetAmount(), {
      wrapper: createWrapper(),
    });

    await result.current.mutateAsync({
      fromBudgetId: "budget-1",
      toBudgetId: "budget-2",
      amount: { amount: "100.00", currency: "ZMW" },
      year: 2026,
      month: 1,
    });

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("/budgets/move"),
      expect.objectContaining({
        method: "POST",
      })
    );
  });

  it("should handle mutation error", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      json: () => Promise.resolve({ error: { message: "Budget amount must be positive" } }),
    });

    const { result } = renderHook(() => useCreateBudget(), {
      wrapper: createWrapper(),
    });

    await expect(
      result.current.mutateAsync({
        name: "Invalid Budget",
        amount: { amount: "-100.00", currency: "ZMW" },
        categoryId: "cat-1",
      })
    ).rejects.toThrow();
  });
});
