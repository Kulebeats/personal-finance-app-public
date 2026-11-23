/**
 * FX Impact Controller
 * Handles foreign exchange impact analysis
 */
import { isIP } from "node:net";
import { Request, Response, NextFunction } from "express";
import { investmentService } from "./investments.service";
import { logger } from "../../utils/logger";
import { success } from "../../core/http";
import { UnauthorizedError, ValidationError } from "../../core/errors";
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

    const rates = await investmentService.listFxRates(req.householdContext!.householdId, parsed.data);
    return success(res, rates);
  } catch (error) {
    next(error);
  }
}

async function createFxRate(req: Request, res: Response, next: NextFunction) {
  try {
    const parsed = createFxRateSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError("Invalid request data", parsed.error.errors);
    }
    if (!req.user || !req.sessionID) {
      throw new UnauthorizedError("Authentication required");
    }
    const requestIp = req.ip?.split("%")[0];
    const session = {
      snapshot: { ...req.user },
      sessionId: req.sessionID,
      generation: req.session.securityGeneration,
    };
    const rate = await investmentService.createFxRate(
      parsed.data,
      req.householdContext!,
      requestIp && isIP(requestIp) ? requestIp : undefined,
      session,
    );

    logger.info("Recorded household FX rate", {
      from: rate.fromCurrency,
      to: rate.toCurrency,
    });
    return success(res, rate, 201);
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
