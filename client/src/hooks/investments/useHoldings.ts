/**
 * Holdings Hooks
 *
 * TanStack Query hooks for investment holdings management.
 *
 * @module hooks/investments/useHoldings
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "../../lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { investmentKeys } from "./keys";
import type { Holding } from "./types";

export function useHoldings(
  accountIdOrOptions?:
    | string
    | {
        accountId?: string;
        baseCurrency?: string;
      }
) {
  const options =
    typeof accountIdOrOptions === "string"
      ? { accountId: accountIdOrOptions }
      : accountIdOrOptions;
  const resolvedAccountId = options?.accountId;
  const baseCurrency = options?.baseCurrency;

  return useQuery({
    queryKey: resolvedAccountId
      ? investmentKeys.holdingsByAccount(resolvedAccountId, baseCurrency)
      : investmentKeys.holdings(baseCurrency),
    queryFn: async () => {
      const params = new URLSearchParams();
      if (resolvedAccountId) params.append("accountId", resolvedAccountId);
      if (baseCurrency) params.append("baseCurrency", baseCurrency);
      const query = params.toString();
      const url = query
        ? `/api/investments/holdings?${query}`
        : "/api/investments/holdings";
      const response = await apiRequest("GET", url);
      return response.json();
    },
    select: (data) => data.data as Holding[],
  });
}

export function useCreateHolding() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (data: Partial<Holding>) => {
      const response = await apiRequest(
        "POST",
        "/api/investments/holdings",
        data
      );
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: investmentKeys.holdingsRoot() });
      queryClient.invalidateQueries({
        queryKey: investmentKeys.portfolioSummaryRoot(),
      });
      toast({
        title: "Holding Added",
        description: "Your investment has been recorded.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to add holding",
        variant: "destructive",
      });
    },
  });
}

export function useUpdateHolding() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({
      id,
      data,
    }: {
      id: string;
      data: Partial<Holding>;
    }) => {
      const response = await apiRequest(
        "PUT",
        `/api/investments/holdings/${id}`,
        data
      );
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: investmentKeys.holdingsRoot() });
      queryClient.invalidateQueries({
        queryKey: investmentKeys.portfolioSummaryRoot(),
      });
      toast({
        title: "Holding Updated",
        description: "Your investment has been updated.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update holding",
        variant: "destructive",
      });
    },
  });
}

export function useDeleteHolding() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (id: string) => {
      const response = await apiRequest(
        "DELETE",
        `/api/investments/holdings/${id}`
      );
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: investmentKeys.holdingsRoot() });
      queryClient.invalidateQueries({
        queryKey: investmentKeys.portfolioSummaryRoot(),
      });
      toast({
        title: "Holding Removed",
        description: "The holding has been deleted.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to delete holding",
        variant: "destructive",
      });
    },
  });
}
