/**
 * Shared Notification Types
 *
 * Canonical list of notification types used across server, client, and seed data.
 * This ensures alignment and prevents type drift between components.
 */

export const NOTIFICATION_TYPES = {
  // Transactions
  LARGE_TRANSACTION: "large_transaction",
  RECURRING_DUE: "recurring_due",
  UNUSUAL_SPENDING: "unusual_spending", // Deferred to v2

  // Budget
  BUDGET_WARNING: "budget_warning",
  BUDGET_EXCEEDED: "budget_exceeded",

  // Goals
  GOAL_PROGRESS: "goal_progress",
  GOAL_ACHIEVED: "goal_achieved",

  // Investments
  PRICE_ALERT: "price_alert",
  STALE_PRICE: "stale_price",

  // Security
  NEW_LOGIN: "new_login",
  PASSWORD_CHANGED: "password_changed",
  EMAIL_CHANGED: "email_changed",

  // Reports
  WEEKLY_RECAP: "weekly_recap",
  MONTHLY_REPORT: "monthly_report",
  SMART_INSIGHT: "smart_insight",

  // System
  MAINTENANCE_ALERT: "maintenance_alert",
  FEATURE_UPDATE: "feature_update",
} as const;

export type NotificationType =
  (typeof NOTIFICATION_TYPES)[keyof typeof NOTIFICATION_TYPES];

// Investment preference rows share storage and the general settings read/save
// path. Keep the accepted preference types aligned with the investment route.
export const INVESTMENT_NOTIFICATION_PREFERENCE_TYPES = [
  "maturity_reminder", "coupon_payment", "price_alert", "stale_price", "auction_results",
] as const;

/**
 * Notification categories for settings UI organization
 */
export const NOTIFICATION_CATEGORIES = {
  TRANSACTIONS: "transactions",
  BUDGET: "budget",
  GOALS: "goals",
  INVESTMENTS: "investments",
  SECURITY: "security",
  REPORTS: "reports",
  SYSTEM: "system",
} as const;

export type NotificationCategory =
  (typeof NOTIFICATION_CATEGORIES)[keyof typeof NOTIFICATION_CATEGORIES];

/**
 * Mapping of notification types to their categories
 */
export const NOTIFICATION_TYPE_CATEGORY: Record<
  NotificationType,
  NotificationCategory
> = {
  [NOTIFICATION_TYPES.LARGE_TRANSACTION]: NOTIFICATION_CATEGORIES.TRANSACTIONS,
  [NOTIFICATION_TYPES.RECURRING_DUE]: NOTIFICATION_CATEGORIES.TRANSACTIONS,
  [NOTIFICATION_TYPES.UNUSUAL_SPENDING]: NOTIFICATION_CATEGORIES.TRANSACTIONS,
  [NOTIFICATION_TYPES.BUDGET_WARNING]: NOTIFICATION_CATEGORIES.BUDGET,
  [NOTIFICATION_TYPES.BUDGET_EXCEEDED]: NOTIFICATION_CATEGORIES.BUDGET,
  [NOTIFICATION_TYPES.GOAL_PROGRESS]: NOTIFICATION_CATEGORIES.GOALS,
  [NOTIFICATION_TYPES.GOAL_ACHIEVED]: NOTIFICATION_CATEGORIES.GOALS,
  [NOTIFICATION_TYPES.PRICE_ALERT]: NOTIFICATION_CATEGORIES.INVESTMENTS,
  [NOTIFICATION_TYPES.STALE_PRICE]: NOTIFICATION_CATEGORIES.INVESTMENTS,
  [NOTIFICATION_TYPES.NEW_LOGIN]: NOTIFICATION_CATEGORIES.SECURITY,
  [NOTIFICATION_TYPES.PASSWORD_CHANGED]: NOTIFICATION_CATEGORIES.SECURITY,
  [NOTIFICATION_TYPES.EMAIL_CHANGED]: NOTIFICATION_CATEGORIES.SECURITY,
  [NOTIFICATION_TYPES.WEEKLY_RECAP]: NOTIFICATION_CATEGORIES.REPORTS,
  [NOTIFICATION_TYPES.MONTHLY_REPORT]: NOTIFICATION_CATEGORIES.REPORTS,
  [NOTIFICATION_TYPES.SMART_INSIGHT]: NOTIFICATION_CATEGORIES.REPORTS,
  [NOTIFICATION_TYPES.MAINTENANCE_ALERT]: NOTIFICATION_CATEGORIES.SYSTEM,
  [NOTIFICATION_TYPES.FEATURE_UPDATE]: NOTIFICATION_CATEGORIES.SYSTEM,
};

