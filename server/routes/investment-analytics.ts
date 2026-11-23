import { Router, Request, Response, NextFunction } from "express";
import { z } from "zod";
import { fxAttributionService } from "../services/FXAttributionService";
import {
  investmentPerformanceService,
  TimeFrame,
} from "../services/InvestmentPerformanceService";
import { householdGuard } from "../middleware/householdGuard";
import { requireAuth } from "../auth";
import { analyticsLimiter } from "../middleware/rateLimit";
import { logger } from "../utils/logger";
import { UnauthorizedError } from "../core/errors";
import { missingFxRateBody } from "../core/errors/missingFxRate";
import type { HoldingReadSession } from "../modules/investments/investmentHoldingRead";

const router = Router();

// SEC-AUTH-008: Apply authentication, rate limiting, and household guard
router.use(requireAuth);
router.use(analyticsLimiter);
router.use(householdGuard);

// Validation schemas
const holdingIdSchema = z.object({
  holdingId: z.string().uuid("Invalid holding ID format"),
});

/** The holding read re-checks this session's membership and credential under lock. */
function holdingReadSession(req: Request): HoldingReadSession {
  if (!req.user || req.session?.userId !== req.user.id || !req.sessionID) throw new UnauthorizedError("Authentication required");
  return { snapshot: structuredClone(req.user), sessionId: req.sessionID, generation: req.session.securityGeneration };
}

const timeframeSchema = z.enum(["1M", "3M", "YTD", "1Y", "ALL"]).default("1M");

// GET /api/investments/analytics/fx-attribution
// Errors go to the shared handler: a missing rate or ZMW basis is a 422, not a 500.
router.get("/fx-attribution", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const results = await fxAttributionService.calculateAttribution(req.householdContext!, holdingReadSession(req));
    res.json(results);
  } catch (error) {
    next(error);
  }
});

// GET /api/investments/analytics/fx-attribution/:holdingId
router.get(
  "/fx-attribution/:holdingId",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      // SEC-VALID-002: Validate holdingId is a UUID
      const parseResult = holdingIdSchema.safeParse(req.params);
      if (!parseResult.success) {
        return res.status(400).json({ message: "Invalid holding ID format" });
      }
      const result = await fxAttributionService.calculateAttributionForHolding(
        req.householdContext!,
        holdingReadSession(req),
        parseResult.data.holdingId,
      );
      if (!result) {
        return res
          .status(404)
          .json({ message: "Holding not found or no attribution data" });
      }
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// M2 FIX: Removed duplicate /fx-historical route
// This route is now handled by modular investments router at:
// server/modules/investments/investments.routes.ts:87
// Path: /api/investments/analytics/fx-historical

// GET /api/investments/analytics/performance
router.get("/performance", async (req: Request, res: Response, next: NextFunction) => {
  try {
    // SEC-VALID-003: Validate timeframe query parameter
    const timeframe = timeframeSchema.parse(req.query.timeframe) as TimeFrame;
    const history = await investmentPerformanceService.gethistory(
      req.householdContext!,
      timeframe
    );
    res.json(history);
  } catch (error) {
    // A-08: a missing rate is the shared 422 naming the pair, not a 500.
    if (missingFxRateBody(error)) return next(error);
    logger.error(
      "Error fetching performance history",
      { requestId: req.requestId },
      error as Error
    );
    res.status(500).json({ message: "Failed to fetch performance history" });
  }
});

export default router;
