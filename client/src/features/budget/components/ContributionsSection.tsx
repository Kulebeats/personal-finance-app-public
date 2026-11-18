/**
 * ContributionsSection Component
 *
 * Displays goal contributions for the budget page.
 */

import { Target } from "lucide-react";
import { useFormatters } from "@/contexts/SettingsContext";
import { parseMoney } from "@/lib/utils";
import type { Goal } from "@/hooks/useGoals";

interface ContributionsSectionProps {
  goals: Goal[];
}

export function ContributionsSection({ goals }: ContributionsSectionProps) {
  const { formatCurrency } = useFormatters();

  if (goals.length === 0) return null;

  const today = new Date();

  const computeMonthlyTarget = (goal: Goal) => {
    const current = parseMoney(goal.currentAmount);
    const target = parseMoney(goal.targetAmount);
    const remaining = Math.max(0, target - current);
    if (!goal.targetDate || remaining === 0) return 0;
    const targetDate = new Date(goal.targetDate);
    const monthsLeft =
      (targetDate.getFullYear() - today.getFullYear()) * 12 +
      (targetDate.getMonth() - today.getMonth()) +
      1;
    if (monthsLeft <= 0) return remaining;
    return remaining / monthsLeft;
  };

  return (
    <div className="mt-6 bg-card rounded-lg border border-border shadow-sm overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 bg-muted/10 border-b border-border/40">
        <div className="flex items-center gap-2 text-sm font-bold text-foreground">
          <Target className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
          Contributions
        </div>
        <div className="text-xs text-muted-foreground">Save Up Goals</div>
      </div>

      {/* Goals List */}
      <div className="divide-y divide-border/40">
        {goals.map((goal) => {
          const current = parseMoney(goal.currentAmount);
          const target = parseMoney(goal.targetAmount);
          const remaining = Math.max(0, target - current);
          const monthlyTarget = computeMonthlyTarget(goal);

          return (
            <div
              key={goal.id}
              className="grid grid-cols-12 gap-4 py-3 px-4 text-sm items-center"
            >
              <div className="col-span-5 flex items-center gap-3">
                <div className="w-7 h-7 rounded-full bg-emerald-50 dark:bg-emerald-950/50 text-emerald-600 dark:text-emerald-400 flex items-center justify-center">
                  <Target className="w-3.5 h-3.5" />
                </div>
                <div>
                  <div className="font-medium text-foreground">{goal.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {formatCurrency(current)} of {formatCurrency(target)}
                  </div>
                </div>
              </div>
              <div className="col-span-3 text-right text-muted-foreground">
                {monthlyTarget > 0
                  ? formatCurrency(Math.round(monthlyTarget))
                  : "—"}
              </div>
              <div className="col-span-2 text-right text-muted-foreground">
                {goal.targetDate
                  ? new Date(goal.targetDate).toLocaleDateString("en-US", {
                      month: "short",
                      year: "numeric",
                    })
                  : "No date"}
              </div>
              <div className="col-span-2 text-right font-medium text-foreground">
                {formatCurrency(Math.round(remaining))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
