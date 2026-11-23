/**
 * Rule Actions
 *
 * Action evaluation and execution for transaction rules.
 *
 * @module services/rule/actions
 */

import { type Transaction, type InsertTransaction } from "@shared/schema";
import { allocateRuleSplits } from "./split-allocation";
import { transactionRepository } from "../../repositories/TransactionRepository";
import { merchantRepository } from "../../repositories/MerchantRepository";
import { tagRepository } from "../../repositories/TagRepository";
import { logger } from "../../utils/logger";
import { transactionGoalLinkService } from "../TransactionGoalLinkService";
import { type TransactionType } from "../../utils/withTransaction";
import {
  actionTagIds,
  resolveOwnedActionReferences,
  splitCategoryIds,
  unownedIds,
  withBlocked,
} from "./action-references";
import type {
  BlockedRuleReferences,
  Rule,
  RuleAction,
  RuleActionPlan,
  PlannedEffect,
  PlannedSplit,
  MerchantCache,
} from "./types";
import { resolveMerchant } from "./matching";
import { assertRuleActionReferencesCurrent } from "./entity-references";
import { addMerchantAliasIfFree } from "../../modules/merchants/merchants.name-guard";

/**
 * Compute what a rule would do to a transaction. WRITES NOTHING (C3-09).
 *
 * This is the only evaluator a preview or dry run may use: it reads (merchant
 * lookup, existing aliases) and returns the field `updates`, goal ids to link,
 * and the database `effects` (tag links, merchant aliases, split replacement)
 * that a real apply would persist via `persistRuleEffects`.
 */
