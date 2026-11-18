import { Router, Request, Response } from "express";
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

const router = Router();

// SEC-AUTH-008: Apply authentication, rate limiting, and household guard
router.use(requireAuth);
router.use(analyticsLimiter);
router.use(householdGuard);

// Validation schemas
const holdingIdSchema = z.object({
  holdingId: z.string().uuid("Invalid holding ID format"),
});

const timeframeSchema = z.enum(["1M", "3M", "YTD", "1Y", "ALL"]).default("1M");

// GET /api/investments/analytics/fx-attribution
router.get("/fx-attribution", async (req: Request, res: Response) => {
  try {
    const householdId = req.householdContext!.householdId;
    // Optional: Allow filtering by date range if implemented
    const results = await fxAttributionService.calculateAttribution(
      householdId
    );
    res.json(results);
  } catch (error) {
    logger.error(
      "Error calculating FX attribution",
      { requestId: req.requestId },
      error as Error
    );
    res.status(500).json({ message: "Failed to calculate FX attribution" });
  }
});

// GET /api/investments/analytics/fx-attribution/:holdingId
router.get(
  "/fx-attribution/:holdingId",
  async (req: Request, res: Response) => {
    try {
      // SEC-VALID-002: Validate holdingId is a UUID
      const parseResult = holdingIdSchema.safeParse(req.params);
      if (!parseResult.success) {
        return res.status(400).json({ message: "Invalid holding ID format" });
      }
      const householdId = req.householdContext!.householdId;
      const { holdingId } = parseResult.data;
      const result = await fxAttributionService.calculateAttributionForHolding(
        householdId,
        holdingId
      );
      if (!result) {
        return res
          .status(404)
          .json({ message: "Holding not found or no attribution data" });
      }
      res.json(result);
    } catch (error) {
      logger.error(
        "Error calculating FX attribution for holding",
        { requestId: req.requestId },
        error as Error
      );
      res.status(500).json({ message: "Failed to calculate FX attribution" });
    }
  }
);

// M2 FIX: Removed duplicate /fx-historical route
// This route is now handled by modular investments router at:
// server/modules/investments/investments.routes.ts:87
// Path: /api/investments/analytics/fx-historical

// GET /api/investments/analytics/performance
router.get("/performance", async (req: Request, res: Response) => {
  try {
    const householdId = req.householdContext!.householdId;
    // SEC-VALID-003: Validate timeframe query parameter
    const timeframe = timeframeSchema.parse(req.query.timeframe) as TimeFrame;
    const history = await investmentPerformanceService.gethistory(
      householdId,
      timeframe
    );
    res.json(history);
  } catch (error) {
    logger.error(
      "Error fetching performance history",
      { requestId: req.requestId },
      error as Error
    );
    res.status(500).json({ message: "Failed to fetch performance history" });
  }
});

export default router;
