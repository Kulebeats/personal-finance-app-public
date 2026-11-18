import type { RecurringTransaction } from "@shared/schema";
import {
  projectOccurrences,
  type Frequency,
  type IntervalUnit,
  type ProjectedOccurrence,
  toMoney,
} from "../../core/calculations";
import { recurringRepository } from "../../repositories/RecurringRepository";
import { transactionRepository } from "../../repositories/TransactionRepository";
import { NotFoundError, ValidationError } from "../../utils/errorHandler";
import { getErrorMessage } from "../../core/errors";
import { logger } from "../../utils/logger";
import { withTransaction } from "../../utils/withTransaction";
import { isPostgresError } from "../../utils/postgresError";
import { goalAccountAssignmentService } from "../GoalAccountAssignmentService";
import { RecurringCreationService } from "./RecurringCreationService";
import { recurringOccurrenceKey } from "./materializationKey";

export class RecurringProcessingService extends RecurringCreationService {
  /**
   * Get projected occurrences for a date range
   */
  async getProjections(
    householdId: string,
    startDate: string,
    endDate: string
  ): Promise<ProjectedOccurrence[]> {
    const rules = await recurringRepository.findByHousehold(householdId);
    let allOccurrences: ProjectedOccurrence[] = [];

    for (const rule of rules) {
      if (!rule.isActive || rule.isPaused) continue;

      const info = {
        id: rule.id,
        amount: toMoney(Number(rule.amount)),
        frequency: rule.frequency as Frequency,
        intervalValue: rule.intervalValue,
        intervalUnit: rule.intervalUnit as IntervalUnit | null,
        startDate: rule.startDate,
        endDate: rule.endDate,
        nextDueDate: rule.nextDueDate,
        dayOfMonth: rule.dayOfMonth,
        dayOfWeek: rule.dayOfWeek,
      };

      const occurrences = projectOccurrences(info, endDate, startDate);
      allOccurrences = allOccurrences.concat(occurrences);
    }

    return allOccurrences.sort((a, b) => a.date.localeCompare(b.date));
  }

  /**
   * Skip next occurrence
   */
  async skipNextOccurrence(
    id: string,
    householdId: string,
    userId?: string
  ): Promise<RecurringTransaction> {
    // Verify exists
    const existing = await recurringRepository.findById(id, householdId);
    if (!existing) {
      throw new NotFoundError("Recurring rule not found");
    }

    const rule = await recurringRepository.skipNext(id, householdId);

    if (!rule) {
      throw new NotFoundError("Recurring rule not found");
    }

    logger.info("Recurring rule - skipped next occurrence", { householdId });

    await recurringRepository.logHistory({
      recurringTransactionId: rule.id,
      action: "skipped",
      previousState: existing,
      newState: rule,
      performedBy: userId,
    });

    return rule;
  }

