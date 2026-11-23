/** Short labels the rule card pills show for each condition, operator and action. */

export const CONDITION_LABELS: Record<string, string> = {
  original_statement: "Statement",
  merchant_name: "Merchant",
  amount: "Amount",
  category: "Category",
  account: "Account",
  transaction_type: "Type",
  description: "Description",
};

export const OPERATOR_LABELS: Record<string, string> = {
  contains: "contains",
  equals: "=",
  starts_with: "starts with",
  ends_with: "ends with",
  not_contains: "doesn't contain",
  greater_than: ">",
  less_than: "<",
  range: "between",
  regex: "matches",
};

export const ACTION_LABELS: Record<string, string> = {
  rename_merchant: "Rename",
  categorize: "Categorize",
  add_tags: "Add tags",
  set_merchant: "Set merchant",
  hide: "Hide",
  mark_reviewed: "Mark reviewed",
  set_owner: "Set owner",
  link_goal: "Link goal",
  set_category_from_merchant: "Auto-categorize",
};
