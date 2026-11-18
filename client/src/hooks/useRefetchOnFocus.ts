import { useEffect, useRef, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";

interface UseRefetchOnFocusOptions {
  /**
   * Query keys to refetch when window regains focus.
   * Pass an array of query key prefixes to invalidate.
   */
  queryKeys?: string[][];
  /**
   * Minimum time (ms) since last focus before refetching.
   * Prevents rapid refetches when switching tabs quickly.
   * Default: 60000 (1 minute)
   */
  staleTime?: number;
  /**
   * Whether the hook is enabled.
   * Default: true
   */
  enabled?: boolean;
}

/**
 * Hook to automatically refetch queries when the window regains focus.
 * Useful for dashboard pages to keep data fresh when users return to the app.
 *
 * @example
 * // Refetch all reports-related queries when tab regains focus
 * useRefetchOnFocus({
 *   queryKeys: [["reports"], ["transactions"]],
 *   staleTime: 60000, // Only refetch if unfocused for > 1 minute
 * });
 */
export function useRefetchOnFocus({
  queryKeys = [],
  staleTime = 60000,
  enabled = true,
}: UseRefetchOnFocusOptions = {}) {
  const queryClient = useQueryClient();
  const lastFocusTime = useRef<number>(Date.now());
  const lastBlurTime = useRef<number>(Date.now());

  const handleVisibilityChange = useCallback(() => {
    if (!enabled) return;

    if (document.visibilityState === "hidden") {
      lastBlurTime.current = Date.now();
    } else if (document.visibilityState === "visible") {
      const timeSinceBlur = Date.now() - lastBlurTime.current;

      // Only refetch if the tab was hidden for longer than staleTime
      if (timeSinceBlur >= staleTime) {
        lastFocusTime.current = Date.now();

        // Invalidate specified query keys
        if (queryKeys.length > 0) {
          queryKeys.forEach((key) => {
            queryClient.invalidateQueries({ queryKey: key });
          });
        } else {
          // If no specific keys, invalidate all queries
          queryClient.invalidateQueries();
        }
      }
    }
  }, [queryClient, queryKeys, staleTime, enabled]);

  useEffect(() => {
    if (!enabled) return;

    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [handleVisibilityChange, enabled]);

  return {
    /** Manually trigger a refetch of all specified queries */
    refetchNow: useCallback(() => {
      if (queryKeys.length > 0) {
        queryKeys.forEach((key) => {
          queryClient.invalidateQueries({ queryKey: key });
        });
      } else {
        queryClient.invalidateQueries();
      }
    }, [queryClient, queryKeys]),
    /** Time of last focus event */
    lastFocusTime: lastFocusTime.current,
  };
}

export default useRefetchOnFocus;
