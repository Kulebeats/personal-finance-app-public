import { transactionRepository } from "../repositories/TransactionRepository";
import { recurringRepository } from "../repositories/RecurringRepository";
import { type Transaction, type RecurringTransaction } from "@shared/schema";
import { logger } from "../utils/logger";
import { Money } from "../core/money";
import type { Frequency } from "../core/calculations/recurring/types";
import type { HouseholdContext } from "../middleware/householdGuard";
import { detectVisiblePatterns } from "./recurring/RecurringPatternSelection";
import { listVisibleRecurringRules } from "./recurring/RecurringAudienceQuery";
import type { PatternSelection } from "@shared/recurring-pattern";

export interface DetectionOptions {
  minOccurrences?: number;
  lookbackMonths?: number;
  confidenceThreshold?: number;
  merchantId?: string;
  categoryId?: string;
}

export interface DetectedPattern {
  name: string;
  type: "income" | "expense";
  merchantId?: string | null;
  estimatedAmount: number | string;
  currency?: string;
  amountTolerance?: number;
  selection?: PatternSelection;
  confirmationIssue?: string;
  amountVariance: number;
  frequency: string;
  dayOfMonth?: number;
  dayOfWeek?: number;
  confidence: number;
  occurrences: number;
  sampleTransactionIds: string[];
  suggestedStartDate: string;
  suggestedNextDueDate: string;
}

export interface MatchResult {
  rule: RecurringTransaction;
  confidence: number;
  matchReasons: string[];
}

export class PatternDetectionService {
  private readonly CONFIDENCE_THRESHOLD = 80;

  /**
   * Detect recurring patterns from transaction history
   */
  async detectPatterns(
    householdId: string,
    options: DetectionOptions = {},
    actor?: HouseholdContext,
  ): Promise<DetectedPattern[]> {
    if (actor) return detectVisiblePatterns(householdId, options, actor);
    const {
      minOccurrences = 3,
      lookbackMonths = 6,
      confidenceThreshold = this.CONFIDENCE_THRESHOLD,
      merchantId,
      categoryId,
    } = options;

    const transactions = await transactionRepository.findForPatternDetection(
      householdId,
      { lookbackMonths, merchantId, categoryId },
      actor,
    );

    const groups = this.groupTransactions(transactions);
    const patterns: DetectedPattern[] = [];

    for (const [, txns] of groups) {
      if (txns.length < minOccurrences) continue;

      const pattern = this.analyzeGroup(txns);
      if (pattern && pattern.confidence >= confidenceThreshold) {
        patterns.push(pattern);
      }
    }

    return patterns.sort((a, b) => b.confidence - a.confidence);
  }

  /**
   * Match a transaction to existing recurring rules
   */
  async matchTransaction(
    transaction: Transaction,
    householdId: string,
    actor?: HouseholdContext,
  ): Promise<MatchResult | null> {
    const rules = actor ? await listVisibleRecurringRules(actor) : await recurringRepository.findByHousehold(householdId);

    let bestMatch: MatchResult | null = null;

    for (const rule of rules) {
      const match = this.matchRule(transaction, rule);
      if (match && (!bestMatch || match.confidence > bestMatch.confidence)) bestMatch = match;
    }

    return bestMatch;
  }

  matchRule(transaction: Transaction, rule: RecurringTransaction): MatchResult | null {
    if (rule.autoLinkEnabled === false || rule.isActive === false || rule.isPaused === true) return null;
    const { confidence, reasons } = this.calculateMatchScore(transaction, rule);
    return confidence >= this.CONFIDENCE_THRESHOLD ? { rule, confidence, matchReasons: reasons } : null;
  }

  /**
   * Group transactions by merchant or normalized name
   */
  private groupTransactions(
    transactions: Transaction[]
  ): Map<string, Transaction[]> {
    const groups = new Map<string, Transaction[]>();

    for (const txn of transactions) {
      const key = txn.merchantId || this.normalizeTransactionName(txn.name);
      if (!groups.has(key)) {
        groups.set(key, []);
      }
      groups.get(key)!.push(txn);
    }

    return groups;
  }

