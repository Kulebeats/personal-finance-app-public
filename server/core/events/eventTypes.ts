/**
 * Event Types Registry
 *
 * SINGLE SOURCE OF TRUTH for all domain event types.
 * All event types should be defined here and imported elsewhere.
 *
 * @module core/events/eventTypes
 */

export const EventTypes = {
  // Transaction events
  TRANSACTION_CREATED: "transaction.created",
  TRANSACTION_UPDATED: "transaction.updated",
  TRANSACTION_DELETED: "transaction.deleted",
  TRANSACTION_CATEGORIZED: "transaction.categorized",

  // Account events
  ACCOUNT_CREATED: "account.created",
  ACCOUNT_UPDATED: "account.updated",
  ACCOUNT_DELETED: "account.deleted",
  ACCOUNT_BALANCE_CHANGED: "account.balance_changed",
  ACCOUNT_BALANCE_ADJUSTED: "account.balance_adjusted",

  // Goal events
  GOAL_CREATED: "goal.created",
  GOAL_UPDATED: "goal.updated",
  GOAL_DELETED: "goal.deleted",
  GOAL_PROGRESS_UPDATED: "goal.progress_updated",
  GOAL_PROGRESS_CHANGED: "goal.progress_changed",
  GOAL_COMPLETED: "goal.completed",

  // Budget events
  BUDGET_CREATED: "budget.created",
  BUDGET_UPDATED: "budget.updated",
  BUDGET_DELETED: "budget.deleted",
  BUDGET_THRESHOLD_EXCEEDED: "budget.threshold_exceeded",

  // Recurring events
  RECURRING_CREATED: "recurring.created",
  RECURRING_UPDATED: "recurring.updated",
  RECURRING_DELETED: "recurring.deleted",
  RECURRING_PAUSED: "recurring.paused",
  RECURRING_RESUMED: "recurring.resumed",

  // Report events
  REPORT_GENERATED: "report.generated",
  REPORT_CACHE_INVALIDATED: "report.cache_invalidated",
} as const;

export type EventType = (typeof EventTypes)[keyof typeof EventTypes];
