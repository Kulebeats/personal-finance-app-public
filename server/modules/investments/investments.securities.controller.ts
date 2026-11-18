/**
 * Securities Controller
 * Handles security CRUD operations (stocks, bonds, funds)
 */
import { Request, Response, NextFunction } from "express";
import { investmentService } from "./investments.service";
import { businessAuditService } from "../../services/BusinessAuditService";
import { logger } from "../../utils/logger";
import { success } from "../../core/http";
import { ValidationError, NotFoundError } from "../../core/errors";
import {
  listSecuritiesQuerySchema,
  getSecurityPricesQuerySchema,
  createSecuritySchema,
  updateSecurityPriceSchema,
} from "./investments.validation";

async function listSecurities(req: Request, res: Response, next: NextFunction) {
  try {
    const queryResult = listSecuritiesQuerySchema.safeParse(req.query);
    if (!queryResult.success) {
      throw new ValidationError(
        "Invalid request data",
        queryResult.error.errors,
      );
    }

    const results = await investmentService.listSecurities(queryResult.data);
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
    const security = await investmentService.getSecurityById(id);

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

    const prices = await investmentService.getSecurityPrices(id, parsed.data);
    return success(res, prices);
  } catch (error) {
    next(error);
  }
}

async function createSecurity(req: Request, res: Response, next: NextFunction) {
  try {
    const { householdId, userId } = req.householdContext!;
    const parsed = createSecuritySchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError("Invalid request data", parsed.error.errors);
    }

    const security = await investmentService.createSecurity(parsed.data);

    await businessAuditService.logCreate({
      userId,
      householdId,
      entityType: "security",
      entityId: security.id,
      newValue: {
        symbol: security.symbol,
        name: security.name,
        type: security.type,
        currency: security.currency,
      },
      ipAddress: businessAuditService.getIpAddress(req),
    });

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
    const { householdId, userId } = req.householdContext!;
    const { id } = req.params;
    const parsed = updateSecurityPriceSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError("Invalid request data", parsed.error.errors);
    }

    // Get old price for audit logging
    const oldSecurity = await investmentService.getSecurityById(id);
    if (!oldSecurity) {
      throw new NotFoundError("Security not found");
    }

    const updated = await investmentService.updateSecurityPrice(
      id,
      parsed.data,
    );

    await businessAuditService.logUpdate({
      userId,
      householdId,
      entityType: "security",
      entityId: id,
      oldValue: { price: oldSecurity.currentPrice },
      newValue: { price: updated.currentPrice },
      ipAddress: businessAuditService.getIpAddress(req),
    });

    logger.info("Updated security price", {
      securityId: id,
      newPrice: parsed.data.price,
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
