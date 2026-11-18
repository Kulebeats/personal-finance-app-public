import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useWeeklyRecap } from "../WeeklyRecapContext";

export default function WelcomeStep() {
  const { data, nextStep } = useWeeklyRecap();

  // Format date range
  const formatDate = (dateStr?: string) => {
    if (!dateStr) return "";
    return new Date(dateStr).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
    });
  };

  const weekRange =
    data?.weekStart && data?.weekEnd
      ? `${formatDate(data.weekStart)} - ${formatDate(data.weekEnd)}`
      : "This Week";

  return (
    <div className="flex flex-col items-center text-center space-y-8 py-8">
      <div
        className="w-20 h-20 bg-primary/10 rounded-full flex items-center justify-center text-primary animate-in fade-in-0 zoom-in-95 duration-300"
      >
        <Sparkles className="w-10 h-10" />
      </div>

      <div className="space-y-4 max-w-sm">
        <h2 className="text-2xl font-bold tracking-tight animate-in fade-in-0 slide-in-from-bottom-1 duration-300">
          Your Weekly Insight
        </h2>

        <p className="text-muted-foreground animate-in fade-in-0 slide-in-from-bottom-1 duration-300">
          Let's see how your finances performed during <br />
          <span className="font-semibold text-foreground">{weekRange}</span>.
        </p>
      </div>

      <div className="w-full max-w-xs animate-in fade-in-0 slide-in-from-bottom-1 duration-300">
        <Button
          size="lg"
          className="w-full rounded-full"
          onClick={nextStep}
        >
          Let's Dive In
        </Button>
      </div>
    </div>
  );
}
