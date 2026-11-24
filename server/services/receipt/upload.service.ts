/**
 * Receipt Upload Service
 *
 * Handles receipt file upload, storage, and OCR result processing.
 *
 * @module services/receipt/upload.service
 */

import * as path from "path";
import { randomUUID } from "crypto";
import type { OcrExtractedData } from "@shared/schema";
import { receiptRepository } from "../../repositories/ReceiptRepository";
import { logger } from "../../utils/logger";
import { NotFoundError } from "../../utils/errorHandler";
import { isPostgresError } from "../../utils/postgresError";
import { withTransaction } from "../../utils/withTransaction";
import { businessAuditService } from "../BusinessAuditService";
import {
  validateFile,
  optimizeImage,
  generateThumbnail,
  calculateImageHash,
  preprocessForOcr as doPreprocessForOcr,
  type ReceiptUpload,
} from "./image";
import { sanitizeOcrData, sanitizeText } from "./matching";
import { sanitizeUploadExtension } from "../../core/uploads";
import type { HouseholdContext } from "../../core/authz/implicit-household-context";
import { removeReceiptFile } from "../../core/storage/receipt-files";
import {
  discardUnlessCommitted, discardUploadObject, isDefiniteRollback, putUploadObject, rowCommitted,
  uploadNameOf, UploadStorageError,
} from "../../core/storage/upload-objects";

const RECEIPT_MIME_EXTENSION_MAP = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
} as const;

export class ReceiptUploadService {
  private async getUploadReplay(idempotencyKey: string, actor: HouseholdContext) {
    const replay = await receiptRepository.findUploadReplay(idempotencyKey, actor);
    if (!replay) return undefined;
    if (!replay.receiptId) throw new NotFoundError("Receipt not found");
    return { receiptId: replay.receiptId, isDuplicate: true };
  }

  /**
   * Upload a standalone receipt (not attached to transaction yet)
   */
  async uploadReceipt(
    upload: ReceiptUpload,
    actor: HouseholdContext,
    idempotencyKey?: string,
    ipAddress?: string,
  ): Promise<{
    receiptId: string;
    isDuplicate: boolean;
    duplicateOf?: string;
  }> {
    const { householdId, userId } = actor;
    // The already-uploaded receipt must still be visible to this actor.
    if (idempotencyKey) {
      const replay = await this.getUploadReplay(idempotencyKey, actor);
      if (replay) return replay;
    }

    // Validate file
    await validateFile(upload);

    // Calculate image hash for duplicate detection
    const imageHash = calculateImageHash(upload.buffer);

    // Duplicate detection among the receipts this uploader may read (A-38);
    // a match hidden from them is not a duplicate, and its id never leaves.
    const existingByHash = await receiptRepository.findVisibleByImageHash(actor, imageHash);
    if (existingByHash) {
      return {
        receiptId: existingByHash.id,
        isDuplicate: true,
        duplicateOf: existingByHash.id,
      };
    }

    // Optimize image (resize if too large)
    const optimizedBuffer = await optimizeImage(upload.buffer);
    // A resized image is re-encoded as JPEG: record and serve the bytes' real type.
    const storedMimeType = optimizedBuffer === upload.buffer ? upload.mimeType : "image/jpeg";

    // Generate paths
    const receiptId = randomUUID();
    const ext = sanitizeUploadExtension(
      storedMimeType,
      RECEIPT_MIME_EXTENSION_MAP,
    );
    const filename = `${receiptId}${ext}`;
    const storagePath = path.join("uploads", "receipts", householdId, filename);
    const thumbnailPath = path.join(
      "uploads",
      "receipts",
      householdId,
      `${receiptId}_thumb.jpg`
    );

    // Decode before storing anything, so an undecodable image stores nothing.
    const thumbnail = await generateThumbnail(optimizedBuffer);

    // Store image and thumbnail (OPS-001); the paths stay the logical names the row records.
    await putUploadObject({ stored: storagePath, householdId, purpose: "receipt", bytes: optimizedBuffer, mediaType: storedMimeType, userId });
    try {
      await putUploadObject({ stored: thumbnailPath, householdId, purpose: "receipt-thumbnail", bytes: thumbnail, mediaType: "image/jpeg", userId });
    } catch (error) {
      await discardUploadObject(storagePath, "receipt");
      throw error;
    }

    // Create database record. A rejected insert removes the stored files again;
    // one whose outcome is unknown is re-read, and the files stay unless the
    // insert certainly rolled back (a committed row may name them).
    try {
      await withTransaction(async tx => {
        await receiptRepository.create({
          id: receiptId,
          householdId,
          uploadedBy: userId,
          filename,
          originalFilename: upload.originalFilename,
          mimeType: storedMimeType,
          size: optimizedBuffer.length,
          storagePath,
          thumbnailPath,
          ocrStatus: "pending",
          matchStatus: "pending",
          idempotencyKey: idempotencyKey || undefined,
          imageHash,
          nextMatchAt: new Date(),
        }, tx);
        await businessAuditService.logCreate({
          tx, userId, householdId, entityType: "receipt", entityId: receiptId, ipAddress,
          newValue: { filename: upload.originalFilename, size: upload.size, mimeType: upload.mimeType },
        });
      });
    } catch (error) {
      if (idempotencyKey && isPostgresError(error, "23505", "pending_receipts_idempotency_key_unique")) {
        // The losing insert definitively rolled back. Only the generated paths are ours to remove.
        await discardUploadObject(storagePath, "receipt");
        await discardUploadObject(thumbnailPath, "receipt-thumbnail");
        const replay = await this.getUploadReplay(idempotencyKey, actor);
        if (replay) return replay;
        // The key is unique even across households. Give the same refusal for any unavailable winner.
        throw new NotFoundError("Receipt not found");
      }
      if (!isDefiniteRollback(error) && await rowCommitted(async () => Boolean(await receiptRepository.findById(receiptId)))) {
        return { receiptId, isDuplicate: false };
      }
      await discardUnlessCommitted(storagePath, "receipt", error);
      await discardUnlessCommitted(thumbnailPath, "receipt-thumbnail", error);
      throw error;
    }

    return { receiptId, isDuplicate: false };
  }

