/**
 * Recurring Module - Routes
 *
 * Express router for recurring transaction rules.
 *
 * @module modules/recurring/routes
 */

import { Router } from "express";
import { householdGuard } from "../../middleware/householdGuard";
import { requireRole } from "../../middleware/validateEntity";
import { generalLimiter, analyticsLimiter } from "../../middleware/rateLimit";
import { recurringController } from "./recurring.controller";

const router = Router();

// All routes require auth and household context
router.use(householdGuard);

// Apply general rate limiting to all routes
router.use(generalLimiter);

// =========================================================================
// Query Routes (before :id to avoid conflicts)
// =========================================================================
router.get("/", recurringController.list);
router.get("/upcoming", recurringController.getUpcoming);
router.get("/summary", analyticsLimiter, recurringController.getSummary);

// =========================================================================
// Batch Processing
// =========================================================================
router.post(
  "/process",
  analyticsLimiter,
  requireRole("member"),
  recurringController.processRecurring,
);

// =========================================================================
// Pattern Detection (member role)
// =========================================================================
router.post(
  "/detect",
  analyticsLimiter,
  requireRole("member"),
  recurringController.detectPatterns,
);
router.post(
  "/confirm",
  requireRole("member"),
  recurringController.confirmPattern,
);

// =========================================================================
// Create New Rule
// =========================================================================
router.post("/", requireRole("member"), recurringController.create);

// =========================================================================
// Individual Rule Routes
// =========================================================================
router.get("/:id", recurringController.getById);
router.put("/:id", requireRole("member"), recurringController.update);
router.delete("/:id", requireRole("member"), recurringController.delete);
router.get("/:id/history", recurringController.getHistory);
router.get("/:id/transactions", recurringController.getLinkedTransactions);

// =========================================================================
// Lifecycle Actions
// =========================================================================
router.post("/:id/skip", requireRole("member"), recurringController.skip);
router.post("/:id/pause", requireRole("member"), recurringController.pause);
router.post("/:id/resume", requireRole("member"), recurringController.resume);
router.post("/:id/end", requireRole("member"), recurringController.end);

// =========================================================================
// Transaction Linking
// =========================================================================
router.post(
  "/:id/link",
  requireRole("member"),
  recurringController.linkTransaction,
);
router.delete(
  "/:id/link/:linkId",
  requireRole("member"),
  recurringController.unlinkTransaction,
);

// =========================================================================
// Create from Transaction
// =========================================================================
router.post(
  "/transaction",
  requireRole("member"),
  recurringController.createWithTransaction,
);
router.post(
  "/transaction/:transactionId",
  requireRole("member"),
  recurringController.createFromTransaction,
);

export default router;
