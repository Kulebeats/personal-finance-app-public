import { and, eq, inArray, or } from "drizzle-orm";
import {
  accounts, recurringTransactionLinks, recurringTransactions, transactions,
  type RecurringTransaction,
} from "@shared/schema";
import { withWritableRecurringRule } from "./withWritableRecurringRule";
import { retainedTransactionOnVisibleAccountPredicate, visibleAccountPredicate } from "../../core/authz/transaction-visibility";
import { EventTypes, outboxEventService } from "../../core/events";
import type { HouseholdContext } from "../../middleware/householdGuard";
import { recurringRepository } from "../../repositories/RecurringRepository";
import { transactionRepository } from "../../repositories/TransactionRepository";
import { ConflictError, NotFoundError } from "../../utils/errorHandler";
import { lockRecurringAudience } from "./RecurringLifecycleAudience";
import { attachRecurringDefinition } from "./RecurringDenomination";
import { firstOccurrenceOnOrAfter, skipOutcome } from "./RecurringLifecycleRules";
import { businessAuditService } from "../BusinessAuditService";
import { householdToday } from "../householdCalendarToday";
import type { TransactionType } from "../../utils/withTransaction";
import { auditRecurringRule, type RecurringAuditRequest } from "./RecurringRuleAudit";

type Change = { action: "paused" | "resumed" } |
  { action: "skipped"; occurrenceDate?: string } |
  { action: "ended"; endDate?: string; reason?: string };

const OPERATION = { paused: "pause", resumed: "resume", skipped: "skip", ended: "end" } as const;

/** The semantics live in RecurringLifecycleRules; this maps an action onto the row. */
async function lifecyclePatch(
  tx: TransactionType, householdId: string, rule: RecurringTransaction, change: Change,
): Promise<Partial<RecurringTransaction>> {
  switch (change.action) {
    case "paused": return { isPaused: true };
    case "resumed": return rule.isPaused
      ? { isPaused: false, nextDueDate: firstOccurrenceOnOrAfter(rule, await householdToday(tx, householdId)) }
      : { isPaused: false };
    case "skipped": return { nextDueDate: recurringRepository.nextDateAfter(rule) };
    case "ended": return {
      endDate: change.endDate ?? await householdToday(tx, householdId),
      isActive: false, isPaused: false,
    };
  }
}

/** The audited fields per action, as the lifecycle controller recorded them. */
function auditedState(rule: RecurringTransaction, action: Change["action"]): Record<string, unknown> {
  switch (action) {
    case "skipped": return {
      nextDueDate: rule.nextDueDate, lastOccurredDate: rule.lastOccurredDate, totalOccurrences: rule.totalOccurrences,
    };
    case "ended": return { endDate: rule.endDate, isActive: rule.isActive, isPaused: rule.isPaused };
    default: return { isPaused: rule.isPaused, isActive: rule.isActive, nextDueDate: rule.nextDueDate };
  }
}

export class RecurringLifecycleService {
  /** One serializable transaction: the rule write, its history and its audit row (Rule 9). */
  changeLifecycle(id: string, actor: HouseholdContext, change: Change, ipAddress?: string) {
    return withWritableRecurringRule(id, actor, async (tx, beforeRule) => {
      if (change.action === "skipped" && skipOutcome(beforeRule, change.occurrenceDate) === "noop") {
        return { beforeRule, rule: await attachRecurringDefinition(beforeRule, actor.householdId, tx) };
      }
      const patch = await lifecyclePatch(tx, actor.householdId, beforeRule, change);
      const rule = await recurringRepository.update(id, actor.householdId, patch, tx);
      if (!rule) throw new NotFoundError("Recurring rule");
      await recurringRepository.logHistory({
        recurringTransactionId: id, action: change.action, previousState: beforeRule, newState: rule,
        performedBy: actor.userId, changeReason: change.action === "ended" ? change.reason : undefined,
      }, tx);
      await businessAuditService.logUpdate({
        tx, userId: actor.userId, householdId: actor.householdId, entityId: id, entityType: "recurring_rule",
        oldValue: auditedState(beforeRule, change.action), newValue: auditedState(rule, change.action),
        ipAddress, metadata: { operation: OPERATION[change.action] },
      });
      if (change.action === "paused" || change.action === "resumed") {
        await outboxEventService.publish({
          eventType: change.action === "paused" ? EventTypes.RECURRING_PAUSED : EventTypes.RECURRING_RESUMED,
          aggregateType: "recurring", aggregateId: id, householdId: actor.householdId, payload: { id },
        }, tx);
      }
      return { beforeRule, rule: await attachRecurringDefinition(rule, actor.householdId, tx) };
    });
  }

