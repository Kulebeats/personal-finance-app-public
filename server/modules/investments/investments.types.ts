/**
 * Investments Module - Types
 *
 * Shared type definitions for investment sub-modules.
 *
 * @module modules/investments/types
 */

/**
 * Security types supported by the system
 */
export type SecurityType =
  | "stock"
  | "bond"
  | "tbill"
  | "etf"
  | "mutual_fund"
  | "unit_trust"
  | "forex"
  | "crypto"
  | "property"
  | "other";

/**
 * Holding metrics after valuation
 */
export interface HoldingMetrics {
  currentValue: number;
  costBasis: number;
  unrealizedGain: number;
  unrealizedGainPercent: number;
  fxRateUsed?: number;
}

/**
 * Portfolio allocation breakdown
 */
export interface AllocationItem {
  category: string;
  value: number;
  percentage: number;
  color?: string;
}

/**
 * Performance data point
 */
export interface PerformancePoint {
  date: string;
  value: number;
  returnPercent: number;
}

/**
 * Benchmark timeframes
 * M1 FIX: Aligned with validation schema and service implementation
 */
export type BenchmarkTimeframe = "1M" | "3M" | "YTD" | "1Y" | "ALL";

/**
 * Price alert types
 */
export type AlertType = "above" | "below" | "change_percent";

/**
 * Investment transaction types
 */
export type InvestmentTransactionType =
  | "buy"
  | "sell"
  | "dividend"
  | "interest"
  | "fee"
  | "split"
  | "transfer_in"
  | "transfer_out"
  | "coupon"
  | "maturity";
