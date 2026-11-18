/**
 * Receipt Service - Unified Interface
 *
 * Combines all receipt sub-services into a single interface for backward compatibility.
 * Split from monolithic service.ts (586 LOC) into focused modules (2026-02-01).
 *
 * @module services/receipt
 */

import type { OcrExtractedData, PendingReceipt } from "@shared/schema";
import { receiptUploadService } from "./upload.service";
import { receiptMatchingService } from "./matching.service";
import { receiptTransactionService } from "./transaction.service";
import { receiptQueryService } from "./query.service";
import type { ReceiptUpload } from "./image";

export interface ProcessedReceipt {
  id: string;
  ocrData: OcrExtractedData;
  confidence: number;
  matchedTransaction?: {
    id: string;
    name: string;
    amount: string;
    date: string;
  };
  isDuplicate?: boolean;
}

/**
 * Unified Receipt Service
 *
 * Delegates to specialized sub-services while maintaining a single interface.
 */
export class ReceiptService {
  // Upload operations
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
    return receiptUploadService.uploadReceipt(upload, householdId, userId, idempotencyKey);
  }

  async preprocessForOcr(buffer: Buffer): Promise<Buffer> {
    return receiptUploadService.preprocessForOcr(buffer);
  }

  async storeOcrResults(
    receiptId: string,
    householdId: string,
    ocrData: OcrExtractedData,
    confidence: number,
    rawText?: string
  ): Promise<{ matched: boolean; transactionId?: string }> {
    return receiptUploadService.storeOcrResults(
      receiptId,
      householdId,
      ocrData,
      confidence,
      rawText,
      (rId, hId) => this.attemptMatch(rId, hId)
    );
  }

  async deleteReceipt(receiptId: string, householdId: string): Promise<void> {
    return receiptUploadService.deleteReceipt(receiptId, householdId);
  }

  // Matching operations
  async attemptMatch(
    receiptId: string,
    householdId: string
  ): Promise<{ matched: boolean; transactionId?: string }> {
    return receiptMatchingService.attemptMatch(
      receiptId,
      householdId,
      (rId, tId, hId, uId) => this.linkReceiptToTransaction(rId, tId, hId, uId)
    );
  }

  async processMatchingQueue(): Promise<{
    processed: number;
    matched: number;
  }> {
    return receiptMatchingService.processMatchingQueue(
      (receiptId, householdId) => this.attemptMatch(receiptId, householdId)
    );
  }

  // Transaction operations
  async linkReceiptToTransaction(
    receiptId: string,
    transactionId: string,
    householdId: string,
    userId?: string,
    options?: { skipAmountValidation?: boolean }
  ): Promise<void> {
    return receiptTransactionService.linkReceiptToTransaction(
      receiptId,
      transactionId,
      householdId,
      userId,
      options
    );
  }

  async createTransactionFromReceipt(
    receiptId: string,
    householdId: string,
    userId: string,
    data: {
      accountId: string;
      name: string;
      amount: string;
      date: string;
      categoryId?: string;
      notes?: string;
    }
  ): Promise<{ transactionId: string }> {
    return receiptTransactionService.createTransactionFromReceipt(
      receiptId,
      householdId,
      userId,
      data
    );
  }

  // Query operations
  async getReceipt(id: string, householdId: string): Promise<PendingReceipt> {
    return receiptQueryService.getReceipt(id, householdId);
  }

  async getPendingReceipts(
    householdId: string,
    filters?: { status?: string; search?: string; limit?: number; offset?: number }
  ): Promise<{ receipts: PendingReceipt[]; total: number }> {
    return receiptQueryService.getPendingReceipts(householdId, filters);
  }
}

// Export singleton instance for backward compatibility
export const receiptService = new ReceiptService();

// Export sub-services for direct access if needed
export { receiptUploadService } from "./upload.service";
export { receiptMatchingService } from "./matching.service";
export { receiptTransactionService } from "./transaction.service";
export { receiptQueryService } from "./query.service";

// Re-export utilities
export {
  validateFile,
  optimizeImage,
  generateThumbnail,
  preprocessForOcr,
  calculateImageHash,
  type ReceiptUpload,
} from "./image";
export {
  buildMatchCriteria,
  calculateMatchScore,
  calculateStringSimilarity,
  sanitizeOcrData,
  sanitizeText,
  MATCH_AMOUNT_TOLERANCE,
  MATCH_DATE_TOLERANCE_DAYS,
  MAX_MATCH_ATTEMPTS,
  RETRY_DELAY_MINUTES,
  type MatchCriteria,
} from "./matching";
