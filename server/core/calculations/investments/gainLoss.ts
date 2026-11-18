/**
 * Calculation Engine - Investment Gain/Loss
 *
 * Calculates investment gains and losses with cost basis.
 *
 * @module core/calculations/investments/gainLoss
 */

import { Money, Percentage, toMoney, toPercentage } from "../types";
import { roundToDecimals, preciseMultiply, preciseSubtract } from "../helpers";

/**
 * Gain/Loss calculation result.
 */
export interface GainLossResult {
  /** Cost basis (original investment) */
  costBasis: Money;
  /** Current market value */
  marketValue: Money;
  /** Unrealized gain/loss amount */
  unrealizedGainLoss: Money;
  /** Unrealized gain/loss percentage */
  unrealizedGainLossPct: Percentage;
  /** Is this a gain? */
  isGain: boolean;
}

/**
 * Calculates unrealized gain/loss for an investment.
 *
 * @formula gainLoss = marketValue - costBasis
 * @formula gainLossPct = (gainLoss / costBasis) * 100
 *
 * @param costBasis - Original investment amount
 * @param marketValue - Current market value
 * @returns Gain/loss result
 */
export function calculateGainLoss(
  costBasis: Money,
  marketValue: Money
): GainLossResult {
  const unrealizedGainLoss = toMoney(preciseSubtract(marketValue, costBasis));

  let unrealizedGainLossPct: number;
  if (costBasis <= 0) {
    unrealizedGainLossPct = marketValue > 0 ? 100 : 0;
  } else {
    unrealizedGainLossPct = roundToDecimals(
      (unrealizedGainLoss / costBasis) * 100,
      2
    );
  }

  return {
    costBasis,
    marketValue,
    unrealizedGainLoss,
    unrealizedGainLossPct: toPercentage(unrealizedGainLossPct),
    isGain: unrealizedGainLoss > 0,
  };
}

/**
 * Holding valuation input.
 */
export interface HoldingInput {
  /** Number of units */
  quantity: number;
  /** Current price per unit */
  currentPrice: number;
  /** Cost basis per unit */
  costBasisPerUnit: number;
}

/**
 * Calculates gain/loss for a holding.
 *
 * @param holding - Holding data
 * @returns Gain/loss result
 */
export function calculateHoldingGainLoss(
  holding: HoldingInput
): GainLossResult {
  const costBasis = toMoney(
    roundToDecimals(
      preciseMultiply(holding.quantity, holding.costBasisPerUnit),
      2
    )
  );

  const marketValue = toMoney(
    roundToDecimals(preciseMultiply(holding.quantity, holding.currentPrice), 2)
  );

  return calculateGainLoss(costBasis, marketValue);
}

/**
 * Realized gain/loss result (for sales).
 */
export interface RealizedGainLossResult {
  proceeds: Money;
  costBasis: Money;
  realizedGainLoss: Money;
  realizedGainLossPct: Percentage;
  isLongTerm: boolean;
  holdingPeriodDays: number;
}

/**
 * Calculates realized gain/loss from a sale.
 *
 * @param proceeds - Sale proceeds
 * @param costBasis - Cost basis of sold shares
 * @param acquisitionDate - Date shares were acquired
 * @param saleDate - Date shares were sold
 * @param longTermThresholdDays - Days for long-term classification (default 365)
 * @returns Realized gain/loss result
 */
export function calculateRealizedGainLoss(
  proceeds: Money,
  costBasis: Money,
  acquisitionDate: string,
  saleDate: string,
  longTermThresholdDays: number = 365
): RealizedGainLossResult {
  const realizedGainLoss = toMoney(preciseSubtract(proceeds, costBasis));

  let realizedGainLossPct: number;
  if (costBasis <= 0) {
    realizedGainLossPct = proceeds > 0 ? 100 : 0;
  } else {
    realizedGainLossPct = roundToDecimals(
      (realizedGainLoss / costBasis) * 100,
      2
    );
  }

  const acqDate = new Date(acquisitionDate);
  const slDate = new Date(saleDate);
  const holdingPeriodDays = Math.round(
    (slDate.getTime() - acqDate.getTime()) / (24 * 60 * 60 * 1000)
  );

  return {
    proceeds,
    costBasis,
    realizedGainLoss,
    realizedGainLossPct: toPercentage(realizedGainLossPct),
    isLongTerm: holdingPeriodDays >= longTermThresholdDays,
    holdingPeriodDays,
  };
}
