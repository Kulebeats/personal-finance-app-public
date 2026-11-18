/**
 * GoalActivityConfig - Configuration for goal activity display
 */

import {
  Plus,
  Minus,
  ArrowRightLeft,
  Check,
  Archive,
  RotateCcw,
  Edit,
  Target,
  RefreshCw,
  Link,
  Unlink,
  DollarSign,
  AlertCircle,
} from "lucide-react";

export interface ActivityConfig {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  color: string;
  bgColor: string;
}

export const ACTIVITY_CONFIG: Record<string, ActivityConfig> = {
  contribution_added: {
    icon: Plus,
    label: "Contribution added",
    color: "text-emerald-600 dark:text-emerald-400",
    bgColor: "bg-emerald-100 dark:bg-emerald-900/30",
  },
  contribution_removed: {
    icon: Minus,
    label: "Contribution removed",
    color: "text-rose-600 dark:text-rose-400",
    bgColor: "bg-rose-100 dark:bg-rose-900/30",
  },
  balance_adjusted: {
    icon: Edit,
    label: "Balance adjusted",
    color: "text-blue-600 dark:text-blue-400",
    bgColor: "bg-blue-100 dark:bg-blue-900/30",
  },
  transfer_in: {
    icon: ArrowRightLeft,
    label: "Transfer received",
    color: "text-emerald-600 dark:text-emerald-400",
    bgColor: "bg-emerald-100 dark:bg-emerald-900/30",
  },
  transfer_out: {
    icon: ArrowRightLeft,
    label: "Transfer sent",
    color: "text-amber-600 dark:text-amber-400",
    bgColor: "bg-amber-100 dark:bg-amber-900/30",
  },
  transaction_linked: {
    icon: Link,
    label: "Transaction linked",
    color: "text-emerald-600 dark:text-emerald-400",
    bgColor: "bg-emerald-100 dark:bg-emerald-900/30",
  },
  transaction_unlinked: {
    icon: Unlink,
    label: "Transaction unlinked",
    color: "text-slate-600 dark:text-slate-400",
    bgColor: "bg-slate-100 dark:bg-slate-900/30",
  },
  spending_linked: {
    icon: Minus,
    label: "Spending recorded",
    color: "text-rose-600 dark:text-rose-400",
    bgColor: "bg-rose-100 dark:bg-rose-900/30",
  },
  goal_created: {
    icon: Target,
    label: "Goal created",
    color: "text-indigo-600 dark:text-indigo-400",
    bgColor: "bg-indigo-100 dark:bg-indigo-900/30",
  },
  goal_updated: {
    icon: Edit,
    label: "Goal updated",
    color: "text-slate-600 dark:text-slate-400",
    bgColor: "bg-slate-100 dark:bg-slate-900/30",
  },
  goal_completed: {
    icon: Check,
    label: "Goal completed",
    color: "text-emerald-600 dark:text-emerald-400",
    bgColor: "bg-emerald-100 dark:bg-emerald-900/30",
  },
  goal_archived: {
    icon: Archive,
    label: "Goal archived",
    color: "text-slate-600 dark:text-slate-400",
    bgColor: "bg-slate-100 dark:bg-slate-900/30",
  },
  goal_unarchived: {
    icon: RotateCcw,
    label: "Goal restored",
    color: "text-blue-600 dark:text-blue-400",
    bgColor: "bg-blue-100 dark:bg-blue-900/30",
  },
  balance_synced: {
    icon: RefreshCw,
    label: "Balance synced",
    color: "text-blue-600 dark:text-blue-400",
    bgColor: "bg-blue-100 dark:bg-blue-900/30",
  },
  account_assigned: {
    icon: Link,
    label: "Account assigned",
    color: "text-indigo-600 dark:text-indigo-400",
    bgColor: "bg-indigo-100 dark:bg-indigo-900/30",
  },
  account_unassigned: {
    icon: Unlink,
    label: "Account unassigned",
    color: "text-slate-600 dark:text-slate-400",
    bgColor: "bg-slate-100 dark:bg-slate-900/30",
  },
  account_removed: {
    icon: Unlink,
    label: "Account removed",
    color: "text-slate-600 dark:text-slate-400",
    bgColor: "bg-slate-100 dark:bg-slate-900/30",
  },
  status_changed: {
    icon: AlertCircle,
    label: "Status changed",
    color: "text-amber-600 dark:text-amber-400",
    bgColor: "bg-amber-100 dark:bg-amber-900/30",
  },
  milestone_reached: {
    icon: Check,
    label: "Milestone reached",
    color: "text-amber-600 dark:text-amber-400",
    bgColor: "bg-amber-100 dark:bg-amber-900/30",
  },
  target_updated: {
    icon: DollarSign,
    label: "Target updated",
    color: "text-blue-600 dark:text-blue-400",
    bgColor: "bg-blue-100 dark:bg-blue-900/30",
  },
  migrated_to_v3: {
    icon: RefreshCw,
    label: "Migrated to Goals 3.0",
    color: "text-indigo-600 dark:text-indigo-400",
    bgColor: "bg-indigo-100 dark:bg-indigo-900/30",
  },
};

export const DEFAULT_ACTIVITY_CONFIG: ActivityConfig = {
  icon: Target,
  label: "",
  color: "text-slate-600 dark:text-slate-400",
  bgColor: "bg-slate-100 dark:bg-slate-900/30",
};

export function getActivityConfig(activityType: string): ActivityConfig {
  const config = ACTIVITY_CONFIG[activityType];
  if (config) return config;
  return {
    ...DEFAULT_ACTIVITY_CONFIG,
    label: activityType.replace(/_/g, " "),
  };
}

export function formatRelativeTime(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`;
  return date.toLocaleDateString();
}
