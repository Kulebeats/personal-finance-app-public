import { useFormatters } from "@/contexts/SettingsContext";
import type { Goal, GoalProjection } from "@/hooks/useGoals";
import { TrendingUp, Calendar, AlertTriangle, CheckCircle } from "lucide-react";
import { cn, parseMoney } from "@/lib/utils";
import { GoalStatusBadge } from "./GoalStatusBadge";

interface MonthlyProjectionProps {
  goal: Goal;
  projection?: GoalProjection | null;
  compact?: boolean;
}

export function MonthlyProjection({
  goal,
  projection,
  compact = false,
}: MonthlyProjectionProps) {
  const { formatCurrency } = useFormatters();

  const currentAmount = parseMoney(goal.currentAmount);
  const targetAmount = parseMoney(goal.targetAmount);
  const remaining = targetAmount - currentAmount;

  const monthlyProjection = projection?.monthlyProjection
    ? parseMoney(projection.monthlyProjection)
    : goal.monthlyProjection
    ? parseMoney(goal.monthlyProjection)
    : null;

  const projectedDate = projection?.projectedCompletionDate ?? goal.projectedCompletionDate;
  const status = projection?.status ?? goal.status;
  const monthsRemaining = projection?.monthsRemaining ?? null;

  const isOnTrack = status === "on_track" || status === "completed";
  const isCompleted = status === "completed" || currentAmount >= targetAmount;

  if (isCompleted) {
    return (
      <div
        className={cn(
          "flex items-center gap-2 p-3 rounded-lg bg-emerald-50 border border-emerald-200",
          compact && "p-2"
        )}
      >
        <CheckCircle className="w-5 h-5 text-emerald-600 shrink-0" />
        <div>
          <p className="text-sm font-medium text-emerald-800">Goal achieved!</p>
          {goal.completedAt && (
            <p className="text-xs text-emerald-600">
              Completed on {new Date(goal.completedAt).toLocaleDateString()}
            </p>
          )}
        </div>
      </div>
    );
  }

  if (compact) {
    return (
      <div className="flex items-center justify-between text-sm">
        <div className="flex items-center gap-2">
          <TrendingUp
            className={cn(
              "w-4 h-4",
              isOnTrack ? "text-emerald-500" : "text-amber-500"
            )}
          />
          <span className="text-muted-foreground">Monthly target:</span>
        </div>
        {monthlyProjection !== null ? (
          <span className="font-semibold">{formatCurrency(monthlyProjection)}</span>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-medium">Monthly Projection</h4>
        <GoalStatusBadge status={status} size="sm" />
      </div>

      <div
        className={cn(
          "p-4 rounded-lg border",
          isOnTrack
            ? "bg-emerald-50 border-emerald-200"
            : status === "behind"
            ? "bg-amber-50 border-amber-200"
            : "bg-rose-50 border-rose-200"
        )}
      >
        <div className="flex items-start gap-3">
          {isOnTrack ? (
            <TrendingUp className="w-5 h-5 text-emerald-600 mt-0.5" />
          ) : (
            <AlertTriangle
              className={cn(
                "w-5 h-5 mt-0.5",
                status === "behind" ? "text-amber-600" : "text-rose-600"
              )}
            />
          )}
          <div className="flex-1">
            <p
              className={cn(
                "text-sm font-medium",
                isOnTrack
                  ? "text-emerald-800"
                  : status === "behind"
                  ? "text-amber-800"
                  : "text-rose-800"
              )}
            >
              {isOnTrack
                ? "You're on track!"
                : status === "behind"
                ? "You're falling behind"
                : "Goal at risk"}
            </p>
            {monthlyProjection !== null && (
              <p
                className={cn(
                  "text-xs mt-1",
                  isOnTrack
                    ? "text-emerald-600"
                    : status === "behind"
                    ? "text-amber-600"
                    : "text-rose-600"
                )}
              >
                Save{" "}
                <span className="font-semibold">
                  {formatCurrency(monthlyProjection)}
                </span>{" "}
                per month to reach your goal
              </p>
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground">Remaining</p>
          <p className="text-lg font-semibold">{formatCurrency(remaining)}</p>
        </div>
        {monthsRemaining !== null && monthsRemaining > 0 && (
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">Months left</p>
            <p className="text-lg font-semibold">{monthsRemaining}</p>
          </div>
        )}
      </div>

      {projectedDate && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground pt-2 border-t">
          <Calendar className="w-4 h-4" />
          <span>
            Projected completion:{" "}
            <span className="font-medium text-foreground">
              {new Date(projectedDate).toLocaleDateString()}
            </span>
          </span>
        </div>
      )}

      {goal.targetDate && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Calendar className="w-4 h-4" />
          <span>
            Target date:{" "}
            <span className="font-medium text-foreground">
              {new Date(goal.targetDate).toLocaleDateString()}
            </span>
          </span>
        </div>
      )}
    </div>
  );
}

interface ProjectionSummaryProps {
  monthlyRequired: number;
  monthsRemaining: number;
  projectedDate: string | null;
  isOnTrack: boolean;
}

export function ProjectionSummary({
  monthlyRequired,
  monthsRemaining,
  projectedDate,
  isOnTrack,
}: ProjectionSummaryProps) {
  const { formatCurrency } = useFormatters();

  return (
    <div className="grid grid-cols-3 gap-4 text-center">
      <div>
        <p className="text-xs text-muted-foreground">Monthly</p>
        <p className="text-sm font-semibold">{formatCurrency(monthlyRequired)}</p>
      </div>
      <div>
        <p className="text-xs text-muted-foreground">Months</p>
        <p className="text-sm font-semibold">{monthsRemaining}</p>
      </div>
      <div>
        <p className="text-xs text-muted-foreground">Status</p>
        <p
          className={cn(
            "text-sm font-semibold",
            isOnTrack ? "text-emerald-600" : "text-amber-600"
          )}
        >
          {isOnTrack ? "On track" : "Behind"}
        </p>
      </div>
    </div>
  );
}
