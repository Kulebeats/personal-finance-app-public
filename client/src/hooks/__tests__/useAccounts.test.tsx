/**
 * useAccounts Hook Tests
 *
 * Tests for the accounts data fetching hooks:
 * - Account list fetching
 * - Single account fetching
 * - Net worth summary
 * - Balance history
 * - Account mutations (create, update, delete, archive)
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

// Mock the API client.
// Defined via vi.hoisted so the object exists before vi.mock factories run
// (vi.mock is hoisted above all imports/top-level declarations).
const { mockAccountsApi } = vi.hoisted(() => ({
  mockAccountsApi: {
    list: vi.fn(),
    get: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    getSummary: vi.fn(),
    getBalanceHistory: vi.fn(),
    getNetWorthHistory: vi.fn(),
    adjustBalance: vi.fn(),
    archive: vi.fn(),
    unarchive: vi.fn(),
    updateSettings: vi.fn(),
  },
}));

vi.mock("@/lib/api", () => ({
  accountsApi: mockAccountsApi,
}));

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
  useAccounts,
  useAccount,
  useNetWorthSummary,
  useAccountBalanceHistory,
  useNetWorthHistory,
  useCreateAccount,
  useUpdateAccount,
  useDeleteAccount,
  useAdjustBalance,
  useArchiveAccount,
} from "../useAccounts";

describe("useAccounts Hook", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Data Fetching", () => {
    it("should fetch accounts successfully", async () => {
      const mockData = [
        { id: "acc-1", name: "Checking", balance: { amount: "1000.00", currency: "ZMW" } },
        { id: "acc-2", name: "Savings", balance: { amount: "5000.00", currency: "ZMW" } },
      ];
      mockAccountsApi.list.mockResolvedValue(mockData);

      const { result } = renderHook(() => useAccounts(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.data).toEqual(mockData);
    });

    it("should handle loading state", async () => {
      mockAccountsApi.list.mockImplementation(
        () => new Promise(() => {})
      );

      const { result } = renderHook(() => useAccounts(), {
        wrapper: createWrapper(),
      });

      expect(result.current.isLoading).toBe(true);
    });

    it("should handle error state", async () => {
      const error = new Error("Failed to fetch accounts");
      mockAccountsApi.list.mockRejectedValue(error);

      const { result } = renderHook(() => useAccounts(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.isError).toBe(true);
      });
    });
  });

  describe("Filtering", () => {
    it("should include archived accounts when specified", async () => {
      mockAccountsApi.list.mockResolvedValue([]);

      renderHook(() => useAccounts({ includeArchived: true }), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(mockAccountsApi.list).toHaveBeenCalledWith(
          expect.objectContaining({ includeArchived: true })
        );
      });
    });

    it("should include hidden accounts when specified", async () => {
      mockAccountsApi.list.mockResolvedValue([]);

      renderHook(() => useAccounts({ includeHidden: true }), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(mockAccountsApi.list).toHaveBeenCalledWith(
          expect.objectContaining({ includeHidden: true })
        );
      });
    });

    it("should filter by owner user id", async () => {
      mockAccountsApi.list.mockResolvedValue([]);

      renderHook(() => useAccounts({ ownerUserId: "user-123" }), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(mockAccountsApi.list).toHaveBeenCalledWith(
          expect.objectContaining({ ownerUserId: "user-123" })
        );
      });
    });
  });
});

describe("useAccount Hook", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should fetch a single account", async () => {
    const mockAccount = {
      id: "acc-1",
      name: "Checking",
      balance: { amount: "1000.00", currency: "ZMW" },
      type: "checking",
    };
    mockAccountsApi.get.mockResolvedValue(mockAccount);

    const { result } = renderHook(() => useAccount("acc-1"), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.data).toEqual(mockAccount);
  });

  it("should not fetch when id is empty", async () => {
    renderHook(() => useAccount(""), {
      wrapper: createWrapper(),
    });

    expect(mockAccountsApi.get).not.toHaveBeenCalled();
  });
});

describe("useNetWorthSummary Hook", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should fetch net worth summary", async () => {
    const mockSummary = {
      totalAssets: { amount: "15000.00", currency: "ZMW" },
      totalLiabilities: { amount: "5000.00", currency: "ZMW" },
      netWorth: { amount: "10000.00", currency: "ZMW" },
    };
    mockAccountsApi.getSummary.mockResolvedValue(mockSummary);

    const { result } = renderHook(() => useNetWorthSummary(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.data).toEqual(mockSummary);
  });
});

describe("useAccountBalanceHistory Hook", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should fetch balance history", async () => {
    const mockHistory = [
      { date: "2026-01-01", balance: "1000.00" },
      { date: "2026-01-15", balance: "1200.00" },
      { date: "2026-01-31", balance: "1100.00" },
    ];
    mockAccountsApi.getBalanceHistory.mockResolvedValue(mockHistory);

    const { result } = renderHook(() => useAccountBalanceHistory("acc-1", "1m"), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.data).toEqual(mockHistory);
    expect(mockAccountsApi.getBalanceHistory).toHaveBeenCalledWith("acc-1", "1m");
  });
});

describe("useNetWorthHistory Hook", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should fetch net worth history", async () => {
    const mockHistory = [
      { date: "2026-01-01", netWorth: "10000.00" },
      { date: "2026-01-31", netWorth: "11000.00" },
    ];
    mockAccountsApi.getNetWorthHistory.mockResolvedValue(mockHistory);

    const { result } = renderHook(() => useNetWorthHistory("1m"), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.data).toEqual(mockHistory);
  });

  it("should accept scope parameter", async () => {
    mockAccountsApi.getNetWorthHistory.mockResolvedValue([]);

    renderHook(() => useNetWorthHistory("1m", "household"), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(mockAccountsApi.getNetWorthHistory).toHaveBeenCalledWith("1m", "household");
    });
  });
});

describe("Account Mutation Hooks", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should create an account", async () => {
    const newAccount = {
      id: "acc-new",
      name: "New Account",
      balance: { amount: "0.00", currency: "ZMW" },
    };
    mockAccountsApi.create.mockResolvedValue(newAccount);

    const { result } = renderHook(() => useCreateAccount(), {
      wrapper: createWrapper(),
    });

    await result.current.mutateAsync({
      name: "New Account",
      type: "checking",
      currency: "ZMW",
    });

    expect(mockAccountsApi.create).toHaveBeenCalled();
  });

  it("should update an account", async () => {
    const updatedAccount = {
      id: "acc-1",
      name: "Updated Account",
    };
    mockAccountsApi.update.mockResolvedValue(updatedAccount);

    const { result } = renderHook(() => useUpdateAccount(), {
      wrapper: createWrapper(),
    });

    await result.current.mutateAsync({
      id: "acc-1",
      data: { name: "Updated Account" },
    });

    expect(mockAccountsApi.update).toHaveBeenCalledWith("acc-1", { name: "Updated Account" });
  });

  it("should delete an account", async () => {
    mockAccountsApi.delete.mockResolvedValue({ success: true });

    const { result } = renderHook(() => useDeleteAccount(), {
      wrapper: createWrapper(),
    });

    await result.current.mutateAsync("acc-1");

    expect(mockAccountsApi.delete).toHaveBeenCalledWith("acc-1");
  });

  it("should adjust balance", async () => {
    const adjustedAccount = {
      id: "acc-1",
      balance: { amount: "1500.00", currency: "ZMW" },
    };
    mockAccountsApi.adjustBalance.mockResolvedValue({ account: adjustedAccount });

    const { result } = renderHook(() => useAdjustBalance(), {
      wrapper: createWrapper(),
    });

    await result.current.mutateAsync({
      id: "acc-1",
      data: {
        amount: 500,
        isIncrease: true,
      },
    });

    expect(mockAccountsApi.adjustBalance).toHaveBeenCalledWith(
      "acc-1",
      expect.objectContaining({
        amount: 500,
        isIncrease: true,
      })
    );
  });

  it("should archive an account", async () => {
    const archivedAccount = {
      id: "acc-1",
      name: "Archived Account",
      isArchived: true,
    };
    mockAccountsApi.archive.mockResolvedValue(archivedAccount);

    const { result } = renderHook(() => useArchiveAccount(), {
      wrapper: createWrapper(),
    });

    await result.current.mutateAsync({ id: "acc-1", archive: true });

    expect(mockAccountsApi.archive).toHaveBeenCalledWith("acc-1");
  });

  it("should unarchive an account", async () => {
    const unarchivedAccount = {
      id: "acc-1",
      name: "Active Account",
      isArchived: false,
    };
    mockAccountsApi.unarchive.mockResolvedValue(unarchivedAccount);

    const { result } = renderHook(() => useArchiveAccount(), {
      wrapper: createWrapper(),
    });

    await result.current.mutateAsync({ id: "acc-1", archive: false });

    expect(mockAccountsApi.unarchive).toHaveBeenCalledWith("acc-1");
  });

  it("should handle mutation error", async () => {
    const error = new Error("Failed to create account");
    mockAccountsApi.create.mockRejectedValue(error);

    const { result } = renderHook(() => useCreateAccount(), {
      wrapper: createWrapper(),
    });

    await expect(
      result.current.mutateAsync({
        name: "Test",
        type: "checking",
        currency: "ZMW",
      })
    ).rejects.toThrow();
  });
});
