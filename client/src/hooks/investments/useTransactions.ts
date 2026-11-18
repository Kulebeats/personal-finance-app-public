/**
 * Investment Transaction Hooks
 *
 * TanStack Query hooks for investment transactions (buy, sell, dividend, etc.)
 *
 * @module hooks/investments/useTransactions
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "../../lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { investmentKeys } from "./keys";
import type { InvestmentTransaction } from "./types";

export function useInvestmentTransactions(options?: {
  accountId?: string;
  holdingId?: string;
  securityId?: string;
  type?: string;
  startDate?: string;
  endDate?: string;
}) {
  return useQuery({
    queryKey: investmentKeys.transactions(options),
    queryFn: async () => {
      const params = new URLSearchParams();
      if (options?.accountId) params.append("accountId", options.accountId);
      if (options?.holdingId) params.append("holdingId", options.holdingId);
      if (options?.securityId) params.append("securityId", options.securityId);
      if (options?.type) params.append("type", options.type);
      if (options?.startDate) params.append("startDate", options.startDate);
      if (options?.endDate) params.append("endDate", options.endDate);

      const query = params.toString();
      const url = query
        ? `/api/investments/transactions?${query}`
        : "/api/investments/transactions";
      const response = await apiRequest("GET", url);
      return response.json();
    },
    select: (data) => data.data as InvestmentTransaction[],
  });
}

export function useCreateInvestmentTransaction() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (
      data: Partial<InvestmentTransaction> & {
        accountId: string;
        type: string;
        transactionDate: string;
      }
    ) => {
      const response = await apiRequest(
        "POST",
        "/api/investments/transactions",
        data
      );
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: investmentKeys.holdingsRoot() });
      queryClient.invalidateQueries({
        queryKey: investmentKeys.portfolioSummaryRoot(),
      });
      queryClient.invalidateQueries({
        queryKey: investmentKeys.transactionsRoot(),
      });
      toast({
        title: "Transaction Recorded",
        description: "Your investment transaction has been saved.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to record transaction",
        variant: "destructive",
      });
    },
  });
}
