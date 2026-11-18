import { z } from "zod";
import { CONDITION_TYPES, ALL_OPERATORS, ACTION_TYPES } from "@shared/ruleConditions";
import { checkRegexSafety } from "../../core/safeRegex";

// ============================================================================
// Condition Schema
// ============================================================================

export const conditionSchema = z
  .object({
    type: z.enum(CONDITION_TYPES),
    operator: z.enum(ALL_OPERATORS),
    value: z.union([z.string(), z.number(), z.array(z.string())]),
    value2: z.union([z.string(), z.number()]).optional(),
    enabled: z.boolean().optional().default(true),
  })
  .superRefine((condition, ctx) => {
    // A regex condition is compiled against every candidate transaction, so a
    // pattern that backtracks exponentially would block the event loop for the
    // whole instance. Reject it at the door with a message the author can act
    // on; `matching.ts` re-checks at execution time for already-stored rules.
    if (condition.operator !== "regex") return;

    if (typeof condition.value !== "string") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["value"],
        message: "A regex condition requires a single string pattern",
      });
      return;
    }

    const safety = checkRegexSafety(condition.value);
    if (!safety.safe) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["value"],
        message: safety.reason,
      });
    }
  });

// ============================================================================
// Split Config Schema (for split_transaction action)
// ============================================================================

export const splitConfigSchema = z.object({
  categoryId: z.string().uuid().optional(),
  amount: z.number().positive().optional(),
  percentage: z.number().min(0).max(100).optional(),
  note: z.string().max(500).optional(),
  merchantName: z.string().max(255).optional(),
});

// ============================================================================
// Action Schema with typed values
// ============================================================================

// Action value can be:
// - string: for rename_merchant, categorize, add_merchant_alias, link_goal, assign_member, set_owner, set_merchant, set_category_from_merchant, set_review_status
// - string[]: for add_tags
// - undefined: for hide, mark_reviewed
const actionValueSchema = z.union([
  z.string(),
  z.array(z.string()),
]).optional();

export const actionSchema = z.object({
  type: z.enum(ACTION_TYPES),
  value: actionValueSchema,
  enabled: z.boolean().optional().default(true),
  splitConfig: z.array(splitConfigSchema).optional(),
});

export const createRuleSchema = z.object({
  name: z.string().min(1).max(255),
  conditions: z.array(conditionSchema).min(1),
  conditionLogic: z.enum(["all", "any"]).default("all"),
  actions: z.array(actionSchema).min(1),
  enabled: z.boolean().default(true),
  priority: z.number().int().optional(),
  applyToNew: z.boolean().default(true),
  applyToPast: z.boolean().default(false),
});

export const updateRuleSchema = createRuleSchema.partial();

// ============================================================================
// Bulk Operations Schema
// ============================================================================

export const bulkEnableDisableSchema = z.object({
  ruleIds: z.array(z.string().uuid()).min(1).max(50),
});

// ============================================================================
// Type Exports
// ============================================================================

export type BulkEnableDisableInput = z.infer<typeof bulkEnableDisableSchema>;

export type ConditionInput = z.infer<typeof conditionSchema>;
export type SplitConfigInput = z.infer<typeof splitConfigSchema>;
export type ActionInput = z.infer<typeof actionSchema>;
export type CreateRuleInput = z.infer<typeof createRuleSchema>;
export type UpdateRuleInput = z.infer<typeof updateRuleSchema>;
