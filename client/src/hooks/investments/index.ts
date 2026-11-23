/**
 * Investment Hooks - Barrel Export
 *
 * Re-exports all investment-related hooks, types, and query keys.
 *
 * @module hooks/investments
 */

// Types
export type {
  Security,
  Holding,
  FxRate,
  InvestmentTransaction,
  PortfolioSummary,
  AttributionResult,
  PensionHolding,
  PensionContribution,
  RecurringInvestment,
} from "./types";

// Query keys
export { investmentKeys } from "./keys";

// Securities hooks
export {
  useSecurities,
  useSecurity,
  useCreateSecurity,
  useUpdateSecurityPrice,
} from "./useSecurities";

// Holdings hooks
export {
  useHoldings,
  useCreateHolding,
  useUpdateHolding,
  useDeleteHolding,
} from "./useHoldings";

// Transaction hooks
export {
  useInvestmentTransactions,
  useCreateInvestmentTransaction,
} from "./useTransactions";

// FX rate hooks
export { useFxRates, useCreateFxRate, useFXHistorical } from "./useFxRates";

// Portfolio and analytics hooks
export {
  usePortfolioSummary,
  useFXAttribution,
  useInvestmentPerformance,
  useTaxSummary,
  useTaxYear,
} from "./usePortfolio";

// Pension hooks
export { usePensionHoldings, usePensionContributions } from "./usePension";

// Recurring investment hooks
export {
  useRecurringInvestments,
  useCreateRecurringInvestment,
} from "./useRecurringInvestments";
