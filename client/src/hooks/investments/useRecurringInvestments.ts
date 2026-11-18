/**
 * Recurring Investments Hooks
 *
 * TanStack Query hooks for recurring investment management (SIPs, auto-investments).
 *
 * @module hooks/investments/useRecurringInvestments
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "../../lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { investmentKeys } from "./keys";
import type { RecurringInvestment } from "./types";

export function useRecurringInvestments() {
  return useQuery({
    queryKey: investmentKeys.recurring(),
    queryFn: async () => {
      const response = await apiRequest("GET", "/api/investments/recurring");
      return response.json();
    },
    select: (data) => data.data as RecurringInvestment[],
  });
}

export function useCreateRecurringInvestment() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (data: Record<string, unknown>) => {
      const response = await apiRequest(
        "POST",
        "/api/investments/recurring",
        data
      );
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: investmentKeys.recurring() });
      toast({
        title: "Setup Complete",
        description: "Your recurring investment has been scheduled.",
      });
    },
  });
}
