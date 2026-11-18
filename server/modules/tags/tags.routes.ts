/**
 * Tags Module - Routes
 */

import { Router } from "express";
import { householdGuard } from "../../middleware/householdGuard";
import { requireRole } from "../../middleware/validateEntity";
import { generalLimiter } from "../../middleware/rateLimit";
import { tagsController } from "./tags.controller";

const router = Router();
router.use(householdGuard);
router.use(generalLimiter);

// Tag analytics (must be before /:id routes)
router.get("/analytics", tagsController.getAnalytics);

// Tag suggestions (P3: must be before /:id routes)
router.get("/suggest", tagsController.suggestTags);

// Tag operations (must be before /:id routes)
router.post("/merge", requireRole("member"), tagsController.mergeTags);

// Default tags creation (P3: must be before /:id routes)
router.post("/defaults", requireRole("member"), tagsController.createDefaults);

// Tag CRUD
router.get("/", tagsController.list);
router.get("/:id", tagsController.getById);
router.post("/", requireRole("member"), tagsController.create);
router.put("/:id", requireRole("member"), tagsController.update);
router.delete("/:id", requireRole("member"), tagsController.delete);

// Tag archive (must be after CRUD)
router.post("/:id/archive", requireRole("member"), tagsController.archiveTag);

// Tag transactions (must be before transaction routes)
router.get("/:id/transactions", tagsController.getTagTransactions);

// Transaction tags
router.get("/transaction/:transactionId", tagsController.getTransactionTags);
router.post(
  "/transaction/:transactionId",
  requireRole("member"),
  tagsController.addTransactionTags
);
router.put(
  "/transaction/:transactionId",
  requireRole("member"),
  tagsController.setTransactionTags
);
router.delete(
  "/transaction/:transactionId/:tagId",
  requireRole("member"),
  tagsController.removeTransactionTag
);

export default router;
