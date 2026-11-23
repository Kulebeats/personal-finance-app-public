import { TrendingUp, TrendingDown, ThumbsUp, ThumbsDown } from "lucide-react";
import { useWeeklyRecap } from "../WeeklyRecapContext";
import { useFormatters } from "@/contexts/SettingsContext";
import WeeklyChart from "../components/WeeklyChart";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useState } from "react";
import { formatCapturedWorth, formatPreviousWorth } from "../formatCapturedWorth";

export default function NetWorthStep() {
  const { data, isChecking, error, retry, nextStep, prevStep, submitStepFeedback } = useWeeklyRecap();
  const { formatCurrency } = useFormatters();
  const [feedbackGiven, setFeedbackGiven] = useState<
    "positive" | "negative" | null
  >(null);

  if (!data || isChecking || error) return <div role={error ? "alert" : "status"} className="space-y-4">
    <p>{error ? "Unable to refresh net worth. Please try again." : "Checking current access to net worth…"}</p>
    {error && <Button onClick={retry}>Retry</Button>}
  </div>;

  const { netWorth } = data;
  const isPositive = netWorth.change !== null && netWorth.change >= 0;
  const formatWorth = (value: number) => formatCapturedWorth(value, netWorth.currency, formatCurrency);
  const previousWorth = formatPreviousWorth(netWorth, formatCurrency);
  const chartPoints = netWorth.series.filter(point => !point.currency || point.currency === netWorth.currency);

  const handleFeedback = (type: "positive" | "negative") => {
    setFeedbackGiven(type);
    submitStepFeedback(type);
    // Auto advance after short delay if positive? or just let user click next
    // UX: let user click next to digest
  };

  return (
    <div className="flex flex-col space-y-6">
      <div className="text-center space-y-2">
        <h3 className="text-xl font-semibold">Net Worth Update</h3>
        <p className="text-foreground/70 text-sm">
          How your assets tracked this week
        </p>
      </div>

      <div className="flex flex-col items-center justify-center space-y-2">
        {netWorth.current === null ? <p>Historical net worth is unavailable</p> : <>
          <span className="text-4xl font-bold tracking-tighter">{formatCapturedWorth(netWorth.currentMoney?.amount ?? netWorth.current, netWorth.currentMoney?.currency ?? netWorth.currency, formatCurrency)}</span>
          {netWorth.asOf && <p className="text-sm text-muted-foreground">Snapshot {netWorth.asOf}</p>}
        </>}
        {netWorth.change === null && previousWorth !== null && <p className="text-sm text-muted-foreground">
          Previous snapshot {netWorth.previousAsOf}: {previousWorth}
        </p>}
        {netWorth.change === null ? <p className="text-sm text-muted-foreground">
          {previousWorth === null ? "Previous period unavailable" : "Comparison unavailable"}
        </p> : <div
          className={cn(
            "flex items-center gap-1 text-sm font-medium",
            isPositive ? "text-emerald-500" : "text-rose-500"
          )}
        >
          {isPositive ? (
            <TrendingUp className="w-4 h-4" />
          ) : (
            <TrendingDown className="w-4 h-4" />
          )}
          <span>
            {isPositive ? "+" : ""}
            {formatWorth(netWorth.change)}
            {netWorth.changePercent !== null && ` (${netWorth.changePercent.toFixed(1)}%)`}
          </span>
        </div>}
      </div>

      {netWorth.current !== null && chartPoints.length > 0 && <div className="h-[200px] w-full">
        <WeeklyChart
          data={chartPoints}
          currency={netWorth.currency ?? undefined}
          title="Captured net worth"
          color={
            isPositive ? "hsl(var(--chart-income))" : "hsl(var(--chart-expense))"
          }
        />
      </div>}

      <div className="flex flex-col items-center gap-4 pt-4">
        <p className="text-sm text-foreground/70">
          How does this look to you?
        </p>
        <div className="flex gap-4">
          <Button
            variant="outline"
            size="icon"
            className={cn(
              "rounded-full w-12 h-12 transition-colors",
              feedbackGiven === "positive" &&
                "bg-emerald-100 border-emerald-500 text-emerald-600 dark:bg-emerald-900/30"
            )}
            onClick={() => handleFeedback("positive")}
            aria-label="Positive feedback"
          >
            <ThumbsUp className="w-5 h-5" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            className={cn(
              "rounded-full w-12 h-12 transition-colors",
              feedbackGiven === "negative" &&
                "bg-rose-100 border-rose-500 text-rose-600 dark:bg-rose-900/30"
            )}
            onClick={() => handleFeedback("negative")}
            aria-label="Negative feedback"
          >
            <ThumbsDown className="w-5 h-5" />
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
