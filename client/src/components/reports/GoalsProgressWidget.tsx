/**
 * GoalsProgressWidget - Core widget showing goals tracking
 *
 * Displays progress towards financial goals with visual progress bars
 */

import React from "react";
import { WidgetCard, WidgetEmptyState } from "./shared/WidgetCard";
import { useReportsGoalsProgress } from "@/hooks/use-reports";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import { Target, CheckCircle2, Clock, AlertTriangle } from "lucide-react";
import { toMoneyNumber } from "@/lib/money";
import { useFormatters } from "@/contexts/SettingsContext";

// ============================================================================
// GOAL ITEM COMPONENT
// ============================================================================

function GoalItem({
  name,
  type,
  targetAmount,
  currentAmount,
  progress,
  onTrack,
  monthlyRequired,
}: {
  name: string;
  type: "save_up" | "pay_down" | "investment";
  targetAmount: number;
  currentAmount: number;
  progress: number;
  onTrack: boolean;
  monthlyRequired: number | null;
}) {
  const isComplete = progress >= 100;
  const { currency } = useFormatters();

  const formatCurrency = (amount: number) =>
    new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium truncate">{name}</span>
          {isComplete ? (
            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
          ) : onTrack ? (
            <Clock className="h-3.5 w-3.5 text-blue-500" />
          ) : (
            <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
          )}
        </div>
        <span className="text-xs text-muted-foreground">
          {Math.min(progress, 100).toFixed(0)}%
        </span>
      </div>

      <Progress
        value={Math.min(progress, 100)}
        className={cn(
          "h-2",
          isComplete && "bg-emerald-100 [&>div]:bg-emerald-500"
        )}
      />

      <div className="flex justify-between text-xs text-muted-foreground">
        <span>{formatCurrency(currentAmount)} saved</span>
        <span>of {formatCurrency(targetAmount)}</span>
      </div>

      {!isComplete && monthlyRequired && (
        <p className="text-xs text-muted-foreground">
          {formatCurrency(monthlyRequired)}/mo needed
        </p>
      )}
    </div>
  );
}

// ============================================================================
// MAIN WIDGET
// ============================================================================

export function GoalsProgressWidget({
  className,
  onHide,
}: {
  className?: string;
  onHide?: () => void;
}) {
  const { data, isLoading, error } = useReportsGoalsProgress({});

  const hasGoals = data && data.goals.length > 0;

  return (
    <WidgetCard
      title="Goals Progress"
      description={
        data?.summary ? `${data.summary.onTrackCount} on track` : undefined
      }
      icon={<Target className="h-4 w-4 text-primary" />}
      isLoading={isLoading}
      error={error}
      className={className}
      onHide={onHide}
    >
      {hasGoals ? (
        <div className="space-y-4">
          {data.goals.slice(0, 4).map((goal) => (
            <GoalItem
              key={goal.id}
              name={goal.name}
              type={goal.type}
              targetAmount={toMoneyNumber(goal.targetAmount)}
              currentAmount={toMoneyNumber(goal.currentAmount)}
              progress={goal.progress}
              onTrack={goal.onTrack}
              monthlyRequired={
                goal.monthlyRequired
                  ? toMoneyNumber(goal.monthlyRequired)
                  : null
              }
            />
          ))}

          {data.goals.length > 4 && (
            <p className="text-xs text-muted-foreground text-center">
              +{data.goals.length - 4} more goals
            </p>
          )}
        </div>
      ) : (
        <WidgetEmptyState
          title="No goals set"
          description="Create a goal to see progress here"
          icon={<Target className="h-8 w-8" />}
        />
      )}
    </WidgetCard>
  );
}
