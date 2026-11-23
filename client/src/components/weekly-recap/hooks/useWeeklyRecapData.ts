import { throwIfResNotOk, type HttpError } from "@/lib/queryClient";
import { protectedFetch } from "@/lib/protected-fetch";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "@/hooks/use-toast";
// apiCall attaches the x-csrf-token header (raw fetch 403s under CSRF
// enforcement) and self-heals on a stale token.
import { apiCall } from "@/lib/api";
import type {
  WeeklyRecapData,
  WeeklyRecapResponse,
  WeeklyRecapFeedback,
} from "@shared/weekly-recap";

// Re-export types for backward compatibility
export type { WeeklyRecapData, WeeklyRecapResponse };

async function fetchWeeklyRecap(): Promise<WeeklyRecapData> {
  const response = await protectedFetch("/api/weekly-recap", {
    credentials: "include",
  });
  await throwIfResNotOk(response);



  const json = await response.json();
  return json.data;
}

/**
 * Submit feedback for a weekly recap step.
 * Uses the WeeklyRecapFeedback type from shared types for contract alignment.
 */
async function submitFeedback(data: WeeklyRecapFeedback) {
  return apiCall<{ success: boolean }>("/weekly-recap/feedback", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export function useWeeklyRecapData() {
  const query = useQuery({
    queryKey: ["weekly-recap"],
    queryFn: fetchWeeklyRecap,
    staleTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: "always",
    refetchInterval: 60_000,
    retry: (count, error) => {
      const failure = error as HttpError;
      return count < 1 && failure.status !== 401 && !["EMAIL_VERIFICATION_REQUIRED", "HOUSEHOLD_NOT_FOUND", "SESSION_CONTEXT_CHANGED"].includes(failure.code || "");
    },
  });
  // The surrounding session boundary owns this QueryClient. Withdraw cached
  // private values during revalidation instead of showing the previous audience.
  const isChecking = query.fetchStatus !== "idle";
  return { ...query, isChecking, data: isChecking || query.isError ? undefined : query.data };
}

export function useWeeklyRecapFeedback() {
  return useMutation({
    mutationFn: submitFeedback,
    onSuccess: () => {
      // Optional: toast success or just silent
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to submit feedback",
        variant: "destructive",
      });
    },
  });
}
