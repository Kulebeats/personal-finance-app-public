import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useFormatters } from "@/contexts/SettingsContext";
import { cn, parseMoney } from "@/lib/utils";
import type { GoalFormData } from "./StepTargets";

interface StepBudgetProps {
  goals: GoalFormData[];
  onUpdateGoal: (goalId: string, updates: Partial<GoalFormData>) => void;
}

export function StepBudget({ goals, onUpdateGoal }: StepBudgetProps) {
  const { formatCurrency } = useFormatters();

  // Calculate total planned contributions
  const totalPlanned = goals.reduce(
    (sum, goal) => sum + (parseMoney(goal.monthlyContribution) || 0),
    0
  );

  // Check if goal has warning (missing targets)
  const hasWarning = (goal: GoalFormData) =>
    !goal.targetDate || !goal.targetAmount;

  return (
    <div className="grid lg:grid-cols-[1fr_350px] gap-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      {/* Left Column: Budget inputs */}
      <div className="space-y-6">
        <div className="space-y-2">
          <h2 className="text-xl font-bold tracking-tight">
            How much of your monthly income do you plan to contribute to your
            goals?
          </h2>
          <p className="text-sm text-muted-foreground">
            Based on your target dates and target amounts, we've prefilled the
            monthly transfers you'll need to reach your goals on time.
          </p>
        </div>

        {/* Monthly planned contributions header */}
        <div className="flex justify-between items-center py-2 border-b">
          <span className="font-medium">Monthly planned contributions</span>
          <span className="font-bold">{formatCurrency(totalPlanned)}</span>
        </div>

        {/* Per-goal editable list */}
        <div className="space-y-3">
          {goals.map((goal) => (
            <div
              key={goal.id}
              className="flex items-center justify-between gap-4 py-3"
            >
              <div className="flex items-center gap-3 flex-1 min-w-0">
                {/* Goal thumbnail */}
                <div className="w-10 h-10 rounded-lg bg-muted overflow-hidden shrink-0">
                  {goal.imageUrl ? (
                    <img
                      src={goal.imageUrl}
                      alt=""
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="w-full h-full bg-orange-100 dark:bg-orange-900/30 flex items-center justify-center text-orange-500 text-sm font-medium">
                      {(goal.name || goal.templateId || "G")
                        .charAt(0)
                        .toUpperCase()}
                    </div>
                  )}
                </div>
                <div className="min-w-0">
                  <div className="font-medium truncate">
                    {goal.name || "Untitled"}
                  </div>
                  {hasWarning(goal) && (
                    <div className="text-xs text-orange-500 font-medium">
                      No target date or target amount
                    </div>
                  )}
                </div>
              </div>

              {/* Contribution input */}
              <div className="relative w-28 shrink-0">
                <span className="absolute left-3 top-2.5 text-muted-foreground text-sm">
                  $
                </span>
                <Input
                  type="number"
                  className="pl-7 text-right"
                  placeholder="0"
                  value={goal.monthlyContribution}
                  onChange={(e) =>
                    onUpdateGoal(goal.id, {
                      monthlyContribution: e.target.value,
                    })
                  }
                />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Right Column: Goals summary sidebar */}
      <div className="hidden lg:block space-y-4">
        <div className="font-medium">Goals ({goals.length})</div>
        <Card className="divide-y">
          {goals.map((goal) => (
            <div
              key={goal.id}
              className="flex items-center justify-between p-4"
            >
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-lg bg-muted overflow-hidden">
                  {goal.imageUrl ? (
                    <img
                      src={goal.imageUrl}
                      alt=""
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="w-full h-full bg-orange-100 dark:bg-orange-900/30 flex items-center justify-center text-orange-500 font-medium">
                      {(goal.name || goal.templateId || "G")
                        .charAt(0)
                        .toUpperCase()}
                    </div>
                  )}
                </div>
                <div>
                  <div className="font-medium">{goal.name || "Untitled"}</div>
                  <div className="text-xs text-muted-foreground">
                    {goal.targetDate
                      ? new Date(goal.targetDate).toLocaleDateString(
                          undefined,
                          {
                            month: "short",
                            year: "numeric",
                          }
                        )
                      : "No target date"}
                  </div>
                </div>
              </div>
              <div className="text-right">
                <div className="font-bold">{formatCurrency(0)}</div>
                <div className="text-xs text-muted-foreground">
                  {goal.targetAmount
                    ? `of ${formatCurrency(parseMoney(goal.targetAmount))}`
                    : "No target amount"}
                </div>
              </div>
            </div>
          ))}
        </Card>
      </div>
    </div>
  );
}
