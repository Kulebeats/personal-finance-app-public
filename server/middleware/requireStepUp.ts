/**
 * Step-Up MFA Middleware
 *
 * Requires recent MFA verification for sensitive actions.
 * Used for: password change, MFA disable, data export, account deletion.
 *
 * SEC-02: Step-up MFA for sensitive actions
 * MFA-001: Tiered TTL based on operation sensitivity
 */

import { Request, Response, NextFunction } from "express";
import { logger } from "../utils/logger";

/**
 * Tiered TTL based on operation sensitivity
 *
 * - FINANCIAL: 5 min for money movement (transfers, payments)
 * - SETTINGS: 15 min for settings changes (profile, notifications)
 * - DESTRUCTIVE: 5 min for account deletion / revoke-all
 */
export const STEP_UP_TTL = {
  FINANCIAL: 5 * 60 * 1000, // 5 minutes
  SETTINGS: 15 * 60 * 1000, // 15 minutes
  DESTRUCTIVE: 5 * 60 * 1000, // 5 minutes (relaxed from 1 min for a usable sudo window)
} as const;

export type StepUpLevel = keyof typeof STEP_UP_TTL;

// Extend session type to include step-up timestamp
declare module "express-session" {
  interface SessionData {
    stepUpVerifiedAt?: number;
    stepUpSessionId?: string;
    stepUpUserId?: string;
  }
}

/**
 * Middleware that requires recent MFA verification (step-up).
 * Returns 401 with { requiresStepUp: true } if not verified recently.
 *
 * @param level - The sensitivity level determining TTL (default: SETTINGS)
 *
 * @example
 * // 15 minutes for settings changes (default)
 * router.put("/settings", requireStepUp(), updateSettings);
 *
 * // 5 minutes for financial operations
 * router.post("/transfer", requireStepUp("FINANCIAL"), createTransfer);
 *
 * // 1 minute for account deletion
 * router.delete("/account", requireStepUp("DESTRUCTIVE"), deleteAccount);
 */
export function requireStepUp(level: StepUpLevel = "SETTINGS") {
  const ttlMs = STEP_UP_TTL[level];

  return (req: Request, res: Response, next: NextFunction) => {
    const stepUpAt = req.session.stepUpVerifiedAt;
    const now = Date.now();

    // Check if step-up was verified within TTL
    if (!stepUpAt || now - stepUpAt > ttlMs || now < stepUpAt ||
        req.session.stepUpSessionId !== req.sessionID || req.session.stepUpUserId !== req.session.userId) {
      logger.info("Step-up MFA required", {
        requestId: req.requestId,
        userId: req.session.userId?.substring(0, 8) + "...",
        endpoint: req.path,
        level,
        ttlMinutes: ttlMs / 60000,
        stepUpAge: stepUpAt ? Math.round((now - stepUpAt) / 1000) : null,
      });

      return res.status(401).json({
        success: false,
        error: {
          code: "STEP_UP_REQUIRED",
          // Users without MFA step up with their password, so never name MFA here.
          message: "Please confirm it's you to continue",
        },
        requiresStepUp: true,
        level,
        ttlMinutes: ttlMs / 60000,
      });
    }

    next();
  };
}

/**
 * Mark session as step-up verified.
 * Call this after successful MFA verification.
 */
export function setStepUpVerified(req: Request): void {
  req.session.stepUpVerifiedAt = Date.now();
  req.session.stepUpSessionId = req.sessionID;
  req.session.stepUpUserId = req.session.userId;
  logger.info("Step-up MFA verified", {
    requestId: req.requestId,
    userId: req.session.userId?.substring(0, 8) + "...",
  });
}

/**
 * Clear step-up verification (e.g., after sensitive action completes)
 */
export function clearStepUpVerification(req: Request): void {
  delete req.session.stepUpVerifiedAt;
  delete req.session.stepUpSessionId;
  delete req.session.stepUpUserId;
}

/**
 * Check if step-up is currently valid for a given level (non-blocking check)
 *
 * @param req - Express request
 * @param level - The sensitivity level to check against (default: SETTINGS)
 */
export function isStepUpValid(
  req: Request,
  level: StepUpLevel = "SETTINGS"
): boolean {
  const stepUpAt = req.session.stepUpVerifiedAt;
  if (!stepUpAt || req.session.stepUpSessionId !== req.sessionID || req.session.stepUpUserId !== req.session.userId) return false;
  return Date.now() >= stepUpAt && Date.now() - stepUpAt <= STEP_UP_TTL[level];
}
