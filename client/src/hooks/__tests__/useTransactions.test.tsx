/**
 * useTransactions Hook Tests
 *
 * Tests for the transactions data fetching hooks:
 * - Data fetching and caching
 * - Filtering and pagination
 * - Error handling
 * - Loading states
 * - Mutations (create, update, delete)
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
const { mockTransactionsApi } = vi.hoisted(() => ({
  mockTransactionsApi: {
    list: vi.fn(),
    get: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    getSummary: vi.fn(),
    createTransfer: vi.fn(),
    updateTransfer: vi.fn(),
    review: vi.fn(),
  },
}));

vi.mock("@/lib/api", () => ({
  transactionsApi: mockTransactionsApi,
  generateIdempotencyKey: () => "test-idempotency-key",
}));

// Mock accountKeys
vi.mock("../useAccounts", () => ({
  accountKeys: {
    all: ["accounts"],
  },
}));

// Create wrapper with QueryClientProvider
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
  useTransactions,
  useTransaction,
  useCreateTransaction,
  useUpdateTransaction,
  useDeleteTransaction,
  useTransactionSummary,
} from "../useTransactions";

describe("useTransactions Hook", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Data Fetching", () => {
    it("should fetch transactions successfully", async () => {
      const mockData = {
        data: [
          { id: "txn-1", name: "Test", amount: { amount: "100.00", currency: "ZMW" } },
          { id: "txn-2", name: "Test 2", amount: { amount: "200.00", currency: "ZMW" } },
        ],
        pagination: { totalCount: 2, offset: 0, pageSize: 2, hasNext: false, hasPrev: false },
      };
      mockTransactionsApi.list.mockResolvedValue(mockData);

      const { result } = renderHook(() => useTransactions(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.data).toEqual(mockData);
      expect(mockTransactionsApi.list).toHaveBeenCalled();
    });

    it("should handle loading state", async () => {
      mockTransactionsApi.list.mockImplementation(
        () => new Promise(() => {})
      );

      const { result } = renderHook(() => useTransactions(), {
        wrapper: createWrapper(),
      });

      expect(result.current.isLoading).toBe(true);
    });

    it("should handle error state", async () => {
      const error = new Error("Failed to fetch transactions");
      mockTransactionsApi.list.mockRejectedValue(error);

      const { result } = renderHook(() => useTransactions(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.isError).toBe(true);
      });

      expect(result.current.error).toBeDefined();
    });
  });

  describe("Filtering", () => {
    it("should apply date filters", async () => {
      mockTransactionsApi.list.mockResolvedValue({ data: [], pagination: {} });

      const filters = {
        startDate: "2026-01-01",
        endDate: "2026-01-31",
      };

      renderHook(() => useTransactions(filters), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(mockTransactionsApi.list).toHaveBeenCalledWith(
          expect.objectContaining({
            startDate: "2026-01-01",
            endDate: "2026-01-31",
          })
        );
      });
    });

    it("should apply account filter", async () => {
      mockTransactionsApi.list.mockResolvedValue({ data: [], pagination: {} });

      renderHook(() => useTransactions({ accountId: "acc-1" }), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(mockTransactionsApi.list).toHaveBeenCalledWith(
          expect.objectContaining({ accountId: "acc-1" })
        );
      });
    });

    it("should apply category filter", async () => {
      mockTransactionsApi.list.mockResolvedValue({ data: [], pagination: {} });

      renderHook(() => useTransactions({ categoryId: "cat-1" }), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(mockTransactionsApi.list).toHaveBeenCalledWith(
          expect.objectContaining({ categoryId: "cat-1" })
        );
      });
    });

    it("should apply type filter", async () => {
      mockTransactionsApi.list.mockResolvedValue({ data: [], pagination: {} });

      renderHook(() => useTransactions({ type: "expense" }), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(mockTransactionsApi.list).toHaveBeenCalledWith(
          expect.objectContaining({ type: "expense" })
        );
      });
    });

    it("should apply search filter", async () => {
      mockTransactionsApi.list.mockResolvedValue({ data: [], pagination: {} });

      renderHook(() => useTransactions({ search: "grocery" }), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(mockTransactionsApi.list).toHaveBeenCalledWith(
          expect.objectContaining({ search: "grocery" })
        );
      });
    });
  });

  describe("Pagination", () => {
    it("should apply pagination parameters", async () => {
      mockTransactionsApi.list.mockResolvedValue({ data: [], pagination: {} });

      renderHook(() => useTransactions({ limit: 25, offset: 50 }), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(mockTransactionsApi.list).toHaveBeenCalledWith(
          expect.objectContaining({ limit: 25, offset: 50 })
        );
      });
    });
  });
});

describe("useTransaction Hook", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should fetch a single transaction", async () => {
    const mockTransaction = {
      id: "txn-1",
      name: "Test Transaction",
      amount: { amount: "100.00", currency: "ZMW" },
      type: "expense",
    };
    mockTransactionsApi.get.mockResolvedValue(mockTransaction);

    const { result } = renderHook(() => useTransaction("txn-1"), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.data).toEqual(mockTransaction);
  });

  it("should handle not found", async () => {
    const error = new Error("Transaction not found");
    (error as any).status = 404;
    mockTransactionsApi.get.mockRejectedValue(error);

    const { result } = renderHook(() => useTransaction("non-existent"), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });
  });
});

describe("useCreateTransaction Hook", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should create a transaction", async () => {
    const newTransaction = {
      id: "txn-new",
      name: "New Transaction",
      amount: { amount: "150.00", currency: "ZMW" },
    };
    mockTransactionsApi.create.mockResolvedValue({ transaction: newTransaction, isDuplicate: false });

    const { result } = renderHook(() => useCreateTransaction(), {
      wrapper: createWrapper(),
    });

    await result.current.mutateAsync({
      accountId: "acc-1",
      amount: { amount: "150.00", currency: "ZMW" },
      type: "expense",
      date: "2026-01-15",
      name: "New Transaction",
    });

    expect(mockTransactionsApi.create).toHaveBeenCalled();
  });

  it("should handle duplicate detection", async () => {
    const existingTransaction = {
      id: "txn-existing",
      name: "Existing Transaction",
    };
    mockTransactionsApi.create.mockResolvedValue({
      transaction: existingTransaction,
      isDuplicate: true,
    });

    const { result } = renderHook(() => useCreateTransaction(), {
      wrapper: createWrapper(),
    });

    const response = await result.current.mutateAsync({
      accountId: "acc-1",
      amount: { amount: "100.00", currency: "ZMW" },
      type: "expense",
      date: "2026-01-15",
      name: "Existing Transaction",
    });

    expect(response.isDuplicate).toBe(true);
  });
});

describe("useUpdateTransaction Hook", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should update a transaction", async () => {
    const updatedTransaction = {
      id: "txn-1",
      name: "Updated Transaction",
      amount: { amount: "200.00", currency: "ZMW" },
    };
    mockTransactionsApi.update.mockResolvedValue(updatedTransaction);

    const { result } = renderHook(() => useUpdateTransaction(), {
      wrapper: createWrapper(),
    });

    await result.current.mutateAsync({
      id: "txn-1",
      data: { name: "Updated Transaction" },
    });

    expect(mockTransactionsApi.update).toHaveBeenCalledWith(
      "txn-1",
      expect.objectContaining({ name: "Updated Transaction" })
    );
  });
});

describe("useDeleteTransaction Hook", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should delete a transaction", async () => {
    mockTransactionsApi.delete.mockResolvedValue({ success: true });

    const { result } = renderHook(() => useDeleteTransaction(), {
      wrapper: createWrapper(),
    });

    await result.current.mutateAsync("txn-1");

    expect(mockTransactionsApi.delete).toHaveBeenCalledWith("txn-1");
  });
});

describe("useTransactionSummary Hook", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should fetch transaction summary", async () => {
    const mockSummary = {
      totalIncome: { amount: "5000.00", currency: "ZMW" },
      totalExpenses: { amount: "2000.00", currency: "ZMW" },
      netFlow: { amount: "3000.00", currency: "ZMW" },
    };
    mockTransactionsApi.getSummary.mockResolvedValue(mockSummary);

    const { result } = renderHook(
      () => useTransactionSummary("2026-01-01", "2026-01-31"),
      { wrapper: createWrapper() }
    );

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.data).toEqual(mockSummary);
  });

  it("should not fetch when dates are missing", async () => {
    renderHook(
      () => useTransactionSummary("", ""),
      { wrapper: createWrapper() }
    );

    expect(mockTransactionsApi.getSummary).not.toHaveBeenCalled();
  });
});
