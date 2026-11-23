import { eq } from "drizzle-orm";
import { getPostgresError } from "../../utils/postgresError";
import { readRecurringCreateReplay } from "../transaction/idempotentReplay";
import {
  accounts,
  households,
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
import { businessAuditService } from "../BusinessAuditService";
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
import { attachRecurringDefinition, recordRecurringDenomination, type VisibleRecurringRule } from "./RecurringDenomination";
import { auditRecurringRule, type RecurringAuditRequest } from "./RecurringRuleAudit";
import { lockAccountHousehold } from "../../repositories/AccountCreationGrant";

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
    const dayOfMonth = date.getUTCDate();
    const dayOfWeek = date.getUTCDay();

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
    input: CreateTransactionInput,
    schedule: CreateRecurringFromTransactionInput["recurring"],
    householdId: string,
    userId: string,
    ipAddress?: string,
  ): Promise<{
    transaction: Transaction;
    recurringRule: VisibleRecurringRule;
    isDuplicate: boolean;
  }> {
    // Preserve one submitted command through lookups, posting and rule creation.
    const data = structuredClone(input);
    const recurring = structuredClone(schedule);
    if (data.idempotencyKey) {
      const existing = await transactionRepository.findByIdempotencyKey(
        data.idempotencyKey,
        householdId
      );

      if (existing) return readRecurringCreateReplay(existing, householdId, userId);
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

    const create = () => withTransaction(async (tx) => {
      if (merchantMatch.merchant && merchantMatch.aliasCandidate) {
        await ensureMerchantAlias(merchantMatch.merchant.id, merchantMatch.aliasCandidate, tx);
      }
      const { transaction, account } =
        await transactionRepository.createWithinTransaction(tx, {
          ...data,
          name: resolvedName,
          merchantId: resolvedMerchantId,
          householdId,
          ownerUserId: userId,
          isRecurring: false,
          recurringTransactionId: null,
        }, {
          createActor: { householdId, userId }, validateReferences: true,
          originalOwnerIntent: { actorUserId: userId, operation: "recurring" },
          audit: { userId, householdId, ipAddress },
          publishCreatedEvent: true,
        });

      const [household] = await tx.select({ currency: households.currency }).from(households)
        .where(eq(households.id, householdId)).for("share");
      if (data.currency !== "ZMW" || account.currency !== data.currency || household?.currency !== data.currency) {
        throw new ValidationError(
          "Recurring denomination must be ZMW and match the destination and household; multi-currency recurring is not yet supported.",
          [{ field: "amount.currency", message: "Enter a ZMW amount matching the destination and household" }],
        );
      }
      const created = await this.createRuleAndLinkForTransaction(
        tx,
        transaction,
        recurring,
        householdId,
        userId
      );
      await recordRecurringDenomination(tx, created.rule, data.currency, userId, "manual_creation");
      await businessAuditService.logCreate({
        tx,
        userId,
        householdId: transaction.isPrivate || account.isPrivate ? null : householdId,
        entityId: created.rule.id,
        entityType: "recurring_rule",
        newValue: {
          name: created.rule.name,
          amount: created.rule.amount,
          source: "transaction",
          transactionId: transaction.id,
        },
        ipAddress,
        metadata: { operation: "createFromTransaction" },
      });
      return created;
    });

    let result: Awaited<ReturnType<typeof create>>;
    try {
      result = await create();
    } catch (error) {
      const conflict = getPostgresError(error);
      if (!data.idempotencyKey || conflict?.code !== "23505" ||
        conflict.constraint !== "transactions_idempotency_key_unique") throw error;
      const winner = await transactionRepository.findByIdempotencyKey(data.idempotencyKey, householdId);
      if (!winner) throw error;
      return readRecurringCreateReplay(winner, householdId, userId);
    }

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
      recurringRule: await attachRecurringDefinition(result.rule, householdId),
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
    userId: string,
    /** Request context for the CREATE audit row, written in the rule's transaction (FIN-13). */
    audit?: RecurringAuditRequest,
  ): Promise<{
    transaction: Transaction;
    recurringRule: VisibleRecurringRule;
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
          recurringRule: await attachRecurringDefinition(rule, householdId),
          isDuplicate: true,
        };
      }
    }

    const result = await withTransaction(async (tx) => {
      // Household first: the audit FK lock order (FIN-13).
      await lockAccountHousehold(tx, householdId);
      const created = await this.createRuleAndLinkForTransaction(tx, transaction, recurring, householdId, userId);
      if (audit) {
        const { id, name, amount } = created.rule;
        // A private source keeps the household off the row, as createRecurringFromTransaction does.
        const [source] = await tx.select({ isPrivate: accounts.isPrivate }).from(accounts)
          .where(eq(accounts.id, transaction.accountId));
        const auditHouseholdId = transaction.isPrivate || source?.isPrivate ? null : householdId;
        await auditRecurringRule(tx, "CREATE", id, { householdId: auditHouseholdId, userId }, audit, {
          newValue: { name, amount, source: "transaction", transactionId },
          metadata: { operation: "createFromTransaction" },
        });
      }
      return created;
    });

    return {
      transaction: result.transaction,
      recurringRule: await attachRecurringDefinition(result.rule, householdId),
      isDuplicate: false,
    };
  }
}
