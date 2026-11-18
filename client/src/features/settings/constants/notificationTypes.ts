/**
 * Client Notification Types
 *
 * Re-exports shared notification type constants for consistent usage across client.
 * All notification type definitions are centralized in @shared/notificationTypes.
 */

// Re-export all shared notification types
export {
  NOTIFICATION_TYPES,
  NOTIFICATION_CATEGORIES,
  NOTIFICATION_TYPE_METADATA,
  NOTIFICATION_TYPE_CATEGORY,
  type NotificationType,
  type NotificationCategory,
  type NotificationTypeMetadata,
} from "@shared/notificationTypes";

// Legacy interface for backwards compatibility
export interface NotificationTypeLocal {
  type: string;
  label: string;
  description: string;
  hasThreshold?: boolean;
  thresholdLabel?: string;
  category?: string;
}

export interface NotificationCategoryLocal {
  category: string;
  notifications: NotificationTypeLocal[];
}

/**
 * Helper to get notification types grouped by category
 * Used for settings UI organization
 */
import {
  NOTIFICATION_TYPE_METADATA as metadata,
  NOTIFICATION_CATEGORIES as categories,
} from "@shared/notificationTypes";

export function getNotificationsByCategory(): NotificationCategoryLocal[] {
  return [
    {
      category: "Transactions",
      notifications: metadata
        .filter((n) => n.category === categories.TRANSACTIONS)
        .map((n) => ({
          type: n.type,
          label: n.label,
          description: n.description,
          hasThreshold: n.hasThreshold,
          thresholdLabel: n.thresholdLabel,
        })),
    },
    {
      category: "Budget",
      notifications: metadata
        .filter((n) => n.category === categories.BUDGET)
        .map((n) => ({
          type: n.type,
          label: n.label,
          description: n.description,
          hasThreshold: n.hasThreshold,
          thresholdLabel: n.thresholdLabel,
        })),
    },
    {
      category: "Goals",
      notifications: metadata
        .filter((n) => n.category === categories.GOALS)
        .map((n) => ({
          type: n.type,
          label: n.label,
          description: n.description,
        })),
    },
    {
      category: "Investments",
      notifications: metadata
        .filter((n) => n.category === categories.INVESTMENTS)
        .map((n) => ({
          type: n.type,
          label: n.label,
          description: n.description,
        })),
    },
    {
      category: "Security",
      notifications: metadata
        .filter((n) => n.category === categories.SECURITY)
        .map((n) => ({
          type: n.type,
          label: n.label,
          description: n.description,
        })),
    },
    {
      category: "Reports",
      notifications: metadata
        .filter((n) => n.category === categories.REPORTS)
        .map((n) => ({
          type: n.type,
          label: n.label,
          description: n.description,
        })),
    },
    {
      category: "System Updates",
      notifications: metadata
        .filter((n) => n.category === categories.SYSTEM)
        .map((n) => ({
          type: n.type,
          label: n.label,
          description: n.description,
        })),
    },
  ];
}

// Legacy export for backwards compatibility
export const NOTIFICATION_CATEGORIES_LEGACY = getNotificationsByCategory();
