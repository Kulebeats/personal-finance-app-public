/**
 * Portfolio Hooks
 *
 * TanStack Query hooks for portfolio summary, analytics, and performance.
 *
 * @module hooks/investments/usePortfolio
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "../../lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { investmentKeys } from "./keys";
import type { PortfolioSummary, AttributionResult } from "./types";

export function usePortfolioSummary(baseCurrency?: string) {
  return useQuery({
    queryKey: investmentKeys.portfolioSummary(baseCurrency),
    queryFn: async () => {
      const params = new URLSearchParams();
      if (baseCurrency) params.append("baseCurrency", baseCurrency);
      const query = params.toString();
      const url = query
        ? `/api/investments/portfolio/summary?${query}`
        : "/api/investments/portfolio/summary";
      const response = await apiRequest("GET", url);
      return response.json();
    },
    select: (data) => data.data as PortfolioSummary,
  });
}

export function useFXAttribution() {
  return useQuery({
    queryKey: investmentKeys.fxAttribution(),
    queryFn: async () => {
      const response = await apiRequest(
        "GET",
        "/api/investments/analytics/fx-attribution"
      );
      return response.json() as Promise<AttributionResult[]>;
    },
    staleTime: 5 * 60 * 1000,
  });
}

export function useInvestmentPerformance(timeframe: string = "1M") {
  return useQuery({
    queryKey: investmentKeys.performance(timeframe),
    queryFn: async () => {
      const response = await apiRequest(
        "GET",
        `/api/investments/analytics/performance?timeframe=${timeframe}`
      );
      return response.json() as Promise<
        { date: string; value: number; benchmark?: number }[]
      >;
    },
    staleTime: 5 * 60 * 1000,
  });
}

export function useTaxSummary(year: number) {
  return useQuery({
    queryKey: investmentKeys.taxSummary(year),
    queryFn: async () => {
      const response = await apiRequest(
        "GET",
        `/api/investments/tax/summary?year=${year}`
      );
      // Server returns decimal strings (MoneyDto convention) for exact
      // regulatory precision - never JS numbers. See InvestmentTaxService.
      return response.json() as Promise<{
        year: number;
        realizedGains: string;
        interestIncome: string;
        dividendIncome: string;
        grossIncome: string;
        totalWht: string;
        netIncome: string;
        currency: string;
      }>;
    },
  });
}

export function useRefreshMarketData() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async () => {
      const response = await apiRequest(
        "POST",
        "/api/investments/market/refresh"
      );
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: investmentKeys.all });
      toast({
        title: "Market Data Refreshed",
        description: "Latest security prices and FX rates have been updated.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Refresh Failed",
        description: error.message || "Failed to update market data",
        variant: "destructive",
      });
    },
  });
}
