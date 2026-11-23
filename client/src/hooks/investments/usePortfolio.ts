/**
 * Portfolio Hooks
 *
 * TanStack Query hooks for portfolio summary, analytics, and performance.
 *
 * @module hooks/investments/usePortfolio
 */

import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "../../lib/queryClient";
import { investmentKeys } from "./keys";
import type { PortfolioSummary, AttributionResult } from "./types";
import { valuationQueryPolicy } from "./valuationQueryPolicy";

export function usePortfolioSummary(baseCurrency?: string) {
  return useQuery({
    ...valuationQueryPolicy,
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
    select: (data: { data: PortfolioSummary; meta?: { baseCurrency?: string } }) =>
      ({ ...data.data, baseCurrency: data.meta?.baseCurrency ?? data.data.baseCurrency }),
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

/** The household's current calendar year (NEW-22): the tax report's default
 * and latest year, so it never follows the browser's clock or zone. */
export function useTaxYear() {
  return useQuery({
    queryKey: investmentKeys.taxYear(),
    queryFn: async () => {
      const response = await apiRequest("GET", "/api/investments/tax/year");
      const body = await response.json() as { year?: unknown };
      if (typeof body.year !== "number" || !Number.isInteger(body.year)) throw new Error("Tax year unavailable");
      return body.year;
    },
  });
}

export function useTaxSummary(year: number | undefined) {
  return useQuery({
    queryKey: investmentKeys.taxSummary(year ?? 0),
    enabled: year !== undefined,
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
