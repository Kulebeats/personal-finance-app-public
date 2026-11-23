/**
 * Holdings Controller
 * Handles investment holdings CRUD and sync operations
 */
import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { investmentService } from "./investments.service";
import { householdRepository } from "../../repositories/HouseholdRepository";
import { businessAuditService } from "../../services/BusinessAuditService";
import { logger } from "../../utils/logger";
import { success, noContent } from "../../core/http";
import { ValidationError, NotFoundError, UnauthorizedError } from "../../core/errors";
import type { HoldingReadSession } from "./investmentHoldingRead";
import { investmentCurrencySelector } from "./investmentCurrencySelector";
import {
  listHoldingsQuerySchema,
  createHoldingRequestSchema,
  updateHoldingSchema,
} from "./investments.validation";

function holdingReadSession(req: Request): HoldingReadSession {
  if (!req.user || req.session?.userId !== req.user.id || !req.sessionID) throw new UnauthorizedError("Authentication required");
  return { snapshot: structuredClone(req.user), sessionId: req.sessionID, generation: req.session.securityGeneration };
}

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
    const session = holdingReadSession(req);
    const { householdId } = req.householdContext!;
    const requestedCurrency = investmentCurrencySelector(req.query);
    const parsed = listHoldingsQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      throw new ValidationError("Invalid request data", parsed.error.errors);
    }

    const baseCurrency = await resolveBaseCurrency(
      householdId,
      requestedCurrency,
    );

    const holdings = await investmentService.getHoldings(
      req.householdContext!,
      parsed.data,
      baseCurrency,
      session,
    );

    success(res, holdings, 200, { baseCurrency });
    return;
  } catch (error) {
    next(error);
  }
}

async function getHoldingById(req: Request, res: Response, next: NextFunction) {
  try {
    const session = holdingReadSession(req);
    const { id } = req.params;

    const holding = await investmentService.getVisibleHoldingById(
      id,
      req.householdContext!,
      session,
    );

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
    const actor = req.householdContext!;
    const session = { snapshot: { ...req.user! }, sessionId: req.sessionID, generation: req.session.securityGeneration };
    const parsed = createHoldingRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError("Invalid request data", parsed.error.errors);
    }

    const holding = await investmentService.createHolding(
      parsed.data,
      actor,
      businessAuditService.getIpAddress(req),
      session,
    );

    logger.info("Created holding", { householdId: actor.householdId, holdingId: holding.id });
    success(res, holding, 201);
    return;
  } catch (error) {
    next(error);
  }
}

async function updateHolding(req: Request, res: Response, next: NextFunction) {
  try {
    const actor = req.householdContext!;
    const session = { snapshot: { ...req.user! }, sessionId: req.sessionID, generation: req.session.securityGeneration };
    const { id } = req.params;
    const parsed = updateHoldingSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError("Invalid request data", parsed.error.errors);
    }

    const updated = await investmentService.updateHolding(
      id,
      parsed.data,
      actor,
      businessAuditService.getIpAddress(req),
      session,
    );

    if (!updated) {
      throw new NotFoundError("Holding not found");
    }

    logger.info("Updated holding", { householdId: actor.householdId, holdingId: id });
    return success(res, updated);
  } catch (error) {
    next(error);
  }
}

async function deleteHolding(req: Request, res: Response, next: NextFunction) {
  try {
    const actor = req.householdContext!;
    const session = { snapshot: { ...req.user! }, sessionId: req.sessionID, generation: req.session.securityGeneration };
    const { id } = req.params;
    // The app parses JSON and form bodies. Unparsed wire bytes must not be
    // silently canonicalized to an empty DELETE intent, including chunked
    // requests without a Content-Length. An actually bodyless call is valid.
    const bodyOnWire = Number(req.get("content-length") ?? "0") > 0 || req.get("transfer-encoding") !== undefined;
    const mediaType = (req.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
    if (bodyOnWire && !["application/json", "application/x-www-form-urlencoded"].includes(mediaType)) {
      throw new ValidationError("Holding deletion does not accept an unsupported request body");
    }
    const intent = z.object({ body: z.object({}).strict(), query: z.object({}).strict() }).safeParse({
      body: req.body === undefined ? {} : req.body, query: req.query,
    });
    if (!intent.success) throw new ValidationError("Holding deletion does not accept financial fields or query options", intent.error.errors);
    const deleted = await investmentService.deleteHolding(id, actor, businessAuditService.getIpAddress(req), session);
    if (!deleted) {
      throw new NotFoundError("Holding");
    }
    logger.info("Deleted holding", { householdId: actor.householdId, holdingId: id });
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
