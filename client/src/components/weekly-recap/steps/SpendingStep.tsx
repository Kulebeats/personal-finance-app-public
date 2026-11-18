import {
  TrendingUp,
  TrendingDown,
  ThumbsUp,
  ThumbsDown,
  ShoppingBag,
  CheckCircle2,
} from "lucide-react";
import { useWeeklyRecap } from "../WeeklyRecapContext";
import { useFormatters } from "@/contexts/SettingsContext";
import WeeklyChart from "../components/WeeklyChart";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useState } from "react";

export default function SpendingStep() {
  const { data, nextStep, prevStep, submitStepFeedback } = useWeeklyRecap();
  const { formatCurrency } = useFormatters();
  const [feedbackGiven, setFeedbackGiven] = useState<
    "positive" | "negative" | null
  >(null);

  if (!data) return null;

  const { spending } = data;
  const changePercent = spending.changePercent ?? 0;
  const trend = spending.trend ?? [];
  const topCategories = spending.topCategories ?? [];
  // For spending, negative change (less spending) is usually "good" in a vacuum,
  // but "Trend" arrow usually indicates direction.
  // Let's stick to direction: Up = more spending (maybe bad?), Down = less (good).
  const isSpendingUp = changePercent > 0;

  const handleFeedback = (type: "positive" | "negative") => {
    setFeedbackGiven(type);
    submitStepFeedback(type);
  };

  return (
    <div className="flex flex-col space-y-6">
      <div className="text-center space-y-2">
        <h3 className="text-xl font-semibold">Weekly Spending</h3>
        <p className="text-foreground/70 text-sm">Where your money went</p>
      </div>

      <div className="flex flex-col items-center justify-center space-y-2">
        <span className="text-4xl font-bold tracking-tighter">
          {formatCurrency(spending.total)}
        </span>
        <div
          className={cn(
            "flex items-center gap-1 text-sm font-medium",
            isSpendingUp ? "text-rose-500" : "text-emerald-500"
          )}
        >
          {isSpendingUp ? (
            <TrendingUp className="w-4 h-4" />
          ) : (
            <TrendingDown className="w-4 h-4" />
          )}
          <span>{Math.abs(changePercent).toFixed(1)}% vs last week</span>
        </div>
      </div>

      <div className="h-[150px] w-full">
        <WeeklyChart
          data={trend.map((t) => ({ date: t.date, value: t.amount }))}
          color="hsl(var(--chart-expense))"
          height={150}
        />
      </div>

      <div className="space-y-3">
        <h4 className="font-medium text-muted-foreground uppercase text-xs tracking-wider">
          Top Categories
        </h4>
        {topCategories.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
            <CheckCircle2 className="w-8 h-8 mb-2 opacity-50" />
            <p className="text-sm">No spending tracked this week</p>
            <p className="text-xs mt-1 opacity-70">Keep up the great work!</p>
          </div>
        ) : (
          <div className="space-y-2">
            {topCategories.map((cat, i) => (
              <div
                key={i}
                className="flex items-center justify-between text-sm p-2 bg-muted/40 rounded-lg"
              >
                <div className="flex items-center gap-2">
                  <ShoppingBag className="w-3 h-3 text-muted-foreground" />
                  <span>{cat.name}</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="font-semibold">
                    {formatCurrency(cat.amount)}
                  </span>
                  <span className="text-xs text-muted-foreground w-8 text-right">
                    {cat.percent.toFixed(0)}%
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

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
