import { RuleAction, RuleCondition } from "./types";
import { REMOVED_ACTION_LABELS } from "@shared/ruleConditions";
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
  { value: "set_review_status", label: "Set review status", icon: "✅" },
] as const;

/**
 * "<label> (removed)" for an action type that was removed (A-44), which a rule
 * saved before the removal can still hold; undefined for a current type.
 */
export const removedActionLabel = (type: string): string | undefined => {
  const label = REMOVED_ACTION_LABELS[type];
  return label ? `${label} (removed)` : undefined;
};

export const getDefaultCondition = (type: string): RuleCondition => ({
  type: type as RuleCondition["type"],
  operator: (OPERATORS[type as keyof typeof OPERATORS]?.[0]?.value ||
    "contains") as RuleCondition["operator"],
  value: "",
  enabled: true,
});

// The server accepts add_tags as one tag id or a list (validateRuleTagReferenceSets);
// the picker always works on a list.
export const toTagIds = (value: string | string[] | undefined): string[] => {
  if (Array.isArray(value)) return value;
  return value ? [value] : [];
};

export const getDefaultAction = (type: string): RuleAction => ({
  type: type as RuleAction["type"],
  // add_tags holds a list of existing tag ids; every other action one string.
  value: type === "add_tags" ? [] : "",
  enabled: true,
  splitConfig:
    type === "split_transaction"
      ? [
          { categoryId: "", percentage: 50 },
          { categoryId: "", percentage: 50 },
        ]
      : undefined,
});
