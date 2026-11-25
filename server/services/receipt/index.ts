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
import { receiptMatchingService, type MatchingQueueTotals, type MatchOrigin } from "./matching.service";
import { receiptTransactionService, type ReceiptLinkOptions } from "./transaction.service";
import { receiptQueryService } from "./query.service";
import type { ReceiptUpload } from "./image";
import type { HouseholdContext } from "../../core/authz/implicit-household-context";

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
    actor: HouseholdContext,
    idempotencyKey?: string,
    ipAddress?: string,
  ): Promise<{
    receiptId: string;
    isDuplicate: boolean;
    duplicateOf?: string;
  }> {
    return receiptUploadService.uploadReceipt(upload, actor, idempotencyKey, ipAddress);
  }

  async preprocessForOcr(buffer: Buffer): Promise<Buffer> {
    return receiptUploadService.preprocessForOcr(buffer);
  }

  async storeOcrResults(
    receiptId: string,
    actor: HouseholdContext,
    ocrData: OcrExtractedData,
    confidence: number,
    rawText?: string,
    ipAddress?: string,
  ): Promise<{ matched: boolean; transactionId?: string }> {
    return receiptUploadService.storeOcrResults(
      receiptId,
      actor,
      ocrData,
      confidence,
      rawText,
      (rId, hId) => this.attemptMatch(rId, hId, actor.userId, "after-ocr", ipAddress),
      ipAddress,
    );
  }

  async deleteReceipt(receiptId: string, actor: HouseholdContext, ipAddress?: string): Promise<void> {
    return receiptUploadService.deleteReceipt(receiptId, actor, ipAddress);
  }

  // Matching operations
  async attemptMatch(
    receiptId: string,
    householdId: string,
    actorUserId?: string,
    origin: MatchOrigin = "request",
    ipAddress?: string,
  ): Promise<{ matched: boolean; transactionId?: string }> {
    return receiptMatchingService.attemptMatch(
      receiptId,
      householdId,
      (rId, tId, hId, uId) => this.linkReceiptToTransaction(rId, tId, hId, uId, { origin, ipAddress }),
      actorUserId,
      origin,
    );
  }

  async processMatchingQueue(): Promise<MatchingQueueTotals> {
    return receiptMatchingService.processMatchingQueue(
      (receiptId, householdId) => this.attemptMatch(receiptId, householdId, undefined, "queue")
    );
  }

  // Transaction operations
  async linkReceiptToTransaction(
    receiptId: string,
    transactionId: string,
    householdId: string,
    userId?: string,
    options?: ReceiptLinkOptions,
  ): Promise<boolean> {
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
    },
    auditContext?: { ipAddress?: string },
  ): Promise<{ transactionId: string; replayed: boolean }> {
    return receiptTransactionService.createTransactionFromReceipt(
      receiptId,
      householdId,
      userId,
      data,
      auditContext,
    );
  }

  // Query operations
  async getReceipt(id: string, householdId: string): Promise<PendingReceipt> {
    return receiptQueryService.getReceipt(id, householdId);
  }

  async getVisibleReceipt(id: string, actor: HouseholdContext): Promise<PendingReceipt> {
    return receiptQueryService.getVisibleReceipt(id, actor);
  }

  async getPendingReceipts(
    actor: HouseholdContext,
    filters?: { status?: string; search?: string; limit?: number; offset?: number }
  ): Promise<{ receipts: PendingReceipt[]; total: number }> {
    return receiptQueryService.getPendingReceipts(actor, filters);
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
