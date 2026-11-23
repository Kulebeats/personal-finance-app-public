/**
 * Rule Types
 *
 * Type definitions for rule conditions and actions.
 *
 * @module services/rule/types
 */

import { type Transaction, rules } from "@shared/schema";
import type { ActionType, ConditionType, Operator } from "@shared/ruleConditions";
import { merchantRepository } from "../../repositories/MerchantRepository";

// Rule type from schema - conditionLogic is already a field in the DB
export type Rule = typeof rules.$inferSelect;

// Type guard for validating conditionLogic value at runtime
export function isValidConditionLogic(
  value: string | null
): value is "all" | "any" {
  return value === "all" || value === "any";
}

export type RuleActionResult = {
  updates: Partial<Transaction>;
  linkGoalIds: string[];
};

/** A split row a rule would write to transaction_splits. */
export type PlannedSplit = {
  amount: string;
  categoryId: string | null;
  merchantId: null;
  notes: string;
  displayOrder: number;
};

/**
 * A database write a rule action WOULD perform. Planning produces these;
 * only the real-apply path persists them (actions.persistRuleEffects).
 */
export type PlannedEffect =
  | { kind: "add_tag"; tagId: string }
  | { kind: "add_merchant_alias"; merchantId: string; aliasName: string }
  | { kind: "replace_splits"; splits: PlannedSplit[] };

/**
 * Category and tag ids a rule names that are not the transaction household's
 * (foreign or missing). The action naming one was skipped (ORG-003).
 */
export type BlockedRuleReferences = {
  categoryIds: string[];
  tagIds: string[];
};

/** One rule's blocked ids, as a run reports them. */
export type BlockedRuleRun = BlockedRuleReferences & { ruleId: string };

/** Everything a rule would do to a transaction, with nothing written. */
export type RuleActionPlan = RuleActionResult & {
  effects: PlannedEffect[];
  blocked: BlockedRuleReferences;
};

// Types matching server/routes/rules.ts schemas
// We define them here to avoid circular dependency or tight coupling with route layer Zod schemas
export type RuleCondition = {
  type: ConditionType;
  operator: Operator;
  value: string | number | string[];
  value2?: string | number;
  enabled?: boolean; // Per-condition toggle (defaults to true if undefined)
};

export type RuleAction = {
  type: ActionType;
  value: string | string[];
  enabled?: boolean; // Per-action toggle (defaults to true if undefined)
  splitConfig?: Array<{
    categoryId?: string;
    /** Fixed split amount as a decimal money string ("25.00"); never a float. */
    amount?: string;
    percentage?: number;
    note?: string;
    merchantName?: string;
  }>;
};

export type MerchantCache = Map<
  string,
  Awaited<ReturnType<typeof merchantRepository.findByIdAndHousehold>> | null
>;
