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
  const response = await fetch("/api/weekly-recap", {
    credentials: "include",
  });

  if (!response.ok) {
    throw new Error("Failed to fetch weekly recap");
  }

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
  return useQuery({
    queryKey: ["weekly-recap"],
    queryFn: fetchWeeklyRecap,
    staleTime: 1000 * 60 * 60, // 1 hour (data doesn't change much for a past week)
    retry: 1,
  });
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