  deleteRecurring(
    id: string, actor: HouseholdContext,
    /** Request context for the DELETE audit row, written in the deletion's transaction (FIN-13). */
    audit?: RecurringAuditRequest,
  ) {
    return withWritableRecurringRule(id, actor, async (tx, rule) => {
      const ruleId = rule.id;
      // Materialized rows can point directly at the rule without a link row.
      const linkedIds = tx.select({ id: recurringTransactionLinks.transactionId }).from(recurringTransactionLinks)
        .where(eq(recurringTransactionLinks.recurringTransactionId, ruleId));
      const sources = await tx.select({ id: transactions.id }).from(transactions)
        .where(or(and(eq(transactions.householdId, actor.householdId), eq(transactions.recurringTransactionId, ruleId)),
          inArray(transactions.id, linkedIds)))
        .orderBy(transactions.id);
      for (const source of sources) {
        const [transaction] = await tx.select().from(transactions)
          .where(and(eq(transactions.id, source.id), retainedTransactionOnVisibleAccountPredicate(actor))).for("update");
        if (!transaction) throw new NotFoundError("Recurring rule");
        const [account] = await tx.select({ id: accounts.id }).from(accounts)
          .where(and(eq(accounts.id, transaction.accountId), visibleAccountPredicate(actor))).for("share");
        if (!account) throw new NotFoundError("Recurring rule");
        const links = await tx.select({ id: recurringTransactionLinks.recurringTransactionId })
          .from(recurringTransactionLinks).where(eq(recurringTransactionLinks.transactionId, source.id));
        const survivors = links.filter(link => link.id !== ruleId);
        for (const survivor of survivors) await lockRecurringAudience(tx, survivor.id, actor);
        // Preserve deleted ledger rows as history. Only live pointers need to
        // be detached or handed to a surviving rule before the links cascade.
        if (transaction.deletedAt) continue;
        const pointer = transaction.recurringTransactionId;
        // Older ordinary creates stored the direct UUID but defaulted the flag to false.
        const legacyDirectPointer = pointer === ruleId && links.length === 0;
        if ((!transaction.isRecurring && !legacyDirectPointer) || !pointer ||
            (pointer !== ruleId && !survivors.some(survivor => survivor.id === pointer)) ||
            (pointer === ruleId && survivors.length > 1)) {
          throw new ConflictError("Recurring link state changed");
        }
        if (pointer === ruleId) {
          const successor = survivors[0]?.id ?? null;
          const result = await transactionRepository.update(source.id, actor.householdId, {
            isRecurring: successor !== null, recurringTransactionId: successor,
          }, undefined, tx);
          if (!result.transaction) throw new NotFoundError("Recurring rule");
        }
      }
      await tx.delete(recurringTransactions).where(and(eq(recurringTransactions.id, ruleId),
        eq(recurringTransactions.householdId, actor.householdId)));
      await outboxEventService.publish({
        eventType: EventTypes.RECURRING_DELETED, aggregateType: "recurring",
        aggregateId: ruleId, householdId: actor.householdId, payload: { id: ruleId },
      }, tx);
      if (audit) {
        const { name, amount, frequency, accountId } = rule;
        await auditRecurringRule(tx, "DELETE", ruleId, actor, audit, { oldValue: { name, amount, frequency, accountId } });
      }
      return rule;
    }, { lockTransactionsForUpdate: true });
  }
}
