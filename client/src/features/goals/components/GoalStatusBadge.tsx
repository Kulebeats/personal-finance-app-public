import { cn } from "@/lib/utils";
import type { GoalStatus } from "@/hooks/useGoals";

const STATUS_STYLES: Record<GoalStatus, string> = {
  on_track: "bg-emerald-100 dark:bg-emerald-900/30 text-emerald-800 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800",
  behind: "bg-amber-100 dark:bg-amber-900/30 text-amber-800 dark:text-amber-300 border-amber-200 dark:border-amber-800",
  at_risk: "bg-rose-100 dark:bg-rose-900/30 text-rose-800 dark:text-rose-300 border-rose-200 dark:border-rose-800",
  completed: "bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-300 border-blue-200 dark:border-blue-800",
};

const STATUS_LABELS: Record<GoalStatus, string> = {
  on_track: "On track",
  behind: "Behind",
  at_risk: "At risk",
  completed: "Completed",
};

export function GoalStatusBadge({
  status,
  size = "sm",
}: {
  status: GoalStatus | null;
  size?: "sm" | "md" | "lg";
}) {
  // The server withholds the status with the progress it is derived from.
  if (!status) return null;
  const sizeClass =
    size === "lg"
      ? "px-3 py-1 text-sm"
      : size === "md"
      ? "px-2.5 py-0.5 text-xs"
      : "px-2 py-0.5 text-xs";

  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border font-medium",
        STATUS_STYLES[status],
        sizeClass
      )}
    >
      {STATUS_LABELS[status]}
    </span>
  );
}
