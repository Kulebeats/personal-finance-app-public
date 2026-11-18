/**
 * Reports cache invalidation on bulk transaction mutations (audit v2 finding B2).
 *
 * Reports use staleTime: Infinity globally (client/src/lib/queryClient.ts), so bulk
 * review/delete/categorize/tag actions on the Transactions page must explicitly
 * invalidate the reports query-key namespace or Reports pages show stale numbers
 * after a bulk edit.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ReactNode } from "react";

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

const { mockTransactionsApi } = vi.hoisted(() => ({
  mockTransactionsApi: {
    bulkReview: vi.fn(),
    bulkDelete: vi.fn(),
    bulkUpdateCategory: vi.fn(),
    bulkAddTags: vi.fn(),
  },
}));

vi.mock("@/lib/api", () => ({
  transactionsApi: mockTransactionsApi,
}));

import { useTransactionBulkMutations } from "../useTransactionMutations";

/** Minimal shape of the invalidateQueries spy this file needs. */
type InvalidateQueriesSpy = {
  mock: { calls: Array<[{ queryKey?: unknown[] } | undefined, ...unknown[]]> };
};

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

function invalidatedReports(invalidateSpy: InvalidateQueriesSpy): boolean {
  return invalidateSpy.mock.calls.some(([arg]) => {
    const queryKey = arg?.queryKey;
    return Array.isArray(queryKey) && queryKey[0] === "reports";
  });
}

describe("useTransactionBulkMutations reports cache invalidation (audit v2 B2)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("invalidates reports caches after bulk review", async () => {
    mockTransactionsApi.bulkReview.mockResolvedValue({ successCount: 2 });
    const { Wrapper, invalidateSpy } = createSpiedWrapper();
    const { result } = renderHook(
      () => useTransactionBulkMutations(vi.fn()),
      { wrapper: Wrapper },
    );

    await result.current.bulkReviewMutation.mutateAsync(["txn-1", "txn-2"]);

    await waitFor(() => expect(invalidatedReports(invalidateSpy)).toBe(true));
  });

  it("invalidates reports caches after bulk delete", async () => {
    mockTransactionsApi.bulkDelete.mockResolvedValue({ successCount: 2 });
    const { Wrapper, invalidateSpy } = createSpiedWrapper();
    const { result } = renderHook(
      () => useTransactionBulkMutations(vi.fn()),
      { wrapper: Wrapper },
    );

    await result.current.bulkDeleteMutation.mutateAsync(["txn-1", "txn-2"]);

    await waitFor(() => expect(invalidatedReports(invalidateSpy)).toBe(true));
  });

  it("invalidates reports caches after bulk categorize", async () => {
    mockTransactionsApi.bulkUpdateCategory.mockResolvedValue({ successCount: 2 });
    const { Wrapper, invalidateSpy } = createSpiedWrapper();
    const { result } = renderHook(
      () => useTransactionBulkMutations(vi.fn()),
      { wrapper: Wrapper },
    );

    await result.current.bulkCategorizeMutation.mutateAsync({
      ids: ["txn-1"],
      categoryId: "cat-1",
    });

    await waitFor(() => expect(invalidatedReports(invalidateSpy)).toBe(true));
  });

  it("invalidates reports caches after bulk tag", async () => {
    mockTransactionsApi.bulkAddTags.mockResolvedValue({ successCount: 2 });
    const { Wrapper, invalidateSpy } = createSpiedWrapper();
    const { result } = renderHook(
      () => useTransactionBulkMutations(vi.fn()),
      { wrapper: Wrapper },
    );

    await result.current.bulkTagMutation.mutateAsync({
      ids: ["txn-1"],
      tagIds: ["tag-1"],
    });

    await waitFor(() => expect(invalidatedReports(invalidateSpy)).toBe(true));
  });
});
