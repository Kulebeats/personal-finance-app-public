/**
 * Rule Proposal
 *
 * Describes what a rule WOULD do, from planned effects, for dry runs and
 * previews (C3-09). Pure: no database access.
 *
 * @module services/rule/proposal
 */

import type { BlockedRuleRun, PlannedEffect, PlannedSplit } from "./types";

export type RuleProposal = {
  linkGoalIds: string[];
  proposedTagIds: string[];
  proposedMerchantAliases: Array<{ merchantId: string; aliasName: string }>;
  proposedSplits: PlannedSplit[];
  /** Rules whose actions named ids outside the household; those actions were skipped. */
  blockedReferences: BlockedRuleRun[];
};

export const EMPTY_PROPOSAL: RuleProposal = {
  linkGoalIds: [],
  proposedTagIds: [],
  proposedMerchantAliases: [],
  proposedSplits: [],
  blockedReferences: [],
};

/** Summarise planned effects plus goal ids into the shape clients receive. */
export function summarizeEffects(
  effects: PlannedEffect[],
  linkGoalIds: string[],
  blockedReferences: BlockedRuleRun[] = []
): RuleProposal {
  const proposedTagIds: string[] = [];
  const proposedMerchantAliases: RuleProposal["proposedMerchantAliases"] = [];
  let proposedSplits: PlannedSplit[] = [];
  for (const effect of effects) {
    if (effect.kind === "add_tag") {
      if (!proposedTagIds.includes(effect.tagId)) {
        proposedTagIds.push(effect.tagId);
      }
    } else if (effect.kind === "add_merchant_alias") {
      proposedMerchantAliases.push({
        merchantId: effect.merchantId,
        aliasName: effect.aliasName,
      });
    } else {
      // Splits replace one another: the last planned replacement wins.
      proposedSplits = effect.splits;
    }
  }
  return {
    linkGoalIds: [...linkGoalIds],
    proposedTagIds,
    proposedMerchantAliases,
    proposedSplits,
    blockedReferences: [...blockedReferences],
  };
}
