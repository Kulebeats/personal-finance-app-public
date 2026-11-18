import { RuleAction, RuleCondition } from "./types";
import {
  CONDITION_TYPE_CONFIGS,
  MERCHANT_CATEGORIES,
  OPERATOR_CONFIGS,
} from "@/features/settings/constants/ruleConditions";

// Re-export from shared constants for backward compatibility
export const CONDITION_TYPES = CONDITION_TYPE_CONFIGS;
export { MERCHANT_CATEGORIES };
export const OPERATORS = OPERATOR_CONFIGS;

// Action type configs
export const ACTION_TYPES = [
  { value: "rename_merchant", label: "Rename merchant", icon: "✏️" },
  { value: "categorize", label: "Update category", icon: "🏷️" },
  { value: "add_tags", label: "Add tags", icon: "🔖" },
  { value: "hide", label: "Hide transaction", icon: "👁️" },
  { value: "mark_reviewed", label: "Mark as reviewed", icon: "✅" },
  { value: "set_owner", label: "Set owner", icon: "👤" },
  { value: "link_goal", label: "Link to goal", icon: "🎯" },
  { value: "split_transaction", label: "Split transaction", icon: "✂️" },
  { value: "set_merchant", label: "Set Merchant", icon: "🏪" },
  { value: "add_merchant_alias", label: "Add Alias", icon: "➕" },
  {
    value: "set_category_from_merchant",
    label: "Use Merchant Category",
    icon: "📦",
  },
  { value: "assign_member", label: "Assign member", icon: "👤" },
  { value: "set_review_status", label: "Set review status", icon: "✅" },
] as const;

export const getDefaultCondition = (type: string): RuleCondition => ({
  type: type as RuleCondition["type"],
  operator: (OPERATORS[type as keyof typeof OPERATORS]?.[0]?.value ||
    "contains") as RuleCondition["operator"],
  value: "",
  enabled: true,
});

export const getDefaultAction = (type: string): RuleAction => ({
  type: type as RuleAction["type"],
  value: "",
  enabled: true,
  splitConfig:
    type === "split_transaction"
      ? [
          { categoryId: "", percentage: 50 },
          { categoryId: "", percentage: 50 },
        ]
      : undefined,
});
