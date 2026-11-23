import {
  recurringTransactions,
  transactions,
  type RecurringTransaction,
  type RecurringTransactionLink,
  type Transaction,
} from "@shared/schema";
import { recurringRepository } from "../../repositories/RecurringRepository";
import { householdRepository } from "../../repositories/HouseholdRepository";
import { transactionRepository } from "../../repositories/TransactionRepository";
import { NotFoundError } from "../../utils/errorHandler";
import { logger } from "../../utils/logger";
import {
  patternDetectionService,
  type DetectedPattern,
} from "../PatternDetectionService";
import type { ConfirmPatternInput } from "../../modules/recurring/recurring.validation";
import { RecurringProcessingService } from "./RecurringProcessingService";
import { withTransaction } from "../../utils/withTransaction";
import { and, eq } from "drizzle-orm";
import { db } from "../../db";
import type { HouseholdContext } from "../../middleware/householdGuard";
import { visibleTransactionPredicate } from "../../core/authz/transaction-visibility";
import { getVisibleRecurringHistory, getVisibleRecurringLinks, getVisibleRecurringSummary } from "./RecurringAudienceQuery";
import { withWritableRecurringRule } from "./withWritableRecurringRule";
import { writeRecurringLink, writeSignedRecurringLink } from "./RecurringLinkWriter";
import { confirmVisiblePattern } from "./RecurringPatternConfirmation";
import { unlinkVisibleRecurringSource } from "./RecurringUnlinkWriter";
import { auditRecurringRule, type RecurringAuditRequest } from "./RecurringRuleAudit";
import { attachRecurringDefinition, getVerifiedRecurringRuleCurrency, type RecurringLinkUnits, type VisibleRecurringRule } from "./RecurringDenomination";

export class RecurringLinkingService extends RecurringProcessingService {
  /**
   * Detect recurring patterns and return suggestions
   */
  async detectAndSuggest(
    householdId: string,
    options?: Parameters<typeof patternDetectionService.detectPatterns>[1],
    actor?: HouseholdContext,
  ): Promise<DetectedPattern[]> {
    return await patternDetectionService.detectPatterns(householdId, options, actor);
  }

  /**
   * Confirm a detected pattern and create a recurring rule
   */
  async confirmPattern(
    householdId: string,
    pattern: ConfirmPatternInput,
    userId: string,
    accountId: string,
    actor?: HouseholdContext,
    ipAddress?: string,
  ): Promise<VisibleRecurringRule> {
    if (!actor || actor.householdId !== householdId || actor.userId !== userId) throw new NotFoundError("Recurring pattern");
    return attachRecurringDefinition(await confirmVisiblePattern(pattern, accountId, actor, ipAddress), householdId);
  }

  /**
   * Trusted internal linking; ordinary HTTP callers use linkVisibleTransaction.
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
      // Preserve the established internal reader; signed linking uses the actor guard below.
      const transaction = await transactionRepository.findByIdWithVisibility(
        transactionId,
        householdId,
        userId,
      );
      if (!transaction) {
        throw new NotFoundError("Transaction not found");
      }

      return writeRecurringLink(tx, rule, transaction, { matchMethod, matchConfidence, performedBy });
    });
  }

  /** Ordinary signed linking requires the complete rule and source audience. */
  linkVisibleTransaction(
    recurringId: string, transactionId: string, actor: HouseholdContext,
    /** Request context for the LINK audit row, written in the link's transaction (FIN-13). */
    audit?: RecurringAuditRequest,
  ): Promise<RecurringTransactionLink & RecurringLinkUnits> {
    return withWritableRecurringRule(recurringId, actor, async (tx, rule) => {
      // The shared guard locks all source transactions before their accounts.
      const [transaction] = await tx.select().from(transactions).where(and(
        eq(transactions.id, transactionId), visibleTransactionPredicate(actor),
      )).limit(1);
      if (!transaction) throw new NotFoundError("Recurring rule");
      const link = await writeSignedRecurringLink(tx, rule, transaction, actor);
      if (audit) {
        await auditRecurringRule(tx, "LINK", recurringId, actor, audit, {
          metadata: { transactionId, linkId: link.id, matchMethod: "manual" },
        });
      }
      return { ...link, actualCurrency: transaction.currency,
        expectedCurrency: await getVerifiedRecurringRuleCurrency(rule.id, actor.householdId, tx) };
    }, { additionalTransactionIds: [transactionId], lockTransactionsForUpdate: true });
  }

  /**
   * Unlink a transaction from a recurring rule
   */
  unlinkTransaction(
    recurringId: string, linkId: string, actor: HouseholdContext,
    /** Request context for the UNLINK audit row, written in the unlink's transaction (FIN-13). */
    audit?: RecurringAuditRequest,
  ) {
    return unlinkVisibleRecurringSource(recurringId, linkId, actor, audit);
  }
  /**
   * Auto-link a new transaction to a matching recurring rule
   */
  async autoLinkNewTransaction(
    transaction: Transaction,
    householdId: string,
    actingUserId?: string,
  ): Promise<void> {
    if (
      transaction.isRecurring ||
      transaction.recurringTransactionId ||
      (transaction.type !== "income" && transaction.type !== "expense")
    ) {
      return;
    }

    const member = actingUserId ? await householdRepository.findMember(householdId, actingUserId) : undefined;
    if (actingUserId !== undefined && !member) return;
    const actor = member && actingUserId ? { userId: actingUserId, householdId, role: member.role } : undefined;
    const match = await patternDetectionService.matchTransaction(transaction, householdId, actor);
    if (!match) return;

    try {
      if (actor) {
        await withWritableRecurringRule(match.rule.id, actor, async (tx, rule) => {
          const [source] = await tx.select().from(transactions).where(and(
            eq(transactions.id, transaction.id), visibleTransactionPredicate(actor),
          )).limit(1);
          if (!source || source.isRecurring || source.recurringTransactionId) return;
          const current = patternDetectionService.matchRule(source, rule);
          if (current) await writeSignedRecurringLink(tx, rule, source, actor, { matchMethod: "auto", matchConfidence: current.confidence });
        }, { additionalTransactionIds: [transaction.id], lockTransactionsForUpdate: true });
        return;
      }
      // Trusted background callers retain the original linking path.
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
  async getSummaryData(actor: HouseholdContext) {
    return getVisibleRecurringSummary(actor);
  }

  /**
   * Actor reads enforce the rule audience; household-only calls remain trusted.
   */
  getLinkedTransactions(id: string, scope: HouseholdContext): Promise<Array<RecurringTransactionLink & RecurringLinkUnits>>;
  getLinkedTransactions(id: string, scope: string): Promise<RecurringTransactionLink[]>;
  async getLinkedTransactions(
    id: string,
    scope: string | HouseholdContext,
  ): Promise<RecurringTransactionLink[]> {
    return typeof scope === "string"
      ? recurringRepository.findLinksByRecurring(id, scope)
      : getVisibleRecurringLinks(id, scope);
  }

  /**
   * Get history for a recurring rule
   */
  async getHistory(id: string, scope: string | HouseholdContext, limit: number = 50) {
    return typeof scope === "string"
      ? recurringRepository.findHistory(id, scope, limit)
      : getVisibleRecurringHistory(id, scope, limit);
  }
}
