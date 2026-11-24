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

/**
 * Who asked for the match: a member's request, the automatic match after an
 * OCR write commits, or the scheduled queue (receipts.match).
 */
export type MatchOrigin = "request" | "after-ocr" | "queue";

/** A link refused for this receipt (access lost, transaction changed), not a fault. */
const isRefusedLink = (error: unknown): boolean => error instanceof ForbiddenError ||
  error instanceof NotFoundError || error instanceof ConflictError || error instanceof ValidationError;

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
    origin: MatchOrigin = "request",
  ): Promise<{ matched: boolean; transactionId?: string }> {
    const receipt = actorUserId
      ? await receiptRepository.findForSignedMatch(receiptId, householdId, actorUserId)
      : await receiptRepository.findById(receiptId);
    if (!receipt || receipt.householdId !== householdId) {
      if (origin === "after-ocr") return { matched: false };
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
        if (origin === "request" || !isRefusedLink(error)) throw error;
        // Automatic matching follows a committed OCR write. A denied or
        // outdated match leaves the result unmatched without exposing details.
        if (origin === "after-ocr") return { matched: false };
        // The queue counts a refused link as an unmatched attempt below, so the
        // receipt reaches no_match instead of failing every daily run.
        logger.warn("Receipt match: link refused, retry scheduled", { receiptId });
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
   * Process the background matching queue (the scheduled job receipts.match).
   * A receipt whose match attempt throws is counted in `failed`, so the run
   * reports a partial failure instead of a success.
   */
  async processMatchingQueue(
    attemptMatchCallback: (receiptId: string, householdId: string) => Promise<{ matched: boolean; transactionId?: string }>
  ): Promise<MatchingQueueTotals> {
    const pendingReceipts = await receiptRepository.findForMatching(50);

    let processed = 0;
    let matched = 0;
    let failed = 0;

    for (const receipt of pendingReceipts) {
      try {
        const result = await attemptMatchCallback(receipt.id, receipt.householdId);
        processed++;
        if (result.matched) matched++;
      } catch (err) {
        failed++;
        logger.error(
          "Failed to process receipt",
          { receiptId: receipt.id },
          err instanceof Error ? err : new Error(String(err))
        );
      }
    }

    return { processed, matched, failed };
  }
}

// A type alias (not an interface) so the totals stay assignable to JobSummary's index signature.
export type MatchingQueueTotals = { readonly processed: number; readonly matched: number; readonly failed: number };

export const receiptMatchingService = new ReceiptMatchingService();
