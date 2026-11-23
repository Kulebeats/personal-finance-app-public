/**
 * Accounts Routes
 *
 * Express router for account endpoints.
 *
 * @module modules/accounts/accounts.routes
 */

import { requireCapability } from "../../core/authz/requireCapability";
import { Router } from "express";
import { householdGuard } from "../../middleware/householdGuard";
import { requireRole } from "../../middleware/validateEntity";
import { asyncHandler } from "../../utils/errorHandler";
import {
  analyticsLimiter,
  uploadLimiter,
} from "../../middleware/rateLimit";
import { reconcile } from "./accounts.reconciliation.controller";
import { accountsController } from "./accounts.controller";
import { requireStepUp } from "../../middleware/requireStepUp";

const router = Router();

// All account routes require authentication and household membership
router.use(householdGuard);

// ============================================================================
// LIST & SUMMARY - TODO-041: Rate limited
// ============================================================================

router.get("/", asyncHandler(accountsController.list));
router.get(
  "/summary",
  analyticsLimiter,
  asyncHandler(accountsController.getSummary),
);
router.get(
  "/summary/export",
  requireCapability("financial.export"),
  analyticsLimiter,
  asyncHandler(accountsController.exportSummary),
);
router.get(
  "/summary/history",
  analyticsLimiter,
  asyncHandler(accountsController.getNetWorthHistory),
);
// TODO-002: Backward-compatible alias for client calling /net-worth/history
router.get(
  "/net-worth/history",
  analyticsLimiter,
  asyncHandler(accountsController.getNetWorthHistory),
);

// ============================================================================
// CRUD - TODO-041: Rate limited
// ============================================================================

router.get("/:id", asyncHandler(accountsController.getById));
router.post(
  "/",
  requireRole("member"),
  asyncHandler(accountsController.create),
);
router.put(
  "/:id",
  requireRole("member"),
  asyncHandler(accountsController.update),
);
router.delete(
  "/:id",
  requireRole("member"),
  requireStepUp("DESTRUCTIVE"),
  asyncHandler(accountsController.remove),
);

// ============================================================================
// BALANCE OPERATIONS - HIGH-006: Added rate limiting
// ============================================================================

router.post("/:id/reconcile", requireCapability("financial.write"), requireStepUp("FINANCIAL"), asyncHandler(reconcile));
router.post(
  "/:id/adjust-balance",
  requireRole("member"),
  asyncHandler(accountsController.adjustBalance),
);
router.post(
  "/:id/archive",
  requireRole("member"),
  asyncHandler(accountsController.archive),
);
router.post(
  "/:id/unarchive",
  requireRole("member"),
  asyncHandler(accountsController.unarchive),
);

// ============================================================================
// BALANCE HISTORY - HIGH-006: Added rate limiting
// ============================================================================

router.get(
  "/:id/balance-history",
  analyticsLimiter,
  asyncHandler(accountsController.getBalanceHistory),
);
router.get(
  "/:id/balance-history/export",
  requireCapability("financial.export"),
  analyticsLimiter,
  asyncHandler(accountsController.exportBalanceHistory),
);
router.post(
  "/:id/balance-history/import",
  uploadLimiter,
  requireRole("member"),
  asyncHandler(accountsController.importBalanceHistory),
);

// ============================================================================
// TRANSACTIONS IMPORT/EXPORT - TODO-041: Rate limited
// ============================================================================

router.get(
  "/:id/transactions/export",
  requireCapability("financial.export"),
  analyticsLimiter,
  asyncHandler(accountsController.exportTransactions),
);
router.post(
  "/:id/transactions/import",
  uploadLimiter,
  requireRole("member"),
  asyncHandler(accountsController.importTransactions),
);

// ============================================================================
// SETTINGS - HIGH-006: Added rate limiting
// ============================================================================

router.patch(
  "/:id/settings",
  requireRole("member"),
  asyncHandler(accountsController.updateSettings),
);

export default router;
