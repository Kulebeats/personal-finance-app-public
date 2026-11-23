import { Router } from "express";
import { marketDataService } from "../services/MarketDataService";
import { requireAuth } from "../middleware/auth";
import { requireSuperAdmin } from "../middleware/systemRoleGuard";
import { analyticsLimiter } from "../middleware/rateLimit";
import { logger } from "../utils/logger";

const router = Router();

// SEC-RATE-003: Apply rate limiting to market refresh endpoints
router.use(analyticsLimiter);

/**
 * POST /api/investments/market/refresh
 * Manually trigger a refresh of security prices and FX rates.
 * NEW-13: curated reference prices are global, so only an operator may refresh
 * them, and the operator needs no household: the audit rows name none.
 */
router.post(
  "/refresh",
  requireAuth,
  requireSuperAdmin(),
  async (req, res) => {
    try {
      const actor = { userId: req.session.userId! };
      const fxResult = await marketDataService.updateFXRates(actor);
      const priceResult = await marketDataService.updateSecurityPrices(actor);

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
      });
    }
  }
);

export default router;
