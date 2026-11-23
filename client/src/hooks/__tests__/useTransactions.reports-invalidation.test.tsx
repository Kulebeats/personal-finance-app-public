/** Check transaction writers against the report queries observed by mounted widgets. */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ReactNode } from "react";
import { protectedFetch } from "@/lib/protected-fetch";
import { useReportsNetWorth } from "../use-reports";
import { useTransactionBulkMutations } from "@/pages/Transactions/useTransactionMutations";

vi.mock("@/lib/protected-fetch", () => ({ protectedFetch: vi.fn() }));
vi.mock("@/contexts/SettingsContext", () => ({ useSettings: () => ({ timezone: "Africa/Lusaka" }) }));

// Mock toast (matches useTransactions.test.tsx convention)
vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({
    toast: vi.fn(),
  }),
}));

// Mock the API client (hoisted so it exists before vi.mock factories run)
const { mockTransactionsApi } = vi.hoisted(() => ({
  mockTransactionsApi: {
    list: vi.fn(),
    get: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    bulkDelete: vi.fn(),
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

vi.mock("../useAccounts", () => ({
  accountKeys: {
    all: ["accounts"],
  },
}));

// Import after mocks
import {
  useCreateTransaction,
  useCreateTransfer,
  useUpdateTransfer,
  useUpdateTransaction,
  useDeleteTransaction,
  useReviewTransaction,
} from "../useTransactions";

/** Minimal shape of the invalidateQueries spy this file needs. */
type InvalidateQueriesSpy = {
  mock: { calls: Array<[{ queryKey?: unknown[] } | undefined, ...unknown[]]> };
};

/** Build a fresh QueryClient + wrapper, with invalidateQueries spied. */
function createSpiedWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  const invalidateSpy = vi.spyOn(
    queryClient,
    "invalidateQueries",
  ) as unknown as InvalidateQueriesSpy;

  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  }

  return { Wrapper, invalidateSpy };
}

/** True if any invalidateQueries call targeted the "reports" query-key namespace. */
function invalidatedReports(invalidateSpy: InvalidateQueriesSpy): boolean {
  return invalidateSpy.mock.calls.some(([arg]) => {
    const queryKey = arg?.queryKey;
    return Array.isArray(queryKey) && queryKey[0] === "reports";
  });
}

function invalidatedKey(invalidateSpy: InvalidateQueriesSpy, key: string): boolean {
  return invalidateSpy.mock.calls.some(([arg]) => {
    const queryKey = arg?.queryKey;
    return Array.isArray(queryKey) && queryKey[0] === key;
  });
}

describe("useTransactions reports cache invalidation (audit v2 B2)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("refetches a fresh mounted net-worth report after each ledger mutation", async () => {
    const { Wrapper } = createSpiedWrapper();
    const reportFetch = vi.mocked(protectedFetch);
    const currency = "ZMW";
    function nextReport(netWorth: string) {
      reportFetch.mockResolvedValueOnce(Response.json({
        success: true, data: { latest: { netWorth: { amount: netWorth, currency } } },
      }));
    }
    const purchase = { accountId: "card", name: "Purchase", type: "expense" as const,
      date: "2026-01-10", amount: { amount: "45.50", currency } };
    mockTransactionsApi.create.mockResolvedValue({ transaction: { id: "p1" }, isDuplicate: false });
    mockTransactionsApi.update.mockResolvedValue({ id: "p1", name: purchase.name });
    mockTransactionsApi.delete.mockResolvedValue({ success: true });
    mockTransactionsApi.bulkDelete.mockResolvedValue({ successCount: 1 });
    mockTransactionsApi.createTransfer.mockResolvedValue({ isDuplicate: false });

    nextReport("4500.00");
    const { result } = renderHook(() => ({
      report: useReportsNetWorth({ from: "2026-01-01", to: "2026-01-31" }),
      create: useCreateTransaction(), update: useUpdateTransaction(), remove: useDeleteTransaction(),
      transfer: useCreateTransfer(), bulk: useTransactionBulkMutations(() => {}),
    }), { wrapper: Wrapper });
    async function expectFresh(amount: string, reads: number) {
      await waitFor(() => {
        expect(result.current.report.data?.latest.netWorth.amount).toBe(amount);
        expect(result.current.report.isStale).toBe(false);
        expect(reportFetch).toHaveBeenCalledTimes(reads);
      });
    }
    await expectFresh("4500.00", 1);
    expect(reportFetch.mock.calls[0][0]).toMatch(/^\/api\/reports\/net-worth\?/);

    nextReport("4454.50");
    await act(async () => { await result.current.create.mutateAsync(purchase); });
    await expectFresh("4454.50", 2);
    nextReport("4434.50");
    await act(async () => { await result.current.update.mutateAsync({ id: "p1", data: { amount: { amount: "65.50", currency } } }); });
    await expectFresh("4434.50", 3);
    nextReport("4500.00");
    await act(async () => { await result.current.remove.mutateAsync("p1"); });
    await expectFresh("4500.00", 4);
    nextReport("4510.00");
    await act(async () => { await result.current.bulk.bulkDeleteMutation.mutateAsync(["other-expense"]); });
    await expectFresh("4510.00", 5);
    nextReport("4510.00");
    await act(async () => {
      await result.current.transfer.mutateAsync({ fromAccountId: "card", toAccountId: "cash", amount: purchase.amount });
    });
    await expectFresh("4510.00", 6);
  });

  it("invalidates reports caches when a transaction is created", async () => {
    mockTransactionsApi.create.mockResolvedValue({
      transaction: { id: "txn-1", name: "Groceries" },
      isDuplicate: false,
    });
    const { Wrapper, invalidateSpy } = createSpiedWrapper();

    const { result } = renderHook(() => useCreateTransaction(), {
      wrapper: Wrapper,
    });

    await result.current.mutateAsync({
      accountId: "acc-1",
      amount: { amount: "10.00", currency: "ZMW" },
      type: "expense",
      date: "2026-07-13",
      name: "Groceries",
    });

    await waitFor(() => {
      expect(invalidatedReports(invalidateSpy)).toBe(true);
    });
  });

  it("invalidates reports caches when a transaction is updated", async () => {
    mockTransactionsApi.update.mockResolvedValue({
      id: "txn-1",
      name: "Updated",
    });
    const { Wrapper, invalidateSpy } = createSpiedWrapper();

    const { result } = renderHook(() => useUpdateTransaction(), {
      wrapper: Wrapper,
    });

    await result.current.mutateAsync({
      id: "txn-1",
      data: { name: "Updated" },
    });

    await waitFor(() => {
      expect(invalidatedReports(invalidateSpy)).toBe(true);
    });
  });

  it("invalidates reports caches when a transaction is deleted", async () => {
    mockTransactionsApi.delete.mockResolvedValue({ success: true });
    const { Wrapper, invalidateSpy } = createSpiedWrapper();

    const { result } = renderHook(() => useDeleteTransaction(), {
      wrapper: Wrapper,
    });

    await result.current.mutateAsync("txn-1");

    await waitFor(() => {
      expect(invalidatedReports(invalidateSpy)).toBe(true);
    });
  });

  it("invalidates reports caches when a transfer is created", async () => {
    mockTransactionsApi.createTransfer.mockResolvedValue({
      outflow: { id: "txn-out" },
      inflow: { id: "txn-in" },
      isDuplicate: false,
    });
    const { Wrapper, invalidateSpy } = createSpiedWrapper();

    const { result } = renderHook(() => useCreateTransfer(), {
      wrapper: Wrapper,
    });

    await result.current.mutateAsync({
      fromAccountId: "acc-1",
      toAccountId: "acc-2",
      amount: { amount: "50.00", currency: "ZMW" },
    });

    await waitFor(() => {
      expect(invalidatedReports(invalidateSpy)).toBe(true);
    });
  });

  it("invalidates budgets, categories, and reports caches when a transfer is updated", async () => {
    // Audit v2 finding: "Transfer-update mutation omits budget/category/report
    // invalidation" - assert all three are fixed together.
    mockTransactionsApi.updateTransfer.mockResolvedValue({
      outflow: { id: "txn-out" },
      inflow: { id: "txn-in" },
    });
    const { Wrapper, invalidateSpy } = createSpiedWrapper();

    const { result } = renderHook(() => useUpdateTransfer(), {
      wrapper: Wrapper,
    });

    await result.current.mutateAsync({
      id: "transfer-1",
      data: {
        fromAccountId: "acc-1",
        toAccountId: "acc-2",
        amount: { amount: "75.00", currency: "ZMW" },
      },
    });

    await waitFor(() => {
      expect(invalidatedKey(invalidateSpy, "budgets")).toBe(true);
      expect(invalidatedKey(invalidateSpy, "categories")).toBe(true);
      expect(invalidatedReports(invalidateSpy)).toBe(true);
    });
  });

  it("invalidates reports caches when a transaction review status changes", async () => {
    mockTransactionsApi.review.mockResolvedValue({
      id: "txn-1",
      reviewedAt: "2026-07-13T00:00:00.000Z",
    });
    const { Wrapper, invalidateSpy } = createSpiedWrapper();

    const { result } = renderHook(() => useReviewTransaction(), {
      wrapper: Wrapper,
    });

    await result.current.mutateAsync({ id: "txn-1", reviewed: true });

    await waitFor(() => {
      expect(invalidatedReports(invalidateSpy)).toBe(true);
    });
  });
});
