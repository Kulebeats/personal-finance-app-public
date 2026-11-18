/**
 * Transactions Routes
 *
 * Express router for transaction endpoints.
 * Applies middleware and wires to controller methods.
 *
 * @module modules/transactions/transactions.routes
 */

import {
  Router,
  type Request,
  type Response,
  type NextFunction,
} from "express";
import multer, { MulterError } from "multer";
import * as path from "path";
import * as fs from "fs";
import { randomUUID } from "crypto";
import { householdGuard } from "../../middleware/householdGuard";
import { requireRole, validateEntity } from "../../middleware/validateEntity";
import { generalLimiter } from "../../middleware/rateLimit";
import { asyncHandler } from "../../utils/errorHandler";
import { transactionsController } from "./transactions.controller";
import { transactionsBulkController } from "./transactions.bulk.controller";
import { requireStepUp } from "../../middleware/requireStepUp";
import { sanitizeUploadExtension } from "../../core/uploads";

const router = Router();

const ATTACHMENT_EXTENSION_BY_MIME = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "application/pdf": ".pdf",
} as const;

const ALLOWED_ATTACHMENT_MIME_TYPES = Object.keys(
  ATTACHMENT_EXTENSION_BY_MIME,
);

// All transaction routes require authentication and household membership
router.use(householdGuard);

// Apply rate limiting to all transaction routes (CLAUDE.md Section 12)
router.use(generalLimiter);

// ============================================================================
// CORE TRANSACTION ENDPOINTS
// ============================================================================

/**
 * GET /api/transactions
 * List transactions with pagination and filtering
 */
router.get(
  "/",
  validateEntity({ accountId: true, categoryId: true }),
  asyncHandler(transactionsController.list),
);

/**
 * GET /api/transactions/summary
 * Get income/expense summary for a period
 */
router.get("/summary", asyncHandler(transactionsController.getSummary));

/**
 * GET /api/transactions/:id
 * Get a single transaction by ID
 */
router.get("/:id", asyncHandler(transactionsController.getById));

/**
 * GET /api/transactions/:id/goals
 * Get goal links for a transaction
 */
router.get("/:id/goals", asyncHandler(transactionsController.getGoalLinks));

/**
 * POST /api/transactions
 * Create a new transaction (income/expense)
 */
router.post(
  "/",
  requireRole("member"),
  validateEntity({
    accountId: true,
    categoryId: true,
    merchantId: true,
    checkPrivacy: true,
  }),
  asyncHandler(transactionsController.create),
);

/**
 * POST /api/transactions/transfer
 * Create a transfer (two transactions)
 */
router.post(
  "/transfer",
  requireRole("member"),
  requireStepUp("FINANCIAL"),
  validateEntity({
    accountId: true,
    toAccountId: true,
    checkPrivacy: true,
  }),
  asyncHandler(transactionsController.createTransfer),
);

/**
 * PUT /api/transactions/transfer/:id
 * Update a transfer (both sides)
 */
router.put(
  "/transfer/:id",
  requireRole("member"),
  requireStepUp("FINANCIAL"),
  validateEntity({
    accountId: true,
    toAccountId: true,
    checkPrivacy: true,
  }),
  asyncHandler(transactionsController.updateTransfer),
);

/**
 * PUT /api/transactions/bulk-owner
 * Bulk update transaction ownership
 */
router.put(
  "/bulk-owner",
  requireRole("member"),
  asyncHandler(transactionsBulkController.bulkUpdateOwner),
);

/**
 * PUT /api/transactions/bulk-category
 * Bulk update transaction category
 */
router.put(
  "/bulk-category",
  requireRole("member"),
  asyncHandler(transactionsBulkController.bulkUpdateCategory),
);

/**
 * PUT /api/transactions/bulk-tags
 * Bulk add tags to transactions
 */
router.put(
  "/bulk-tags",
  requireRole("member"),
  asyncHandler(transactionsBulkController.bulkAddTags),
);

