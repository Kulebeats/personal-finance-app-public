/**
 * Receipts Module - Routes
 *
 * Receipt upload, OCR, and transaction matching endpoints.
 */

import { Router } from "express";
import multer from "multer";
import { requireAuth, requireRole } from "../../middleware/auth";
import { householdGuard } from "../../middleware/householdGuard";
import { generalLimiter, uploadLimiter } from "../../middleware/rateLimit";
import { receiptsController } from "./receipts.controller";

const router = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
});

// Authentication and household context required for all routes
router.use(requireAuth);
router.use(householdGuard);
router.use(generalLimiter);

// Receipt images (read-only, view_only can access)
router.get("/:id/thumbnail", receiptsController.getThumbnail);
router.get("/:id/ocr-image", receiptsController.getOcrImage);

// List and get receipts (read-only, view_only can access)
router.get("/", receiptsController.list);
router.get("/:id", receiptsController.getById);

// SEC-RBAC-003: Upload with rate limiting and member role required
router.post(
  "/upload",
  requireRole("member"),
  uploadLimiter,
  upload.single("file"),
  receiptsController.upload
);

// SEC-RBAC-004: Receipt mutations require member role
router.post("/:id/match", requireRole("member"), receiptsController.match);
router.post("/:id/ocr-results", requireRole("member"), receiptsController.storeOcrResults);
router.post("/:id/retry-match", requireRole("member"), receiptsController.retryMatch);
router.post("/:id/create-transaction", requireRole("member"), receiptsController.createTransaction);
router.delete("/:id", requireRole("member"), receiptsController.delete);

export default router;
