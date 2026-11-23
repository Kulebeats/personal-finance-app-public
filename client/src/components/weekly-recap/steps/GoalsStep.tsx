import { Target, ThumbsUp, ThumbsDown, TrendingUp, CheckCircle2 } from "lucide-react";
import { useWeeklyRecap } from "../WeeklyRecapContext";
import { useFormatters } from "@/contexts/SettingsContext";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useState } from "react";
import { useGoalsSummary } from "@/hooks/useGoals";
import { toMoneyNumber } from "@/lib/money";

export default function GoalsStep() {
  const { nextStep, prevStep, submitStepFeedback } = useWeeklyRecap();
  const { formatCurrency } = useFormatters();
  const { data: summary, isLoading } = useGoalsSummary();
  const [feedbackGiven, setFeedbackGiven] = useState<
    "positive" | "negative" | null
  >(null);

  const handleFeedback = (type: "positive" | "negative") => {
    setFeedbackGiven(type);
    submitStepFeedback(type);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-sm text-muted-foreground">Loading goals...</div>
      </div>
    );
  }

  const hasGoals = summary && (summary.saveUp.total > 0 || summary.payDown.total > 0);
  const totalGoals = (summary?.saveUp.total || 0) + (summary?.payDown.total || 0);
  const onTrackCount = (summary?.saveUp.onTrack || 0) + (summary?.payDown.onTrack || 0);
  const totalSaved = toMoneyNumber(summary?.saveUp.totalSaved ?? 0);
  const totalTarget = toMoneyNumber(summary?.saveUp.totalTarget ?? 0);
  const overallProgress = totalTarget > 0 ? (totalSaved / totalTarget) * 100 : 0;

  return (
    <div className="flex flex-col space-y-6">
      <div className="text-center space-y-2">
        <h3 className="text-xl font-semibold">Goals Progress</h3>
        <p className="text-foreground/70 text-sm">Your financial goals this week</p>
      </div>

      {!hasGoals ? (
        <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
          <Target className="w-12 h-12 mb-3 opacity-50" />
          <p className="font-medium">No active goals yet</p>
          <p className="text-xs mt-1 opacity-70">Set goals to track your progress</p>
        </div>
      ) : (
        <>
          <div className="bg-blue-50 dark:bg-blue-900/10 rounded-xl p-6 border border-blue-100 dark:border-blue-800/30">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <div className="h-10 w-10 bg-blue-200 dark:bg-blue-800 rounded-full flex items-center justify-center text-blue-700 dark:text-blue-300">
                  <Target className="w-5 h-5" />
                </div>
                <div>
                  <p className="text-sm text-blue-600 dark:text-blue-400 font-medium">
                    Active Goals
                  </p>
                  <p className="text-2xl font-bold">{totalGoals}</p>
                </div>
              </div>
              <div className="text-right">
                <p className="text-sm text-blue-600 dark:text-blue-400 font-medium">
                  On Track
                </p>
                <p className="text-2xl font-bold">{onTrackCount}</p>
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>Overall Progress</span>
                <span>{overallProgress.toFixed(0)}%</span>
              </div>
              <div className="h-2 bg-blue-100 dark:bg-blue-900/30 rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-blue-500 to-blue-600 transition-all duration-500"
                  style={{ width: `${Math.min(100, overallProgress)}%` }}
                />
              </div>
            </div>
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between p-3 border rounded-xl">
              <div className="flex items-center gap-3">
                <TrendingUp className="w-5 h-5 text-emerald-500" />
                <div>
                  <p className="font-medium text-sm">Total Saved</p>
                  <p className="text-xs text-muted-foreground">Across all goals</p>
                </div>
              </div>
              <span className="font-semibold text-emerald-600">
                {formatCurrency(totalSaved)}
              </span>
            </div>

            <div className="flex items-center justify-between p-3 border rounded-xl">
              <div className="flex items-center gap-3">
                <Target className="w-5 h-5 text-blue-500" />
                <div>
                  <p className="font-medium text-sm">Total Target</p>
                  <p className="text-xs text-muted-foreground">Combined goal amount</p>
                </div>
              </div>
              <span className="font-semibold text-blue-600">
                {formatCurrency(totalTarget)}
              </span>
            </div>
          </div>
        </>
      )}

      <div className="flex flex-col items-center gap-4 pt-2">
        <div className="flex gap-4">
          <Button
            variant="outline"
            size="icon"
            className={cn(
              "rounded-full w-10 h-10 transition-colors",
              feedbackGiven === "positive" &&
                "bg-emerald-100 border-emerald-500 text-emerald-600 dark:bg-emerald-900/30"
            )}
            onClick={() => handleFeedback("positive")}
            aria-label="Positive feedback"
          >
            <ThumbsUp className="w-4 h-4" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            className={cn(
              "rounded-full w-10 h-10 transition-colors",
              feedbackGiven === "negative" &&
                "bg-rose-100 border-rose-500 text-rose-600 dark:bg-rose-900/30"
            )}
            onClick={() => handleFeedback("negative")}
            aria-label="Negative feedback"
          >
            <ThumbsDown className="w-4 h-4" />
          </Button>
        </div>
      </div>

      <div className="flex gap-3">
        <Button
          variant="outline"
          className="flex-1 rounded-full"
          onClick={prevStep}
        >
          Back
        </Button>
        <Button className="flex-1 rounded-full" onClick={nextStep}>
          Continue
        </Button>
      </div>
    </div>
  );
}
