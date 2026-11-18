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
import { NotFoundError } from "../../utils/errorHandler";
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
    linkCallback?: (receiptId: string, transactionId: string, householdId: string, userId: string) => Promise<void>
  ): Promise<{ matched: boolean; transactionId?: string }> {
    const receipt = await receiptRepository.findById(receiptId);
    if (!receipt || receipt.householdId !== householdId) {
      throw new NotFoundError("Receipt not found");
    }

    if (!receipt.ocrData) {
      return { matched: false };
    }

    const ocrData = receipt.ocrData as OcrExtractedData;

    // Need at least amount or date to match
    if (!ocrData.amount && !ocrData.date) {
      await receiptRepository.update(receiptId, {
        matchStatus: "no_match",
        ocrErrorMessage: "Insufficient data for matching (need amount or date)",
      });
      return { matched: false };
    }

    // Build match criteria
    const matchCriteria = buildMatchCriteria(ocrData);

    // Search for matching transactions
    const candidates = (await receiptRepository.findTransactionsForMatch(
      householdId,
      receipt.uploadedBy,
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
      await linkCallback(
        receiptId,
        bestMatch.transaction.id,
        householdId,
        receipt.uploadedBy
      );
      return { matched: true, transactionId: bestMatch.transaction.id };
    }

    // No match - schedule retry
    const attempts = (receipt.matchAttempts || 0) + 1;
    if (attempts < MAX_MATCH_ATTEMPTS) {
      const delayMinutes = RETRY_DELAY_MINUTES[attempts - 1] || 1440;
      const nextMatchAt = new Date(Date.now() + delayMinutes * 60 * 1000);

      await receiptRepository.update(receiptId, {
        matchAttempts: attempts,
        lastMatchAttempt: new Date(),
        nextMatchAt,
      });
    } else {
      await receiptRepository.update(receiptId, {
        matchStatus: "no_match",
        matchAttempts: attempts,
        lastMatchAttempt: new Date(),
      });
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
