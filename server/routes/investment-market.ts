import { Router } from "express";
import { marketDataService } from "../services/MarketDataService";
import { requireAuth, householdGuard, requireRole } from "../middleware/auth";
import { analyticsLimiter } from "../middleware/rateLimit";
import { logger } from "../utils/logger";

const router = Router();

// SEC-RATE-003: Apply rate limiting to market refresh endpoints
router.use(analyticsLimiter);

/**
 * POST /api/investments/market/refresh
 * Manually trigger a refresh of security prices and FX rates
 */
router.post(
  "/refresh",
  requireAuth,
  householdGuard,
  requireRole("member"),
  async (_req, res) => {
    try {
      const fxResult = await marketDataService.updateFXRates();
      const priceResult = await marketDataService.updateSecurityPrices();

      res.json({
        success: true,
        fx: fxResult,
        prices: priceResult,
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      logger.error("Market refresh error", {}, err as Error);
      res.status(500).json({
        success: false,
        message: "Failed to refresh market data",
        error: String(err),
      });
    }
  }
);

export default router;