export async function planRuleActions(
  rule: Rule,
  transaction: Transaction,
  householdId: string,
  merchantCache: MerchantCache,
  tx?: TransactionType
): Promise<RuleActionPlan> {
  const actions = rule.actions as RuleAction[];
  // Filter to only enabled actions (default to true if enabled is undefined)
  const activeActions = actions.filter((a) => a.enabled !== false);
  // ORG-003: an owner/member can leave and a goal can go after a rule was
  // saved. Fail closed (the whole apply or preview aborts) rather than plan a
  // stale id. Real applies pass their transaction so the check is locked.
  await assertRuleActionReferencesCurrent(activeActions, householdId, tx);
  // ORG-003: a category or tag id that is not this household's skips the
  // action naming it; the run reports the id and nothing is written for it.
  const owned = await resolveOwnedActionReferences(activeActions, householdId, tx);
  let blocked: BlockedRuleReferences = { categoryIds: [], tagIds: [] };
  const updates: Partial<Transaction> = {};
  const linkGoalIds: string[] = [];
  const effects: PlannedEffect[] = [];
  const plannedAliasKeys = new Set<string>();
  let currentMerchantId = transaction.merchantId ?? null;

  for (const action of activeActions) {
    try {
      const { type, value } = action;

      switch (type) {
        case "rename_merchant":
          updates.name = String(value);
          break;
        case "categorize": {
          const categoryId = String(value);
          const foreign = unownedIds([categoryId], owned.categoryIds);
          if (foreign.length > 0) {
            blocked = withBlocked(blocked, { categoryIds: foreign });
            break;
          }
          updates.categoryId = categoryId;
          break;
        }
        case "add_tags": {
          const tagIds = actionTagIds(action);
          const foreign = unownedIds(tagIds, owned.tagIds);
          if (foreign.length > 0) {
            blocked = withBlocked(blocked, { tagIds: foreign });
            break;
          }
          if (transaction.id) {
            for (const tagId of tagIds) {
              effects.push({ kind: "add_tag", tagId });
            }
          }
          break;
        }
        case "set_merchant": {
          const merchantId = String(value);
          const merchant = await resolveMerchant(
            merchantId,
            householdId,
            merchantCache
          );
          if (merchant) {
            updates.merchantId = merchant.id;
            updates.name = merchant.name;
            currentMerchantId = merchant.id;
          }
          break;
        }
        case "set_category_from_merchant": {
          const merchant = await resolveMerchant(
            currentMerchantId,
            householdId,
            merchantCache
          );
          if (merchant?.defaultCategoryId) {
            updates.categoryId = merchant.defaultCategoryId;
          }
          break;
        }
        case "add_merchant_alias": {
          const aliasName = String(value).trim();
          if (!aliasName) break;

          const merchant = await resolveMerchant(
            currentMerchantId,
            householdId,
            merchantCache
          );
          if (!merchant) break;

          const normalizedAlias = aliasName.toLowerCase();
          if (merchant.name.toLowerCase() === normalizedAlias) break;

          const existingAliases = await merchantRepository.getAliases(merchant.id);
          const alreadyExists = existingAliases.some(
            (alias) => alias.aliasName.toLowerCase() === normalizedAlias
          );

          // A second planned alias with the same name must not become a second
          // insert: the earlier one is not in the database yet at plan time.
          const plannedKey = `${merchant.id}:${normalizedAlias}`;
          if (!alreadyExists && !plannedAliasKeys.has(plannedKey)) {
            plannedAliasKeys.add(plannedKey);
            effects.push({
              kind: "add_merchant_alias",
              merchantId: merchant.id,
              aliasName,
            });
          }
          break;
        }
        case "hide":
          updates.isExcludedFromReports = true;
          updates.isExcludedFromBudget = true;
          break;
        case "mark_reviewed":
          updates.reviewedAt = new Date();
          break;
        case "set_review_status":
          if (value === "reviewed") {
            updates.reviewedAt = new Date();
          } else if (value === "needs_review") {
            updates.reviewedAt = null;
          }
          break;
        case "link_goal":
          linkGoalIds.push(String(value));
          break;
        case "set_owner":
          if (value === "shared" || value === "") {
            updates.ownerUserId = null;
          } else {
            updates.ownerUserId = String(value);
          }
          break;
        case "split_transaction": {
          // FIX INT-RULES-001: rule-generated splits go to transaction_splits
          // when the plan is persisted (never while planning).
          const splits = action.splitConfig;
          const foreign = unownedIds(splitCategoryIds(action), owned.categoryIds);
          if (foreign.length > 0) {
            blocked = withBlocked(blocked, { categoryIds: foreign });
            break;
          }

          const splitAmounts = allocateRuleSplits(transaction.amount, transaction.currency ?? "ZMW", splits ?? []);

          // Build split records for transaction_splits table
          const splitRecords = (splits ?? [])
            .map((split, i): PlannedSplit | null => {
              const splitMoney = splitAmounts[i];
              // Skip zero or negative amounts
              if (splitMoney.lte(0)) return null;

              return {
                amount: splitMoney.toString(),
                categoryId: split.categoryId || null,
                merchantId: null, // Rule splits use categoryId, not merchantId
                notes: split.note || `Split ${i + 1}`,
                displayOrder: i,
              };
            })
            .filter((s): s is PlannedSplit => s !== null);

          if (splitRecords.length > 0 && transaction.id) {
            effects.push({ kind: "replace_splits", splits: splitRecords });

            // Add note to indicate splits were applied by rule
            updates.notes =
              (transaction.notes ? transaction.notes + "\n" : "") +
              `[Split by rule into ${splitRecords.length} categories]`;
          }

          break;
        }
      }
    } catch (error) {
      logger.error(`Failed to execute rule action ${action.type}`, {
        ruleId: rule.id,
        transactionId: transaction.id,
        actionType: action.type,
        error: error instanceof Error ? error.message : String(error),
      });
      // A failed action must abort the whole apply so its transaction rolls
      // back; a preview surfaces the failure rather than a partial answer.
      throw error;
    }
  }

  if (blocked.categoryIds.length + blocked.tagIds.length > 0) {
    logger.warn("Rule actions blocked: ids outside the transaction's household", {
      ruleId: rule.id,
      transactionId: transaction.id,
      householdId,
      blockedCategoryCount: blocked.categoryIds.length,
      blockedTagCount: blocked.tagIds.length,
    });
  }
  return { updates, linkGoalIds, effects, blocked };
}

