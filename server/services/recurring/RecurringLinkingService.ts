import {
  recurringTransactions,
  type RecurringTransaction,
  type RecurringTransactionLink,
  type Transaction,
} from "@shared/schema";
import { Money } from "../../core/money";
import { accountRepository } from "../../repositories/AccountRepository";
import { recurringRepository } from "../../repositories/RecurringRepository";
import { transactionRepository } from "../../repositories/TransactionRepository";
import { NotFoundError, ValidationError } from "../../utils/errorHandler";
import { logger } from "../../utils/logger";
import {
  patternDetectionService,
  type DetectedPattern,
} from "../PatternDetectionService";
import type { ConfirmPatternInput } from "../../modules/recurring/recurring.validation";
import { RecurringProcessingService } from "./RecurringProcessingService";
import type {
  Frequency,
  IntervalUnit,
} from "../../core/calculations/recurring/types";
import { withTransaction } from "../../utils/withTransaction";
import { and, eq } from "drizzle-orm";
import { db } from "../../db";

export class RecurringLinkingService extends RecurringProcessingService {
  /**
   * Detect recurring patterns and return suggestions
   */
  async detectAndSuggest(
    householdId: string,
    options?: Parameters<typeof patternDetectionService.detectPatterns>[1],
  ): Promise<DetectedPattern[]> {
    return await patternDetectionService.detectPatterns(householdId, options);
  }

  /**
   * Confirm a detected pattern and create a recurring rule
   */
  async confirmPattern(
    householdId: string,
    pattern: ConfirmPatternInput,
    userId: string,
    accountId: string,
  ): Promise<RecurringTransaction> {
    const account = await accountRepository.findByIdWithVisibility(
      accountId,
      householdId,
      userId,
    );
    if (!account) {
      throw new NotFoundError("Account not found or not accessible");
    }

    const amountVariance = pattern.amountVariance ?? 0;
    const amountTolerance = Math.min(
      50,
      Math.max(0, Math.round(amountVariance)),
    );
    const estimatedMoney = new Money(
      pattern.estimatedAmount.amount,
      pattern.estimatedAmount.currency,
    );

    const rule = await recurringRepository.create({
      householdId,
      accountId,
      name: pattern.name,
      amount: estimatedMoney.toString(),
      amountType: amountTolerance > 0 ? "variable" : "fixed",
      amountTolerance,
      type: pattern.type,
      frequency: pattern.frequency as Frequency,
      startDate: pattern.suggestedStartDate,
      nextDueDate: pattern.suggestedNextDueDate,
      dayOfMonth: pattern.dayOfMonth ?? null,
      dayOfWeek: pattern.dayOfWeek ?? null,
      merchantId: pattern.merchantId ?? null,
      detectionMethod: "suggested",
      detectionConfidence: pattern.confidence,
    });

    await recurringRepository.logHistory({
      recurringTransactionId: rule.id,
      action: "created",
      newState: rule,
      performedBy: userId,
    });

    // PERF: Parallel linking with Promise.allSettled (fixes N+1 pattern)
    const linkResults = await Promise.allSettled(
      pattern.sampleTransactionIds.map((transactionId) =>
        this.linkTransaction(
          rule.id,
          transactionId,
          householdId,
          userId,
          "confirmed",
          pattern.confidence,
        )
      )
    );

    // Log failures (non-blocking, just for observability)
    linkResults.forEach((result, index) => {
      if (result.status === "rejected") {
        logger.warn("Failed to link sample transaction", {
          transactionId: pattern.sampleTransactionIds[index],
          recurringId: rule.id,
          error: result.reason,
        });
      }
    });

    return rule;
  }

