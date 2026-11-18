/**
 * Reports Module - Routes
 *
 * Express router for all report endpoints.
 * Applies appropriate middleware and rate limiting.
 *
 * @module modules/reports/routes
 */

import { Router } from "express";
import { householdGuard } from "../../middleware/householdGuard";
import {
  analyticsLimiter,
  expensiveAnalyticsLimiter,
} from "../../middleware/rateLimit";
import { reportsAnnualController } from "./reports.annual.controller";
import { reportsCashflowController } from "./reports.cashflow.controller";
import { reportsSpendingController } from "./reports.spending.controller";
import { reportsNetWorthController } from "./reports.networth.controller";
import { reportsAnalyticsController } from "./reports.analytics.controller";
import { reportsCustomController } from "./reports.custom.controller";
import { reportsExportsController } from "./reports.exports.controller";

const router = Router();

// All routes require auth and household context
router.use(householdGuard);

// Apply base rate limiting to all report routes
router.use(analyticsLimiter);

// =========================================================================
// Annual Reports
// =========================================================================
router.get("/annual", reportsAnnualController.getAnnual);

// =========================================================================
// Cashflow Reports
// =========================================================================
router.get("/cashflow", reportsCashflowController.getCashflow);
router.get("/cashflow/budget", reportsCashflowController.getBudgetComparison);
router.get("/income", reportsCashflowController.getIncome);
router.get("/savings-rate", reportsCashflowController.getSavingsRate);

// =========================================================================
// Spending Reports
// =========================================================================
router.get(
  "/spending/breakdown",
  reportsSpendingController.getSpendingBreakdown,
);
router.get("/spending/trend", reportsSpendingController.getSpendingTrend);

// =========================================================================
// Net Worth Reports
// =========================================================================
router.get("/net-worth", reportsNetWorthController.getNetWorth);
router.get("/net-worth/changes", reportsNetWorthController.getNetWorthChanges);

// =========================================================================
// Analytics & Visualization (Expensive operations - stricter rate limit)
// =========================================================================
router.get(
  "/sankey",
  expensiveAnalyticsLimiter,
  reportsAnalyticsController.getSankey,
);
router.get("/ratios", reportsAnalyticsController.getFinancialRatios);
router.get("/financial-ratios", reportsAnalyticsController.getFinancialRatios);
router.get("/debt", reportsAnalyticsController.getDebtAnalysis);
// FIX PERF-REPORTS-001: Apply expensive limiter to forecast endpoint
router.get(
  "/forecast",
  expensiveAnalyticsLimiter,
  reportsAnalyticsController.getForecast,
);

// =========================================================================
// Drilldowns & Custom Charts
// =========================================================================
router.get("/transactions", reportsCustomController.getTransactions);
router.get(
  "/expenses/classification",
  reportsSpendingController.getExpenseClassification,
);
router.get("/goals/progress", reportsCustomController.getGoalsProgress);
router.get(
  "/spending/subcategory",
  reportsSpendingController.getSubcategoryBreakdown,
);
// FIX PERF-REPORTS-001: Apply expensive limiter to custom chart endpoints
router.get(
  "/custom",
  expensiveAnalyticsLimiter,
  reportsCustomController.getCustomChart,
);
router.post(
  "/custom",
  expensiveAnalyticsLimiter,
  reportsCustomController.executeCustomChart,
);

// =========================================================================
// Exports
// =========================================================================
router.get("/exports", reportsExportsController.listExports);
router.post("/exports", reportsExportsController.createExport);
router.get("/exports/:id", reportsExportsController.getExport);

export default router;