  /**
   * Analyze a group of transactions for recurring pattern
   */
  private analyzeGroup(transactions: Transaction[]): DetectedPattern | null {
    if (transactions.length < 2) return null;

    const sorted = [...transactions].sort(
      (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
    );

    const intervals: number[] = [];
    for (let i = 1; i < sorted.length; i++) {
      const daysDiff = this.daysBetween(sorted[i - 1].date, sorted[i].date);
      intervals.push(daysDiff);
    }

    const frequency = this.detectFrequency(intervals);
    if (!frequency) return null;

    const amounts = sorted.map((t) => Math.abs(new Money(t.amount).toNumber()));
    const avgAmount = amounts.reduce((a, b) => a + b, 0) / amounts.length;
    const variance = this.calculateVariance(amounts, avgAmount);

    const confidence = this.calculateConfidence(
      sorted.length,
      intervals,
      frequency.avgInterval,
      variance
    );

    const dayOfMonth = this.detectDayOfMonth(sorted);
    const dayOfWeek = this.detectDayOfWeek(sorted);

    const lastDate = sorted[sorted.length - 1].date;
    let suggestedNextDate: string;
    try {
      suggestedNextDate = recurringRepository.calculateNextDate(
        lastDate,
        frequency.type as Frequency,
        {
          dayOfMonth,
          dayOfWeek,
        }
      );
    } catch (error) {
      logger.warn("Failed to calculate next due date for pattern", { error });
      return null;
    }

    return {
      name: sorted[0].name,
      type: this.detectType(sorted),
      merchantId: sorted[0].merchantId || null,
      estimatedAmount: Number(avgAmount.toFixed(2)),
      amountVariance: Number(variance.toFixed(2)),
      frequency: frequency.type,
      dayOfMonth,
      dayOfWeek,
      confidence: Math.round(confidence),
      occurrences: sorted.length,
      sampleTransactionIds: sorted.slice(-5).map((t) => t.id),
      suggestedStartDate: sorted[0].date,
      suggestedNextDueDate: suggestedNextDate,
    };
  }

  /**
   * Calculate match score between transaction and recurring rule
   */
  private calculateMatchScore(
    transaction: Transaction,
    rule: RecurringTransaction
  ): { confidence: number; reasons: string[] } {
    let score = 0;
    const reasons: string[] = [];

    if (rule.merchantId && transaction.merchantId === rule.merchantId) {
      score += 30;
      reasons.push("Merchant matches");
    } else if (this.nameSimilarity(transaction.name, rule.name) > 0.85) {
      score += 25;
      reasons.push("Name similar");
    }

    const ruleAmount = new Money(rule.amount);
    const txnAmount = new Money(transaction.amount).abs();

    if (ruleAmount.isPositive()) {
      const tolerance = rule.amountTolerance ?? 5;
      // Calculate percentage difference: (|rule - txn| / rule) * 100
      const diffAmount = ruleAmount.subtract(txnAmount).abs();
      const amountDiff = diffAmount
        .divide(ruleAmount.amount)
        .multiply(100)
        .toNumber();

      if (amountDiff <= tolerance) {
        score += 30;
        reasons.push(`Amount within ${tolerance}% tolerance`);
      } else if (amountDiff <= tolerance * 2) {
        score += 15;
        reasons.push("Amount close");
      }
    }

    const daysDiff = Math.abs(
      this.daysBetween(transaction.date, rule.nextDueDate)
    );
    if (daysDiff <= 3) {
      score += 20;
      reasons.push("Date matches expected");
    } else if (daysDiff <= 7) {
      score += 10;
      reasons.push("Date close to expected");
    }

    if (rule.categoryId && transaction.categoryId === rule.categoryId) {
      score += 10;
      reasons.push("Category matches");
    }

    if (transaction.accountId === rule.accountId) {
      score += 10;
      reasons.push("Account matches");
    }

    return { confidence: Math.min(100, score), reasons };
  }

  /**
   * Detect frequency from intervals
   */
  private detectFrequency(
    intervals: number[]
  ): { type: string; avgInterval: number } | null {
    if (intervals.length === 0) return null;

    const avg = intervals.reduce((a, b) => a + b, 0) / intervals.length;

    const frequencies = [
      { type: "daily", days: 1, tolerance: 0.5 },
      { type: "weekly", days: 7, tolerance: 2 },
      { type: "biweekly", days: 14, tolerance: 3 },
      { type: "monthly", days: 30, tolerance: 5 },
      { type: "quarterly", days: 90, tolerance: 10 },
      { type: "yearly", days: 365, tolerance: 30 },
    ];

    for (const freq of frequencies) {
      if (Math.abs(avg - freq.days) <= freq.tolerance) {
        return { type: freq.type, avgInterval: avg };
      }
    }

    return null;
  }

  /**
   * Calculate confidence score
   */
  private calculateConfidence(
    occurrences: number,
    intervals: number[],
    avgInterval: number,
    amountVariance: number
  ): number {
    const baseScore = Math.min(25, occurrences * 5);
    const intervalVariance = this.calculateVariance(intervals, avgInterval);
    const frequencyScore = Math.max(0, 35 - intervalVariance * 2);
    const amountScore = Math.max(0, 30 - amountVariance * 3);
    const recencyScore = occurrences >= 3 ? 10 : 5;

    return baseScore + frequencyScore + amountScore + recencyScore;
  }

  private detectType(transactions: Transaction[]): "income" | "expense" {
    const counts = transactions.reduce(
      (acc, txn) => {
        acc[txn.type as "income" | "expense"] =
          (acc[txn.type as "income" | "expense"] || 0) + 1;
        return acc;
      },
      { income: 0, expense: 0 }
    );

    return counts.income > counts.expense ? "income" : "expense";
  }

  private daysBetween(date1: string, date2: string): number {
    const d1 = new Date(date1);
    const d2 = new Date(date2);
    return Math.round(
      Math.abs(d2.getTime() - d1.getTime()) / (1000 * 60 * 60 * 24)
    );
  }

  private calculateVariance(values: number[], mean: number): number {
    if (values.length === 0 || mean === 0) return 0;
    const squaredDiffs = values.map((v) =>
      Math.pow(((v - mean) / mean) * 100, 2)
    );
    return Math.sqrt(squaredDiffs.reduce((a, b) => a + b, 0) / values.length);
  }

  private normalizeTransactionName(name: string): string {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "")
      .substring(0, 20);
  }

