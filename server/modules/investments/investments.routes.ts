/**
 * Investments Module - Routes
 *
 * Express router for investment management.
 *
 * @module modules/investments/routes
 */

import { Router } from "express";
import { householdGuard } from "../../middleware/householdGuard";
import { requireRole } from "../../middleware/validateEntity";
import { analyticsLimiter, strictLimiter } from "../../middleware/rateLimit";
import { investmentsController } from "./investments.controller";

const router = Router();

// All routes require auth and household context
router.use(householdGuard);

// P0-7 FIX: Apply base rate limiting to all routes (100 req/min)

// =========================================================================
// Securities
// =========================================================================
router.get("/securities", investmentsController.listSecurities);
router.get("/securities/:id", investmentsController.getSecurityById);
router.get("/securities/:id/prices", investmentsController.getSecurityPrices);
router.post("/securities", strictLimiter, requireRole("member"), investmentsController.createSecurity);
router.put(
  "/securities/:id/price",
  requireRole("admin"),
  investmentsController.updateSecurityPrice,
);

// =========================================================================
// Holdings
// =========================================================================
router.get("/holdings", investmentsController.listHoldings);
router.get("/holdings/:id", investmentsController.getHoldingById);
router.post(
  "/holdings",
  requireRole("member"),
  investmentsController.createHolding,
);
router.put(
  "/holdings/:id",
  requireRole("member"),
  investmentsController.updateHolding,
);
router.delete(
  "/holdings/:id",
  requireRole("member"),
  investmentsController.deleteHolding,
);

// =========================================================================
// Portfolio & Performance (expensive operations - use stricter limiter)
// =========================================================================
router.get(
  "/portfolio",
  analyticsLimiter,
  investmentsController.getPortfolioSummary,
);
router.get(
  "/portfolio/summary",
  analyticsLimiter,
  investmentsController.getPortfolioSummary,
); // Alias for client
router.get(
  "/portfolio/allocation",
  analyticsLimiter,
  investmentsController.getAllocation,
);
router.get(
  "/performance",
  analyticsLimiter,
  investmentsController.getPerformanceHistory,
);

// =========================================================================
// Transactions
// =========================================================================
router.get("/transactions", investmentsController.listTransactions);
router.get("/tax-lots", investmentsController.listTaxLots);
router.post(
  "/transactions",
  requireRole("member"),
  investmentsController.createTransaction,
);

// =========================================================================
// FX Rates
// =========================================================================
router.get("/fx-rates", investmentsController.listFxRates);
router.post(
  "/fx-rates",
  requireRole("admin"),
  investmentsController.createFxRate,
);
router.get(
  "/analytics/fx-historical",
  analyticsLimiter,
  investmentsController.getFxHistorical,
);

export default router;