  /**
   * Preprocess image for better OCR accuracy
   */
  async preprocessForOcr(buffer: Buffer): Promise<Buffer> {
    return doPreprocessForOcr(buffer);
  }

  /**
   * Store OCR results from client-side processing
   */
  async storeOcrResults(
    receiptId: string,
    actor: HouseholdContext,
    ocrData: OcrExtractedData,
    confidence: number,
    rawText?: string,
    attemptMatch?: (receiptId: string, householdId: string) => Promise<{ matched: boolean; transactionId?: string }>,
    ipAddress?: string,
  ): Promise<{ matched: boolean; transactionId?: string }> {
    // Sanitize extracted data
    const sanitizedData = sanitizeOcrData(ocrData);
    if (rawText) {
      sanitizedData.rawText = sanitizeText(rawText);
    }

    // A-14: the write is bound to the read visibility, in one transaction; a
    // receipt the caller cannot read is a 404, never overwritten.
    const isStored = await receiptRepository.updateVisibleOcrResults(actor, receiptId, {
      ocrStatus: "completed",
      ocrData: sanitizedData,
      ocrConfidence: confidence.toString(),
      ocrProcessedAt: new Date(),
    }, tx => businessAuditService.logUpdate({
      tx, userId: actor.userId, householdId: actor.householdId, entityType: "receipt",
      entityId: receiptId, ipAddress, newValue: { ocrStatus: "completed", ocrConfidence: confidence.toString() },
      metadata: {
        hasAmount: Boolean(ocrData.amount), hasDate: Boolean(ocrData.date),
        hasMerchant: Boolean(ocrData.merchantName), itemsCount: ocrData.lineItems?.length ?? 0,
        hasRawText: Boolean(rawText),
      },
    }));
    if (!isStored) throw new NotFoundError("Receipt not found");

    // Trigger matching attempt if callback provided
    if (attemptMatch) {
      return await attemptMatch(receiptId, actor.householdId);
    }

    return { matched: false };
  }

  /**
   * Delete a pending receipt
   */
  async deleteReceipt(receiptId: string, actor: HouseholdContext, ipAddress?: string): Promise<void> {
    // R6-08: a receipt the caller cannot read is a 404, before any matched check.
    const receipt = await receiptRepository.deleteVisible(actor, receiptId, (tx, removed) =>
      businessAuditService.logDelete({
        tx, userId: actor.userId, householdId: actor.householdId, entityType: "receipt", entityId: receiptId,
        oldValue: { filename: removed.originalFilename }, ipAddress,
      }));
    if (!receipt) throw new NotFoundError("Receipt not found");

    // Delete files (stored objects, or legacy files on the old uploads disk).
    // Each file is attempted on its own. Nothing serves them by name any more
    // (only the receipt routes, through the row that is now gone), and a failed
    // removal keeps its manifest row naming what is left for the sweep.
    // A-28: only the receipt's own files go; see removeReceiptFile.
    for (const kind of ["receipt", "receipt-thumbnail"] as const) {
      const stored = kind === "receipt" ? receipt.storagePath : receipt.thumbnailPath;
      if (!stored) continue;
      try {
        await removeReceiptFile(receipt, kind);
      } catch (err) {
        logger.error("Failed to delete a receipt file; its manifest row names what is left", {
          receiptId, uploadName: uploadNameOf(stored), code: err instanceof UploadStorageError ? err.storageCode : "UNKNOWN",
        });
      }
    }
  }
}

export const receiptUploadService = new ReceiptUploadService();
