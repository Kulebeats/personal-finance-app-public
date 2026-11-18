/**
 * Transaction Creation Service
 *
 * Handles transaction creation with idempotency support.
 *
 * @module services/transaction/create
 */

import { transactionRepository } from "../../repositories/TransactionRepository";
import { accountRepository } from "../../repositories/AccountRepository";
import { categoryRepository } from "../../repositories/CategoryRepository";
import { merchantRepository } from "../../repositories/MerchantRepository";
import { type Transaction, type InsertTransaction } from "@shared/schema";
import { NotFoundError, ValidationError } from "../../utils/errorHandler";
import { logger } from "../../utils/logger";
import { invalidateOnChange } from "../CacheInvalidation";
import { ruleService } from "../RuleService";
import { recurringService } from "../RecurringService";
import {
  ensureMerchantAlias,
  resolveMerchantMatch,
} from "../merchantRecognition";
import { notificationService } from "../NotificationService";
import { outboxEventService, EventTypes } from "../../core/events";
import { Money } from "../../core/money";
import { isPostgresError } from "../../utils/postgresError";

/**
 * Create a transaction with idempotency support
 */
export async function createTransaction(
  data: Omit<InsertTransaction, "householdId" | "ownerUserId"> & {
    splits?: {
      amount: string;
      categoryId?: string | null;
      merchantId?: string | null;
      notes?: string | null;
    }[];
  },
  householdId: string,
  userId: string,
  idempotencyKey?: string,
  auditContext?: { ipAddress?: string },
): Promise<{ transaction: Transaction; isDuplicate: boolean }> {
  // Check idempotency key if provided
  if (idempotencyKey) {
    const existing = await transactionRepository.findByIdempotencyKey(
      idempotencyKey,
      householdId,
    );
    if (existing) {
      logger.info("Duplicate transaction detected", { householdId });
      return { transaction: existing, isDuplicate: true };
    }
  }

  // Verify account exists and is accessible
  const account = await accountRepository.findByIdWithVisibility(
    data.accountId,
    householdId,
    userId,
  );

  if (!account) {
    throw new NotFoundError("Account not found");
  }

  // Enforce strict currency matching: transaction currency must match account currency
  // Cross-currency flows are only allowed through transfers with FX rate tracking
  if (data.currency && data.currency !== account.currency) {
    throw new ValidationError(
      "Transaction currency must match account currency",
      [
        { field: "currency", message: `Expected ${account.currency}, got ${data.currency}. Use transfers for cross-currency flows.` },
      ],
    );
  }

  // Validate transaction type
  const validTypes = ["income", "expense", "transfer", "balance_adjustment"];
  if (!validTypes.includes(data.type)) {
    throw new ValidationError("Invalid transaction type", [
      { field: "type", message: `Must be one of: ${validTypes.join(", ")}` },
    ]);
  }

  // Prevent direct transfer creation (use createTransfer instead)
  if (data.type === "transfer") {
    throw new ValidationError(
      "Use POST /api/transactions/transfer to create transfers",
      [
        { field: "type", message: "Transfers require source and destination accounts" },
      ],
    );
  }

  // Validate split sum if splits exist
  if (data.splits && data.splits.length > 0) {
    const totalAmount = new Money(data.amount);
    const splitsSum = data.splits.reduce(
      (sum, split) => sum.add(split.amount),
      Money.zero(),
    );

    if (!totalAmount.subtract(splitsSum).abs().lte(0.005)) {
      throw new ValidationError(
        "Sum of splits must equal the total transaction amount",
        [
          { field: "splits", message: `Sum: ${splitsSum.toString()}, Total: ${totalAmount.toString()}` },
        ],
      );
    }

    // FIX DATA-TRANS-SPLIT-002: Validate split categoryId and merchantId belong to household
    for (let i = 0; i < data.splits.length; i++) {
      const split = data.splits[i];

      if (split.categoryId) {
        const category = await categoryRepository.findByIdAndHousehold(
          split.categoryId,
          householdId
        );
        if (!category) {
          throw new NotFoundError(`Split ${i + 1}: Category not found`);
        }
      }

      if (split.merchantId) {
        const merchant = await merchantRepository.findByIdAndHousehold(
          split.merchantId,
          householdId
        );
        if (!merchant) {
          throw new NotFoundError(`Split ${i + 1}: Merchant not found`);
        }
      }
    }
  }

  const merchantMatch = await resolveMerchantMatch({
    householdId,
    rawName: data.name,
    merchantId: data.merchantId ?? null,
  });

  const resolvedMerchantId =
    merchantMatch.merchant?.id ?? data.merchantId ?? null;
  const resolvedName = merchantMatch.merchant
    ? merchantMatch.merchant.name
    : data.merchantId
      ? data.name
      : merchantMatch.cleanedName || data.name;

  if (merchantMatch.merchant && merchantMatch.aliasCandidate) {
    await ensureMerchantAlias(
      merchantMatch.merchant.id,
      merchantMatch.aliasCandidate,
    );
  }

  // Create transaction (currency enforced to match account)
  // FIX INT-RULES-001: Pass splits to repository for persistence
  //
  // CONCURRENCY (CLAUDE.md Rule 10): the findByIdempotencyKey check at the top of
  // this function is itself a read-then-write TOCTOU — it reads on one connection
  // and inserts later on another, with no lock between. Two concurrent calls with
  // the SAME key therefore both see "no existing row", both reach this insert, and
  // the loser hit a raw unique violation on transactions.idempotency_key that
  // nothing caught — surfacing as a 500 to the caller. So the idempotency
  // guarantee held only when requests did not actually overlap, which is exactly
  // when it was not needed.
  //
  // The unique index IS the real serialization point (a pre-check cannot be one),
  // so treat its violation as the authoritative duplicate signal: re-read the row
  // the winner committed and return it as the idempotent hit — the same
  // {transaction, isDuplicate: true} the pre-check returns. Callers see one
  // contract whether the duplicate was caught before the insert or by the index.
  let transaction: Transaction;
  try {
    ({ transaction } = await transactionRepository.create(
      {
        ...data,
        name: resolvedName,
        merchantId: resolvedMerchantId,
        householdId,
        ownerUserId: userId,
        idempotencyKey,
        currency: account.currency, // Always use account currency for income/expense
        splits: data.splits, // Persist splits to transaction_splits table
      },
      {
        // Rule 9: audit lives at the repository layer (atomic with the
        // insert) so every caller of this service function is audited, not
        // just the ones that happen to go through the transactions
        // controller (GRZ coupon postings, CSV import, recurring, ...).
        audit: {
          userId,
          householdId,
          ipAddress: auditContext?.ipAddress,
        },
      },
    ));
  } catch (error) {
    if (!idempotencyKey || !isPostgresError(error, "23505")) {
      throw error;
    }

    const winner = await transactionRepository.findByIdempotencyKey(
      idempotencyKey,
      householdId,
    );
    // Only an idempotency-key collision may be swallowed. If the row is not
    // there, the 23505 came from some OTHER unique constraint and must not be
    // silently reported as a duplicate — rethrow it.
    if (!winner) {
      throw error;
    }

    logger.info("Duplicate transaction detected via unique index", {
      householdId,
    });
    return { transaction: winner, isDuplicate: true };
  }

  // Apply rules. SCP-334: rule application is now atomic (all-or-nothing). A
  // mid-apply DB failure rolls back the rule's writes and throws — but the
  // transaction itself was already created and must still succeed, so a rule
  // failure is logged and we proceed with the un-ruled transaction rather than
  // failing the whole create request.
  let processedTransaction = transaction;
  try {
    processedTransaction = await ruleService.applyRules(
      transaction,
      householdId,
      { userId },
    );
  } catch (error) {
    logger.error("Rule application failed; transaction kept un-ruled", {
      householdId,
      transactionId: transaction.id,
      error,
    });
  }

  logger.info("Transaction created", { householdId });

  // Invalidate analytics cache
  await invalidateOnChange("transaction", householdId);

  try {
    await recurringService.autoLinkNewTransaction(
      processedTransaction,
      householdId,
    );
  } catch (error) {
    logger.warn("Auto-linking recurring rule failed", {
      transactionId: processedTransaction.id,
      error,
    });
  }

  // Trigger large transaction notification for expenses
  if (processedTransaction.type === "expense") {
    // toNumber() acceptable for notification display (non-financial operation)
    const amount = new Money(processedTransaction.amount).toNumber();
    const merchantName = resolvedName || "Unknown";

    notificationService
      .triggerLargeTransaction(
        userId,
        householdId,
        processedTransaction.id,
        amount,
        merchantName,
      )
      .catch((err) =>
        logger.error("Failed to trigger large transaction notification", {
          err,
        }),
      );
  }

  // Emit transaction created event (fire and forget)
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
    .catch((err) =>
      logger.error("Failed to publish transaction event", { err }),
    );

  return { transaction: processedTransaction, isDuplicate: false };
}