/**
 * UI metadata for notification types in settings
 */
export interface NotificationTypeMetadata {
  type: NotificationType;
  label: string;
  description: string;
  hasThreshold?: boolean;
  thresholdLabel?: string;
  category: NotificationCategory;
}

export const NOTIFICATION_TYPE_METADATA: NotificationTypeMetadata[] = [
  // Transactions
  {
    type: NOTIFICATION_TYPES.LARGE_TRANSACTION,
    label: "Large Transactions",
    description: "Get notified when a transaction exceeds a certain amount",
    hasThreshold: true,
    thresholdLabel: "Amount threshold",
    category: NOTIFICATION_CATEGORIES.TRANSACTIONS,
  },
  {
    type: NOTIFICATION_TYPES.RECURRING_DUE,
    label: "Recurring Transactions Due",
    description: "Reminder before recurring transactions are due",
    category: NOTIFICATION_CATEGORIES.TRANSACTIONS,
  },
  {
    type: NOTIFICATION_TYPES.UNUSUAL_SPENDING,
    label: "Unusual Spending",
    description: "Alert when spending patterns are unusual (coming soon)",
    category: NOTIFICATION_CATEGORIES.TRANSACTIONS,
  },
  // Budget
  {
    type: NOTIFICATION_TYPES.BUDGET_WARNING,
    label: "Budget Warning",
    description: "Alert when approaching budget limit",
    category: NOTIFICATION_CATEGORIES.BUDGET,
  },
  {
    type: NOTIFICATION_TYPES.BUDGET_EXCEEDED,
    label: "Budget Exceeded",
    description: "Alert when budget is exceeded",
    category: NOTIFICATION_CATEGORIES.BUDGET,
  },
  // Goals
  {
    type: NOTIFICATION_TYPES.GOAL_PROGRESS,
    label: "Goal Progress",
    description: "Updates on savings goal progress",
    category: NOTIFICATION_CATEGORIES.GOALS,
  },
  {
    type: NOTIFICATION_TYPES.GOAL_ACHIEVED,
    label: "Goal Achieved",
    description: "Celebration when a goal is reached",
    category: NOTIFICATION_CATEGORIES.GOALS,
  },
  // Investments
  {
    type: NOTIFICATION_TYPES.PRICE_ALERT,
    label: "Price Alerts",
    description: "Alerts when a security crosses a price threshold",
    category: NOTIFICATION_CATEGORIES.INVESTMENTS,
  },
  {
    type: NOTIFICATION_TYPES.STALE_PRICE,
    label: "Stale Prices",
    description: "Alerts when a security price is outdated",
    category: NOTIFICATION_CATEGORIES.INVESTMENTS,
  },
  // Security
  {
    type: NOTIFICATION_TYPES.NEW_LOGIN,
    label: "New Login",
    description: "Alert when account is accessed from a new device",
    category: NOTIFICATION_CATEGORIES.SECURITY,
  },
  {
    type: NOTIFICATION_TYPES.PASSWORD_CHANGED,
    label: "Password Changed",
    description: "Confirmation when password is updated",
    category: NOTIFICATION_CATEGORIES.SECURITY,
  },
  {
    type: NOTIFICATION_TYPES.EMAIL_CHANGED,
    label: "Email Changed",
    description: "Confirmation when a verified email address is changed",
    category: NOTIFICATION_CATEGORIES.SECURITY,
  },
  // Reports
  {
    type: NOTIFICATION_TYPES.WEEKLY_RECAP,
    label: "Weekly Recap",
    description: "Your weekly spending summary is ready",
    category: NOTIFICATION_CATEGORIES.REPORTS,
  },
  {
    type: NOTIFICATION_TYPES.MONTHLY_REPORT,
    label: "Monthly Report",
    description: "Your monthly financial report is available",
    category: NOTIFICATION_CATEGORIES.REPORTS,
  },
  {
    type: NOTIFICATION_TYPES.SMART_INSIGHT,
    label: "Smart Tips",
    description: "Tips to save money and optimize finances",
    category: NOTIFICATION_CATEGORIES.REPORTS,
  },
  // System
  {
    type: NOTIFICATION_TYPES.MAINTENANCE_ALERT,
    label: "Maintenance",
    description: "Scheduled maintenance alerts",
    category: NOTIFICATION_CATEGORIES.SYSTEM,
  },
  {
    type: NOTIFICATION_TYPES.FEATURE_UPDATE,
    label: "New Features",
    description: "Check out new features and updates",
    category: NOTIFICATION_CATEGORIES.SYSTEM,
  },
];
