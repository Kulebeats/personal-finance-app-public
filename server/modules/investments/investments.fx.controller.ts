/**
 * FX Impact Controller
 * Handles foreign exchange impact analysis
 */
import { Request, Response, NextFunction } from "express";
import { investmentService } from "./investments.service";
import { businessAuditService } from "../../services/BusinessAuditService";
import { logger } from "../../utils/logger";
import { success } from "../../core/http";
import { ValidationError } from "../../core/errors";
import {
  listFxRatesQuerySchema,
  createFxRateSchema,
  fxHistoricalQuerySchema,
} from "./investments.validation";

async function listFxRates(req: Request, res: Response, next: NextFunction) {
  try {
    const parsed = listFxRatesQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      throw new ValidationError("Invalid request data", parsed.error.errors);
    }

    const rates = await investmentService.listFxRates(parsed.data);
    return success(res, rates);
  } catch (error) {
    next(error);
  }
}

async function createFxRate(req: Request, res: Response, next: NextFunction) {
  try {
    const { householdId, userId } = req.householdContext!;
    const parsed = createFxRateSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError("Invalid request data", parsed.error.errors);
    }

    const rate = await investmentService.createFxRate(parsed.data);

    await businessAuditService.logCreate({
      userId,
      householdId,
      entityType: "fx_rate",
      entityId: rate.id,
      newValue: {
        fromCurrency: rate.fromCurrency,
        toCurrency: rate.toCurrency,
        rate: rate.rate,
        date: rate.date,
      },
      ipAddress: businessAuditService.getIpAddress(req),
    });

    logger.info("Created FX rate", {
      from: rate.fromCurrency,
      to: rate.toCurrency,
      rate: rate.rate,
    });
    success(res, rate, 201);
    return;
  } catch (error) {
    next(error);
  }
}

async function getFxHistorical(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const parsed = fxHistoricalQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      throw new ValidationError("Invalid request data", parsed.error.errors);
    }

    const history = await investmentService.getFxHistorical(parsed.data);
    return success(res, history);
  } catch (error) {
    next(error);
  }
}

export const investmentsFxController = {
  listFxRates,
  createFxRate,
  getFxHistorical,
};
