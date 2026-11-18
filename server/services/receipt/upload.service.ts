/**
 * Receipt Upload Service
 *
 * Handles receipt file upload, storage, and OCR result processing.
 *
 * @module services/receipt/upload.service
 */

import * as fs from "fs/promises";
import * as path from "path";
import { randomUUID } from "crypto";
import type { OcrExtractedData } from "@shared/schema";
import { receiptRepository } from "../../repositories/ReceiptRepository";
import { logger } from "../../utils/logger";
import { NotFoundError, ValidationError } from "../../utils/errorHandler";
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

const RECEIPT_MIME_EXTENSION_MAP = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
} as const;

export class ReceiptUploadService {
  /**
   * Upload a standalone receipt (not attached to transaction yet)
   */
  async uploadReceipt(
    upload: ReceiptUpload,
    householdId: string,
    userId: string,
    idempotencyKey?: string
  ): Promise<{
    receiptId: string;
    isDuplicate: boolean;
    duplicateOf?: string;
  }> {
    // FIX SEC-RECEIPTS-001: Scope idempotency check to household
    if (idempotencyKey) {
      const existing = await receiptRepository.findByIdempotencyKey(
        idempotencyKey,
        householdId
      );
      if (existing) {
        return { receiptId: existing.id, isDuplicate: true };
      }
    }

    // Validate file
    await validateFile(upload);

    // Calculate image hash for duplicate detection
    const imageHash = calculateImageHash(upload.buffer);

    // Check for duplicate receipt in household
    const existingByHash = await receiptRepository.findByImageHash(
      householdId,
      imageHash
    );
    if (existingByHash) {
      return {
        receiptId: existingByHash.id,
        isDuplicate: true,
        duplicateOf: existingByHash.id,
      };
    }

    // Optimize image (resize if too large)
    const optimizedBuffer = await optimizeImage(upload.buffer);

    // Generate paths
    const receiptId = randomUUID();
    const ext = sanitizeUploadExtension(
      upload.mimeType,
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

    // Ensure directory exists
    await fs.mkdir(path.dirname(storagePath), { recursive: true });

    // Save optimized file
    await fs.writeFile(storagePath, optimizedBuffer);

    // Generate thumbnail
    await generateThumbnail(optimizedBuffer, thumbnailPath);

    // Create database record
    const receipt = await receiptRepository.create({
      id: receiptId,
      householdId,
      uploadedBy: userId,
      filename,
      originalFilename: upload.originalFilename,
      mimeType: upload.mimeType,
      size: optimizedBuffer.length,
      storagePath,
      thumbnailPath,
      ocrStatus: "pending",
      matchStatus: "pending",
      idempotencyKey,
      imageHash,
      nextMatchAt: new Date(),
    });

    return { receiptId: receipt.id, isDuplicate: false };
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
    householdId: string,
    ocrData: OcrExtractedData,
    confidence: number,
    rawText?: string,
    attemptMatch?: (receiptId: string, householdId: string) => Promise<{ matched: boolean; transactionId?: string }>
  ): Promise<{ matched: boolean; transactionId?: string }> {
    // Verify ownership
    const receipt = await receiptRepository.findById(receiptId);
    if (!receipt || receipt.householdId !== householdId) {
      throw new NotFoundError("Receipt not found");
    }

    // Sanitize extracted data
    const sanitizedData = sanitizeOcrData(ocrData);
    if (rawText) {
      sanitizedData.rawText = sanitizeText(rawText);
    }

    // Update receipt
    await receiptRepository.update(receiptId, {
      ocrStatus: "completed",
      ocrData: sanitizedData,
      ocrConfidence: confidence.toString(),
      ocrProcessedAt: new Date(),
    });

    // Trigger matching attempt if callback provided
    if (attemptMatch) {
      return await attemptMatch(receiptId, householdId);
    }

    return { matched: false };
  }

  /**
   * Delete a pending receipt
   */
  async deleteReceipt(receiptId: string, householdId: string): Promise<void> {
    const receipt = await receiptRepository.findById(receiptId);
    if (!receipt || receipt.householdId !== householdId) {
      throw new NotFoundError("Receipt not found");
    }

    if (receipt.matchStatus === "matched") {
      throw new ValidationError(
        "Cannot delete matched receipt. Delete the transaction attachment instead."
      );
    }

    // Delete files
    try {
      await fs.unlink(receipt.storagePath);
      if (receipt.thumbnailPath) {
        await fs.unlink(receipt.thumbnailPath);
      }
    } catch (err) {
      logger.warn("Failed to delete receipt files", {
        receiptId,
        error: String(err),
      });
    }

    await receiptRepository.delete(receiptId);
  }
}

export const receiptUploadService = new ReceiptUploadService();
