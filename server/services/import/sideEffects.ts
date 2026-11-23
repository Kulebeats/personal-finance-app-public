/**
 * Post-import side effects for CSV import.
 *
 * Extracted from `services/ImportService.ts` during the Rule 2 LOC burn-down;
 * The posting transaction owns each durable creation event.
 *
 * Every step here is best-effort and individually guarded: an imported batch
 * has already been committed by the time this runs, so a failure in rule
 * application, recurring auto-link, or notification must be
 * logged and swallowed rather than surfaced as an import failure. Do not
 * "improve" this by letting these throw.
 */
import type { Transaction } from "@shared/schema";
import { logger } from "../../utils/logger";
import { Money } from "../../core/money";
import { recurringService } from "../RecurringService";
import { ruleService } from "../RuleService";
import { invalidateOnChangeAfterCommit } from "../CacheInvalidation";
import { notificationService } from "../NotificationService";

export async function runPostImportSideEffects(
  transactionsToProcess: Transaction[],
  householdId: string,
  userId: string,
  deletedCount = 0,
): Promise<void> {
  if (transactionsToProcess.length === 0 && deletedCount === 0) {
    return;
  }

  await invalidateOnChangeAfterCommit("transaction", householdId);

  for (const transaction of transactionsToProcess) {
    let processedTransaction = transaction;
    try {
      processedTransaction = await ruleService.applyRules(
        transaction,
        householdId,
        { userId },
      );
    } catch (error) {
      logger.error("Rule application failed for imported transaction", {
        householdId,
        transactionId: transaction.id,
        error,
      });
    }

    try {
      await recurringService.autoLinkNewTransaction(
        processedTransaction,
        householdId,
        userId,
      );
    } catch (error) {
      logger.warn("Auto-linking recurring rule failed for import", {
        transactionId: processedTransaction.id,
        householdId,
        error,
      });
    }

    if (processedTransaction.type === "expense") {
      // notificationService.triggerLargeTransaction takes a numeric threshold
      // comparison value, not a persisted monetary figure, so the Money is
      // converted only at this boundary.
      const value = new Money(
        processedTransaction.amount,
        processedTransaction.currency ?? undefined,
      ).toNumber();
      notificationService
        .triggerLargeTransaction(
          userId,
          householdId,
          processedTransaction.id,
          value,
          processedTransaction.name || "Imported Transaction",
        )
        .catch((error) =>
          logger.error("Failed to trigger import transaction notification", {
            error,
          }),
        );
    }


  }
}