  private nameSimilarity(name1: string, name2: string): number {
    const n1 = this.normalizeTransactionName(name1);
    const n2 = this.normalizeTransactionName(name2);
    if (n1 === n2) return 1;

    const set1 = new Set(n1.split(""));
    const set2 = new Set(n2.split(""));
    const intersection = new Set([...set1].filter((x) => set2.has(x)));
    const union = new Set([...set1, ...set2]);
    return union.size === 0 ? 0 : intersection.size / union.size;
  }

  private detectDayOfMonth(transactions: Transaction[]): number | undefined {
    const days = transactions.map((t) => new Date(t.date).getUTCDate());
    const counts = new Map<number, number>();

    for (const day of days) {
      counts.set(day, (counts.get(day) || 0) + 1);
    }

    const [mostCommon, count] =
      [...counts.entries()].sort((a, b) => b[1] - a[1])[0] || [];

    if (mostCommon === undefined) return undefined;
    return count >= transactions.length * 0.6 ? mostCommon : undefined;
  }

  private detectDayOfWeek(transactions: Transaction[]): number | undefined {
    const days = transactions.map((t) => new Date(t.date).getUTCDay());
    const counts = new Map<number, number>();

    for (const day of days) {
      counts.set(day, (counts.get(day) || 0) + 1);
    }

    const [mostCommon, count] =
      [...counts.entries()].sort((a, b) => b[1] - a[1])[0] || [];

    if (mostCommon === undefined) return undefined;
    return count >= transactions.length * 0.6 ? mostCommon : undefined;
  }
}

export const patternDetectionService = new PatternDetectionService();
