/**
 * Shown in place of a goal's progress when the server withholds it because
 * one of the goal's sources is another member's private account or
 * transaction (FIN-01). The target stays visible; the progress never shows
 * as a misleading zero.
 */
import { cn } from "@/lib/utils";
import type { Goal } from "@/hooks/useGoals";

export function isGoalProgressHidden(goal: Pick<Goal, "progressAvailability">): boolean {
  return goal.progressAvailability === "unavailable";
}

export function GoalProgressHidden({ className }: { className?: string }) {
  return (
    <p className={cn("text-xs text-muted-foreground", className)}>
      Progress hidden: this goal uses another member's private account.
    </p>
  );
}
