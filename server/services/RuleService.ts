/**
 * Rule Service
 *
 * Re-exports from modularized rule services for backward compatibility.
 *
 * @module services/RuleService
 * @see services/rule/service for implementation
 */

export { RuleService, ruleService } from "./rule/service";
export type { RuleCondition, RuleAction } from "./rule/types";
