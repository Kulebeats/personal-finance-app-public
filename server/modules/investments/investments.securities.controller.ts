/**
 * Securities Controller
 * Handles security CRUD operations (stocks, bonds, funds)
 */
import { Request, Response, NextFunction } from "express";
import { isIP } from "node:net";
import { z } from "zod";
import { investmentService } from "./investments.service";
import { businessAuditService } from "../../services/BusinessAuditService";
import { logger } from "../../utils/logger";
import { success } from "../../core/http";
import { UnauthorizedError, ValidationError } from "../../core/errors";
import type { InvestmentReadSession } from "./investmentReadAuthority";
import {
  listSecuritiesQuerySchema,
  getSecurityPricesQuerySchema,
  createSecuritySchema,
  updateSecurityPriceSchema,
} from "./investments.validation";

function securitySession(req: Request): InvestmentReadSession {
  if (!req.user || req.session?.userId !== req.user.id || !req.sessionID) {
    throw new UnauthorizedError("Authentication required");
  }
  return { snapshot: structuredClone(req.user), sessionId: req.sessionID, generation: req.session.securityGeneration };
}

async function listSecurities(req: Request, res: Response, next: NextFunction) {
  try {
    const session = securitySession(req);
    const queryResult = listSecuritiesQuerySchema.safeParse(req.query);
    if (!queryResult.success) {
      throw new ValidationError(
        "Invalid request data",
        queryResult.error.errors,
      );
    }

    const results = await investmentService.listSecurities(queryResult.data, req.householdContext!, session);
    return success(res, results);
  } catch (error) {
    next(error);
  }
}

async function getSecurityById(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const { id } = req.params;
    const security = await investmentService.getSecurityById(id, req.householdContext!, securitySession(req));

    if (!security) {
      return res.status(404).json({
        success: false,
        error: { code: "NOT_FOUND", message: "Security not found" },
      });
    }

    return success(res, security);
  } catch (error) {
    next(error);
  }
}

// Reference history retains the global source rows and their original dates.
async function getSecurityPrices(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const { id } = req.params;
    const parsed = getSecurityPricesQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      throw new ValidationError("Invalid request data", parsed.error.errors);
    }

    const prices = await investmentService.getSecurityPrices(id, parsed.data, req.householdContext!, securitySession(req));
    return success(res, prices);
  } catch (error) {
    next(error);
  }
}

async function createSecurity(req: Request, res: Response, next: NextFunction) {
  try {
    const parsed = createSecuritySchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError("Invalid request data", parsed.error.errors);
    }

    const requestIp = req.ip?.split("%")[0];
    const security = await investmentService.createSecurity(
      parsed.data,
      req.householdContext!,
      requestIp && isIP(requestIp) ? requestIp : undefined,
      securitySession(req),
    );

    logger.info("Created security", {
      securityId: security.id,
      symbol: security.symbol,
    });
    success(res, security, 201);
    return;
  } catch (error) {
    next(error);
  }
}

async function updateSecurityPrice(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const identifier = z.string().uuid().safeParse(req.params.id);
    if (!identifier.success) {
      throw new ValidationError("Invalid security identifier", identifier.error.errors);
    }
    const parsed = updateSecurityPriceSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError("Invalid request data", parsed.error.errors);
    }

    const requestIp = req.ip?.split("%")[0];
    const session = {
      snapshot: { ...req.user! },
      sessionId: req.sessionID,
      generation: req.session.securityGeneration,
    };
    const updated = await investmentService.updateSecurityPrice(
      identifier.data,
      parsed.data,
      req.householdContext!,
      requestIp && isIP(requestIp) ? requestIp : undefined,
      session,
    );

    logger.info("Updated security price", {
      securityId: identifier.data,
    });
    return success(res, updated);
  } catch (error) {
    next(error);
  }
}

export const investmentsSecuritiesController = {
  listSecurities,
  getSecurityById,
  getSecurityPrices,
  createSecurity,
  updateSecurityPrice,
};
