/**
 * Investment Query Keys
 *
 * TanStack Query key factory for investment-related queries.
 *
 * @module hooks/investments/keys
 */

export const investmentKeys = {
  all: ["investments"] as const,
  securities: () => [...investmentKeys.all, "securities"] as const,
  security: (id: string) => [...investmentKeys.securities(), id] as const,
  holdingsRoot: () => [...investmentKeys.all, "holdings"] as const,
  holdings: (baseCurrency?: string) =>
    [...investmentKeys.all, "holdings", baseCurrency || "default"] as const,
  holdingsByAccount: (accountId: string, baseCurrency?: string) =>
    [...investmentKeys.holdings(baseCurrency), { accountId }] as const,
  transactionsRoot: () => [...investmentKeys.all, "transactions"] as const,
  transactions: (options?: {
    accountId?: string;
    holdingId?: string;
    securityId?: string;
    type?: string;
    startDate?: string;
    endDate?: string;
  }) => [...investmentKeys.all, "transactions", options ?? {}] as const,
  fxRates: () => [...investmentKeys.all, "fx-rates"] as const,
  portfolioSummaryRoot: () =>
    [...investmentKeys.all, "portfolio", "summary"] as const,
  portfolioSummary: (baseCurrency?: string) =>
    [
      ...investmentKeys.all,
      "portfolio",
      "summary",
      baseCurrency || "default",
    ] as const,
  fxAttribution: () =>
    [...investmentKeys.all, "analytics", "fx-attribution"] as const,
  performance: (timeframe: string) =>
    [...investmentKeys.all, "analytics", "performance", timeframe] as const,
  fxHistorical: (from: string, to: string) =>
    [...investmentKeys.all, "analytics", "fx-historical", from, to] as const,
  taxYear: () => [...investmentKeys.all, "tax", "year"] as const,
  taxSummary: (year: number) =>
    [...investmentKeys.all, "tax", "summary", year] as const,
  pension: () => [...investmentKeys.all, "pension"] as const,
  pensionContributions: (id: string) =>
    [...investmentKeys.pension(), id, "contributions"] as const,
  recurring: () => [...investmentKeys.all, "recurring"] as const,
};