  /**
   * Process all due recurring rules and create transactions
   * @param householdId - Household ID to process rules for
   * @param asOfDate - Process rules due as of this date (defaults to today)
   * @param dryRun - If true, only simulate processing without creating transactions
   */
  async processRecurring(
    householdId: string,
    asOfDate?: string,
    dryRun: boolean = false
  ): Promise<{
    processed: number;
    created: number;
    errors: Array<{ ruleId: string; error: string }>;
    dueRules?: Array<{
      id: string;
      name: string;
      amount: string;
      nextDueDate: string;
      frequency: string;
    }>;
  }> {
    const today = asOfDate || new Date().toISOString().split("T")[0];
    const dueRules = await recurringRepository.findDue(householdId, today);

    const result = {
      processed: dueRules.length,
      created: 0,
      errors: [] as Array<{ ruleId: string; error: string }>,
      dueRules: dryRun
        ? dueRules.map((rule) => ({
            id: rule.id,
            name: rule.name,
            amount: rule.amount,
            nextDueDate: rule.nextDueDate,
            frequency: rule.frequency,
          }))
        : undefined,
    };

    // If dry-run, return without creating transactions
    if (dryRun) {
      logger.info("Dry-run: Would process recurring transactions", {
        householdId,
        count: dueRules.length,
      });
      return result;
    }

    for (const rule of dueRules) {
      try {
        if (rule.type !== "income" && rule.type !== "expense") {
          throw new ValidationError("Unsupported recurring type", [
            {
              field: "type",
              message: `Unsupported type: ${rule.type}`,
            },
          ]);
        }

        // SCP-330 (atomicity) + R5 (locking, idempotency, audit): process each
        // due rule inside ONE transaction that
        //   1. locks the rule row FOR UPDATE so overlapping/retried cron runs
        //      serialize on it (Rule 10) — findDue read the rule UNLOCKED,
        //   2. re-checks due-ness INSIDE the lock as the conditional guard (a
        //      concurrent run may have already advanced/paused/ended the rule
        //      since that unlocked read),
        //   3. creates the ledger transaction with a deterministic idempotency
        //      key, an audit row (Rule 9) and the balance effect — all in-txn,
        //   4. links it, advances nextDueDate, and logs history.
        // Row lock + idempotency key give correctness even across instances
        // without a distributed cron lock (Redis is intentionally out of scope
        // for this packet).
        const outcome = await withTransaction(async (tx) => {
          const locked = await recurringRepository.findByIdForUpdate(
            rule.id,
            householdId,
            tx,
          );

          // Conditional guard: only materialize if the rule is STILL due now that
          // we hold the lock. Mirrors findDue's due-ness predicate.
          if (
            !locked ||
            !locked.isActive ||
            locked.isPaused ||
            locked.nextDueDate > today ||
            (locked.endDate !== null && locked.endDate < today)
          ) {
            return { status: "skipped" as const };
          }

          const occurrenceDate = locked.nextDueDate;
          const idempotencyKey = recurringOccurrenceKey(
            locked.id,
            occurrenceDate,
          );

          const { transaction } =
            await transactionRepository.createWithinTransaction(
              tx,
              {
                householdId,
                accountId: locked.accountId,
                date: occurrenceDate,
                name: locked.name,
                amount: locked.amount,
                type: locked.type as "income" | "expense",
                categoryId: locked.categoryId,
                source: "recurring",
                isRecurring: true,
                recurringTransactionId: locked.id,
                isPending: true,
                status: "pending",
                // Deterministic per (rule, occurrence): a UNIQUE(idempotency_key)
                // collision from a concurrent/retried run is caught below as an
                // idempotent skip, never a double-create.
                idempotencyKey,
                notes: locked.notes
                  ? `[Auto] ${locked.notes}`
                  : "[Auto] Recurring transaction",
              },
              {
                // Rule 9: the materialized ledger write MUST be audited, atomic
                // with the write. userId null = system/cron-initiated write.
                audit: {
                  userId: null,
                  householdId,
                  metadata: {
                    reason: "recurring_materialization",
                    recurringTransactionId: locked.id,
                    occurrenceDate,
                    idempotencyKey,
                  },
                },
              },
            );

          await recurringRepository.createLink(
            {
              recurringTransactionId: locked.id,
              transactionId: transaction.id,
              matchMethod: "auto",
              matchConfidence: 100,
              expectedDate: occurrenceDate,
              actualDate: transaction.date,
              expectedAmount: locked.amount,
              actualAmount: transaction.amount,
              status: "linked",
            },
            tx,
          );

          // Calculate and advance next due date (inside the same transaction)
          const nextDate = recurringRepository.calculateNextDate(
            occurrenceDate,
            locked.frequency as Frequency,
            {
              dayOfMonth: locked.dayOfMonth || undefined,
              dayOfWeek: locked.dayOfWeek || undefined,
              intervalValue: locked.intervalValue ?? undefined,
              intervalUnit:
                (locked.intervalUnit as IntervalUnit | null) ?? undefined,
            },
          );

          await recurringRepository.update(
            locked.id,
            householdId,
            {
              nextDueDate: nextDate,
              totalOccurrences: (locked.totalOccurrences || 0) + 1,
              lastOccurredDate: transaction.date,
            },
            tx,
          );

          await recurringRepository.logHistory(
            {
              recurringTransactionId: locked.id,
              action: "processed",
              newState: { nextDueDate: nextDate },
              linkedTransactionId: transaction.id,
            },
            tx,
          );

          return {
            status: "created" as const,
            accountId: transaction.accountId,
          };
        }).catch((error: unknown) => {
          // Idempotency backstop: a UNIQUE violation on transactions.idempotency_key
          // means another run/instance already materialized this occurrence. The
          // transaction has rolled back, so treat it as an idempotent skip — never
          // a 500, never a double-create.
          if (isPostgresError(error, "23505")) {
            return { status: "duplicate" as const };
          }
          throw error;
        });

        if (outcome.status === "created") {
          // Goal progress depends on the account balance the auto transaction
          // just changed; sync AFTER commit (mirrors transactionRepository.create's
          // own post-commit goal sync, which createWithinTransaction does not run).
          try {
            await goalAccountAssignmentService.syncGoalsForAccount(
              outcome.accountId,
              "transaction_created",
            );
          } catch (syncError) {
            logger.error("Goal auto-sync failed after recurring create", {
              accountId: outcome.accountId,
              error: syncError,
            });
          }

          result.created++;
        }
        // "skipped" / "duplicate": the occurrence was already materialized or the
        // rule is no longer due — neither a creation nor an error.
      } catch (error: unknown) {
        result.errors.push({
          ruleId: rule.id,
          error: getErrorMessage(error) || "Unknown error",
        });
        logger.error("Failed to process recurring rule", {
          ruleId: rule.id,
          error,
        });
      }
    }

    logger.info("Processed recurring transactions", {
      householdId,
      processed: result.processed,
      created: result.created,
      errors: result.errors.length,
    });

    return result;
  }
}