/**
 * PUT /api/transactions/bulk-review
 * Bulk mark transactions as reviewed/unreviewed
 */
router.put(
  "/bulk-review",
  requireRole("member"),
  asyncHandler(transactionsBulkController.bulkReview),
);

/**
 * DELETE /api/transactions/bulk
 * Bulk delete transactions
 */
router.delete(
  "/bulk",
  requireRole("member"),
  asyncHandler(transactionsBulkController.bulkDelete),
);

/**
 * PUT /api/transactions/:id
 * Update an existing transaction
 */
router.put(
  "/:id",
  requireRole("member"),
  validateEntity({ categoryId: true, merchantId: true }),
  asyncHandler(transactionsController.update),
);

/**
 * DELETE /api/transactions/:id
 * Soft delete a transaction (with balance reversal)
 */
router.delete(
  "/:id",
  requireRole("member"),
  asyncHandler(transactionsController.remove),
);

/**
 * PUT /api/transactions/:id/owner
 * Update transaction ownership
 */
router.put(
  "/:id/owner",
  requireRole("member"),
  asyncHandler(transactionsController.updateOwner),
);

/**
 * PUT /api/transactions/:id/review
 * Mark transaction as reviewed/unreviewed
 */
router.put(
  "/:id/review",
  requireRole("member"),
  asyncHandler(transactionsController.markReviewed),
);

// ============================================================================
// ATTACHMENT ENDPOINTS
// ============================================================================

// Configure multer for file uploads
const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      const tempDir = path.join(process.cwd(), "uploads", "temp");
      if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
      }
      cb(null, tempDir);
    },
    filename: (req, file, cb) => {
      try {
        const extension = sanitizeUploadExtension(
          file.mimetype,
          ATTACHMENT_EXTENSION_BY_MIME,
        );
        cb(null, `${randomUUID()}${extension}`);
      } catch (error) {
        cb(error as Error, "");
      }
    },
  }),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB max
  fileFilter: (req, file, cb) => {
    if (ALLOWED_ATTACHMENT_MIME_TYPES.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error("Invalid file type. Allowed: JPEG, PNG, PDF"));
    }
  },
});

/**
 * POST /api/transactions/:id/attachments
 * Upload an attachment to a transaction
 */
router.post(
  "/:id/attachments",
  requireRole("member"),
  upload.single("file"),
  asyncHandler(transactionsController.uploadAttachment),
);

/**
 * GET /api/transactions/:id/attachments
 * List all attachments for a transaction
 */
router.get(
  "/:id/attachments",
  asyncHandler(transactionsController.listAttachments),
);

/**
 * GET /api/transactions/:id/attachments/:attachmentId/download
 * Download an attachment
 */
router.get(
  "/:id/attachments/:attachmentId/download",
  asyncHandler(transactionsController.downloadAttachment),
);

/**
 * DELETE /api/transactions/:id/attachments/:attachmentId
 * Delete an attachment
 */
router.delete(
  "/:id/attachments/:attachmentId",
  requireRole("member"),
  asyncHandler(transactionsController.deleteAttachment),
);

// ============================================================================
// MULTER ERROR HANDLER
// ============================================================================

router.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  if (err instanceof MulterError) {
    let message = "File upload error";
    let code = "UPLOAD_ERROR";

    switch (err.code) {
      case "LIMIT_FILE_SIZE":
        message = "File too large. Maximum size is 5MB";
        code = "FILE_TOO_LARGE";
        break;
      case "LIMIT_UNEXPECTED_FILE":
        message = "Unexpected field name for file upload";
        code = "UNEXPECTED_FIELD";
        break;
    }

    return res.status(400).json({
      success: false,
      error: { code, message },
    });
  }

  if (err.message?.includes("Invalid file type")) {
    return res.status(400).json({
      success: false,
      error: {
        code: "INVALID_FILE_TYPE",
        message: err.message,
      },
    });
  }

  next(err);
});

export default router;
