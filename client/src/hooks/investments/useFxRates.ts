/**
 * FX Rates Hooks
 *
 * TanStack Query hooks for foreign exchange rate management.
 *
 * @module hooks/investments/useFxRates
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "../../lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { investmentKeys } from "./keys";
import type { FxRate } from "./types";

export function useFxRates(options?: { from?: string; to?: string }) {
  return useQuery({
    queryKey: [...investmentKeys.fxRates(), options],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (options?.from) params.append("from", options.from);
      if (options?.to) params.append("to", options.to);

      const response = await apiRequest(
        "GET",
        `/api/investments/fx-rates?${params.toString()}`
      );
      return response.json();
    },
    select: (data) => data.data as FxRate[],
  });
}

export function useCreateFxRate() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (data: Partial<FxRate>) => {
      const response = await apiRequest(
        "POST",
        "/api/investments/fx-rates",
        data
      );
      return response.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: investmentKeys.fxRates() });
      toast({
        title: "FX Rate Added",
        description: `${data.data.fromCurrency}/${data.data.toCurrency} rate recorded.`,
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to add FX rate",
        variant: "destructive",
      });
    },
  });
}

export function useFXHistorical(
  from: string = "USD",
  to: string = "ZMW",
  limit: number = 365
) {
  return useQuery({
    queryKey: investmentKeys.fxHistorical(from, to),
    queryFn: async () => {
      const response = await apiRequest(
        "GET",
        `/api/investments/analytics/fx-historical?from=${from}&to=${to}&limit=${limit}`
      );
      return response.json() as Promise<{ date: string; rate: number }[]>;
    },
    staleTime: 15 * 60 * 1000, // FX rates don't change every second
  });
}
