/**
 * GoalActivityItem Component
 *
 * Displays a single activity log entry for a goal.
 */

import { useFormatters } from "@/contexts/SettingsContext";
import type { GoalActivityLogEntry } from "@/hooks/useGoals";
import { cn, parseMoney } from "@/lib/utils";
import { getActivityConfig, formatRelativeTime } from "./GoalActivityConfig";

interface GoalActivityItemProps {
  activity: GoalActivityLogEntry;
  showGoalName?: boolean;
  goalName?: string;
}

export function GoalActivityItem({
  activity,
  showGoalName = false,
  goalName,
}: GoalActivityItemProps) {
  const { formatCurrency } = useFormatters();
  const config = getActivityConfig(activity.activityType);
  const Icon = config.icon;

  const amount =
    activity.amount !== null && activity.amount !== undefined
      ? parseMoney(activity.amount)
      : null;
  const isPositive = amount !== null && amount > 0;
  const isNegative = amount !== null && amount < 0;
  const hasBalanceUpdate =
    activity.previousBalance !== null &&
    activity.previousBalance !== undefined &&
    activity.newBalance !== null &&
    activity.newBalance !== undefined;

  return (
    <div className="flex items-start gap-3 py-2">
      <div
        className={cn(
          "flex items-center justify-center w-8 h-8 rounded-full shrink-0",
          config.bgColor
        )}
      >
        <Icon className={cn("w-4 h-4", config.color)} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="text-sm font-medium truncate">
              {config.label}
              {showGoalName && goalName && (
                <span className="text-muted-foreground font-normal">
                  {" "}
                  - {goalName}
                </span>
              )}
            </p>
            {activity.metadata && typeof activity.metadata === "object" && (
              <p className="text-xs text-muted-foreground truncate">
                {Object.entries(activity.metadata)
                  .filter(
                    ([key]) =>
                      !["transactionId", "previousValues"].includes(key)
                  )
                  .map(([key, value]) => {
                    if (Array.isArray(value)) {
                      return `${key}: ${value.join(", ")}`;
                    }
                    return `${key}: ${value}`;
                  })
                  .join(", ")}
              </p>
            )}
          </div>
          <div className="text-right shrink-0">
            {amount !== null && amount !== 0 && (
              <p
                className={cn(
                  "text-sm font-semibold",
                  isPositive && "text-emerald-600",
                  isNegative && "text-rose-600"
                )}
              >
                {isPositive ? "+" : isNegative ? "-" : ""}
                {formatCurrency(Math.abs(amount))}
              </p>
            )}
            <p className="text-xs text-muted-foreground">
              {formatRelativeTime(activity.createdAt)}
            </p>
          </div>
        </div>
        {hasBalanceUpdate && (
          <p className="text-xs text-muted-foreground mt-1">
            Balance:{" "}
            {formatCurrency(parseMoney(activity.previousBalance ?? "0"))} →{" "}
            {formatCurrency(parseMoney(activity.newBalance ?? "0"))}
          </p>
        )}
      </div>
    </div>
  );
}

interface GoalActivityListProps {
  activities: GoalActivityLogEntry[];
  showGoalName?: boolean;
  goalName?: string;
  emptyMessage?: string;
}

export function GoalActivityList({
  activities,
  showGoalName = false,
  goalName,
  emptyMessage = "No activity yet",
}: GoalActivityListProps) {
  if (activities.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground text-sm">
        {emptyMessage}
      </div>
    );
  }

  return (
    <div className="divide-y">
      {activities.map((activity) => (
        <GoalActivityItem
          key={activity.id}
          activity={activity}
          showGoalName={showGoalName}
          goalName={goalName}
        />
      ))}
    </div>
  );
}
