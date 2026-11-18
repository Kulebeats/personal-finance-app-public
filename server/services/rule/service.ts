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
import type { Rule, MerchantCache } from "./types";
import { matchesRule } from "./matching";
import { evaluateActions, linkGoalsToTransaction } from "./actions";

export class RuleService {
  /**
   * Apply all enabled rules to a single transaction
   * @param transaction - The transaction to apply rules to
   * @param householdId - The household ID
   * @param context - Optional context with userId
   * @param dryRun - If true, returns what would be changed without persisting
   * @returns The updated transaction (or preview if dryRun)
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

    // SCP-334: run the ENTIRE apply — every matched rule's inline writes
    // (tags, merchant aliases, splits), the field update, and goal links — in
    // ONE database transaction so a partial failure rolls back the whole apply
    // instead of leaving the transaction half-ruled. evaluateActions and
    // linkGoalsToTransaction propagate DB errors when given a tx (no swallow).
    return withTransaction(async (tx) => {
      let currentTransaction = { ...transaction };
      let updates: Partial<Transaction> = {};
      const linkGoalIds: string[] = [];
      const merchantCache: MerchantCache = new Map();

      for (const rule of rules) {
        if (
          await matchesRule(rule, currentTransaction, householdId, merchantCache)
        ) {
          const { updates: actionUpdates, linkGoalIds: actionLinkGoals } =
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
              `Applied rule "${rule.name}" to transaction ${transaction.id}`,
              {
                ruleId: rule.id,
                transactionId: transaction.id,
                updates: actionUpdates,
              }
            );
          }

          if (actionLinkGoals.length > 0) {
            linkGoalIds.push(...actionLinkGoals);
          }
        }
      }

      // Persist field changes within the same transaction
      let finalTransaction = currentTransaction;
      if (Object.keys(updates).length > 0 && transaction.id) {
        const updated = await transactionRepository.update(
          transaction.id,
          householdId,
          updates,
          undefined,
          tx
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

      return finalTransaction;
    });
  }

  /**
   * Dry-run preview helper: evaluates matched rules to compute the previewed
   * transaction. Mirrors the pre-SCP-334 dry-run behavior (no transaction
   * wrapper; evaluateActions is called without a tx).
   */
  private async previewRules(
    transaction: Transaction,
    householdId: string,
    rules: Rule[]
  ): Promise<Transaction> {
    let currentTransaction = { ...transaction };
    let updates: Partial<Transaction> = {};
    const linkGoalIds: string[] = [];
    const merchantCache: MerchantCache = new Map();

    for (const rule of rules) {
      if (
        await matchesRule(rule, currentTransaction, householdId, merchantCache)
      ) {
        const { updates: actionUpdates, linkGoalIds: actionLinkGoals } =
          await evaluateActions(
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
      }
    }

    logger.info("Dry-run mode: preview generated without persisting changes", {
      transactionId: transaction.id,
      updatesCount: Object.keys(updates).length,
      linkGoalIdsCount: linkGoalIds.length,
    });
    return currentTransaction;
  }

  /**
   * Apply rules to multiple transactions
   */
  async applyRulesToTransactions(
    transactions: Transaction[],
    householdId: string,
    context?: { userId?: string }
  ): Promise<Transaction[]> {
    const results: Transaction[] = [];
    for (const txn of transactions) {
      // Rule 11 defence-in-depth: never mutate another member's PRIVATE
      // transaction, even if a caller passes an unfiltered list. Callers are
      // expected to fetch via findByHouseholdWithVisibility; this guard covers
      // the transaction-privacy half for any path that doesn't.
      if (txn.isPrivate && context?.userId && txn.ownerUserId !== context.userId) {
        results.push(txn);
        continue;
      }
      // SCP-334: each transaction's rule application is atomic. In a batch
      // (apply-to-past), one transaction's rollback must not abort the whole
      // batch — log it and keep that transaction un-ruled.
      try {
        results.push(await this.applyRules(txn, householdId, context));
      } catch (error) {
        logger.error("Rule application failed for transaction in batch", {
          householdId,
          transactionId: txn.id,
          error,
        });
        results.push(txn);
      }
    }
    return results;
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
  ): Promise<{
    transaction: Transaction;
    matches: boolean;
    proposedUpdates: Partial<Transaction>;
    linkGoalIds: string[];
  }> {
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
        linkGoalIds: [],
      };
    }

    const { updates, linkGoalIds } = await evaluateActions(
      rule,
      transaction,
      householdId,
      merchantCache
    );

    return {
      transaction,
      matches: true,
      proposedUpdates: updates,
      linkGoalIds,
    };
  }
}

export const ruleService = new RuleService();
