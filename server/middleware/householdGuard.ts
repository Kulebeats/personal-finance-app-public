import { type Request, type Response, type NextFunction } from "express";
import { householdRepository } from "../repositories/HouseholdRepository";
import { logger } from "../utils/logger";
import { isHouseholdRole } from "../core/authz/capabilities";
import { resolveVerifiedSessionUser } from "../auth";
import { HttpError } from "../core/errors";
import type { HouseholdContext } from "../core/authz/implicit-household-context";
import { resolveRequestImplicitHouseholdContext, readSessionPreconditions, assertHouseholdPrecondition } from "../core/authz/session-preconditions";

/**
 * Household context attached to request after middleware verification
 */
export type { HouseholdContext } from "../core/authz/implicit-household-context";

/**
 * Extend Express Request to include household context
 */
declare global {
  namespace Express {
    interface Request {
      householdContext?: HouseholdContext;
    }
  }
}

/**
 * Middleware to verify household membership and attach context to request
 *
 * This middleware:
 * 1. Resolves the user's household
 * 2. Verifies household membership
 * 3. Attaches household context (householdId, userId, role) to request
 * 4. Returns 403 for unauthorized access attempts
 *
 * Requirements: 11.1, 11.2, 11.3, 11.4
 */
export async function householdGuard(
  req: Request,
  res: Response,
  next: NextFunction
) {
  delete req.householdContext;
  const user = await resolveVerifiedSessionUser(req, res);
  if (!user) return;
  const userId = user.id;
  logger.debug("Household guard check", {
    requestId: req.requestId,
    userId: userId?.substring(0, 8) + "...",
  });

  try {
    const context = await resolveRequestImplicitHouseholdContext(req, userId);
    logger.debug("Household resolved", {
      requestId: req.requestId,
      householdFound: !!context,
      householdId: context?.householdId.substring(0, 8) + "...",
    });

    if (!context) {
      logger.warn("No household found for user", {
        requestId: req.requestId,
        userId: userId?.substring(0, 8) + "...",
      });
      // Same structural signal as HouseholdNotFoundError (core/errors) so any
      // client can branch on `code` rather than message prose regardless of
      // which code path resolved "this user has no household yet".
      return res.status(404).json({
        success: false,
        error: {
          code: "HOUSEHOLD_NOT_FOUND",
          message: "Household not found. Please create a household first.",
        },
      });
    }

    req.householdContext = context;

    next();
  } catch (error) {
    if (error instanceof HttpError) {
      return res.status(error.statusCode).json(error.toJSON());
    }
    logger.error(
      "Household guard error",
      {
        requestId: req.requestId,
        userId: userId?.substring(0, 8) + "...",
      },
      error instanceof Error ? error : new Error(String(error))
    );

    return res.status(500).json({
      success: false,
      error: {
        code: "INTERNAL_ERROR",
        message: "Failed to verify household membership",
      },
    });
  }
}

/**
 * Middleware to verify household access for a specific household ID
 * Used when the household ID is provided in the request (e.g., URL parameter)
 *
 * This middleware:
 * 1. Extracts householdId from request params or body
 * 2. Verifies user is a member of that specific household
 * 3. Returns 403 if user attempts to access another household's resources
 *
 * Requirements: 11.4
 */
export async function householdGuardWithId(
  req: Request,
  res: Response,
  next: NextFunction
) {
  delete req.householdContext;
  const user = await resolveVerifiedSessionUser(req, res, { explicitHousehold: true });
  if (!user) return;
  const userId = user.id;
  const targetHouseholdId = req.params.householdId || req.body?.householdId;

  if (!targetHouseholdId) {
    return res.status(400).json({
      success: false,
      error: {
        code: "BAD_REQUEST",
        message: "Household ID is required",
      },
    });
  }

  try {
    // Verify user is a member of the target household
    const membership = await householdRepository.findMember(
      targetHouseholdId,
      userId
    );

    if (!membership || !isHouseholdRole(membership.role)) {
      // User is attempting to access another household's resources
      return res.status(403).json({
        success: false,
        error: {
          code: "FORBIDDEN",
          message:
            "Access denied. You cannot access resources from another household.",
        },
      });
    }

    assertHouseholdPrecondition(readSessionPreconditions(req), targetHouseholdId);
    // Attach household context to request
    req.householdContext = {
      householdId: targetHouseholdId,
      userId: userId,
      role: membership.role,
    };

    next();
  } catch (error) {
    if (error instanceof HttpError) {
      return res.status(error.statusCode).json(error.toJSON());
    }
    logger.error(
      "Household guard with ID error",
      {
        requestId: req.requestId,
        userId: userId?.substring(0, 8) + "...",
        targetHouseholdId: targetHouseholdId?.substring(0, 8) + "...",
      },
      error instanceof Error ? error : new Error(String(error))
    );
    return res.status(500).json({
      success: false,
      error: {
        code: "INTERNAL_ERROR",
        message: "Failed to verify household membership",
      },
    });
  }
}
