/**
 * Reports Module - Utilities
 *
 * Shared utility functions for report sub-modules.
 *
 * @module modules/reports/utils
 */

import { Request, Response } from "express";
import { z } from "zod";
import { logger } from "../../utils/logger";
import { householdRepository } from "../../repositories/HouseholdRepository";
import { BudgetDenominationUnavailable } from "../../core/money/budget-denomination";
import { ForbiddenError } from "../../core/errors";
import type { ReportScope } from "./reports.types";
import { MISSING_FX_RATE_STATUS, missingFxRateBody } from "../../core/errors/missingFxRate";

/**
 * Resolve report scope based on user role
 *
 * @param req - Express request
 * @param res - Express response
 * @param query - Query parameters with optional scope
 * @returns Resolved query with scope, or null if authorization fails
 */
export function resolveReportScope<T extends object>(
  req: Request,
  res: Response,
  query: T
): (T & { scope: ReportScope }) | null {
  if (!req.householdContext) {
    res.status(500).json({
      success: false,
      error: {
        code: "INTERNAL_ERROR",
        message: "Household context not available",
      },
    });
    return null;
  }

  const { role } = req.householdContext;
  const defaultScope: ReportScope =
    role === "owner" || role === "admin" ? "household" : "mine";
  const scope =
    (query as { scope?: ReportScope }).scope ??
    defaultScope;

  // Only owners/admins can view household-wide reports
  if (scope === "household" && !["owner", "admin"].includes(role)) {
    res.status(403).json({
      success: false,
      error: {
        code: "FORBIDDEN",
        message: "Household scope requires admin or owner role",
      },
    });
    return null;
  }

  return { ...query, scope };
}

/**
 * FIX REPORTS-PENDING-001: Resolve report query with household preferences
 *
 * Applies household preferences for pending transaction visibility to match
 * the behavior of transaction list/summary endpoints.
 *
 * @param req - Express request with household context
 * @param res - Express response
 * @param query - Query parameters with optional includePending
 * @returns Resolved query with scope and includePending defaults, or null if authorization fails
 */
export async function resolveReportQuery<
  T extends { includePending?: boolean; scope?: ReportScope }
>(
  req: Request,
  res: Response,
  query: T
): Promise<(T & { scope: ReportScope; includePending: boolean }) | null> {
  // First resolve scope (synchronous)
  const scopedQuery = resolveReportScope(req, res, query);
  if (!scopedQuery) return null;

  const { householdId } = req.householdContext!;

  // If includePending is explicitly set by client, respect it
  if (query.includePending !== undefined) {
    return { ...scopedQuery, includePending: query.includePending };
  }

  // Otherwise, default to household preference
  const prefs = await householdRepository.findPreferences(householdId);
  const includePending = prefs?.showPendingTransactions ?? true;

  return { ...scopedQuery, includePending };
}

/**
 * Standard error handler for report endpoints
 */
export function handleReportError(
  res: Response,
  error: unknown,
  context: string
): Response {
  if (error instanceof ForbiddenError) return res.status(error.statusCode).json(error.toJSON());
  if (error instanceof BudgetDenominationUnavailable) return res.status(error.statusCode).json(error.toJSON());
  const missingRate = missingFxRateBody(error);
  if (missingRate) return res.status(MISSING_FX_RATE_STATUS).json(missingRate);
  if (error instanceof z.ZodError) {
    return res.status(400).json({
      success: false,
      error: {
        code: "VALIDATION_ERROR",
        message: "Invalid query parameters",
        details: error.errors,
      },
    });
  }

  if (error instanceof Error && error.name === "ValidationError") {
    return res.status(400).json({
      success: false,
      error: {
        code: "VALIDATION_ERROR",
        message: error.message,
      },
    });
  }

  logger.error(`${context} error`, { context }, error as Error);
  return res.status(500).json({
    success: false,
    error: {
      code: "INTERNAL_ERROR",
      message: "Unexpected error",
      debug:
        process.env.NODE_ENV !== "production"
          ? error instanceof Error
            ? error.message
            : String(error)
          : undefined,
    },
  });
}

/**
 * Success response wrapper
 */
export function reportSuccess<T>(res: Response, data: T): Response {
  return res.json({ success: true, data });
}
