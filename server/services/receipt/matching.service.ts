/**
 * Receipt Matching Service
 *
 * Handles automatic matching of receipts to existing transactions.
 *
 * @module services/receipt/matching.service
 */

import type { OcrExtractedData, Transaction } from "@shared/schema";
import { receiptRepository } from "../../repositories/ReceiptRepository";
import { logger } from "../../utils/logger";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "../../utils/errorHandler";
import {
  buildMatchCriteria,
  calculateMatchScore,
  MAX_MATCH_ATTEMPTS,
  RETRY_DELAY_MINUTES,
} from "./matching";

type MatchCandidate = Transaction;

type ScoredCandidate = {
  transaction: MatchCandidate;
  score: number;
};

export class ReceiptMatchingService {
  /**
   * Attempt to match receipt to existing transaction
   */
  async attemptMatch(
    receiptId: string,
    householdId: string,
    linkCallback?: (receiptId: string, transactionId: string, householdId: string, userId: string) => Promise<boolean>,
    actorUserId?: string,
    afterOcrCommit = false,
  ): Promise<{ matched: boolean; transactionId?: string }> {
    const receipt = actorUserId
      ? await receiptRepository.findForSignedMatch(receiptId, householdId, actorUserId)
      : await receiptRepository.findById(receiptId);
    if (!receipt || receipt.householdId !== householdId) {
      if (afterOcrCommit) return { matched: false };
      throw new NotFoundError("Receipt not found");
    }

    if (receipt.matchStatus === "matched" || receipt.matchedTransactionId || !receipt.ocrData) {
      return { matched: false };
    }

    const ocrData = receipt.ocrData as OcrExtractedData;

    // Need at least amount or date to match
    if (!ocrData.amount && !ocrData.date) {
      await receiptRepository.updateUnmatchedReceipt(receiptId, householdId, {
        matchStatus: "no_match",
        ocrErrorMessage: "Insufficient data for matching (need amount or date)",
      }, actorUserId);
      return { matched: false };
    }

    // Build match criteria
    const matchCriteria = buildMatchCriteria(ocrData);

    // Search for matching transactions
    const matchingUserId = actorUserId ?? receipt.uploadedBy;
    const candidates = (await receiptRepository.findTransactionsForMatch(
      householdId,
      matchingUserId,
      matchCriteria
    )) as MatchCandidate[];

    // Score candidates
    const scored: ScoredCandidate[] = candidates.map((txn) => ({
      transaction: txn,
      score: calculateMatchScore(ocrData, txn),
    }));

    // Find best match (score >= 0.7)
    const bestMatch = scored
      .filter((s) => s.score >= 0.7)
      .sort((a, b) => b.score - a.score)[0];

    if (bestMatch && linkCallback) {
      try {
        const linked = await linkCallback(receiptId, bestMatch.transaction.id, householdId, matchingUserId);
        return linked ? { matched: true, transactionId: bestMatch.transaction.id } : { matched: false };
      } catch (error: unknown) {
        // Automatic matching follows a committed OCR write. A denied or
        // outdated match leaves the result unmatched without exposing details.
        if (afterOcrCommit && (error instanceof ForbiddenError || error instanceof NotFoundError ||
          error instanceof ConflictError || error instanceof ValidationError)) return { matched: false };
        throw error;
      }
    }

    // No match - schedule retry
    const attempts = (receipt.matchAttempts || 0) + 1;
    if (attempts < MAX_MATCH_ATTEMPTS) {
      const delayMinutes = RETRY_DELAY_MINUTES[attempts - 1] || 1440;
      const nextMatchAt = new Date(Date.now() + delayMinutes * 60 * 1000);

      await receiptRepository.updateUnmatchedReceipt(receiptId, householdId, {
        matchAttempts: attempts,
        lastMatchAttempt: new Date(),
        nextMatchAt,
      }, actorUserId);
    } else {
      await receiptRepository.updateUnmatchedReceipt(receiptId, householdId, {
        matchStatus: "no_match",
        matchAttempts: attempts,
        lastMatchAttempt: new Date(),
      }, actorUserId);
    }

    return { matched: false };
  }

  /**
   * Process background matching jobs (called by cron)
   */
  async processMatchingQueue(
    attemptMatchCallback: (receiptId: string, householdId: string) => Promise<{ matched: boolean; transactionId?: string }>
  ): Promise<{
    processed: number;
    matched: number;
  }> {
    const pendingReceipts = await receiptRepository.findForMatching(50);

    let processed = 0;
    let matched = 0;

    for (const receipt of pendingReceipts) {
      try {
        const result = await attemptMatchCallback(receipt.id, receipt.householdId);
        processed++;
        if (result.matched) matched++;
      } catch (err) {
        logger.error(
          "Failed to process receipt",
          { receiptId: receipt.id },
          err as Error
        );
      }
    }

    return { processed, matched };
  }
}

export const receiptMatchingService = new ReceiptMatchingService();
