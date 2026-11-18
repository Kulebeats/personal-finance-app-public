/**
 * Accounts Routes
 *
 * Express router for account endpoints.
 *
 * @module modules/accounts/accounts.routes
 */

import { Router } from "express";
import { householdGuard } from "../../middleware/householdGuard";
import { requireRole } from "../../middleware/validateEntity";
import { asyncHandler } from "../../utils/errorHandler";
import {
  generalLimiter,
  analyticsLimiter,
  uploadLimiter,
} from "../../middleware/rateLimit";
import { accountsController } from "./accounts.controller";
import { requireStepUp } from "../../middleware/requireStepUp";

const router = Router();

// All account routes require authentication and household membership
router.use(householdGuard);

// ============================================================================
// LIST & SUMMARY - TODO-041: Rate limited
// ============================================================================

router.get("/", generalLimiter, asyncHandler(accountsController.list));
router.get(
  "/summary",
  analyticsLimiter,
  asyncHandler(accountsController.getSummary),
);
router.get(
  "/summary/export",
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

router.get("/:id", generalLimiter, asyncHandler(accountsController.getById));
router.post(
  "/",
  generalLimiter,
  requireRole("member"),
  asyncHandler(accountsController.create),
);
router.put(
  "/:id",
  generalLimiter,
  requireRole("member"),
  asyncHandler(accountsController.update),
);
router.delete(
  "/:id",
  generalLimiter,
  requireRole("member"),
  requireStepUp("DESTRUCTIVE"),
  asyncHandler(accountsController.remove),
);

// ============================================================================
// BALANCE OPERATIONS - HIGH-006: Added rate limiting
// ============================================================================

router.post(
  "/:id/adjust-balance",
  generalLimiter,
  requireRole("member"),
  asyncHandler(accountsController.adjustBalance),
);
router.post(
  "/:id/archive",
  generalLimiter,
  requireRole("member"),
  asyncHandler(accountsController.archive),
);
router.post(
  "/:id/unarchive",
  generalLimiter,
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
  generalLimiter,
  requireRole("member"),
  asyncHandler(accountsController.updateSettings),
);

export default router;
