/**
 * Securities Hooks
 *
 * TanStack Query hooks for security management (stocks, bonds, etc.)
 *
 * @module hooks/investments/useSecurities
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "../../lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { investmentKeys } from "./keys";
import type { Security } from "./types";

export function useSecurities(options?: {
  type?: string;
  exchange?: string;
  currency?: string;
  search?: string;
}) {
  return useQuery({
    queryKey: [...investmentKeys.securities(), options],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (options?.type) params.append("type", options.type);
      if (options?.exchange) params.append("exchange", options.exchange);
      if (options?.currency) params.append("currency", options.currency);
      if (options?.search) params.append("search", options.search);

      const response = await apiRequest(
        "GET",
        `/api/investments/securities?${params.toString()}`
      );
      return response.json();
    },
    select: (data) => data.data as Security[],
  });
}

export function useSecurity(id: string) {
  return useQuery({
    queryKey: investmentKeys.security(id),
    queryFn: async () => {
      const response = await apiRequest(
        "GET",
        `/api/investments/securities/${id}`
      );
      return response.json();
    },
    select: (data) => data.data as Security,
    enabled: !!id,
  });
}

export function useCreateSecurity() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (data: Partial<Security>) => {
      const response = await apiRequest(
        "POST",
        "/api/investments/securities",
        data
      );
      return response.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: investmentKeys.securities() });
      toast({
        title: "Security Created",
        description: `${data.data.symbol} has been added.`,
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to create security",
        variant: "destructive",
      });
    },
  });
}

export function useUpdateSecurityPrice() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({
      id,
      price,
      date,
    }: {
      id: string;
      price: number;
      date?: string;
    }) => {
      const response = await apiRequest(
        "PUT",
        `/api/investments/securities/${id}/price`,
        { price, date }
      );
      return response.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: investmentKeys.securities() });
      queryClient.invalidateQueries({ queryKey: investmentKeys.holdingsRoot() });
      queryClient.invalidateQueries({
        queryKey: investmentKeys.portfolioSummaryRoot(),
      });
      toast({
        title: "Price Updated",
        description: `${data.data.symbol} price updated to ${data.data.currentPrice}`,
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update price",
        variant: "destructive",
      });
    },
  });
}
