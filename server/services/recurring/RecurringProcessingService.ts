import {
  projectOccurrences,
  type Frequency,
  type IntervalUnit,
  type ProjectedOccurrence,
  type RecurringRuleInfo,
} from "../../core/calculations";
import { Money } from "../../core/money";
import { recurringRepository } from "../../repositories/RecurringRepository";
import { transactionRepository } from "../../repositories/TransactionRepository";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "../../utils/errorHandler";
import { getErrorMessage } from "../../core/errors";
import { logger } from "../../utils/logger";
import { withTransaction, type TransactionType } from "../../utils/withTransaction";
import { isPostgresError } from "../../utils/postgresError";
import { goalAccountAssignmentService } from "../GoalAccountAssignmentService";
import { RecurringCreationService } from "./RecurringCreationService";
import { recurringOccurrenceKey } from "./materializationKey";
import { and, eq } from "drizzle-orm";
import { householdMembers, recurringTransactions, type RecurringTransaction } from "@shared/schema";
import { verifiedRecurringCurrencySql } from "./RecurringDenomination";
import type { HouseholdContext } from "../../middleware/householdGuard";
import { db } from "../../db";
import { can } from "../../core/authz/capabilities";
import { listVisibleRecurringRules } from "./RecurringAudienceQuery";
import { withWritableRecurringRule } from "./withWritableRecurringRule";
import { isPastEnd } from "./RecurringLifecycleRules";
import { lockRecurringReferences, recurringPostingMetadata, type LockedRecurringAudience } from "./RecurringAudienceReferences";

/** Missed occurrences one rule may book in a single trusted run (NEW-30). */
export const RECURRING_CATCH_UP_LIMIT = 12;

/** Goal progress depends on the balance the auto transaction just changed; sync
 * AFTER commit (createWithinTransaction does not run the post-commit sync). */
async function syncGoalsAfterCreate(accountId: string): Promise<void> {
  try {
    await goalAccountAssignmentService.syncGoalsForAccount(accountId, "transaction_created");
  } catch (syncError) {
    logger.error("Goal auto-sync failed after recurring create", { accountId, error: syncError });
  }
}

