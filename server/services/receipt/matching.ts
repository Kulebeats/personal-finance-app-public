/**
 * Receipt Matching Logic
 *
 * Algorithms for matching receipts to transactions.
 *
 * @module services/receipt/matching
 */

import type { OcrExtractedData } from "@shared/schema";
import { Money } from "../../core/money";

// Constants
export const MATCH_AMOUNT_TOLERANCE = 0.5; // $0.50
export const MATCH_DATE_TOLERANCE_DAYS = 3;
export const MAX_MATCH_ATTEMPTS = 5;
export const RETRY_DELAY_MINUTES = [5, 15, 60, 240, 1440]; // Exponential backoff

export interface MatchCriteria {
  amountMin?: number;
  amountMax?: number;
  dateMin?: Date;
  dateMax?: Date;
  merchantPattern?: string;
}

/**
 * Build match criteria from OCR data
 */
export function buildMatchCriteria(ocrData: OcrExtractedData): MatchCriteria {
  const criteria: MatchCriteria = {};

  if (ocrData.amount) {
    const amount = new Money(ocrData.amount);
    criteria.amountMin = amount.subtract(MATCH_AMOUNT_TOLERANCE).toNumber();
    criteria.amountMax = amount.add(MATCH_AMOUNT_TOLERANCE).toNumber();
  }

  if (ocrData.date) {
    const date = new Date(ocrData.date);
    criteria.dateMin = new Date(
      date.getTime() - MATCH_DATE_TOLERANCE_DAYS * 24 * 60 * 60 * 1000
    );
    criteria.dateMax = new Date(
      date.getTime() + MATCH_DATE_TOLERANCE_DAYS * 24 * 60 * 60 * 1000
    );
  }

  if (ocrData.merchantName) {
    criteria.merchantPattern = ocrData.merchantName
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "%");
  }

  return criteria;
}

/**
 * Calculate match score between OCR data and transaction
 */
export function calculateMatchScore(
  ocrData: OcrExtractedData,
  transaction: { name: string; amount: string; date: string }
): number {
  let score = 0;
  let factors = 0;

  // Amount match (40% weight)
  if (ocrData.amount) {
    // Use absolute values for comparison
    const ocrAmount = new Money(ocrData.amount).abs();
    const txnAmount = new Money(transaction.amount).abs();
    const amountDiff = ocrAmount.subtract(txnAmount).abs();
    const tolerance = new Money(MATCH_AMOUNT_TOLERANCE);

    if (amountDiff.isZero()) {
      score += 0.4;
    } else if (amountDiff.lte(tolerance)) {
      // Linear decay: score = 0.4 * (1 - diff / tolerance)
      const diffRatio = amountDiff.toNumber() / tolerance.toNumber();
      score += 0.4 * (1 - diffRatio);
    }
    factors++;
  }

  // Date match (30% weight)
  if (ocrData.date) {
    const ocrDate = new Date(ocrData.date);
    const txnDate = new Date(transaction.date);
    const daysDiff = Math.abs(
      (ocrDate.getTime() - txnDate.getTime()) / (24 * 60 * 60 * 1000)
    );

    if (daysDiff === 0) {
      score += 0.3;
    } else if (daysDiff <= MATCH_DATE_TOLERANCE_DAYS) {
      score += 0.3 * (1 - daysDiff / MATCH_DATE_TOLERANCE_DAYS);
    }
    factors++;
  }

  // Merchant match (30% weight)
  if (ocrData.merchantName) {
    const similarity = calculateStringSimilarity(
      ocrData.merchantName.toLowerCase(),
      transaction.name.toLowerCase()
    );
    score += 0.3 * similarity;
    factors++;
  }

  // Normalize score if not all factors present
  return factors > 0 ? score * (3 / factors) : 0;
}

/**
 * Simple string similarity (Jaccard index on words)
 */
export function calculateStringSimilarity(a: string, b: string): number {
  const wordsA = new Set(a.split(/\s+/).filter((w) => w.length > 2));
  const wordsB = new Set(b.split(/\s+/).filter((w) => w.length > 2));

  if (wordsA.size === 0 || wordsB.size === 0) return 0;

  const intersection = Array.from(wordsA).filter((w) => wordsB.has(w)).length;
  const union = new Set([...Array.from(wordsA), ...Array.from(wordsB)]).size;

  return intersection / union;
}

/**
 * Sanitize OCR data to prevent XSS
 */
export function sanitizeOcrData(data: OcrExtractedData): OcrExtractedData {
  return {
    ...data,
    merchantName: data.merchantName
      ? sanitizeText(data.merchantName)
      : undefined,
    lineItems: data.lineItems?.map((item) => ({
      ...item,
      description: sanitizeText(item.description),
    })),
  };
}

/**
 * Sanitize text to prevent XSS
 */
export function sanitizeText(text: string): string {
  return text
    .replace(/[<>]/g, "")
    .replace(/javascript:/gi, "")
    .trim()
    .slice(0, 1000);
}
