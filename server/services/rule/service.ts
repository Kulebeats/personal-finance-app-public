/**
 * Rule Service
 *
 * Business logic for applying rules to transactions.
 *
 * @module services/rule/service
 */

import { ruleRepository } from "../../repositories/RuleRepository";
import { transactionRepository } from "../../repositories/TransactionRepository";
import { type Transaction } from "@shared/schema";
import { logger } from "../../utils/logger";
import { withTransaction } from "../../utils/withTransaction";
import type { Rule, MerchantCache, PlannedEffect, BlockedRuleReferences, BlockedRuleRun } from "./types";
import type { TransactionUpdateSnapshot } from "../../repositories/TransactionUpdateWriter";
import { writeRuleApplyAudit } from "./apply-audit";
import { EMPTY_PROPOSAL, summarizeEffects, type RuleProposal } from "./proposal";
import { matchesRule } from "./matching";
import { evaluateActions, linkGoalsToTransaction, planRuleActions } from "./actions";
import { EMPTY_OUTCOME, failureOf, withRow, type RuleApplyOutcome } from "./apply-outcome";

/** A rule's blocked ids as a run entry, or null when it blocked nothing. */
function toBlockedRun(ruleId: string, blocked: BlockedRuleReferences): BlockedRuleRun | null {
  if (blocked.categoryIds.length + blocked.tagIds.length === 0) return null;
  return { ruleId, categoryIds: [...blocked.categoryIds], tagIds: [...blocked.tagIds] };
}

export class RuleService {
  /**
   * Apply all enabled rules to a single transaction
   * @param transaction - The transaction to apply rules to
   * @param householdId - The household ID
   * @param context - Optional context with userId
   * @param dryRun - If true, returns what would be changed without persisting
   * @returns The updated transaction. With dryRun it is the previewed
   *   transaction plus the proposed tag, alias, split and goal-link changes.
   */
  async applyRules(
    transaction: Transaction,
    householdId: string,
    context?: { userId?: string; dryRun?: boolean }
  ): Promise<Transaction> {
    const rules = await ruleRepository.findEnabledByHousehold(householdId);

    if (rules.length === 0) {
      return transaction;
    }

    // Dry-run: preview only, no transaction wrapper (behavior unchanged).
    if (context?.dryRun) {
      return this.previewRules(transaction, householdId, rules);
    }

    return (await this.persistRules(transaction, householdId, rules, context)).transaction;
  }

  /**
   * SCP-334: run the ENTIRE apply — every matched rule's inline writes
   * (tags, merchant aliases, splits), the field update, and goal links — in
   * ONE database transaction so a partial failure rolls back the whole apply
   * instead of leaving the transaction half-ruled. evaluateActions and
   * linkGoalsToTransaction propagate DB errors when given a tx (no swallow).
   * `changed` says whether any rule changed the row (A-32 counts it).
   */
  private async persistRules(
    transaction: Transaction,
    householdId: string,
    rules: Rule[],
    context?: { userId?: string }
  ): Promise<{ transaction: Transaction; changed: boolean }> {
    return withTransaction(async (tx) => {
      let currentTransaction = { ...transaction };
      let updates: Partial<Transaction> = {};
      const linkGoalIds: string[] = [];
      const effects: PlannedEffect[] = [];
      const changedByRuleIds: string[] = [];
      const blockedRuns: BlockedRuleRun[] = [];
      const merchantCache: MerchantCache = new Map();

      for (const rule of rules) {
        if (
          await matchesRule(rule, currentTransaction, householdId, merchantCache)
        ) {
          const {
            updates: actionUpdates,
            linkGoalIds: actionLinkGoals,
            effects: actionEffects,
            blocked,
          } =
            await evaluateActions(
              rule,
              currentTransaction,
              householdId,
              merchantCache,
              tx
            );

          if (Object.keys(actionUpdates).length > 0) {
            updates = { ...updates, ...actionUpdates };
            currentTransaction = { ...currentTransaction, ...actionUpdates };

            logger.info(
              "Rule updates prepared",
              {
                ruleId: rule.id,
                transactionId: transaction.id,
                householdId,
                updatesCount: Object.keys(actionUpdates).length,
                action: "apply",
              }
            );
          }

          if (actionLinkGoals.length > 0) {
            linkGoalIds.push(...actionLinkGoals);
          }
          effects.push(...actionEffects);
          if (
            Object.keys(actionUpdates).length > 0 ||
            actionLinkGoals.length > 0 ||
            actionEffects.length > 0
          ) {
            changedByRuleIds.push(rule.id);
          }
          const blockedRun = toBlockedRun(rule.id, blocked);
          if (blockedRun) blockedRuns.push(blockedRun);
        }
      }

      // Persist field changes within the same transaction
      let finalTransaction = currentTransaction;
      let snapshot: TransactionUpdateSnapshot | undefined;
      if (Object.keys(updates).length > 0 && transaction.id) {
        const updated = await transactionRepository.update(
          transaction.id,
          householdId,
          updates,
          undefined,
          tx,
          { onWrite: async (_tx, written) => { snapshot = written; } }
        );
        finalTransaction = updated.transaction || currentTransaction;
      }

      if (transaction.id && linkGoalIds.length > 0) {
        await linkGoalsToTransaction(
          finalTransaction,
          householdId,
          linkGoalIds,
          context?.userId,
          tx
        );
      }

      // FIN-16: one audit row per changed transaction, in this same transaction,
      // so a failed audit insert rolls the whole apply back. A run whose
      // actions were blocked (ORG-003) is audited even if nothing changed.
      if (transaction.id && (changedByRuleIds.length > 0 || blockedRuns.length > 0)) {
        await writeRuleApplyAudit(tx, {
          householdId,
          userId: context?.userId ?? null,
          transaction,
          snapshot,
          updates,
          effects,
          linkGoalIds,
          ruleIds: changedByRuleIds,
          blocked: blockedRuns,
        });
      }

      return { transaction: finalTransaction, changed: changedByRuleIds.length > 0 };
    });
  }

