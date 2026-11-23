/**
 * Goals Routes
 *
 * Express router for goal endpoints.
 * Consolidates routes for all goal-related operations.
 *
 * @module modules/goals/goals.routes
 */

import { Router } from "express";
import multer from "multer";
import { householdGuard } from "../../middleware/householdGuard";
import { requireRole } from "../../middleware/validateEntity";
import { requireCapability } from "../../core/authz/requireCapability";
import { analyticsLimiter } from "../../middleware/rateLimit";
import { asyncHandler } from "../../utils/errorHandler";
import { goalsController } from "./goals.controller";

const router = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
});

router.use(householdGuard);


// ============================================================================
// GLOBAL ENDPOINTS (before :id routes)
// ============================================================================

router.get("/summary", asyncHandler(goalsController.getSummary));
router.get("/images", asyncHandler(goalsController.getImages));
router.post(
  "/images",
  requireRole("member"),
  upload.single("file"),
  asyncHandler(goalsController.uploadImage)
);
router.get("/available-funds", analyticsLimiter, asyncHandler(goalsController.getAvailableFunds));
router.get("/assignments", analyticsLimiter, asyncHandler(goalsController.getAllAssignments));
router.get("/transfers", asyncHandler(goalsController.getTransfers));
router.post(
  "/transfers",
  requireRole("member"),
  asyncHandler(goalsController.createTransfer)
);
router.post(
  "/debt-strategy",
  requireCapability("financial.read"),
  asyncHandler(goalsController.calculateDebtStrategy)
);
router.post(
  "/calculate-projection",
  requireCapability("financial.read"),
  asyncHandler(goalsController.calculateProjection)
);

// ============================================================================
// GOAL CRUD
// ============================================================================

router.get("/", asyncHandler(goalsController.list));
router.post("/", requireRole("member"), asyncHandler(goalsController.create));
router.get("/:id", asyncHandler(goalsController.getById));
router.put("/:id", requireRole("member"), asyncHandler(goalsController.update));
router.delete(
  "/:id",
  requireRole("member"),
  asyncHandler(goalsController.remove)
);
router.post(
  "/:id/complete",
  requireRole("member"),
  asyncHandler(goalsController.completeGoal)
);
router.post(
  "/:id/archive",
  requireRole("member"),
  asyncHandler(goalsController.archiveGoal)
);
router.post(
  "/:id/unarchive",
  requireRole("member"),
  asyncHandler(goalsController.unarchiveGoal)
);

// ============================================================================
// ACCOUNT ASSIGNMENTS
// ============================================================================

router.get("/:id/assignments", asyncHandler(goalsController.getAssignments));
router.post(
  "/:id/assign-account",
  requireRole("member"),
  asyncHandler(goalsController.assignAccount)
);
router.put(
  "/:id/accounts/:accountId",
  requireRole("member"),
  asyncHandler(goalsController.updateAssignment)
);
router.delete(
  "/:id/accounts/:accountId",
  requireRole("member"),
  asyncHandler(goalsController.removeAssignment)
);

// ============================================================================
// TRANSFERS & TRANSACTIONS
// ============================================================================

router.get("/:id/transfers", asyncHandler(goalsController.getGoalTransfers));
router.get("/:id/transactions", asyncHandler(goalsController.getGoalTransactions));
router.get("/:id/projection", asyncHandler(goalsController.getProjection));
router.get("/:id/contributions", asyncHandler(goalsController.getContributions));
router.post("/:id/contribute", requireRole("member"), asyncHandler(goalsController.addContribution));
router.post("/:id/contributions/from-account", requireRole("member"), asyncHandler(goalsController.contributeFromAccount));
router.post("/:id/contributions/:contributionId/reverse", requireRole("member"), asyncHandler(goalsController.reverseContribution));
router.post(
  "/:id/transactions",
  requireRole("member"),
  asyncHandler(goalsController.linkTransaction)
);
router.delete(
  "/:id/transactions/:txId",
  requireRole("member"),
  asyncHandler(goalsController.unlinkTransaction)
);
router.get("/:id/payoff-scenarios", asyncHandler(goalsController.getPayoffScenarios));
router.post(
  "/:id/calculate-payoff",
  requireRole("member"),
  asyncHandler(goalsController.calculatePayoff)
);

// ============================================================================
// ACTIVITY
// ============================================================================

router.get("/:id/activity", asyncHandler(goalsController.getActivity));

export default router;
