import { protectedFetch } from "@/lib/protected-fetch";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { Notification as SchemaNotification } from "@shared/schema";
// apiCall attaches the x-csrf-token header (raw fetch 403s under CSRF
// enforcement) and self-heals on a stale token.
import { apiCall } from "@/lib/api";
import { throwIfResNotOk } from "@/lib/queryClient";

/**
 * Client notification type - extends schema with string dates
 * (server returns ISO strings, schema has Date objects)
 */
export type Notification = Omit<SchemaNotification, "createdAt"> & {
  createdAt: string;
};

/**
 * Fetch notifications list
 */
async function fetchNotifications(options?: {
  limit?: number;
  offset?: number;
  unreadOnly?: boolean;
}): Promise<Notification[]> {
  const params = new URLSearchParams();
  if (options?.limit) params.set("limit", String(options.limit));
  if (options?.offset) params.set("offset", String(options.offset));
  if (options?.unreadOnly) params.set("unreadOnly", "true");

  const res = await protectedFetch(`/api/notifications?${params.toString()}`, {
    credentials: "include",
  });

  await throwIfResNotOk(res);

  const json = await res.json();
  return json.data;
}

/**
 * Fetch unread count
 */
async function fetchUnreadCount(): Promise<number> {
  const res = await protectedFetch("/api/notifications/unread-count", {
    credentials: "include",
  });

  await throwIfResNotOk(res);

  const json = await res.json();
  return json.data.count;
}

/**
 * Mark notification as read
 */
async function markAsRead(id: string): Promise<Notification> {
  const json = await apiCall<{ success: boolean; data: Notification }>(
    `/notifications/${id}/read`,
    { method: "PUT" }
  );
  return json.data;
}

/**
 * Mark all notifications as read
 */
async function markAllAsRead(): Promise<number> {
  const json = await apiCall<{ success: boolean; data: { count: number } }>(
    "/notifications/read-all",
    { method: "PUT" }
  );
  return json.data.count;
}

/**
 * Archive a notification
 */
async function archiveNotification(id: string): Promise<Notification> {
  const json = await apiCall<{ success: boolean; data: Notification }>(
    `/notifications/${id}`,
    { method: "DELETE" }
  );
  return json.data;
}

// ============================================================================
// Hooks
// ============================================================================

/**
 * Hook to fetch notifications list
 */
export function useNotifications(options?: {
  limit?: number;
  offset?: number;
  unreadOnly?: boolean;
  enabled?: boolean;
}) {
  return useQuery({
    queryKey: ["notifications", options],
    queryFn: () =>
      fetchNotifications({
        limit: options?.limit ?? 10,
        offset: options?.offset ?? 0,
        unreadOnly: options?.unreadOnly,
      }),
    enabled: options?.enabled !== false,
    staleTime: 30 * 1000, // 30 seconds
  });
}

/**
 * Hook to fetch unread notification count with polling
 */
export function useUnreadCount(options?: { pollingInterval?: number }) {
  return useQuery({
    queryKey: ["notifications", "unread-count"],
    queryFn: fetchUnreadCount,
    refetchInterval: options?.pollingInterval ?? 30 * 1000, // Default 30 seconds
    staleTime: 10 * 1000, // Consider stale after 10 seconds
  });
}

/**
 * Hook to mark a notification as read
 */
export function useMarkAsRead() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: markAsRead,
    onMutate: async (notificationId: string) => {
      // Cancel any outgoing refetches
      await queryClient.cancelQueries({ queryKey: ["notifications"] });

      // Snapshot the previous value
      const previousNotifications = queryClient.getQueryData<Notification[]>([
        "notifications",
      ]);
      const previousCount = queryClient.getQueryData<number>([
        "notifications",
        "unread-count",
      ]);

      // Optimistically update notifications list
      queryClient.setQueriesData<Notification[]>(
        { queryKey: ["notifications"] },
        (old) => {
          if (!old) return old;
          return old.map((n) =>
            n.id === notificationId ? { ...n, isRead: true } : n
          );
        }
      );

      // Optimistically update unread count
      if (previousCount !== undefined && previousCount > 0) {
        queryClient.setQueryData(
          ["notifications", "unread-count"],
          previousCount - 1
        );
      }

      return { previousNotifications, previousCount };
    },
    onError: (err, notificationId, context) => {
      // Rollback on error
      if (context?.previousNotifications) {
        queryClient.setQueryData(
          ["notifications"],
          context.previousNotifications
        );
      }
      if (context?.previousCount !== undefined) {
        queryClient.setQueryData(
          ["notifications", "unread-count"],
          context.previousCount
        );
      }
    },
    onSettled: () => {
      // Always refetch to ensure consistency
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
    },
  });
}

/**
 * Hook to mark all notifications as read
 */
export function useMarkAllAsRead() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: markAllAsRead,
    onMutate: async () => {
      // Cancel any outgoing refetches
      await queryClient.cancelQueries({ queryKey: ["notifications"] });

      // Snapshot the previous value
      const previousNotifications = queryClient.getQueryData<Notification[]>([
        "notifications",
      ]);
      const previousCount = queryClient.getQueryData<number>([
        "notifications",
        "unread-count",
      ]);

      // Optimistically update all notifications
      queryClient.setQueriesData<Notification[]>(
        { queryKey: ["notifications"] },
        (old) => {
          if (!old) return old;
          return old.map((n) => ({ ...n, isRead: true }));
        }
      );

      // Optimistically update unread count to 0
      queryClient.setQueryData(["notifications", "unread-count"], 0);

      return { previousNotifications, previousCount };
    },
    onError: (err, variables, context) => {
      // Rollback on error
      if (context?.previousNotifications) {
        queryClient.setQueryData(
          ["notifications"],
          context.previousNotifications
        );
      }
      if (context?.previousCount !== undefined) {
        queryClient.setQueryData(
          ["notifications", "unread-count"],
          context.previousCount
        );
      }
    },
    onSettled: () => {
      // Always refetch to ensure consistency
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
    },
  });
}

/**
 * Hook to archive a notification
 */
export function useArchiveNotification() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: archiveNotification,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
    },
  });
}
