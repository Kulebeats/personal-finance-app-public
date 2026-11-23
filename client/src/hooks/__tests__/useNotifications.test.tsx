/**
 * @vitest-environment jsdom
 */
import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor, act } from "@testing-library/react";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { clearCsrfToken } from "@/lib/api";
import {
  useNotifications,
  useUnreadCount,
  useMarkAsRead,
  useMarkAllAsRead,
  useArchiveNotification,
  type Notification,
} from "../useNotifications";

// Mutations go through apiCall, which fetches a CSRF token (GET
// /api/csrf-token) before each mutating request. Serve that token
// transparently so it never consumes per-test mocks; everything else is
// forwarded to mockFetch.
const mockFetch = vi.fn();

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
  }) as unknown as Response;

describe("useNotifications hooks", () => {
  const mockNotification: Notification = {
    id: "notif-1",
    householdId: "h1",
    userId: "u1",
    type: "budget_exceeded",
    title: "Budget Alert",
    body: "You have exceeded your monthly budget",
    actionUrl: null,
    metadata: null,
    dedupeKey: null,
    isRead: false,
    isArchived: false,
    createdAt: "2026-01-27T10:00:00Z",
  };

  beforeEach(() => {
    clearCsrfToken();
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        if (String(input).includes("/csrf-token")) {
          return Promise.resolve(
            mockFetchResponse({ csrfToken: "test-csrf" }),
          );
        }
        return mockFetch(input, init);
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  describe("useNotifications", () => {
    it("fetches notifications list", async () => {
      mockFetch.mockResolvedValue(
        mockFetchResponse({
          success: true,
          data: [mockNotification],
        })
      );

      const { wrapper } = createWrapper();
      const { result } = renderHook(() => useNotifications(), { wrapper });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(result.current.data).toHaveLength(1);
      expect(result.current.data?.[0].id).toBe("notif-1");
      expect(result.current.data?.[0].body).toBe(
        "You have exceeded your monthly budget"
      );
    });

    it("applies query options correctly", async () => {
      mockFetch.mockResolvedValue(
        mockFetchResponse({
          success: true,
          data: [],
        })
      );

      const { wrapper } = createWrapper();
      renderHook(
        () => useNotifications({ limit: 5, offset: 10, unreadOnly: true }),
        { wrapper }
      );

      await waitFor(() =>
        expect(mockFetch).toHaveBeenCalledWith(
          expect.stringContaining("limit=5"),
          expect.objectContaining({ credentials: "include" })
        )
      );

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("offset=10"),
        expect.any(Object)
      );
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("unreadOnly=true"),
        expect.any(Object)
      );
    });

    it("handles fetch error gracefully", async () => {
      mockFetch.mockResolvedValue(new Response(JSON.stringify({ error: { code: "SERVICE_UNAVAILABLE", message: "Failed to fetch notifications" } }), { status: 503 }));

      const { wrapper } = createWrapper();
      const { result } = renderHook(() => useNotifications(), { wrapper });

      await waitFor(() => expect(result.current.isError).toBe(true));

      expect(result.current.error?.message).toBe(
        "Failed to fetch notifications"
      );
    });

    it("respects enabled option", () => {

      const { wrapper } = createWrapper();
      renderHook(() => useNotifications({ enabled: false }), { wrapper });

      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("returns properly typed Notification data", async () => {
      mockFetch.mockResolvedValue(
        mockFetchResponse({
          success: true,
          data: [mockNotification],
        })
      );

      const { wrapper } = createWrapper();
      const { result } = renderHook(() => useNotifications(), { wrapper });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      const notification = result.current.data?.[0];
      // Type assertions to verify typing works correctly
      expect(typeof notification?.id).toBe("string");
      expect(typeof notification?.createdAt).toBe("string"); // Date comes as ISO string
      expect(typeof notification?.isRead).toBe("boolean");
    });
  });

  describe("useUnreadCount", () => {
    it("fetches unread count", async () => {
      mockFetch.mockResolvedValue(
        mockFetchResponse({
          success: true,
          data: { count: 5 },
        })
      );

      const { wrapper } = createWrapper();
      const { result } = renderHook(() => useUnreadCount(), { wrapper });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(result.current.data).toBe(5);
    });

    it("calls correct API endpoint", async () => {
      mockFetch.mockResolvedValue(
        mockFetchResponse({
          success: true,
          data: { count: 0 },
        })
      );

      const { wrapper } = createWrapper();
      renderHook(() => useUnreadCount(), { wrapper });

      await waitFor(() =>
        expect(mockFetch).toHaveBeenCalledWith(
          "/api/notifications/unread-count",
          expect.objectContaining({ credentials: "include" })
        )
      );
    });

    it("handles fetch error gracefully", async () => {
      mockFetch.mockResolvedValue(new Response(JSON.stringify({ error: { code: "SERVICE_UNAVAILABLE", message: "Failed to fetch unread count" } }), { status: 503 }));

      const { wrapper } = createWrapper();
      const { result } = renderHook(() => useUnreadCount(), { wrapper });

      await waitFor(() => expect(result.current.isError).toBe(true));

      expect(result.current.error?.message).toBe(
        "Failed to fetch unread count"
      );
    });
  });

  describe("useMarkAsRead", () => {
    it("marks notification as read", async () => {
      const readNotification = { ...mockNotification, isRead: true };
      mockFetch.mockResolvedValue(
        mockFetchResponse({
          success: true,
          data: readNotification,
        })
      );

      const { wrapper, queryClient } = createWrapper();
      const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

      const { result } = renderHook(() => useMarkAsRead(), { wrapper });

      await act(async () => {
        await result.current.mutateAsync("notif-1");
      });

      expect(mockFetch).toHaveBeenCalledWith(
        "/api/notifications/notif-1/read",
        expect.objectContaining({
          method: "PUT",
          credentials: "include",
          headers: expect.objectContaining({ "x-csrf-token": "test-csrf" }),
        })
      );

      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: ["notifications"],
      });
    });

    it("handles error on mark as read", async () => {
      // apiCall surfaces the server's error.message on failure
      mockFetch.mockResolvedValue(
        mockFetchResponse(
          { error: { message: "Failed to mark notification as read" } },
          false
        )
      );

      const { wrapper } = createWrapper();
      const { result } = renderHook(() => useMarkAsRead(), { wrapper });

      await expect(result.current.mutateAsync("notif-1")).rejects.toThrow(
        "Failed to mark notification as read"
      );
    });
  });

  describe("useMarkAllAsRead", () => {
    it("marks all notifications as read", async () => {
      mockFetch.mockResolvedValue(
        mockFetchResponse({
          success: true,
          data: { count: 5 },
        })
      );

      const { wrapper, queryClient } = createWrapper();
      const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

      const { result } = renderHook(() => useMarkAllAsRead(), { wrapper });

      await act(async () => {
        await result.current.mutateAsync();
      });

      expect(mockFetch).toHaveBeenCalledWith(
        "/api/notifications/read-all",
        expect.objectContaining({
          method: "PUT",
          credentials: "include",
          headers: expect.objectContaining({ "x-csrf-token": "test-csrf" }),
        })
      );

      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: ["notifications"],
      });
    });

    it("handles error on mark all as read", async () => {
      // apiCall surfaces the server's error.message on failure
      mockFetch.mockResolvedValue(
        mockFetchResponse(
          { error: { message: "Failed to mark all as read" } },
          false
        )
      );

      const { wrapper } = createWrapper();
      const { result } = renderHook(() => useMarkAllAsRead(), { wrapper });

      await expect(result.current.mutateAsync()).rejects.toThrow(
        "Failed to mark all as read"
      );
    });
  });

  describe("useArchiveNotification", () => {
    it("archives a notification", async () => {
      mockFetch.mockResolvedValue(
        mockFetchResponse({
          success: true,
          data: mockNotification,
        })
      );

      const { wrapper, queryClient } = createWrapper();
      const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

      const { result } = renderHook(() => useArchiveNotification(), {
        wrapper,
      });

      await act(async () => {
        await result.current.mutateAsync("notif-1");
      });

      expect(mockFetch).toHaveBeenCalledWith(
        "/api/notifications/notif-1",
        expect.objectContaining({
          method: "DELETE",
          credentials: "include",
          headers: expect.objectContaining({ "x-csrf-token": "test-csrf" }),
        })
      );

      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: ["notifications"],
      });
    });

    it("handles error on archive", async () => {
      // apiCall surfaces the server's error.message on failure
      mockFetch.mockResolvedValue(
        mockFetchResponse(
          { error: { message: "Failed to archive notification" } },
          false
        )
      );

      const { wrapper } = createWrapper();
      const { result } = renderHook(() => useArchiveNotification(), {
        wrapper,
      });

      await expect(result.current.mutateAsync("notif-1")).rejects.toThrow(
        "Failed to archive notification"
      );
    });
  });
});
