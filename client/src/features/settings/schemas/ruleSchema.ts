import { z } from "zod";
import {
  CONDITION_TYPES,
  ALL_OPERATORS,
  ACTION_TYPES,
} from "../constants/ruleConditions";

/**
 * Rule validation schemas using Zod
 *
 * Rules consist of:
 * - Conditions: field + operator + value combinations
 * - Actions: what to do when conditions match
 * - Metadata: name, enabled status, priority
 */

/**
 * Rule condition schema
 */
export const ruleConditionSchema = z.object({
  type: z.enum(CONDITION_TYPES),
  operator: z.enum(ALL_OPERATORS),
  value: z.string().min(1, "Condition value is required"),
  value2: z.string().optional(),
  enabled: z.boolean().optional().default(true),
});

export type RuleConditionData = z.infer<typeof ruleConditionSchema>;

/**
 * Rule action schema
 */
export const ruleActionSchema = z.object({
  type: z.enum(ACTION_TYPES),
  value: z.union([z.string(), z.number(), z.array(z.string())]),
  enabled: z.boolean().optional().default(true),
});

export type RuleActionData = z.infer<typeof ruleActionSchema>;

/**
 * Complete rule schema
 */
export const ruleSchema = z.object({
  name: z
    .string()
    .min(1, "Rule name is required")
    .max(100, "Rule name cannot exceed 100 characters"),

  conditions: z
    .array(ruleConditionSchema)
    .min(1, "At least one condition is required"),

  conditionLogic: z.enum(["all", "any"]).default("all"),

  actions: z.array(ruleActionSchema).min(1, "At least one action is required"),

  isEnabled: z.boolean().default(true),

  priority: z
    .number()
    .int("Priority must be an integer")
    .nonnegative("Priority cannot be negative"),
});

export type RuleFormData = z.infer<typeof ruleSchema>;

// Default rule data
export const defaultRuleData: Partial<RuleFormData> = {
  name: "",
  conditions: [],
  conditionLogic: "all",
  actions: [],
  isEnabled: true,
  priority: 0,
};

// Default condition
export const defaultCondition: RuleConditionData = {
  type: "merchant_name",
  operator: "contains",
  value: "",
  enabled: true,
};

// Default action
export const defaultAction: RuleActionData = {
  type: "categorize",
  value: "",
  enabled: true,
};
