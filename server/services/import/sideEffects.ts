/**
 * Post-import side effects for CSV import.
 *
 * Extracted from `services/ImportService.ts` during the Rule 2 LOC burn-down;
 * moved verbatim, no behaviour change.
 *
 * Every step here is best-effort and individually guarded: an imported batch
 * has already been committed by the time this runs, so a failure in rule
 * application, recurring auto-link, notification, or event publication must be
 * logged and swallowed rather than surfaced as an import failure. Do not
 * "improve" this by letting these throw.
 */
import type { Transaction } from "@shared/schema";
import { logger } from "../../utils/logger";
import { Money } from "../../core/money";
import { recurringService } from "../RecurringService";
import { ruleService } from "../RuleService";
import { invalidateOnChange } from "../CacheInvalidation";
import { EventTypes, outboxEventService } from "../../core/events";
import { notificationService } from "../NotificationService";

export async function runPostImportSideEffects(
  transactionsToProcess: Transaction[],
  householdId: string,
  userId: string,
): Promise<void> {
  if (transactionsToProcess.length === 0) {
    return;
  }

  await invalidateOnChange("transaction", householdId);

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

    outboxEventService
      .publish({
        eventType: EventTypes.TRANSACTION_CREATED,
        aggregateType: "transaction",
        aggregateId: processedTransaction.id,
        householdId,
        payload: {
          id: processedTransaction.id,
          type: processedTransaction.type,
          amount: String(processedTransaction.amount),
          accountId: processedTransaction.accountId,
        },
      })
      .catch((error) =>
        logger.error("Failed to publish import transaction event", {
          error,
        }),
      );
  }
}
