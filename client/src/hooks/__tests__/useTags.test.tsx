/**
 * @vitest-environment jsdom
 */
import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { clearCsrfToken } from "@/lib/csrf";
import {
  tagKeys,
  useTags,
  useTag,
  useTagTransactions,
  useCreateTag,
  useUpdateTag,
  useDeleteTag,
  useTransactionTags,
  useAddTagsToTransaction,
  useSetTransactionTags,
  useRemoveTagFromTransaction,
  useMergeTags,
  useArchiveTag,
  useTagAnalytics,
} from "../useTags";

const toastSpy = vi.fn();
const endpointFetch = vi.fn();

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
  new Response(JSON.stringify(data), { status: ok ? 200 : 400 });

const mockErrorResponse = (message: string, code?: string): Response =>
  new Response(JSON.stringify({ success: false, error: { message, code } }), { status: code === "CONFLICT" ? 409 : 400 });

describe("useTags hooks", () => {
  const tagId = "11111111-1111-1111-1111-111111111111";
  const transactionId = "22222222-2222-2222-2222-222222222222";

  const mockTag = {
    id: tagId,
    name: "Test Tag",
    color: "#FF5733",
    icon: null,
    memberSpecific: false,
    memberId: null,
    usageCount: 5,
    createdAt: "2026-01-15T00:00:00.000Z",
    updatedAt: "2026-01-15T00:00:00.000Z",
  };

  beforeEach(() => {
    toastSpy.mockReset();
    clearCsrfToken(); endpointFetch.mockReset();
    vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => String(input) === "/api/csrf-token"
      ? Promise.resolve(new Response(JSON.stringify({ csrfToken: "tags-test-token" })))
      : endpointFetch(input, init));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  // ===========================================================================
  // Query Hooks
  // ===========================================================================

  describe("useTags", () => {
    it("fetches all tags", async () => {
      const mockFetch = endpointFetch;
      mockFetch.mockResolvedValue(
        mockFetchResponse({
          success: true,
          data: [mockTag],
        })
      );

      const { wrapper } = createWrapper();
      const { result } = renderHook(() => useTags(), { wrapper });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(mockFetch).toHaveBeenCalledWith(
        "/api/tags",
        expect.objectContaining({ credentials: "include" })
      );
      expect(result.current.data).toEqual([mockTag]);
    });

    it("handles fetch error", async () => {
      const mockFetch = endpointFetch;
      mockFetch.mockRejectedValue(new Error("Network error"));

      const { wrapper } = createWrapper();
      const { result } = renderHook(() => useTags(), { wrapper });

      await waitFor(() => expect(result.current.isError).toBe(true));
      expect(result.current.error?.message).toBe("Network error");
    });
  });

  describe("useTag", () => {
    it("fetches a single tag by ID", async () => {
      const mockFetch = endpointFetch;
      mockFetch.mockResolvedValue(
        mockFetchResponse({
          success: true,
          data: mockTag,
        })
      );

      const { wrapper } = createWrapper();
      const { result } = renderHook(() => useTag(tagId), { wrapper });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(mockFetch).toHaveBeenCalledWith(
        `/api/tags/${tagId}`,
        expect.objectContaining({ credentials: "include" })
      );
      expect(result.current.data).toEqual(mockTag);
    });

    it("does not fetch when ID is empty", async () => {
      const mockFetch = endpointFetch;

      const { wrapper } = createWrapper();
      const { result } = renderHook(() => useTag(""), { wrapper });

      // Should not be loading because query is disabled
      expect(result.current.isLoading).toBe(false);
      expect(result.current.isFetching).toBe(false);
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  describe("useTagTransactions", () => {
    it("fetches transactions for a tag", async () => {
      const mockFetch = endpointFetch;
      const mockResponse = {
        tag: mockTag,
        transactions: [{ id: transactionId, name: "Coffee", amount: "5.00" }],
        count: 1,
      };
      mockFetch.mockResolvedValue(
        mockFetchResponse({ success: true, data: mockResponse })
      );

      const { wrapper } = createWrapper();
      const { result } = renderHook(() => useTagTransactions(tagId, 20), {
        wrapper,
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(mockFetch).toHaveBeenCalledWith(
        `/api/tags/${tagId}/transactions?limit=20`,
        expect.objectContaining({ credentials: "include" })
      );
    });
  });

  describe("useTransactionTags", () => {
    it("fetches tags for a transaction", async () => {
      const mockFetch = endpointFetch;
      mockFetch.mockResolvedValue(
        mockFetchResponse({
          success: true,
          data: [{ id: tagId, name: "Test Tag", color: "#FF5733" }],
        })
      );

      const { wrapper } = createWrapper();
      const { result } = renderHook(() => useTransactionTags(transactionId), {
        wrapper,
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(mockFetch).toHaveBeenCalledWith(
        `/api/tags/transaction/${transactionId}`,
        expect.objectContaining({ credentials: "include" })
      );
    });
  });

  describe("useTagAnalytics", () => {
    it("fetches tag analytics", async () => {
      const mockFetch = endpointFetch;
      const mockAnalytics = {
        topTags: [{ id: tagId, name: "Test", usageCount: 10, percentage: 50 }],
        summary: { totalTags: 5, totalUsage: 20, averageUsage: 4 },
      };
      mockFetch.mockResolvedValue(
        mockFetchResponse({ success: true, data: mockAnalytics })
      );

      const { wrapper } = createWrapper();
      const { result } = renderHook(() => useTagAnalytics(10), { wrapper });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(mockFetch).toHaveBeenCalledWith(
        "/api/tags/analytics?limit=10",
        expect.objectContaining({ credentials: "include" })
      );
    });
  });

  // ===========================================================================
  // Mutation Hooks - Create
  // ===========================================================================

  describe("useCreateTag", () => {
    it("creates a tag and shows success toast", async () => {
      const mockFetch = endpointFetch;
      mockFetch.mockResolvedValue(
        mockFetchResponse({ success: true, data: mockTag })
      );

      const { wrapper, queryClient } = createWrapper();
      const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
      const { result } = renderHook(() => useCreateTag(), { wrapper });

      await act(async () => {
        await result.current.mutateAsync({ name: "Test Tag", color: "#FF5733" });
      });

      expect(mockFetch).toHaveBeenCalledWith(
        "/api/tags",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ name: "Test Tag", color: "#FF5733" }),
        })
      );
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: tagKeys.list(),
      });
      expect(toastSpy).toHaveBeenCalledWith({
        title: "Tag created",
        description: '"Test Tag" has been created.',
      });
    });

    it("shows conflict error toast for duplicate name", async () => {
      const mockFetch = endpointFetch;
      mockFetch.mockResolvedValue(mockErrorResponse("Duplicate", "CONFLICT"));

      const { wrapper } = createWrapper();
      const { result } = renderHook(() => useCreateTag(), { wrapper });

      await act(async () => {
        try {
          await result.current.mutateAsync({ name: "Test Tag" });
        } catch {
          // Expected to throw
        }
      });

      expect(toastSpy).toHaveBeenCalledWith({
        title: "Tag already exists",
        description: "A tag with this name already exists.",
        variant: "destructive",
      });
    });

    it("shows generic error toast on failure", async () => {
      const mockFetch = endpointFetch;
      mockFetch.mockRejectedValue(new Error("Network error"));

      const { wrapper } = createWrapper();
      const { result } = renderHook(() => useCreateTag(), { wrapper });

      await act(async () => {
        try {
          await result.current.mutateAsync({ name: "Test Tag" });
        } catch {
          // Expected to throw
        }
      });

      expect(toastSpy).toHaveBeenCalledWith({
        title: "Error",
        description: "Failed to create tag. Please try again.",
        variant: "destructive",
      });
    });
  });

  // ===========================================================================
  // Mutation Hooks - Update
  // ===========================================================================

  describe("useUpdateTag", () => {
    it("updates a tag and shows success toast", async () => {
      const mockFetch = endpointFetch;
      mockFetch.mockResolvedValue(
        mockFetchResponse({
          success: true,
          data: { ...mockTag, name: "Updated Tag" },
        })
      );

      const { wrapper, queryClient } = createWrapper();
      const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
      const { result } = renderHook(() => useUpdateTag(), { wrapper });

      await act(async () => {
        await result.current.mutateAsync({
          id: tagId,
          data: { name: "Updated Tag" },
        });
      });

      expect(mockFetch).toHaveBeenCalledWith(
        `/api/tags/${tagId}`,
        expect.objectContaining({
          method: "PUT",
          body: JSON.stringify({ name: "Updated Tag" }),
        })
      );
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: tagKeys.list() });
      expect(toastSpy).toHaveBeenCalledWith({
        title: "Tag updated",
        description: '"Updated Tag" has been updated.',
      });
    });
  });

  // ===========================================================================
  // Mutation Hooks - Delete (with optimistic update)
  // ===========================================================================

  describe("useDeleteTag", () => {
    it("deletes a tag with optimistic update", async () => {
      const mockFetch = endpointFetch;
      mockFetch.mockResolvedValue(mockFetchResponse({ success: true }));

      const { wrapper, queryClient } = createWrapper();
      // Pre-populate the cache
      queryClient.setQueryData(tagKeys.list(), [mockTag]);

      const { result } = renderHook(() => useDeleteTag(), { wrapper });

      await act(async () => {
        await result.current.mutateAsync(tagId);
      });

      // Should have removed the tag optimistically
      const cachedTags = queryClient.getQueryData(tagKeys.list());
      expect(cachedTags).toEqual([]);
      expect(toastSpy).toHaveBeenCalledWith({
        title: "Tag deleted",
        description: "The tag has been deleted.",
      });
    });

    it("rolls back on error", async () => {
      const mockFetch = endpointFetch;
      mockFetch.mockRejectedValue(new Error("Network error"));

      const { wrapper, queryClient } = createWrapper();
      // Pre-populate the cache
      queryClient.setQueryData(tagKeys.list(), [mockTag]);

      const { result } = renderHook(() => useDeleteTag(), { wrapper });

      await act(async () => {
        try {
          await result.current.mutateAsync(tagId);
        } catch {
          // Expected to throw
        }
      });

      // Should have rolled back
      const cachedTags = queryClient.getQueryData(tagKeys.list());
      expect(cachedTags).toEqual([mockTag]);
      expect(toastSpy).toHaveBeenCalledWith({
        title: "Error",
        description: "Failed to delete tag. Please try again.",
        variant: "destructive",
      });
    });
  });

  // ===========================================================================
  // Mutation Hooks - Transaction Tags
  // ===========================================================================

  describe("useAddTagsToTransaction", () => {
    it("adds tags to a transaction", async () => {
      const mockFetch = endpointFetch;
      mockFetch.mockResolvedValue(
        mockFetchResponse({
          success: true,
          data: [{ id: tagId, name: "Test Tag" }],
        })
      );

      const { wrapper, queryClient } = createWrapper();
      const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
      const { result } = renderHook(() => useAddTagsToTransaction(), {
        wrapper,
      });

      await act(async () => {
        await result.current.mutateAsync({
          transactionId,
          tagIds: [tagId],
        });
      });

      expect(mockFetch).toHaveBeenCalledWith(
        `/api/tags/transaction/${transactionId}`,
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ tagIds: [tagId] }),
        })
      );
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: tagKeys.transactionTags(transactionId),
      });
    });
  });

  describe("useSetTransactionTags", () => {
    it("sets all tags on a transaction", async () => {
      const mockFetch = endpointFetch;
      mockFetch.mockResolvedValue(
        mockFetchResponse({
          success: true,
          data: [{ id: tagId, name: "Test Tag" }],
        })
      );

      const { wrapper } = createWrapper();
      const { result } = renderHook(() => useSetTransactionTags(), { wrapper });

      await act(async () => {
        await result.current.mutateAsync({
          transactionId,
          tagIds: [tagId],
        });
      });

      expect(mockFetch).toHaveBeenCalledWith(
        `/api/tags/transaction/${transactionId}`,
        expect.objectContaining({
          method: "PUT",
          body: JSON.stringify({ tagIds: [tagId] }),
        })
      );
    });
  });

  describe("useRemoveTagFromTransaction", () => {
    it("removes a tag from a transaction", async () => {
      const mockFetch = endpointFetch;
      mockFetch.mockResolvedValue(mockFetchResponse({ success: true, data: [] }));

      const { wrapper, queryClient } = createWrapper();
      const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
      const { result } = renderHook(() => useRemoveTagFromTransaction(), {
        wrapper,
      });

      await act(async () => {
        await result.current.mutateAsync({
          transactionId,
          tagId,
        });
      });

      expect(mockFetch).toHaveBeenCalledWith(
        `/api/tags/transaction/${transactionId}/${tagId}`,
        expect.objectContaining({ method: "DELETE" })
      );
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: tagKeys.transactionTags(transactionId),
      });
    });
  });

  // ===========================================================================
  // Mutation Hooks - Merge (with optimistic update)
  // ===========================================================================

  describe("useMergeTags", () => {
    it("merges tags with optimistic update", async () => {
      const mockFetch = endpointFetch;
      const sourceTag = { ...mockTag, id: "source-id", name: "Source Tag" };
      const mergeResult = {
        targetTag: mockTag,
        mergedTagIds: ["source-id"],
        mergedTagNames: ["Source Tag"],
      };
      mockFetch.mockResolvedValue(
        mockFetchResponse({ success: true, data: mergeResult })
      );

      const { wrapper, queryClient } = createWrapper();
      // Pre-populate cache with source and target tags
      queryClient.setQueryData(tagKeys.list(), [mockTag, sourceTag]);

      const { result } = renderHook(() => useMergeTags(), { wrapper });

      await act(async () => {
        await result.current.mutateAsync({
          sourceTagIds: ["source-id"],
          targetTagId: tagId,
        });
      });

      expect(mockFetch).toHaveBeenCalledWith(
        "/api/tags/merge",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({
            sourceTagIds: ["source-id"],
            targetTagId: tagId,
          }),
        })
      );
      expect(toastSpy).toHaveBeenCalledWith({
        title: "Tags merged",
        description: '1 tag(s) merged into "Test Tag".',
      });
    });

    it("rolls back merge on error", async () => {
      const mockFetch = endpointFetch;
      const sourceTag = { ...mockTag, id: "source-id", name: "Source Tag" };
      mockFetch.mockRejectedValue(new Error("Network error"));

      const { wrapper, queryClient } = createWrapper();
      queryClient.setQueryData(tagKeys.list(), [mockTag, sourceTag]);

      const { result } = renderHook(() => useMergeTags(), { wrapper });

      await act(async () => {
        try {
          await result.current.mutateAsync({
            sourceTagIds: ["source-id"],
            targetTagId: tagId,
          });
        } catch {
          // Expected to throw
        }
      });

      // Should have rolled back
      const cachedTags = queryClient.getQueryData(tagKeys.list());
      expect(cachedTags).toEqual([mockTag, sourceTag]);
      expect(toastSpy).toHaveBeenCalledWith({
        title: "Error",
        description: "Failed to merge tags. Please try again.",
        variant: "destructive",
      });
    });
  });

  // ===========================================================================
  // Mutation Hooks - Archive (with optimistic update)
  // ===========================================================================

  describe("useArchiveTag", () => {
    it("archives a tag with optimistic update", async () => {
      const mockFetch = endpointFetch;
      mockFetch.mockResolvedValue(
        mockFetchResponse({ success: true, data: mockTag })
      );

      const { wrapper, queryClient } = createWrapper();
      queryClient.setQueryData(tagKeys.list(), [mockTag]);

      const { result } = renderHook(() => useArchiveTag(), { wrapper });

      await act(async () => {
        await result.current.mutateAsync(tagId);
      });

      // Should have removed the tag optimistically
      const cachedTags = queryClient.getQueryData(tagKeys.list());
      expect(cachedTags).toEqual([]);
      expect(toastSpy).toHaveBeenCalledWith({
        title: "Tag archived",
        description: '"Test Tag" has been archived.',
      });
    });

    it("rolls back archive on error", async () => {
      const mockFetch = endpointFetch;
      mockFetch.mockRejectedValue(new Error("Network error"));

      const { wrapper, queryClient } = createWrapper();
      queryClient.setQueryData(tagKeys.list(), [mockTag]);

      const { result } = renderHook(() => useArchiveTag(), { wrapper });

      await act(async () => {
        try {
          await result.current.mutateAsync(tagId);
        } catch {
          // Expected to throw
        }
      });

      // Should have rolled back
      const cachedTags = queryClient.getQueryData(tagKeys.list());
      expect(cachedTags).toEqual([mockTag]);
      expect(toastSpy).toHaveBeenCalledWith({
        title: "Error",
        description: "Failed to archive tag. Please try again.",
        variant: "destructive",
      });
    });
  });

  // ===========================================================================
  // Query Keys
  // ===========================================================================

  describe("tagKeys", () => {
    it("generates correct query keys", () => {
      expect(tagKeys.all).toEqual(["tags"]);
      expect(tagKeys.list()).toEqual(["tags", "list"]);
      expect(tagKeys.detail("123")).toEqual(["tags", "detail", "123"]);
      expect(tagKeys.transactions("123")).toEqual(["tags", "123", "transactions"]);
      expect(tagKeys.transactionTags("456")).toEqual([
        "tags",
        "transaction",
        "456",
      ]);
    });
  });
});
