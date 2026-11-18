/**
 * Investment Hooks
 *
 * TanStack Query hooks for investment operations.
 * Includes securities, holdings, FX rates, and portfolio summaries.
 *
 * NOTE: This file is now a re-export barrel for backward compatibility.
 * The actual implementations are in ./investments/ folder, split into:
 * - types.ts - Type definitions
 * - keys.ts - Query key factory
 * - useSecurities.ts - Securities CRUD hooks
 * - useHoldings.ts - Holdings CRUD hooks
 * - useTransactions.ts - Investment transaction hooks
 * - useFxRates.ts - FX rate hooks
 * - usePortfolio.ts - Portfolio, analytics, and market data hooks
 * - usePension.ts - Pension hooks
 * - useRecurringInvestments.ts - Recurring investment hooks
 *
 * @module hooks/useInvestments
 */

// Re-export everything from the modular structure
export * from "./investments";
