/**
 * Rule Actions
 *
 * Action evaluation and execution for transaction rules.
 *
 * @module services/rule/actions
 */

import { type Transaction, type InsertTransaction } from "@shared/schema";
import { Money } from "../../core/money";
import { transactionRepository } from "../../repositories/TransactionRepository";
import { merchantRepository } from "../../repositories/MerchantRepository";
import { tagRepository } from "../../repositories/TagRepository";
import { logger } from "../../utils/logger";
import { transactionGoalLinkService } from "../TransactionGoalLinkService";
import { type TransactionType } from "../../utils/withTransaction";
import type { Rule, RuleAction, RuleActionResult, MerchantCache } from "./types";
import { resolveMerchant } from "./matching";

/**
 * Generate updates based on actions
 *
 * SCP-334: when `tx` is provided, all inline writes (tags, merchant aliases,
 * splits) run inside that transaction. DB-write failures must PROPAGATE so the
 * enclosing rule-apply transaction rolls back as a whole — they are no longer
 * swallowed per-action.
 */
export async function evaluateActions(
  rule: Rule,
  transaction: Transaction,
  householdId: string,
  merchantCache: MerchantCache,
  tx?: TransactionType
): Promise<RuleActionResult> {
  const actions = rule.actions as RuleAction[];
  // Filter to only enabled actions (default to true if enabled is undefined)
  const activeActions = actions.filter((a) => a.enabled !== false);
  const updates: Partial<Transaction> = {};
  const linkGoalIds: string[] = [];
  let currentMerchantId = transaction.merchantId ?? null;

  for (const action of activeActions) {
    try {
      const { type, value } = action;

      switch (type) {
        case "rename_merchant":
          updates.name = String(value);
          break;
        case "categorize":
          updates.categoryId = String(value);
          break;
        case "add_tags": {
          if (transaction.id) {
            const tagIds = Array.isArray(value) ? value : [String(value)];
            for (const tagId of tagIds) {
              if (tagId && tagId.trim()) {
                // SCP-334: no inner catch — a failed tag write must roll back
                // the whole rule apply, not be silently swallowed.
                // SCP-335: only bump usageCount when the link was newly added,
                // so re-applying a rule does not inflate the count.
                const { inserted } = await tagRepository.addTagToTransaction(
                  transaction.id,
                  tagId,
                  tx
                );
                if (inserted) {
                  await tagRepository.incrementUsageCount(tagId, tx);
                }
              }
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

          if (!alreadyExists) {
            await merchantRepository.addAlias(merchant.id, aliasName, tx);
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
          // FIX INT-RULES-001: Persist rule-generated splits to transaction_splits table
          const splits = action.splitConfig;

          if (!splits || splits.length === 0) break;

          // Use Money class for all split calculations to maintain precision
          const totalMoney = new Money(transaction.amount).abs();

          // Track remainder for last split to avoid rounding errors
          let remainder = totalMoney;
          const splitAmounts: Money[] = [];

          // Calculate split amounts, assigning remainder to last split
          for (let i = 0; i < splits.length; i++) {
            const split = splits[i];
            let splitMoney: Money;

            if (i === splits.length - 1) {
              // Last split gets the remainder to avoid rounding errors
              splitMoney = remainder;
            } else if (split.percentage) {
              // Calculate percentage using Money arithmetic
              splitMoney = totalMoney.multiply(split.percentage).divide(100);
              remainder = remainder.subtract(splitMoney);
            } else if (split.amount) {
              splitMoney = new Money(String(split.amount));
              remainder = remainder.subtract(splitMoney);
            } else {
              splitMoney = Money.zero();
            }

            splitAmounts.push(splitMoney);
          }

          // Build split records for transaction_splits table
          const splitRecords = splits
            .map((split, i) => {
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
            .filter((s): s is NonNullable<typeof s> => s !== null);

          // Persist splits to transaction_splits table
          if (splitRecords.length > 0 && transaction.id) {
            // SCP-334: no inner catch — a failed split write must roll back the
            // whole rule apply (including the parent-transaction update below).
            await transactionRepository.addSplits(
              transaction.id,
              householdId,
              splitRecords,
              tx
            );

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
      // SCP-334: in atomic mode (running inside a transaction) a failed action
      // must abort the whole apply so the transaction rolls back. Only the
      // legacy non-atomic path continues on error.
      if (tx) {
        throw error;
      }
      // Continue with other actions even if one fails
    }
  }

  return { updates, linkGoalIds };
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

  const uniqueGoalIds = Array.from(new Set(goalIds)).filter(Boolean);
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
