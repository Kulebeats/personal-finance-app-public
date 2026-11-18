/**
 * Holdings Controller
 * Handles investment holdings CRUD and sync operations
 */
import { Request, Response, NextFunction } from "express";
import { investmentService } from "./investments.service";
import { householdRepository } from "../../repositories/HouseholdRepository";
import { businessAuditService } from "../../services/BusinessAuditService";
import { logger } from "../../utils/logger";
import { success, noContent } from "../../core/http";
import { ValidationError, NotFoundError } from "../../core/errors";
import {
  listHoldingsQuerySchema,
  createHoldingSchema,
  updateHoldingSchema,
} from "./investments.validation";

async function resolveBaseCurrency(
  householdId: string,
  requested?: string | string[],
): Promise<string> {
  if (requested) {
    return Array.isArray(requested) ? requested[0] : requested;
  }
  const household = await householdRepository.findById(householdId);
  return household?.currency || "ZMW";
}

async function listHoldings(req: Request, res: Response, next: NextFunction) {
  try {
    const { householdId } = req.householdContext!;
    const parsed = listHoldingsQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      throw new ValidationError("Invalid request data", parsed.error.errors);
    }

    const baseCurrency = await resolveBaseCurrency(
      householdId,
      parsed.data.currency,
    );

    const holdings = await investmentService.getHoldings(
      householdId,
      parsed.data,
      baseCurrency,
    );

    success(res, holdings, 200, { baseCurrency });
    return;
  } catch (error) {
    next(error);
  }
}

async function getHoldingById(req: Request, res: Response, next: NextFunction) {
  try {
    const { householdId } = req.householdContext!;
    const { id } = req.params;

    const holding = await investmentService.getHoldingById(id, householdId);

    if (!holding) {
      return res.status(404).json({
        success: false,
        error: { code: "NOT_FOUND", message: "Holding not found" },
      });
    }

    return success(res, holding);
  } catch (error) {
    next(error);
  }
}

async function createHolding(req: Request, res: Response, next: NextFunction) {
  try {
    const { householdId, userId } = req.householdContext!;
    const parsed = createHoldingSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError("Invalid request data", parsed.error.errors);
    }

    const holding = await investmentService.createHolding(
      parsed.data,
      householdId,
    );

    await businessAuditService.logCreate({
      userId,
      householdId,
      entityType: "holding",
      entityId: holding.id,
      newValue: {
        accountId: holding.accountId,
        securityId: holding.securityId,
        quantity: holding.quantity,
        costBasis: holding.costBasis,
      },
      ipAddress: businessAuditService.getIpAddress(req),
    });

    logger.info("Created holding", { householdId, holdingId: holding.id });
    success(res, holding, 201);
    return;
  } catch (error) {
    next(error);
  }
}

async function updateHolding(req: Request, res: Response, next: NextFunction) {
  try {
    const { householdId, userId } = req.householdContext!;
    const { id } = req.params;
    const parsed = updateHoldingSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError("Invalid request data", parsed.error.errors);
    }

    const oldHolding = await investmentService.getHoldingById(id, householdId);
    if (!oldHolding) {
      throw new NotFoundError("Holding not found");
    }

    const updated = await investmentService.updateHolding(
      id,
      parsed.data,
      householdId,
    );

    if (!updated) {
      throw new NotFoundError("Holding not found");
    }

    await businessAuditService.logUpdate({
      userId,
      householdId,
      entityType: "holding",
      entityId: id,
      oldValue: {
        quantity: oldHolding.quantity,
        costBasis: oldHolding.costBasis,
      },
      newValue: {
        quantity: updated.quantity,
        costBasis: updated.costBasis,
      },
      ipAddress: businessAuditService.getIpAddress(req),
    });

    logger.info("Updated holding", { householdId, holdingId: id });
    return success(res, updated);
  } catch (error) {
    next(error);
  }
}

async function deleteHolding(req: Request, res: Response, next: NextFunction) {
  try {
    const { householdId, userId } = req.householdContext!;
    const { id } = req.params;

    const holding = await investmentService.getHoldingById(id, householdId);
    if (!holding) {
      throw new NotFoundError("Holding not found");
    }

    const deleted = await investmentService.deleteHolding(id, householdId);

    if (!deleted) {
      throw new NotFoundError("Holding not found");
    }

    await businessAuditService.logDelete({
      userId,
      householdId,
      entityType: "holding",
      entityId: id,
      oldValue: {
        accountId: holding.accountId,
        securityId: holding.securityId,
        quantity: holding.quantity,
        costBasis: holding.costBasis,
      },
      ipAddress: businessAuditService.getIpAddress(req),
    });

    logger.info("Deleted holding", { householdId, holdingId: id });
    return noContent(res);
  } catch (error) {
    next(error);
  }
}

export { resolveBaseCurrency };

export const investmentsHoldingsController = {
  listHoldings,
  getHoldingById,
  createHolding,
  updateHolding,
  deleteHolding,
};
