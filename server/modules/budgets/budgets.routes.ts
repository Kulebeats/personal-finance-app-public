/**
 * Budgets Module - Routes
 *
 * Express router for budget management.
 *
 * @module modules/budgets/routes
 */

import { Router } from "express";
import { householdGuard } from "../../middleware/householdGuard";
import { requireRole } from "../../middleware/validateEntity";
import { generalLimiter, analyticsLimiter } from "../../middleware/rateLimit";
import { budgetsController } from "./budgets.controller";

const router = Router();

// All routes require auth and household context
router.use(householdGuard);

// Apply rate limiting to all budget routes
router.use(generalLimiter);

// =========================================================================
// Query Routes (before :id to avoid conflicts)
// =========================================================================
router.get("/", budgetsController.list);
router.get("/progress", budgetsController.getProgress);
router.get("/alerts", budgetsController.getAlerts);
router.get("/settings", budgetsController.getSettings);
router.get("/forecast", analyticsLimiter, budgetsController.getForecast);

// =========================================================================
// Mutating Operations (require member role)
// =========================================================================
router.post("/", requireRole("member"), budgetsController.create);
router.put(
  "/settings",
  requireRole("member"),
  budgetsController.updateSettings,
);
router.post(
  "/recalculate",
  requireRole("member"),
  budgetsController.recalculate,
);
router.post("/clear", requireRole("member"), budgetsController.clear);
router.post("/move", requireRole("member"), budgetsController.move);
router.put(
  "/forecast/:id",
  requireRole("member"),
  budgetsController.updateForecast,
);

// =========================================================================
// Individual Budget Routes
// =========================================================================
router.get("/:id", budgetsController.getById);
router.put("/:id", requireRole("member"), budgetsController.update);
router.delete("/:id", requireRole("member"), budgetsController.delete);

export default router;
