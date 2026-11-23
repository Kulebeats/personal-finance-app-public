/**
 * Securities Hooks
 *
 * TanStack Query hooks for security management (stocks, bonds, etc.)
 *
 * @module hooks/investments/useSecurities
 */

import { userErrorMessage } from "@/lib/errorCopy";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "../../lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { investmentKeys } from "./keys";
import type { Security } from "./types";
import { valuationQueryPolicy } from "./valuationQueryPolicy";

export function useSecurities(options?: {
  type?: string;
  exchange?: string;
  currency?: string;
  search?: string;
}) {
  return useQuery({
    ...valuationQueryPolicy,
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
    ...valuationQueryPolicy,
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
        description: userErrorMessage(error, "Failed to create security"),
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
      validThrough,
    }: {
      id: string;
      price: string | number;
      date: string;
      validThrough: string;
    }) => {
      const response = await apiRequest(
        "PUT",
        `/api/investments/securities/${id}/price`,
        { price, date, validThrough }
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
        description: `${data.data.symbol} price recorded through ${data.data.validThrough}`,
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: userErrorMessage(error, "Failed to update price"),
        variant: "destructive",
      });
    },
  });
}