/**
 * Persist the database effects of a plan. The ONLY writer of rule-action
 * effects: called by the real apply path, never by a dry run or preview.
 *
 * SCP-334: every write runs inside `tx` and failures PROPAGATE so the
 * enclosing rule-apply transaction rolls back as a whole.
 */
export async function persistRuleEffects(
  effects: PlannedEffect[],
  transaction: Transaction,
  householdId: string,
  tx: TransactionType
): Promise<void> {
  for (const effect of effects) {
    switch (effect.kind) {
      case "add_tag": {
        // SCP-335: only bump usageCount when the link was newly added, so
        // re-applying a rule does not inflate the count.
        const { inserted } = await tagRepository.addTagToTransaction(
          transaction.id,
          effect.tagId,
          tx
        );
        if (inserted) {
          await tagRepository.incrementUsageCount(effect.tagId, tx);
        }
        break;
      }
      case "add_merchant_alias":
        // One household namespace (merchants.name-guard): a name another
        // merchant already claims is skipped rather than duplicated.
        await addMerchantAliasIfFree(tx, householdId, effect.merchantId, effect.aliasName);
        break;
      case "replace_splits":
        await transactionRepository.addSplits(
          transaction.id,
          householdId,
          effect.splits,
          tx
        );
        break;
    }
  }
}

/**
 * Real-apply evaluator: plan the rule's actions, then persist their database
 * effects inside `tx`. `tx` is required — there is no write-free mode here;
 * previews use `planRuleActions` and never reach the persist step.
 */
export async function evaluateActions(
  rule: Rule,
  transaction: Transaction,
  householdId: string,
  merchantCache: MerchantCache,
  tx: TransactionType
): Promise<RuleActionPlan> {
  const plan = await planRuleActions(
    rule,
    transaction,
    householdId,
    merchantCache,
    tx
  );
  await persistRuleEffects(plan.effects, transaction, householdId, tx);
  return plan;
}

/**
 * Link goals to a transaction based on rule actions
 *
 * SCP-334: when `tx` is provided, links run inside that transaction (FOR UPDATE
 * threaded through) and a failed link PROPAGATES so the whole rule apply rolls
 * back. The legacy non-atomic path keeps continuing on per-goal failure.
 */
export async function linkGoalsToTransaction(
  transaction: Transaction,
  householdId: string,
  goalIds: string[],
  userId?: string,
  tx?: TransactionType
): Promise<void> {
  if (!transaction.id) {
    logger.debug("Skipping goal linking - transaction has no ID");
    return;
  }

  // Goals are locked in id order, as every other multi-goal writer does, so
  // two rules linking to overlapping goals cannot deadlock.
  const uniqueGoalIds = Array.from(new Set(goalIds)).filter(Boolean).sort();
  if (uniqueGoalIds.length === 0) {
    return;
  }

  if (transaction.type === "transfer") {
    logger.debug("Skipping goal linking - transfers cannot be linked to goals");
    return;
  }

  const linkType = transaction.type === "expense" ? "spending" : "contribution";
  const linkUserId = userId ?? transaction.ownerUserId ?? null;

  for (const goalId of uniqueGoalIds) {
    try {
      await transactionGoalLinkService.linkTransaction(
        goalId,
        householdId,
        linkUserId,
        {
          transactionId: transaction.id,
          linkType,
        },
        tx
      );
    } catch (error) {
      logger.warn("Goal auto-link failed", {
        goalId,
        transactionId: transaction.id,
        error: error instanceof Error ? error.message : String(error),
      });
      if (tx) {
        throw error;
      }
      // Continue with other goals even if one fails
    }
  }
}
