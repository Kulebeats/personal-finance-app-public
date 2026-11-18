/**
 * Shared Rule Condition and Action Type Definitions
 *
 * Single source of truth for condition types, operators, and action types
 * used across validation schemas, API types, and UI components.
 */

import {
  CONDITION_TYPES,
  TEXT_OPERATORS,
  NUMBER_OPERATORS,
  ALL_OPERATORS,
  ACTION_TYPES,
  type ConditionType,
  type TextOperator,
  type NumberOperator,
  type Operator,
  type ActionType,
} from "@shared/ruleConditions";

export {
  CONDITION_TYPES,
  TEXT_OPERATORS,
  NUMBER_OPERATORS,
  ALL_OPERATORS,
  ACTION_TYPES,
};

export type {
  ConditionType,
  TextOperator,
  NumberOperator,
  Operator,
  ActionType,
};

// ============================================================================
// UI DISPLAY CONFIGS
// ============================================================================

export const CONDITION_TYPE_CONFIGS = [
  { value: "original_statement", label: "Original Statement", icon: "📝" },
  { value: "merchant_name", label: "Merchant Name", icon: "🏪" },
  { value: "merchant_category", label: "Merchant Category", icon: "🏷️" },
  { value: "amount", label: "Amount", icon: "💰" },
  { value: "category", label: "Categories", icon: "🏷️" },
  { value: "account", label: "Accounts", icon: "🏦" },
  { value: "transaction_type", label: "Transaction Type", icon: "📊" },
  { value: "description", label: "Description", icon: "📋" },
] as const;

export const MERCHANT_CATEGORIES = [
  "Food & Dining",
  "Transportation",
  "Utilities",
  "Telecommunications",
  "Retail & Shopping",
  "Banking & Finance",
  "Healthcare",
  "Education",
  "Entertainment",
  "Other",
] as const;

export const OPERATOR_CONFIGS = {
  original_statement: [
    { value: "contains", label: "Contains" },
    { value: "equals", label: "Equals" },
    { value: "starts_with", label: "Starts with" },
    { value: "ends_with", label: "Ends with" },
    { value: "not_contains", label: "Does not contain" },
    { value: "regex", label: "Matches regex" },
  ],
  merchant_name: [
    { value: "contains", label: "Contains" },
    { value: "equals", label: "Equals" },
    { value: "starts_with", label: "Starts with" },
    { value: "ends_with", label: "Ends with" },
    { value: "not_contains", label: "Does not contain" },
  ],
  merchant_category: [
    { value: "equals", label: "Is" },
    { value: "not_equals", label: "Is not" },
  ],
  amount: [
    { value: "greater_than", label: "Greater than" },
    { value: "less_than", label: "Less than" },
    { value: "equals", label: "Equals" },
    { value: "range", label: "Between" },
  ],
  account: [{ value: "equals", label: "Is" }],
  category: [{ value: "equals", label: "Is" }],
  transaction_type: [{ value: "equals", label: "Is" }],
  description: [
    { value: "contains", label: "Contains" },
    { value: "equals", label: "Equals" },
    { value: "starts_with", label: "Starts with" },
    { value: "ends_with", label: "Ends with" },
    { value: "not_contains", label: "Does not contain" },
  ],
} as const;
