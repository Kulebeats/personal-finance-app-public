/**
 * Portfolio Controller
 * Handles portfolio-level analytics and summaries
 */
import { Request, Response, NextFunction } from "express";
import { portfolioValuationService } from "../../services/PortfolioValuationService";
import {
  investmentPerformanceService,
  type TimeFrame,
} from "../../services/InvestmentPerformanceService";
import { success } from "../../core/http";
import { toMoneyDto, type Money } from "../../core/money";
import type { HouseholdInvestmentValue } from "../../services/PortfolioValuationService";
import { resolveBaseCurrency } from "./investments.holdings.controller";
import { investmentCurrencySelector } from "./investmentCurrencySelector";
import { UnauthorizedError } from "../../core/errors";
import { valueVisiblePortfolio } from "./investmentPortfolioRead";
import type { InvestmentReadSession } from "./investmentReadAuthority";

/** Holdings totals as MoneyDto in the base currency; the percentage is a ratio. */
function toInvestmentValueDto(summary: HouseholdInvestmentValue) {
  return {
    totalValue: toMoneyDto(summary.totalValue),
    totalCostBasis: summary.totalCostBasis && toMoneyDto(summary.totalCostBasis),
    totalGainLoss: summary.totalGainLoss && toMoneyDto(summary.totalGainLoss),
    totalGainLossPercent: summary.totalGainLossPercent,
    byType: Object.fromEntries(Object.entries(summary.byType).map(([type, value]) => [type, toMoneyDto(value)])),
    holdingsCount: summary.holdingsCount,
  };
}

function percentOf(part: Money, whole: Money): number {
  return whole.isZero() ? 0 : part.divide(whole.toFullString()).multiply(100).toNumber();
}

function portfolioReadSession(req: Request): InvestmentReadSession {
  if (!req.user || req.session?.userId !== req.user.id || !req.sessionID) throw new UnauthorizedError("Authentication required");
  return { snapshot: structuredClone(req.user), sessionId: req.sessionID, generation: req.session.securityGeneration };
}

async function getPortfolioSummary(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const session = portfolioReadSession(req);
    const { householdId } = req.householdContext!;
    const baseCurrency = await resolveBaseCurrency(
      householdId,
      investmentCurrencySelector(req.query),
    );

    const data = await valueVisiblePortfolio(req.householdContext!, session, async context => {
      const summary = await portfolioValuationService.getHouseholdInvestmentValue(householdId, baseCurrency, context);
      const tbillsValue = await portfolioValuationService.getTBillsValue(householdId, baseCurrency, context);
      const pensionValue = await portfolioValuationService.getPensionValue(householdId, baseCurrency, context);
      return {
        ...toInvestmentValueDto(summary),
        tbillsValue: toMoneyDto(tbillsValue),
        pensionValue: toMoneyDto(pensionValue),
        totalIncludingAlternatives: toMoneyDto(summary.totalValue.add(tbillsValue).add(pensionValue)),
      };
    });
    success(res, data, 200, { baseCurrency });
    return;
  } catch (error) {
    next(error);
  }
}

async function getPerformanceHistory(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const rawTimeframe = (req.query.timeframe as string) || "1M";

    // Validate timeframe instead of an unchecked cast
    const validTimeframes: TimeFrame[] = ["1M", "3M", "YTD", "1Y", "ALL"];
    const timeframe: TimeFrame = validTimeframes.includes(
      rawTimeframe as TimeFrame,
    )
      ? (rawTimeframe as TimeFrame)
      : "1M";

    const history = await investmentPerformanceService.gethistory(
      req.householdContext!,
      timeframe,
    );

    return success(res, history);
  } catch (error) {
    next(error);
  }
}

async function getAllocation(req: Request, res: Response, next: NextFunction) {
  try {
    const session = portfolioReadSession(req);
    const { householdId } = req.householdContext!;
    const baseCurrency = await resolveBaseCurrency(
      householdId,
      req.query.currency as string | undefined,
    );

    const summary = await valueVisiblePortfolio(req.householdContext!, session, context =>
      portfolioValuationService.getHouseholdInvestmentValue(householdId, baseCurrency, context), false);

    // Convert byType to allocation array
    const allocation = Object.entries(summary.byType).map(([type, value]) => ({
      category: type,
      value: toMoneyDto(value),
      percentage: percentOf(value, summary.totalValue),
    }));

    success(res, allocation, 200, {
      baseCurrency,
      totalValue: toMoneyDto(summary.totalValue),
    });
    return;
  } catch (error) {
    next(error);
  }
}

export const investmentsPortfolioController = {
  getPortfolioSummary,
  getPerformanceHistory,
  getAllocation,
};