  /**
   * Dry-run preview helper: evaluates matched rules to compute the previewed
   * transaction. Mirrors the pre-SCP-334 dry-run behavior (no transaction
   * wrapper). Uses planRuleActions, which writes nothing (C3-09).
   */
  private async previewRules(
    transaction: Transaction,
    householdId: string,
    rules: Rule[]
  ): Promise<Transaction & RuleProposal> {
    let currentTransaction = { ...transaction };
    let updates: Partial<Transaction> = {};
    const linkGoalIds: string[] = [];
    const effects: PlannedEffect[] = [];
    const blockedRuns: BlockedRuleRun[] = [];
    const merchantCache: MerchantCache = new Map();

    for (const rule of rules) {
      if (
        await matchesRule(rule, currentTransaction, householdId, merchantCache)
      ) {
        const {
          updates: actionUpdates,
          linkGoalIds: actionLinkGoals,
          effects: actionEffects,
          blocked,
        } =
          await planRuleActions(
            rule,
            currentTransaction,
            householdId,
            merchantCache
          );

        if (Object.keys(actionUpdates).length > 0) {
          updates = { ...updates, ...actionUpdates };
          currentTransaction = { ...currentTransaction, ...actionUpdates };
        }

        if (actionLinkGoals.length > 0) {
          linkGoalIds.push(...actionLinkGoals);
        }
        effects.push(...actionEffects);
        const blockedRun = toBlockedRun(rule.id, blocked);
        if (blockedRun) blockedRuns.push(blockedRun);
      }
    }

    logger.info("Dry-run mode: preview generated without persisting changes", {
      transactionId: transaction.id,
      updatesCount: Object.keys(updates).length,
      linkGoalIdsCount: linkGoalIds.length,
    });
    return { ...currentTransaction, ...summarizeEffects(effects, linkGoalIds, blockedRuns) };
  }

  /**
   * Apply rules to multiple transactions (apply-to-past). Returns each
   * transaction as it now stands and the outcome: rows changed, and rows that
   * failed with the reason (A-32), so the caller can report a partial apply.
   */
  async applyRulesToTransactions(
    transactions: Transaction[],
    householdId: string,
    context?: { userId?: string }
  ): Promise<{ transactions: Transaction[]; outcome: RuleApplyOutcome }> {
    const results: Transaction[] = [];
    let outcome: RuleApplyOutcome = EMPTY_OUTCOME;
    for (const txn of transactions) {
      // Rule 11 defence-in-depth: never mutate another member's PRIVATE
      // transaction, even if a caller passes an unfiltered list. Callers are
      // expected to fetch via findByHouseholdWithVisibility; this guard covers
      // the transaction-privacy half for any path that doesn't. Such a row is
      // neither counted nor listed in the outcome.
      if (txn.isPrivate && context?.userId && txn.ownerUserId !== context.userId) {
        results.push(txn);
        continue;
      }
      // SCP-334: each transaction's rule application is atomic. In a batch
      // (apply-to-past), one transaction's rollback must not abort the whole
      // batch — keep that transaction un-ruled and report it as failed.
      try {
        const applied = await this.applyRulesTracked(txn, householdId, context);
        results.push(applied.transaction);
        outcome = withRow(outcome, { changed: applied.changed });
      } catch (error) {
        logger.error("Rule application failed for transaction in batch", {
          householdId,
          transactionId: txn.id,
          error,
        });
        results.push(txn);
        outcome = withRow(outcome, { failure: failureOf(txn, error) });
      }
    }
    return { transactions: results, outcome };
  }

