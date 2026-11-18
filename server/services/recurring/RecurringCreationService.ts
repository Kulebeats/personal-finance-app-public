import { eq } from "drizzle-orm";
import {
  recurringTransactionHistory,
  recurringTransactionLinks,
  recurringTransactions,
  transactions,
  type RecurringTransaction,
  type Transaction,
} from "@shared/schema";
import { accountRepository } from "../../repositories/AccountRepository";
import { recurringRepository } from "../../repositories/RecurringRepository";
import { transactionRepository } from "../../repositories/TransactionRepository";
import { Money } from "../../core/money";
import type { Frequency, IntervalUnit } from "../../core/calculations/recurring/types";
import { NotFoundError, ValidationError } from "../../utils/errorHandler";
import { logger } from "../../utils/logger";
import { withTransaction } from "../../utils/withTransaction";
import { goalAccountAssignmentService } from "../GoalAccountAssignmentService";
import {
  ensureMerchantAlias,
  resolveMerchantMatch,
} from "../merchantRecognition";
import type { CreateTransactionInput } from "../../modules/transactions/transactions.validation";
import type {
  CreateRecurringFromExistingTransactionInput,
  CreateRecurringFromTransactionInput,
} from "../../modules/recurring/recurring.validation";
import { RecurringBaseService } from "./RecurringBaseService";

export class RecurringCreationService extends RecurringBaseService {
  private async createRuleAndLinkForTransaction(
    tx: Parameters<Parameters<typeof withTransaction>[0]>[0],
    transaction: Transaction,
    recurring: CreateRecurringFromTransactionInput["recurring"],
    householdId: string,
    userId: string
  ): Promise<{ transaction: Transaction; rule: RecurringTransaction }> {
    const transactionDate = transaction.date;
    const startDate = recurring.startDate ?? transactionDate;
    const date = new Date(startDate);
    const dayOfMonth = date.getDate();
    const dayOfWeek = date.getDay();

    const [rule] = await tx
      .insert(recurringTransactions)
      .values({
        householdId,
        accountId: transaction.accountId,
        name: transaction.name,
        amount: transaction.amount,
        type: transaction.type,
        frequency: recurring.frequency,
        intervalValue: recurring.intervalValue ?? undefined,
        intervalUnit: (recurring.intervalUnit as IntervalUnit | null) ?? undefined,
        startDate,
        endDate: recurring.endDate ?? null,
        nextDueDate: startDate,
        dayOfMonth,
        dayOfWeek,
        categoryId: transaction.categoryId,
        merchantId: transaction.merchantId,
        amountType: recurring.amountType ?? "fixed",
        amountTolerance: recurring.amountTolerance ?? 0,
        reminderDays: recurring.reminderDays ?? 3,
        reminderEmail: recurring.reminderEmail ?? false,
        reminderPush: recurring.reminderPush ?? false,
        reminderInApp: recurring.reminderInApp ?? true,
        autoLinkEnabled: recurring.autoLinkEnabled ?? true,
        autoMarkReviewed: recurring.autoMarkReviewed ?? false,
        isSubscription: recurring.isSubscription ?? false,
        trialEndDate: recurring.trialEndDate ?? null,
        notes: recurring.notes ?? transaction.notes ?? null,
      })
      .returning();

    await tx.insert(recurringTransactionLinks).values({
      recurringTransactionId: rule.id,
      transactionId: transaction.id,
      matchMethod: "manual",
      expectedDate: startDate,
      actualDate: transaction.date,
      expectedAmount: rule.amount,
      actualAmount: transaction.amount,
      status: "linked",
    });

    await tx
      .update(transactions)
      .set({
        isRecurring: true,
        recurringTransactionId: rule.id,
        updatedAt: new Date(),
      })
      .where(eq(transactions.id, transaction.id));

    const shouldAdvance =
      !rule.nextDueDate || transaction.date >= rule.nextDueDate;
    const nextDate = shouldAdvance
      ? recurringRepository.calculateNextDate(
          transaction.date,
          rule.frequency as Frequency,
          {
            dayOfMonth: rule.dayOfMonth ?? dayOfMonth,
            dayOfWeek: rule.dayOfWeek ?? dayOfWeek,
            intervalValue: rule.intervalValue ?? undefined,
            intervalUnit: (rule.intervalUnit as IntervalUnit | null) ?? undefined,
          }
        )
      : rule.nextDueDate;

    const [updatedRule] = await tx
      .update(recurringTransactions)
      .set({
        totalOccurrences: (rule.totalOccurrences || 0) + 1,
        lastOccurredDate: transaction.date,
        ...(shouldAdvance ? { nextDueDate: nextDate } : {}),
        updatedAt: new Date(),
      })
      .where(eq(recurringTransactions.id, rule.id))
      .returning();

    await tx.insert(recurringTransactionHistory).values([
      {
        recurringTransactionId: rule.id,
        action: "created",
        newState: rule,
        performedBy: userId,
      },
      {
        recurringTransactionId: rule.id,
        action: "linked",
        newState: { matchMethod: "manual" },
        linkedTransactionId: transaction.id,
        performedBy: userId,
      },
    ]);

    return {
      transaction: {
        ...transaction,
        isRecurring: true,
        recurringTransactionId: rule.id,
      },
      rule: updatedRule || rule,
    };
  }

