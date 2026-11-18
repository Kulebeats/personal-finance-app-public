/**
 * Calculation Engine - Investments Module
 *
 * Re-exports all investment-related calculations.
 *
 * @module core/calculations/investments
 */

export {
  calculateTimeWeightedReturn,
  calculateSimpleReturn,
  type TWRPeriod,
  type TWRResult,
} from "./twr";

export {
  calculateGainLoss,
  calculateHoldingGainLoss,
  calculateRealizedGainLoss,
  type GainLossResult,
  type HoldingInput,
  type RealizedGainLossResult,
} from "./gainLoss";