export class RecurringProcessingService extends RecurringCreationService {
  /**
   * Get projected occurrences for a date range
   */
  async getProjections(
    householdId: string,
    startDate: string,
    endDate: string
  ): Promise<ProjectedOccurrence<Money>[]> {
    // Each rule with its proven unit (null when unproven), read together (FIN-05).
    const rows = await db.select({ rule: recurringTransactions, currency: verifiedRecurringCurrencySql() })
      .from(recurringTransactions).where(eq(recurringTransactions.householdId, householdId));
    let allOccurrences: ProjectedOccurrence<Money>[] = [];

    for (const { rule, currency } of rows) {
      // An unproven rule cannot post (materialisation refuses it), so it projects no money.
      if (!rule.isActive || rule.isPaused || !currency) continue;

      const info: RecurringRuleInfo<Money> = {
        id: rule.id,
        // Money from the stored decimal string in the rule's proven unit: no Number().
        amount: Money.from(rule.amount, currency),
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
   * Process all due recurring rules and create transactions
   * @param householdId - Household ID to process rules for
   * @param asOfDate - Process rules due as of this date (defaults to today)
   * @param dryRun - If true, only simulate processing without creating transactions
   */
  async processRecurring(
    householdId: string,
    asOfDate?: string,
    dryRun: boolean = false,
    actor?: HouseholdContext,
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
    if (actor && actor.householdId !== householdId) throw new NotFoundError("Recurring rule");
    // Read the grant after a lock wait, then hold it for one audience statement.
    // Financial postings independently revalidate inside serializable transactions.
    const dueRules = actor ? await db.transaction(async tx => {
      const [grant] = await tx.select({ role: householdMembers.role }).from(householdMembers)
        .where(and(eq(householdMembers.householdId, householdId), eq(householdMembers.userId, actor.userId))).for("share");
      if (!grant) throw new NotFoundError("Recurring rule");
      if (!can(grant.role, "financial.write") || !can(actor.role, "financial.write")) throw new ForbiddenError("Financial write access required");
      // A-12: include rules whose end date has passed, so a final occurrence on
      // endDate still posts when the run is late; the end bounds the occurrence.
      const visible = await listVisibleRecurringRules({ ...actor, role: grant.role }, { includeInactive: true }, tx);
      return visible.filter(rule => rule.isActive && rule.nextDueDate <= today && !isPastEnd(rule.endDate, rule.nextDueDate));
    }, { isolationLevel: "read committed" }) : await recurringRepository.findDue(householdId, today);

    const result = {
      processed: actor && !dryRun ? 0 : dueRules.length,
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
        const materialize = async (tx: TransactionType, locked: RecurringTransaction | undefined, held?: LockedRecurringAudience) => {
          // Conditional guard: only materialize if the rule is STILL due now that
          // we hold the lock. Mirrors findDue's due-ness predicate.
          if (
            !locked ||
            !locked.isActive ||
            locked.isPaused ||
            locked.nextDueDate > today ||
            isPastEnd(locked.endDate, locked.nextDueDate)
          ) {
            return { status: "skipped" as const };
          }

          const audience = held ?? await lockRecurringReferences(tx, [locked], householdId, undefined,
            { lockTransactionsForUpdate: true, lockAccountsForUpdate: true });
          const metadata = recurringPostingMetadata(audience, locked, actor);

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
                ...metadata,
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
                // with the write. Trusted cron retains null; signed runs carry their actor.
                audit: {
                  userId: actor?.userId ?? null,
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
              dayOfWeek: locked.dayOfWeek ?? undefined,
              intervalValue: locked.intervalValue ?? undefined,
              intervalUnit:
                (locked.intervalUnit as IntervalUnit | null) ?? undefined,
            },
          );

          // R14: the inclusive end date was this rule's last occurrence; it ends now, in the same transaction.
          const ended = isPastEnd(locked.endDate, nextDate);
          await recurringRepository.update(
            locked.id,
            householdId,
            {
              nextDueDate: nextDate,
              totalOccurrences: (locked.totalOccurrences || 0) + 1,
              lastOccurredDate: transaction.date,
              ...(ended ? { isActive: false } : {}),
            },
            tx,
          );

          await recurringRepository.logHistory(
            {
              recurringTransactionId: locked.id,
              action: "processed",
              newState: ended ? { nextDueDate: nextDate, isActive: false } : { nextDueDate: nextDate },
              linkedTransactionId: transaction.id,
            },
            tx,
          );

          return {
            status: "created" as const,
            accountId: transaction.accountId,
          };
        };
        const materializeOnce = () => (actor
          ? withWritableRecurringRule(rule.id, actor, materialize, { lockTransactionsForUpdate: true, lockAccountsForUpdate: true })
          : withTransaction(async tx => materialize(tx, await recurringRepository.findByIdForUpdate(rule.id, householdId, tx))))
          .catch((error: unknown) => {
          // Idempotency backstop: a UNIQUE violation on transactions.idempotency_key
          // means another run/instance already materialized this occurrence. The
          // transaction has rolled back, so treat it as an idempotent skip — never
          // a 500, never a double-create.
          if (isPostgresError(error, "23505")) {
            return { status: "duplicate" as const };
          }
          throw error;
        });

        // NEW-30 bounded catch-up: the trusted (scheduler/cron) run books each
        // missed occurrence once, oldest first, each in its own locked
        // transaction, up to the cap; a signed member run stays one per call.
        const maxOccurrences = actor ? 1 : RECURRING_CATCH_UP_LIMIT;
        for (let booked = 0; booked < maxOccurrences; booked++) {
          const outcome = await materializeOnce();
          if (outcome.status !== "created") break;
          await syncGoalsAfterCreate(outcome.accountId);
          result.created++;
        }
        if (actor) result.processed++;
        // "skipped" / "duplicate": the occurrence was already materialized or the
        // rule is no longer due — neither a creation nor an error.
      } catch (error: unknown) {
        if (actor && error instanceof NotFoundError) continue; // No inaccessible ID/count/error escapes a stale selection.
        if (actor && (error instanceof ForbiddenError || error instanceof ConflictError)) throw error;
        if (actor) result.processed++;
        result.errors.push({
          ruleId: rule.id,
          error: actor ? (error instanceof ValidationError ? error.message : "Recurring processing failed; retry or contact support.") : getErrorMessage(error) || "Unknown error",
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