  /**
   * Apply-to-past after a rule is saved: run the rules over every past
   * transaction `userId` can see and say what happened (A-32). Rule 11: only
   * rows VISIBLE to the requester are read or changed, so another member's
   * private transactions stay untouched and unreported (mirrors dryRunRule /
   * SCP-334). includePending: false keeps pending transactions out.
   */
  async applyToPast(householdId: string, userId: string): Promise<RuleApplyOutcome> {
    const visibleTransactions = await transactionRepository.findByHouseholdWithVisibility(
      householdId,
      userId,
      { includePending: false },
    );
    const { outcome } = await this.applyRulesToTransactions(visibleTransactions, householdId, { userId });
    return outcome;
  }

  /** applyRules for one batch row, also saying whether any rule changed it. */
  private async applyRulesTracked(
    transaction: Transaction,
    householdId: string,
    context?: { userId?: string }
  ): Promise<{ transaction: Transaction; changed: boolean }> {
    const rules = await ruleRepository.findEnabledByHousehold(householdId);
    if (rules.length === 0) return { transaction, changed: false };
    return this.persistRules(transaction, householdId, rules, context);
  }

  /**
   * Test if a rule's conditions match a transaction (public method for preview)
   * Used by preview endpoint to check matches without applying actions
   */
  async testRuleConditions(
    rule: Rule,
    transaction: Transaction,
    householdId: string
  ): Promise<boolean> {
    const merchantCache: MerchantCache = new Map();
    return matchesRule(rule, transaction, householdId, merchantCache);
  }

  /**
   * Test a rule against recent transactions visible to the requesting user
   * (Rule 11: another member's private transactions must not be counted).
   */
  async testRule(
    ruleId: string,
    householdId: string,
    userId: string
  ): Promise<number> {
    const rule = await ruleRepository.findByIdAndHousehold(ruleId, householdId);
    if (!rule) {
      throw new Error("Rule not found");
    }

    // Fetch up to 100 recent visible transactions to test against
    const transactions =
      await transactionRepository.findByHouseholdWithVisibility(
        householdId,
        userId,
        { limit: 100, includePending: false }
      );

    let matchCount = 0;
    const merchantCache: MerchantCache = new Map();
    for (const txn of transactions) {
      if (await matchesRule(rule, txn, householdId, merchantCache)) {
        matchCount++;
      }
    }

    return matchCount;
  }

  /**
   * Dry-run: Preview what actions a rule would apply to a transaction
   * @returns Object with original transaction, proposed updates, and matched rule info
   */
  async dryRunRule(
    ruleId: string,
    transactionId: string,
    householdId: string,
    userId: string
  ): Promise<
    {
      transaction: Transaction;
      matches: boolean;
      proposedUpdates: Partial<Transaction>;
    } & RuleProposal
  > {
    const rule = await ruleRepository.findByIdAndHousehold(ruleId, householdId);
    if (!rule) {
      throw new Error("Rule not found");
    }

    // SCP-334: enforce visibility — a member must NOT be able to dry-run a rule
    // against another member's PRIVATE transaction (which would leak its
    // name/amount/category). findByIdWithVisibility returns undefined for a
    // private transaction the requester doesn't own, exactly like a missing row.
    const transaction = await transactionRepository.findByIdWithVisibility(
      transactionId,
      householdId,
      userId
    );
    if (!transaction) {
      throw new Error("Transaction not found");
    }

    const merchantCache: MerchantCache = new Map();
    const matches = await matchesRule(rule, transaction, householdId, merchantCache);

    if (!matches) {
      return {
        transaction,
        matches: false,
        proposedUpdates: {},
        ...EMPTY_PROPOSAL,
      };
    }

    // C3-09: planRuleActions computes the proposal and writes nothing; the
    // persist step (persistRuleEffects) is never reachable from a dry run.
    const { updates, linkGoalIds, effects, blocked } = await planRuleActions(
      rule,
      transaction,
      householdId,
      merchantCache
    );

    const blockedRun = toBlockedRun(rule.id, blocked);
    const proposal = summarizeEffects(effects, linkGoalIds, blockedRun ? [blockedRun] : []);

    return {
      transaction,
      matches: true,
      proposedUpdates: updates,
      ...proposal,
    };
  }
}

export const ruleService = new RuleService();
