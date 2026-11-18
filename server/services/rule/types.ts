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
    amount?: number;
    percentage?: number;
    note?: string;
    merchantName?: string;
  }>;
};

export type MerchantCache = Map<
  string,
  Awaited<ReturnType<typeof merchantRepository.findByIdAndHousehold>> | null
>;
