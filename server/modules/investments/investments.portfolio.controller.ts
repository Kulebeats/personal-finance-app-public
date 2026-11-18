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
import { resolveBaseCurrency } from "./investments.holdings.controller";

async function getPortfolioSummary(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const { householdId } = req.householdContext!;
    const baseCurrency = await resolveBaseCurrency(
      householdId,
      req.query.currency as string | undefined,
    );

    const summary = await portfolioValuationService.getHouseholdInvestmentValue(
      householdId,
      baseCurrency,
    );

    // Add T-Bills and Pensions for complete picture
    const tbillsValue = await portfolioValuationService.getTBillsValue(
      householdId,
      baseCurrency,
    );
    const pensionValue = await portfolioValuationService.getPensionValue(
      householdId,
      baseCurrency,
    );

    success(
      res,
      {
        ...summary,
        tbillsValue,
        pensionValue,
        totalIncludingAlternatives:
          summary.totalValue + tbillsValue + pensionValue,
      },
      200,
      { baseCurrency },
    );
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
    const { householdId } = req.householdContext!;
    const rawTimeframe = (req.query.timeframe as string) || "1M";

    // Validate timeframe instead of an unchecked cast
    const validTimeframes: TimeFrame[] = ["1M", "3M", "YTD", "1Y", "ALL"];
    const timeframe: TimeFrame = validTimeframes.includes(
      rawTimeframe as TimeFrame,
    )
      ? (rawTimeframe as TimeFrame)
      : "1M";

    const history = await investmentPerformanceService.gethistory(
      householdId,
      timeframe,
    );

    return success(res, history);
  } catch (error) {
    next(error);
  }
}

async function getAllocation(req: Request, res: Response, next: NextFunction) {
  try {
    const { householdId } = req.householdContext!;
    const baseCurrency = await resolveBaseCurrency(
      householdId,
      req.query.currency as string | undefined,
    );

    const summary = await portfolioValuationService.getHouseholdInvestmentValue(
      householdId,
      baseCurrency,
    );

    // Convert byType to allocation array
    const total = summary.totalValue || 1;
    const allocation = Object.entries(summary.byType).map(([type, value]) => ({
      category: type,
      value,
      percentage: (value / total) * 100,
    }));

    success(res, allocation, 200, {
      baseCurrency,
      totalValue: summary.totalValue,
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