  /**
   * Create a transaction and recurring rule atomically, then link them
   */
  async createRecurringFromTransaction(
    data: CreateTransactionInput,
    recurring: CreateRecurringFromTransactionInput["recurring"],
    householdId: string,
    userId: string
  ): Promise<{
    transaction: Transaction;
    recurringRule: RecurringTransaction;
    isDuplicate: boolean;
  }> {
    if (data.idempotencyKey) {
      const existing = await transactionRepository.findByIdempotencyKey(
        data.idempotencyKey,
        householdId
      );

      if (existing) {
        if (existing.recurringTransactionId) {
          const rule = await recurringRepository.findById(
            existing.recurringTransactionId,
            householdId
          );
          if (rule) {
            return {
              transaction: existing,
              recurringRule: rule,
              isDuplicate: true,
            };
          }
        }

        const linked = await withTransaction((tx) =>
          this.createRuleAndLinkForTransaction(
            tx,
            existing,
            recurring,
            householdId,
            userId
          )
        );

        return {
          transaction: linked.transaction,
          recurringRule: linked.rule,
          isDuplicate: true,
        };
      }
    }

    const account = await accountRepository.findByIdWithVisibility(
      data.accountId,
      householdId,
      userId
    );
    if (!account) {
      throw new NotFoundError("Account not found or not accessible");
    }

    if (data.splits && data.splits.length > 0) {
      const totalAmount = new Money(data.amount);
      const splitsSum = data.splits.reduce(
        (sum, split) => sum.add(new Money(split.amount)),
        new Money(0)
      );

      if (!totalAmount.equals(splitsSum)) {
        throw new ValidationError(
          "Sum of splits must equal the total transaction amount",
          [
            {
              field: "splits",
              message: `Sum: ${splitsSum.toString()}, Total: ${totalAmount.toString()}`,
            },
          ]
        );
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
        merchantMatch.aliasCandidate
      );
    }

    const result = await withTransaction(async (tx) => {
      const { transaction } =
        await transactionRepository.createWithinTransaction(tx, {
          ...data,
          name: resolvedName,
          merchantId: resolvedMerchantId,
          householdId,
          ownerUserId: userId,
          isRecurring: false,
          recurringTransactionId: null,
        });

      return this.createRuleAndLinkForTransaction(
        tx,
        transaction,
        recurring,
        householdId,
        userId
      );
    });

    try {
      await goalAccountAssignmentService.syncGoalsForAccount(
        data.accountId,
        "transaction_created"
      );
    } catch (error) {
      logger.error("Goal auto-sync failed after transaction create", {
        accountId: data.accountId,
        error,
      });
    }

    return {
      transaction: result.transaction,
      recurringRule: result.rule,
      isDuplicate: false,
    };
  }

  /**
   * Create a recurring rule from an existing transaction and link them
   */
  async createRecurringFromExistingTransaction(
    transactionId: string,
    recurring: CreateRecurringFromExistingTransactionInput,
    householdId: string,
    userId: string
  ): Promise<{
    transaction: Transaction;
    recurringRule: RecurringTransaction;
    isDuplicate: boolean;
  }> {
    const transaction = await transactionRepository.findByIdWithVisibility(
      transactionId,
      householdId,
      userId
    );
    if (!transaction) {
      throw new NotFoundError("Transaction not found");
    }

    if (transaction.type !== "income" && transaction.type !== "expense") {
      throw new ValidationError("Unsupported transaction type", [
        {
          field: "type",
          message: "Only income or expense transactions can be recurring",
        },
      ]);
    }

    if (transaction.recurringTransactionId) {
      const rule = await recurringRepository.findById(
        transaction.recurringTransactionId,
        householdId
      );
      if (rule) {
        return {
          transaction,
          recurringRule: rule,
          isDuplicate: true,
        };
      }
    }

    const result = await withTransaction((tx) =>
      this.createRuleAndLinkForTransaction(
        tx,
        transaction,
        recurring,
        householdId,
        userId
      )
    );

    return {
      transaction: result.transaction,
      recurringRule: result.rule,
      isDuplicate: false,
    };
  }
}
