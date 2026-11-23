/**
 * Rule Services Index
 *
 * Re-exports all rule-related services and utilities.
 *
 * @module services/rule
 */

export { RuleService, ruleService } from "./service";
export type {
  Rule,
  RuleCondition,
  RuleAction,
  RuleActionResult,
  RuleActionPlan,
  PlannedEffect,
  PlannedSplit,
  MerchantCache,
} from "./types";
export { matchesRule, evaluateCondition, resolveMerchant } from "./matching";
export {
  evaluateActions,
  planRuleActions,
  persistRuleEffects,
  linkGoalsToTransaction,
} from "./actions";
