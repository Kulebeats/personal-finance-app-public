/**
 * Audit for a rule apply (FIN-16): one UPDATE row per changed transaction,
 * written inside the apply's database transaction.
 *
 * @module services/rule/apply-audit
 */

import type { Transaction } from "@shared/schema";
import type { TransactionType } from "../../utils/withTransaction";
import type { TransactionUpdateSnapshot } from "../../repositories/TransactionUpdateWriter";
import { auditTransactionUpdate, isPrivateTransactionAudit } from "../transaction/updateAudit";
import type { BlockedRuleRun, PlannedEffect } from "./types";

export interface RuleApplyAuditInput {
  householdId: string;
  userId: string | null;
  /** The transaction as it was before the apply. */
  transaction: Transaction;
  /** Set when a field update was written; carries the locked before/after rows. */
  snapshot?: TransactionUpdateSnapshot;
  /** Every field update the rules made. */
  updates: Partial<Transaction>;
  effects: readonly PlannedEffect[];
  linkGoalIds: readonly string[];
  /** Rules that changed something, in apply order. */
  ruleIds: readonly string[];
  /** Rules whose actions named ids outside the household (ORG-003); those actions were skipped. */
  blocked?: readonly BlockedRuleRun[];
}

function summarizeEffects(effects: readonly PlannedEffect[], linkGoalIds: readonly string[]) {
  const tagIds = effects.flatMap((effect) => (effect.kind === "add_tag" ? [effect.tagId] : []));
  const aliases = effects.flatMap((effect) => (effect.kind === "add_merchant_alias" ? [effect.aliasName] : []));
  const splitsReplaced = effects.some((effect) => effect.kind === "replace_splits");
  return {
    ...(tagIds.length > 0 ? { tagIds } : {}),
    ...(aliases.length > 0 ? { merchantAliases: aliases } : {}),
    ...(splitsReplaced ? { splitsReplaced } : {}),
    ...(linkGoalIds.length > 0 ? { goalIds: [...linkGoalIds] } : {}),
  };
}

/** Writes the single audit row (and event) for a transaction a rule apply changed. */
export async function writeRuleApplyAudit(tx: TransactionType, input: RuleApplyAuditInput): Promise<void> {
  const effectSummary = summarizeEffects(input.effects, input.linkGoalIds);
  const hasEffects = Object.keys(effectSummary).length > 0;
  const blocked = input.blocked ?? [];
  const hasBlocked = blocked.length > 0;
  if (!input.snapshot && !hasEffects && !hasBlocked) return;

  const before = input.snapshot?.before ?? input.transaction;
  const after = input.snapshot?.after ?? input.transaction;
  await auditTransactionUpdate(tx, {
    householdId: input.householdId,
    userId: input.userId,
    before,
    after,
    privateAudit: input.snapshot?.privateAudit === true || await isPrivateTransactionAudit(tx, input.transaction),
    onlyFields: Object.keys(input.updates),
    alwaysWrite: hasEffects || hasBlocked,
    metadata: {
      source: "rule_apply",
      ruleId: input.ruleIds[0] ?? blocked[0]?.ruleId,
      ruleIds: [...input.ruleIds],
      ...(hasEffects ? { effects: effectSummary } : {}),
      ...(hasBlocked ? { blockedReferences: blocked.map((run) => ({ ...run })) } : {}),
    },
  });
}
