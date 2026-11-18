/**
 * Receipts Module - Controller
 *
 * HTTP handlers for receipt upload, OCR, and transaction matching.
 * Delegates to ReceiptService for business logic.
 *
 * @module modules/receipts/controller
 */

import { Request, Response, NextFunction } from "express";
import * as fs from "fs/promises";
import * as path from "path";
import { receiptService } from "./receipts.service";
import { logger } from "../../utils/logger";
import { NotFoundError, ValidationError } from "../../utils/errorHandler";
import { businessAuditService } from "../../services/BusinessAuditService";
import {
  matchSchema,
  ocrResultsSchema,
  createTransactionSchema,
  listQuerySchema,
} from "./receipts.validation";

function success<T>(
  res: Response,
  data: T,
  message?: string,
  status = 200
): Response {
  return res.status(status).json({ success: true, data, message });
}

export const receiptsController = {
  /**
   * List pending receipts for the household
   */
  async list(req: Request, res: Response, next: NextFunction) {
    try {
      const { householdId } = req.householdContext!;

      const parseResult = listQuerySchema.safeParse(req.query);
      if (!parseResult.success) {
        throw new ValidationError("Invalid query parameters");
      }

      const { status, search, limit, offset } = parseResult.data;
      const statusFilter = status === "all" ? undefined : status;
      const result = await receiptService.getPendingReceipts(householdId, {
        status: statusFilter,
        search,
        limit,
        offset,
      });
      return res.status(200).json({
        success: true,
        data: result.receipts,
        pagination: {
          total: result.total,
          limit,
          offset,
        },
      });
    } catch (error) {
      logger.error("GET /api/receipts error", {}, error as Error);
      next(error);
    }
  },

  /**
   * Get a specific receipt by ID
   */
  async getById(req: Request, res: Response, next: NextFunction) {
    try {
      const { householdId } = req.householdContext!;
      const { id } = req.params;

      const receipt = await receiptService.getReceipt(id, householdId);
      return success(res, receipt);
    } catch (error) {
      logger.error(
        "GET /api/receipts/:id error",
        { id: req.params.id },
        error as Error
      );
      next(error);
    }
  },

  /**
   * Upload a new receipt image
   */
  async upload(req: Request, res: Response, next: NextFunction) {
    try {
      const { householdId } = req.householdContext!;
      const userId = req.session.userId!;

      if (!req.file) {
        throw new ValidationError("No file uploaded");
      }

      // Get idempotency key from header if provided
      const idempotencyKey = req.headers["x-idempotency-key"] as
        | string
        | undefined;

      const result = await receiptService.uploadReceipt(
        {
          buffer: req.file.buffer,
          originalFilename: req.file.originalname,
          mimeType: req.file.mimetype,
          size: req.file.size,
        },
        householdId,
        userId,
        idempotencyKey
      );

      // Audit log for receipt upload
      if (!result.isDuplicate) {
        await businessAuditService.logCreate({
          userId,
          householdId,
          entityType: "receipt",
          entityId: result.receiptId,
          newValue: {
            filename: req.file.originalname,
            size: req.file.size,
            mimeType: req.file.mimetype,
          },
          ipAddress: businessAuditService.getIpAddress(req),
        });
      }

      return success(
        res,
        {
          receiptId: result.receiptId,
          isDuplicate: result.isDuplicate,
          duplicateOf: result.duplicateOf,
          status: "uploaded",
        },
        result.isDuplicate ? "Duplicate receipt detected" : "Receipt uploaded",
        201
      );
    } catch (error) {
      logger.error("POST /api/receipts/upload error", {}, error as Error);
      next(error);
    }
  },

  /**
   * Match a receipt to an existing transaction
   */
  async match(req: Request, res: Response, next: NextFunction) {
    try {
      const { householdId } = req.householdContext!;
      const userId = req.session.userId!;
      const { id } = req.params;

      const parseResult = matchSchema.safeParse(req.body);
      if (!parseResult.success) {
        throw new ValidationError(
          parseResult.error.errors[0]?.message || "Invalid request"
        );
      }

      await receiptService.linkReceiptToTransaction(
        id,
        parseResult.data.transactionId,
        householdId,
        userId,
        { skipAmountValidation: parseResult.data.skipAmountValidation }
      );

      // Audit log for receipt-transaction link
      await businessAuditService.log({
        userId,
        householdId,
        action: "LINK",
        entityType: "receipt",
        entityId: id,
        details: {
          transactionId: parseResult.data.transactionId,
        },
        ipAddress: businessAuditService.getIpAddress(req),
      });

      return success(res, {
        matched: true,
        receiptId: id,
        transactionId: parseResult.data.transactionId,
      });
    } catch (error) {
      logger.error(
        "POST /api/receipts/:id/match error",
        { id: req.params.id },
        error as Error
      );
      next(error);
    }
  },

  /**
   * Delete a pending receipt
   */
  async delete(req: Request, res: Response, next: NextFunction) {
    try {
      const { householdId } = req.householdContext!;
      const userId = req.session.userId!;
      const { id } = req.params;

      // Get receipt before deletion for audit
      const receipt = await receiptService.getReceipt(id, householdId);

      await receiptService.deleteReceipt(id, householdId);

      // Audit log for receipt deletion
      await businessAuditService.logDelete({
        userId,
        householdId,
        entityType: "receipt",
        entityId: id,
        oldValue: receipt ? { filename: receipt.originalFilename } : undefined,
        ipAddress: businessAuditService.getIpAddress(req),
      });

      return success(res, { deleted: true, id });
    } catch (error) {
      logger.error(
        "DELETE /api/receipts/:id error",
        { id: req.params.id },
        error as Error
      );
      next(error);
    }
  },

  /**
   * Store OCR results from client-side processing
   */
  async storeOcrResults(req: Request, res: Response, next: NextFunction) {
    try {
      const { householdId } = req.householdContext!;
      const userId = req.session.userId!;
      const { id } = req.params;

      const parseResult = ocrResultsSchema.safeParse(req.body);
      if (!parseResult.success) {
        throw new ValidationError(
          parseResult.error.errors[0]?.message || "Invalid OCR data"
        );
      }

      const { confidence, rawText, ...ocrData } = parseResult.data;

      const matchResult = await receiptService.storeOcrResults(
        id,
        householdId,
        ocrData,
        confidence,
        rawText
      );

      await businessAuditService.logUpdate({
        userId,
        householdId,
        entityType: "receipt",
        entityId: id,
        newValue: {
          ocrStatus: "completed",
          ocrConfidence: confidence.toString(),
        },
        metadata: {
          hasAmount: Boolean(ocrData.amount),
          hasDate: Boolean(ocrData.date),
          hasMerchant: Boolean(ocrData.merchantName),
          itemsCount: ocrData.lineItems?.length ?? 0,
          hasRawText: Boolean(rawText),
        },
        ipAddress: businessAuditService.getIpAddress(req),
      });

      if (matchResult.matched && matchResult.transactionId) {
        await businessAuditService.log({
          userId,
          householdId,
          action: "LINK",
          entityType: "receipt",
          entityId: id,
          details: {
            transactionId: matchResult.transactionId,
            method: "auto",
          },
          ipAddress: businessAuditService.getIpAddress(req),
        });
      }

      return success(res, {
        id,
        ocrStored: true,
        autoMatched: matchResult.matched,
        matchedTransactionId: matchResult.transactionId,
      });
    } catch (error) {
      logger.error(
        "POST /api/receipts/:id/ocr-results error",
        { id: req.params.id },
        error as Error
      );
      next(error);
    }
  },

  /**
   * Create a new transaction from receipt data
   */
  async createTransaction(req: Request, res: Response, next: NextFunction) {
    try {
      const { householdId } = req.householdContext!;
      const userId = req.session.userId!;
      const { id } = req.params;

      const parseResult = createTransactionSchema.safeParse(req.body);
      if (!parseResult.success) {
        throw new ValidationError(
          parseResult.error.errors[0]?.message || "Invalid transaction data"
        );
      }

      const result = await receiptService.createTransactionFromReceipt(
        id,
        householdId,
        userId,
        parseResult.data
      );

      // Audit log for transaction creation from receipt
      await businessAuditService.logCreate({
        userId,
        householdId,
        entityType: "transaction",
        entityId: result.transactionId,
        newValue: {
          source: "receipt",
          receiptId: id,
          amount: parseResult.data.amount,
          name: parseResult.data.name,
        },
        ipAddress: businessAuditService.getIpAddress(req),
        metadata: { operation: "createFromReceipt" },
      });

      await businessAuditService.log({
        userId,
        householdId,
        action: "LINK",
        entityType: "receipt",
        entityId: id,
        details: {
          transactionId: result.transactionId,
          method: "create",
        },
        ipAddress: businessAuditService.getIpAddress(req),
      });

      return success(
        res,
        {
          transactionId: result.transactionId,
          receiptId: id,
        },
        "Transaction created from receipt",
        201
      );
    } catch (error) {
      logger.error(
        "POST /api/receipts/:id/create-transaction error",
        { id: req.params.id },
        error as Error
      );
      next(error);
    }
  },

  /**
   * Serve receipt thumbnail for list view
   */
  async getThumbnail(req: Request, res: Response, next: NextFunction) {
    try {
      const { householdId } = req.householdContext!;
      const { id } = req.params;

      const receipt = await receiptService.getReceipt(id, householdId);
      if (!receipt.thumbnailPath) {
        throw new ValidationError("Receipt thumbnail not available");
      }

      const filePath = path.isAbsolute(receipt.thumbnailPath)
        ? receipt.thumbnailPath
        : path.join(process.cwd(), receipt.thumbnailPath);
      try {
        await fs.access(filePath);
      } catch {
        throw new NotFoundError("Receipt thumbnail not found");
      }
      return res.sendFile(filePath);
    } catch (error) {
      logger.error(
        "GET /api/receipts/:id/thumbnail error",
        { id: req.params.id },
        error as Error
      );
      next(error);
    }
  },

  /**
   * Serve receipt image for OCR processing
   */
  async getOcrImage(req: Request, res: Response, next: NextFunction) {
    try {
      const { householdId } = req.householdContext!;
      const { id } = req.params;

      const receipt = await receiptService.getReceipt(id, householdId);
      const filePath = path.isAbsolute(receipt.storagePath)
        ? receipt.storagePath
        : path.join(process.cwd(), receipt.storagePath);
      try {
        await fs.access(filePath);
      } catch {
        throw new NotFoundError("Receipt image not found");
      }
      return res.sendFile(filePath);
    } catch (error) {
      logger.error(
        "GET /api/receipts/:id/ocr-image error",
        { id: req.params.id },
        error as Error
      );
      next(error);
    }
  },

  /**
   * Retry matching a receipt
   */
  async retryMatch(req: Request, res: Response, next: NextFunction) {
    try {
      const { householdId } = req.householdContext!;
      const { id } = req.params;

      const result = await receiptService.attemptMatch(id, householdId);
      return success(res, {
        matched: result.matched,
        transactionId: result.transactionId ?? null,
      });
    } catch (error) {
      logger.error(
        "POST /api/receipts/:id/retry-match error",
        { id: req.params.id },
        error as Error
      );
      next(error);
    }
  },
};