  /**
   * Link a transaction to a recurring rule
   * @param userId - Required to check transaction visibility (private transactions only linkable by owner)
   */
  async linkTransaction(
    recurringId: string,
    transactionId: string,
    householdId: string,
    userId: string,
    matchMethod: "auto" | "manual" | "confirmed" = "manual",
    matchConfidence?: number,
    performedBy?: string,
  ): Promise<RecurringTransactionLink> {
    return await withTransaction(async (tx) => {
      // 1. Lock the recurring rule first to serialize requests
      // This ensures no two processes can link to the same rule/transaction simultaneously
      const rules = await tx
        .select()
        .from(recurringTransactions)
        .where(
          and(
            eq(recurringTransactions.id, recurringId),
            eq(recurringTransactions.householdId, householdId),
          ),
        )
        .for("update");

      const rule = rules[0];
      if (!rule) {
        throw new NotFoundError("Recurring rule not found");
      }

      // 2. Checks
      // Use visibility check to prevent linking private transactions by non-owners
      // Note: Visibility check usually doesn't need to lock unless transaction privacy is changing rapidly
      const transaction = await transactionRepository.findByIdWithVisibility(
        transactionId,
        householdId,
        userId,
      );
      if (!transaction) {
        throw new NotFoundError("Transaction not found");
      }

      const existingLink = await recurringRepository.findLinkByTransaction(
        transactionId,
        householdId,
        tx,
      );
      if (existingLink) {
        if (existingLink.recurringTransactionId === recurringId) {
          return existingLink;
        }
        throw new ValidationError(
          "Transaction already linked to a recurring rule",
          [
            {
              field: "transactionId",
              message: "Already linked",
            },
          ],
        );
      }

      // 3. Updates
      const link = await recurringRepository.createLink(
        {
          recurringTransactionId: rule.id,
          transactionId: transaction.id,
          matchMethod,
          matchConfidence,
          expectedDate: rule.nextDueDate,
          actualDate: transaction.date,
          expectedAmount: rule.amount,
          actualAmount: transaction.amount,
          status: "linked",
        },
        tx,
      );

      if (
        !transaction.isRecurring ||
        transaction.recurringTransactionId !== rule.id
      ) {
        await transactionRepository.update(
          transaction.id,
          householdId,
          {
            isRecurring: true,
            recurringTransactionId: rule.id,
          },
          undefined, // expectedUpdatedAt
          tx,
        );
      }

      const lastOccurredDate =
        rule.lastOccurredDate && rule.lastOccurredDate > transaction.date
          ? rule.lastOccurredDate
          : transaction.date;

      const shouldAdvance =
        !rule.nextDueDate || transaction.date >= rule.nextDueDate;
      const nextDueDate = shouldAdvance
        ? recurringRepository.calculateNextDate(
            transaction.date,
            rule.frequency as Frequency,
            {
              dayOfMonth: rule.dayOfMonth || undefined,
              dayOfWeek: rule.dayOfWeek || undefined,
              intervalValue: rule.intervalValue ?? undefined,
              intervalUnit:
                (rule.intervalUnit as IntervalUnit | null) ?? undefined,
            },
          )
        : rule.nextDueDate;

      await recurringRepository.update(
        rule.id,
        householdId,
        {
          totalOccurrences: (rule.totalOccurrences || 0) + 1,
          lastOccurredDate,
          ...(shouldAdvance ? { nextDueDate } : {}),
        },
        tx,
      );

      await recurringRepository.logHistory(
        {
          recurringTransactionId: rule.id,
          action: "linked",
          newState: { matchMethod, matchConfidence },
          linkedTransactionId: transaction.id,
          performedBy,
        },
        tx,
      );

      return link;
    });
  }

  /**
   * Unlink a transaction from a recurring rule
   */
  async unlinkTransaction(
    linkId: string,
    householdId: string,
    performedBy?: string,
  ): Promise<{
    id: string;
    transactionId: string;
    recurringTransactionId: string;
  }> {
    const deleted = await recurringRepository.deleteLink(linkId, householdId);
    if (!deleted) {
      throw new NotFoundError("Link not found");
    }

    const remainingLink = await recurringRepository.findLinkByTransaction(
      deleted.transactionId,
      householdId,
    );

    if (!remainingLink) {
      await transactionRepository.update(deleted.transactionId, householdId, {
        isRecurring: false,
        recurringTransactionId: null,
      });
    }

    await recurringRepository.logHistory({
      recurringTransactionId: deleted.recurringTransactionId,
      action: "unlinked",
      linkedTransactionId: deleted.transactionId,
      performedBy,
    });

    return deleted;
  }

  /**
   * Auto-link a new transaction to a matching recurring rule
   */
  async autoLinkNewTransaction(
    transaction: Transaction,
    householdId: string,
  ): Promise<void> {
    if (
      transaction.isRecurring ||
      transaction.recurringTransactionId ||
      (transaction.type !== "income" && transaction.type !== "expense")
    ) {
      return;
    }

    const match = await patternDetectionService.matchTransaction(
      transaction,
      householdId,
    );
    if (!match) return;

    try {
      // Use transaction owner for visibility check (auto-link uses owner's context)
      // For shared transactions (null owner), use empty string which will be handled by visibility check
      await this.linkTransaction(
        match.rule.id,
        transaction.id,
        householdId,
        transaction.ownerUserId ?? "", // Shared transactions have null ownerUserId
        "auto",
        match.confidence,
      );
    } catch (error) {
      logger.warn("Auto-link failed", {
        transactionId: transaction.id,
        recurringId: match.rule.id,
        error,
      });
    }
  }

  /**
   * Get recurring summary metrics
   */
  async getSummaryData(householdId: string) {
    return await recurringRepository.getSummary(householdId);
  }

  /**
   * Get links for a recurring rule
   */
  async getLinkedTransactions(
    id: string,
    householdId: string,
  ): Promise<RecurringTransactionLink[]> {
    return await recurringRepository.findLinksByRecurring(id, householdId);
  }

  /**
   * Get history for a recurring rule
   */
  async getHistory(id: string, householdId: string, limit: number = 50) {
    return await recurringRepository.findHistory(id, householdId, limit);
  }
}
