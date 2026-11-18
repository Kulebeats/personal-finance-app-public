/**
 * Shared Rule Condition and Action Type Definitions
 *
 * Single source of truth for condition types, operators, and action types
 * used across client and server.
 */

// ============================================================================
// CONDITION TYPES
// ============================================================================

export const CONDITION_TYPES = [
  "original_statement",
  "merchant_name",
  "merchant_category",
  "amount",
  "account",
  "description",
  "category",
  "transaction_type",
] as const;

export type ConditionType = (typeof CONDITION_TYPES)[number];

// ============================================================================
// OPERATORS
// ============================================================================

export const TEXT_OPERATORS = [
  "equals",
  "not_equals",
  "contains",
  "starts_with",
  "ends_with",
  "not_contains",
  "regex",
] as const;

export const NUMBER_OPERATORS = [
  "equals",
  "greater_than",
  "less_than",
  "range",
] as const;

export const ALL_OPERATORS = [...TEXT_OPERATORS, ...NUMBER_OPERATORS] as const;

export type TextOperator = (typeof TEXT_OPERATORS)[number];
export type NumberOperator = (typeof NUMBER_OPERATORS)[number];
export type Operator = (typeof ALL_OPERATORS)[number];

// ============================================================================
// ACTION TYPES
// ============================================================================

export const ACTION_TYPES = [
  "rename_merchant",
  "categorize",
  "add_tags",
  "add_merchant_alias",
  "hide",
  "mark_reviewed",
  "link_goal",
  "split_transaction",
  "assign_member",
  "set_owner",
  "set_merchant",
  "set_category_from_merchant",
  "set_review_status",
] as const;

export type ActionType = (typeof ACTION_TYPES)[number];
